import test from 'node:test';
import assert from 'node:assert/strict';
import { afterClosing, closingDesk, closingUser, istanbulClock } from '../server/daily-close.js';
import cronClose from '../api/cron-close.js';

const response = () => ({ setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
test('22:00 Turkey time closes penalty-free without altering printed QR', () => {
  assert.equal(afterClosing(Date.parse('2026-10-13T18:59:59.000Z')), false);
  assert.equal(afterClosing(Date.parse('2026-10-13T19:00:00.000Z')), true);
  assert.equal(istanbulClock(Date.parse('2026-10-13T19:00:00Z')).dayKey, '2026-10-13');
  const original = { id: 2, qrCode: 'ORIGINAL-PRINTED-QR', status: 'reported', occupant: 'a', reportIssuedAt: 1, reportEndTime: 9999, pendingOccupant: 'b' };
  const closed = closingDesk(original);
  assert.equal(closed.qrCode, original.qrCode);
  assert.equal(closed.occupant, null);
  assert.equal(closed.pendingOccupant, null);
  assert.equal(closed.status, 'available');
  const user = { id: 'a', pin: '12345678', specialCode: '87654321', activeDeskId: 2, strikes: 1, violationHistory: [1000], restrictedUntil: 12345 };
  const after = closingUser(user);
  assert.equal(after.activeDeskId, null);
  assert.equal(after.pin, user.pin);
  assert.equal(after.specialCode, user.specialCode);
  assert.equal(after.strikes, 1);
  assert.deepEqual(after.violationHistory, [1000]);
  assert.equal(after.restrictedUntil, user.restrictedUntil);
});
test('scheduled closing cannot be called without CRON_SECRET', async () => {
  const old = process.env.CRON_SECRET;
  try {
    delete process.env.CRON_SECRET;
    const res = response();
    await cronClose({ method: 'GET', headers: {} }, res);
    assert.equal(res.code, 401);
  } finally {
    if (old === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = old;
  }
});
