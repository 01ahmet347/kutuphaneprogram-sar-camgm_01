import test from 'node:test';
import assert from 'node:assert/strict';
import { createCloudActions } from '../src/cloud-transactions.js';
import { hasCurrentOwnerSession, hasPreviousClosingSession, lastIstanbulClosingAt, closingDesk } from '../src/desk-day-safety.js';
import { recoverPreviousDayDesks } from '../server/morning-recovery.js';
import { createStudentDeskHandler } from '../server/student-desk.js';

const morning = Date.parse('2026-10-22T04:15:00Z'); // 07:15 Istanbul
const old = Date.parse('2026-10-21T12:15:00Z');
const today = Date.parse('2026-10-22T04:10:00Z');

const clone = x => structuredClone(x);
function fakeDb(source) {
  const records = new Map(Object.entries(source).map(([key, value]) => [key, clone(value)]));
  const writes = [];
  const ref = (bucket, id) => `${bucket}/${id}`;
  const collection = name => ({
    name, firestore: { runTransaction: async callback => {
      const pending = [];
      const value = await callback({
        get: async key => {
          if (typeof key === 'string') return {
            exists: () => records.has(key), data: () => clone(records.get(key)), ref: key
          };
          return { docs: [...records].filter(([path]) => path.startsWith(`${key.name}/`))
            .map(([path, data]) => ({ id: path.split('/')[1], ref: path, data: () => clone(data) })) };
        },
        set: (key, row, opts) => pending.push({ key, row: clone(row), opts }),
        create: (key, row) => pending.push({ key, row: clone(row) })
      });
      for (const { key, row, opts } of pending) {
        records.set(key, opts?.merge ? { ...records.get(key), ...row } : row);
        writes.push({ key, row, opts });
      }
      return value;
    } },
    doc(id) { return `${name}/${id}`; }
  });
  const runTransaction = (_, callback) => collection('anything').firestore.runTransaction(callback);
  return { records, writes, ref, collection, runTransaction };
}
function createActions(db) {
  return createCloudActions({ db: {}, runTransaction: db.runTransaction, ref: db.ref,
    settings: () => ({ reportsEnabled: true }), dayKey: () => '2026-10-22',
    isRestricted: () => false, lostDeskToday: () => false,
    applyViolationPolicy: (user, desk, at) => ({ violationHistory: [...(user.violationHistory || []), at] }),
    now: () => morning });
}

test('22:00 Istanbul boundary and real day session are validated, not the report creation time', () => {
  assert.equal(lastIstanbulClosingAt(morning), Date.parse('2026-10-21T19:00:00Z'));
  assert.equal(hasCurrentOwnerSession({ occupant: 'student', sessionStartTime: old }, morning), false);
  assert.equal(hasCurrentOwnerSession({ occupant: 'student', sessionStartTime: today }, morning), true);
  assert.equal(hasCurrentOwnerSession({ occupant: 'student', sessionStartTime: null }, morning), false);
  assert.equal(hasPreviousClosingSession({ occupant: 'student', sessionStartTime: old }, morning), true);
  assert.equal(hasPreviousClosingSession({ occupant: 'student', sessionStartTime: today }, morning), false);
  assert.equal(hasPreviousClosingSession({ occupant: 'student', sessionStartTime: null }, morning), false);
});

test('07:15 report against yesterday\'s occupied/on_break desk is rejected without any writes', async () => {
  for (const status of ['occupied', 'on_break']) {
    const db = fakeDb({
      'sgmUsers/reporter': { activeDeskId: null },
      'sgmUsers/owner': { activeDeskId: 8, strikes: 0, pin: '12345678' },
      'sgmDesks/8': { id: 8, status, occupant: 'owner', sessionStartTime: old, breakEndTime: old + 1800000 }
    });
    await assert.rejects(createActions(db).reportDesk({ userId: 'reporter', deskId: 8, targetUserId: 'owner' }),
      /Masa durumu değişti/);
    assert.equal(db.writes.length, 0);
  }
});

test('a fresh genuine desk session still allows the existing report behavior', async () => {
  const db = fakeDb({
    'sgmUsers/reporter': { activeDeskId: null, canReport: true },
    'sgmUsers/owner': { activeDeskId: 8, strikes: 0 },
    'sgmDesks/8': { id: 8, status: 'occupied', occupant: 'owner', sessionStartTime: today }
  });
  const result = await createActions(db).reportDesk({ userId: 'reporter', deskId: 8, targetUserId: 'owner' });
  assert.equal(result.desk.status, 'reported');
  assert.equal(db.records.get('sgmUsers/owner').strikes, 0);
});

test('a newly issued 07:15 report on an old session cannot cause a 07:20 violation', async () => {
  const db = fakeDb({
    'sgmUsers/owner': { activeDeskId: 8, strikes: 1, violationHistory: [123],
      pin: '12345678', specialCode: '55555555', restrictedUntil: 1234 },
    'sgmDesks/8': { id: 8, status: 'reported', occupant: 'owner',
      sessionStartTime: old, reportIssuedAt: morning - 300000, reportEndTime: morning }
  });
  const result = await createActions(db).expireDesk(8);
  assert.equal(result.mode, 'closing_grace');
  assert.equal(result.user.activeDeskId, null);
  assert.equal(db.records.get('sgmUsers/owner').strikes, 1);
  assert.deepEqual(db.records.get('sgmUsers/owner').violationHistory, [123]);
  assert.equal(db.records.get('sgmUsers/owner').pin, '12345678');
  assert.equal(db.records.get('sgmUsers/owner').restrictedUntil, 1234);
  assert.equal([...db.records.keys()].some(key => key.startsWith('sgmViolations/')), false);
  assert.equal([...db.records.keys()].some(key => key.startsWith('sgmAudit/')), false);
});

test('morning recovery clears only confirmed yesterday sessions and linked desk fields, preserving accounts, QR, and today desk', async () => {
  const db = fakeDb({
    'sgmDesks/8': { id: 8, status: 'on_break', occupant: 'owner', sessionStartTime: old,
      qrCode: 'QR-8-original', breakEndTime: old + 1800000 },
    'sgmDesks/9': { id: 9, status: 'occupied', occupant: 'today-owner', sessionStartTime: today,
      qrCode: 'QR-9-original' },
    'sgmUsers/owner': { id: 'owner', activeDeskId: 8, strikes: 2,
      pin: '87654321', specialCode: '12345678', violationHistory: [456],
      restrictedUntil: today + 100000 },
    'sgmUsers/today-owner': { id: 'today-owner', activeDeskId: 9, pin: '11111111', strikes: 0 }
  });
  const first = await recoverPreviousDayDesks({ at: morning, collection: db.collection });
  assert.deepEqual(first, { recoveredDesks: 1, recoveredUsers: 1 });
  assert.equal(db.records.get('sgmDesks/8').occupant, null);
  assert.equal(db.records.get('sgmDesks/8').qrCode, 'QR-8-original');
  assert.deepEqual(db.records.get('sgmDesks/9'), { id: 9, status: 'occupied', occupant: 'today-owner', sessionStartTime: today, qrCode: 'QR-9-original' });
  const user = db.records.get('sgmUsers/owner');
  assert.equal(user.activeDeskId, null);
  assert.equal(user.strikes, 2);
  assert.deepEqual(user.violationHistory, [456]);
  assert.equal(user.pin, '87654321');
  assert.equal(user.specialCode, '12345678');
  assert.equal(user.restrictedUntil, today + 100000);
  assert.equal(db.records.get('sgmUsers/today-owner').activeDeskId, 9);
  assert.equal([...db.records.keys()].filter(key => key.startsWith('sgmViolations/')).length, 0);
  const again = await recoverPreviousDayDesks({ at: morning, collection: db.collection });
  assert.deepEqual(again, { recoveredDesks: 0, recoveredUsers: 0 });
});

test('only authenticated student can call the day-recovery endpoint without deskId', async () => {
  const handler = createStudentDeskHandler({
    authenticateStudent: async () => 'student-a',
    createActions: async () => ({ recoverStale: async () => ({ recoveredDesks: 1, recoveredUsers: 1 }) })
  });
  const res = { setHeader() {}, status(code) { this.code = code; return this; }, json(data) { this.data = data; return this; } };
  await handler({ method: 'POST', body: { action: 'recover-stale' } }, res);
  assert.equal(res.code, 200);
  assert.deepEqual(res.data.result, { recoveredDesks: 1, recoveredUsers: 1 });
});
