import test from 'node:test';
import assert from 'node:assert/strict';
import { approveAccounts, updateAdminAccount } from '../server/user-approval.js';
import { countRecentUnpardonedViolations, violationPolicyPatch } from '../src/restriction-policy.js';
import { withoutAccountApprovalWrites } from '../src/authoritative-session.js';
import { createCloudActions } from '../src/cloud-transactions.js';

const DAY = 86400000;
const at = Date.parse('2026-10-17T12:00:00.000Z');
const dayKey = () => '2026-10-17';

function fixture() {
  const user = {
    id: 'u1', name: 'Öğrenci', pin: '12345678', specialCode: '87654321',
    blocked: false, pendingApproval: false,
    restrictedUntil: at + DAY * 7, restrictionReason: 'Eski ceza',
    violationHistory: [at - 2 * DAY, at - DAY], strikes: 2,
    activeDeskId: 7, activeDeskRole: 'owner',
    breaks: { short: 3, long: 1 }, breaksResetDate: '2026-10-17', violationsResetDate: '2026-10-17'
  };
  const desk = { id: 7, status: 'occupied', occupant: 'u1', sessionStartTime: at - 10000, qrCode: 'QR-7' };
  const records = new Map([['sgmUsers/u1', user], ['sgmDesks/7', desk]]);
  const collection = bucket => ({doc: id => ({key: `${bucket}/${id}`})});
  const runTransaction = async callback => {
    const writes = [];
    const tx = {
      async get(ref) {
        const key = typeof ref === 'string' ? ref : ref.key;
        const row = records.get(key);
        return {
          exists: row !== undefined, data: () => structuredClone(row), ref,
        };
      },
      set(ref, value, options = {}) { writes.push({key: typeof ref === 'string' ? ref : ref.key, value: structuredClone(value), merge: options.merge === true}); }
    };
    const result = await callback(tx);
    for (const write of writes) records.set(write.key, write.merge ? { ...records.get(write.key), ...write.value } : write.value);
    return result;
  };
  const actions = createCloudActions({
    db: {}, ref: (bucket,id) => `${bucket}/${id}`, now: () => at + 120000,
    runTransaction: (_, callback) => runTransaction(callback), dayKey,
    settings: () => ({}), isRestricted: (user, timestamp) => user.blocked || user.pendingApproval || Number(user.restrictedUntil || 0) > timestamp,
    lostDeskToday: () => false,
    applyViolationPolicy: (u,deskId,timestamp) => violationPolicyPatch(u, deskId, timestamp, dayKey)
  });
  return { records, collection, runTransaction, actions };
}

test('restriction lift preserves active desk, credentials and archived violations', async () => {
  const f = fixture();
  const [approved] = await approveAccounts({ ids: ['u1'], collection: f.collection, runTransaction: f.runTransaction, now: () => at });
  const u = f.records.get('sgmUsers/u1');
  assert.equal(u.blocked, false);
  assert.equal(u.restrictedUntil, 0);
  assert.equal(u.restrictionClearedAt, at);
  assert.equal(u.activeDeskId, 7);
  assert.equal(u.strikes, 2);
  assert.equal(u.pin, '12345678');
  assert.deepEqual(u.violationHistory, [at - 2 * DAY, at - DAY]);
  assert.equal(f.records.get('sgmDesks/7').occupant, 'u1');
  assert.equal(approved.restrictionClearedAt, at);
  assert.equal(await f.actions.expireDesk(7), null);
  assert.equal(f.records.get('sgmDesks/7').occupant, 'u1');
});

test('old violations remain archived but cannot trigger another restriction after approval', () => {
  const user = { violationHistory: [at - DAY * 2, at - DAY], restrictionClearedAt: at, restrictedUntil: 0 };
  const first = violationPolicyPatch(user, 7, at + 60000, dayKey);
  assert.equal(first.restrictedUntil, 0);
  assert.equal(countRecentUnpardonedViolations({ ...user, ...first }, at + 60000), 1);
  const second = violationPolicyPatch({ ...user, ...first }, 8, at + 120000, dayKey);
  assert.equal(second.restrictedUntil, at + 120000 + 7 * DAY);
  assert.deepEqual(second.violationHistory, [at - DAY * 2, at - DAY, at + 60000, at + 120000]);
});

test('report started before admin pardon cannot expire later into a restriction or vacant desk', async () => {
  const f = fixture();
  f.records.set('sgmDesks/7', {
    ...f.records.get('sgmDesks/7'), status: 'reported',
    reportIssuedAt: at - 120000, reportEndTime: at + 1000
  });
  await approveAccounts({ ids: ['u1'], collection: f.collection, runTransaction: f.runTransaction, now: () => at });
  const result = await f.actions.expireDesk(7);
  assert.equal(result.mode, 'approval_grace');
  assert.equal(result.verified, true);
  assert.equal(f.records.get('sgmDesks/7').occupant, 'u1');
  assert.equal(f.records.get('sgmDesks/7').status, 'occupied');
  assert.equal(f.records.get('sgmUsers/u1').restrictedUntil, 0);
  assert.equal(f.records.get('sgmUsers/u1').activeDeskId, 7);
});

test('stale admin restriction update conflicts after approval; unrelated name change keeps approval', async () => {
  const f = fixture();
  const before = structuredClone(f.records.get('sgmUsers/u1'));
  await approveAccounts({ ids: ['u1'], collection: f.collection, runTransaction: f.runTransaction, now: () => at });
  await assert.rejects(updateAdminAccount({ id: 'u1', patch: { restrictedUntil: at + DAY * 2 },
    expectedPermission: before, collection: f.collection, runTransaction: f.runTransaction, now: () => at + 1000 }), /başka bir işlemle değişmiş/);
  assert.equal(f.records.get('sgmUsers/u1').restrictedUntil, 0);
  const edited = await updateAdminAccount({ id: 'u1', patch: { name: 'Yeni Ad' }, collection: f.collection, runTransaction: f.runTransaction, now: () => at + 1000 });
  assert.equal(edited.name, 'Yeni Ad');
  assert.equal(edited.restrictedUntil, 0);
  assert.equal(edited.activeDeskId, 7);
  assert.equal(f.records.get('sgmDesks/7').occupant, 'u1');
  assert.deepEqual(withoutAccountApprovalWrites({ blocked: true, restrictionClearedAt: 0, name: 'Yeni Ad' }), { name: 'Yeni Ad' });
});

test('administrator manually lifts a restriction via editor without clearing session', async () => {
  const f = fixture();
  const before = structuredClone(f.records.get('sgmUsers/u1'));
  const edited = await updateAdminAccount({ id: 'u1', patch: { restrictedUntil: 0, restrictionReason: '' },
    expectedPermission: before, collection: f.collection, runTransaction: f.runTransaction, now: () => at });
  assert.equal(edited.restrictionClearedAt, at);
  assert.equal(edited.activeDeskId, 7);
  assert.equal(f.records.get('sgmDesks/7').occupant, 'u1');
});
