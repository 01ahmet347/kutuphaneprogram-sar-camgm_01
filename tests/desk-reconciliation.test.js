import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { userLinkPatch, releasedDeskUserPatch, deskNeedsClosing } from '../server/desk-integrity.js';
import { preventClosedHoursSessionWrites } from '../src/session-write-guard.js';

const now = Date.parse('2026-10-15T16:00:00.000Z');
const baseUser = { id: 'u1', pin: '12345678', specialCode: '87654321', strikes: 2, violationHistory: [111], activeDeskId: 9 };

test('a desk marked available cannot leave a user showing active desk 9', () => {
  const patch = userLinkPatch(baseUser, 'u1', new Map([['9', { id: 9, status: 'available', occupant: null }]]), now);
  assert.deepEqual(patch, {
    activeDeskId: null, activeDeskRole: null,
    adminDeskOverrideDeskId: null, adminDeskOverrideSessionStart: null
  });
  const merged = { ...baseUser, ...patch };
  assert.equal(merged.activeDeskId, null);
  assert.equal(merged.pin, baseUser.pin);
  assert.equal(merged.specialCode, baseUser.specialCode);
  assert.equal(merged.strikes, 2);
  assert.deepEqual(merged.violationHistory, [111]);
});

test('valid owner and valid guest keep their active desk; other student does not', () => {
  const desks = new Map([['9', { id: 9, occupant: 'owner', guestOccupant: 'guest' }]]);
  assert.deepEqual(userLinkPatch({ activeDeskId: 9 }, 'owner', desks, now), {});
  assert.deepEqual(userLinkPatch({ activeDeskId: 9 }, 'guest', desks, now), {});
  assert.equal(userLinkPatch({ activeDeskId: 9 }, 'other', desks, now).activeDeskId, null);
});

test('valid reservation is preserved; missing/expired reservations are repaired', () => {
  const desks = new Map([['9', { id: 9, pendingOccupant: 'u1', pendingDeskDeadline: now + 60000 }]]);
  assert.deepEqual(userLinkPatch({ pendingDeskId: 9 }, 'u1', desks, now), {});
  assert.equal(userLinkPatch({ pendingDeskId: 9 }, 'u2', desks, now).pendingDeskId, null);
  assert.equal(userLinkPatch({ pendingDeskId: 13 }, 'u1', desks, now).pendingDeskId, null);
  assert.equal(userLinkPatch({ pendingDeskId: 9 }, 'u1', desks, now + 61000).pendingDeskId, null);
});

test('releasing an already available desk also repairs orphaned users', () => {
  assert.equal(deskNeedsClosing({ status: 'available', occupant: null }), false);
  assert.equal(releasedDeskUserPatch({ ...baseUser, pendingDeskId: 9 }, 9).activeDeskId, null);
  assert.equal(releasedDeskUserPatch({ activeDeskId: 8 }, 9).activeDeskId, undefined);
  assert.equal(deskNeedsClosing({ status: 'occupied', occupant: null }), true);
  assert.equal(deskNeedsClosing({ status: 'disabled', guestOccupant: 'u1' }), true);
});

test('a stale client cannot write active desks or reservations after closing or before opening', () => {
  for (const closedAt of ['2026-10-15T19:05:00Z', '2026-10-16T03:00:00Z']) {
    const desk = preventClosedHoursSessionWrites({ occupant: 'u1', status: 'occupied', qrCode: 'ORIGINAL' }, 'desks', Date.parse(closedAt));
    assert.deepEqual(desk, { qrCode: 'ORIGINAL' });
    const user = preventClosedHoursSessionWrites({ activeDeskId: 9, activeDeskRole: 'owner', name: 'Deneme' }, 'users', Date.parse(closedAt));
    assert.deepEqual(user, { name: 'Deneme' });
    assert.deepEqual(preventClosedHoursSessionWrites({ activeDeskId: null, activeDeskRole: null }, 'users', Date.parse(closedAt)), { activeDeskId: null, activeDeskRole: null });
  }
  assert.equal(preventClosedHoursSessionWrites({ activeDeskId: 9 }, 'users', Date.parse('2026-10-15T12:00:00Z')).activeDeskId, 9);
});

// Load production closing logic with only the Firebase import replaced. No
// package installation or live Firebase connection is needed for this test.
const source = await readFile(new URL('../server/daily-close.js', import.meta.url), 'utf8');
const stripped = source.replace(/^import [^\n]+;\n/gm, '');
const prelude = `
const dataCollection = () => { throw new Error('Pass mock collection'); };
const getIstanbulDayKey = date => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
const deskNeedsClosing = ${deskNeedsClosing.toString()};
`;
const { closeLibraryDay } = await import('data:text/javascript;base64,' + Buffer.from(prelude + stripped).toString('base64'));

function mockFirestore() {
  const items = new Map();
  const db = {
    runTransaction: async execute => {
      const tx = {
        async get(target) {
          if (target.kind === 'collection') {
            const prefix = `${target.name}/`;
            return { docs: [...items].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => {
              const id = key.slice(prefix.length);
              return { id, ref: { kind: 'doc', key }, data: () => structuredClone(value) };
            }) };
          }
          const value = items.get(target.key);
          return { exists: value !== undefined, data: () => structuredClone(value) };
        },
        set(ref, value, options = {}) {
          items.set(ref.key, structuredClone(options.merge ? { ...items.get(ref.key), ...value } : value));
        },
        create(ref, value) {
          assert.equal(items.has(ref.key), false);
          items.set(ref.key, structuredClone(value));
        }
      };
      return execute(tx);
    }
  };
  const collection = name => ({
    kind: 'collection', name, firestore: db,
    doc(id) { return { kind: 'doc', key: `${name}/${id}`, id }; }
  });
  return { collection, items };
}

test('22:00 server closing clears orphaned users, preserves credentials/QR; rechecks marker', async () => {
  const { items, collection } = mockFirestore();
  items.set('sgmDesks/9', { id: 9, status: 'available', occupant: null, qrCode: 'ORIGINAL' });
  items.set('sgmDesks/14', { id: 14, status: 'occupied', occupant: 'u2', qrCode: 'OTHER' });
  items.set('sgmUsers/u1', { ...baseUser });
  items.set('sgmUsers/u2', { id: 'u2', activeDeskId: 14, pin: '09876543' });
  const at = Date.parse('2026-10-15T19:01:00Z');
  const before = await closeLibraryDay({ collection, at: at - 61000 });
  assert.equal(before.reason, 'before_close');
  const first = await closeLibraryDay({ collection, at });
  assert.equal(first.deskCount, 1);
  assert.equal(first.userCount, 2);
  assert.equal(items.get('sgmUsers/u1').activeDeskId, null);
  assert.equal(items.get('sgmUsers/u1').pin, '12345678');
  assert.equal(items.get('sgmUsers/u1').strikes, 2);
  assert.equal(items.get('sgmDesks/14').qrCode, 'OTHER');
  assert.equal((await closeLibraryDay({ collection, at: at + 1000 })).reason, 'already_closed');
  items.set('sgmUsers/u1', { ...baseUser }); // a late legacy client writes the stale link
  const again = await closeLibraryDay({ collection, at: at + 3000 });
  assert.equal(again.recovered, true);
  assert.equal(again.userCount, 1);
  assert.equal(items.get('sgmUsers/u1').activeDeskId, null);
});
