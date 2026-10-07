import test from 'node:test';
import assert from 'node:assert/strict';
import { createStudentDeskHandler, getIstanbulDayKey } from '../server/student-desk.js';

const response = () => ({
  headers: {},
  setHeader(name, value) { this.headers[name] = value; },
  status(code) { this.code = code; return this; },
  json(body) { this.body = body; return this; }
});

test('student desk endpoint only accepts POST', async () => {
  const handler = createStudentDeskHandler({});
  const res = response();
  await handler({ method: 'GET' }, res);
  assert.equal(res.code, 405);
  assert.equal(res.headers.Allow, 'POST');
});

test('student desk endpoint rejects unauthenticated requests', async () => {
  const handler = createStudentDeskHandler({
    async authenticateStudent() { return null; },
    async createActions() { throw new Error('must not be called'); }
  });
  const res = response();
  await handler({ method: 'POST', body: {} }, res);
  assert.equal(res.code, 401);
});

test('student desk endpoint validates inputs and binds mutations to authenticated uid', async () => {
  let input;
  const handler = createStudentDeskHandler({
    async authenticateStudent() { return 'student-1'; },
    async createActions() {
      return {
        async reserve(value) {
          input = value;
          return {
            desk: { id: 2, pendingOccupant: 'student-1' },
            user: { id: 'student-1', pin: '87654321', pushTokens: ['secret'] },
            deadline: 1000
          };
        }
      };
    }
  });
  const res = response();
  await handler({ method: 'POST', body: { action: 'reserve', userId: 'other-user', deskId: 2, deviceId: 'device-1' } }, res);
  assert.equal(res.code, 200);
  assert.equal(input.userId, 'student-1');
  assert.equal(res.body.user.id, 'student-1');
  assert.equal('pin' in res.body.user, false);
  assert.equal('pushTokens' in res.body.user, false);

  const invalid = response();
  await handler({ method: 'POST', body: { action: 'claim', deskId: 2, deviceId: 'd' } }, invalid);
  assert.equal(invalid.code, 400);
});

test('student desk endpoint routes break, report, verification, and leave actions through authenticated uid', async () => {
  const calls = [];
  const actions = {
    async startBreak(input) { calls.push(['break-start', input]); return { desk: { id: 2 }, user: { id: input.userId } }; },
    async endBreak(input) { calls.push(['break-end', input]); return { desk: { id: 2 }, user: { id: input.userId } }; },
    async reportDesk(input) { calls.push(['report', input]); return { desk: { id: 2 }, user: { id: 'target' }, eventId: 'report-1' }; },
    async verifyPresence(input) { calls.push(['verify', input]); return { desk: { id: 2 }, user: { id: input.userId } }; },
    async leaveDesk(input) { calls.push(['leave', input]); return { desk: { id: 2 }, user: { id: input.userId } }; }
  };
  const handler = createStudentDeskHandler({
    async authenticateStudent() { return 'student-1'; },
    async createActions() { return actions; }
  });
  const requests = [
    { action: 'break-start', deskId: 2, type: 'short' },
    { action: 'break-end', deskId: 2, qrCode: 'QR-2-current' },
    { action: 'report', deskId: 2, targetUserId: 'target' },
    { action: 'verify', deskId: 2, qrCode: 'QR-2-current' },
    { action: 'leave', deskId: 2 }
  ];
  for (const body of requests) {
    const res = response();
    await handler({ method: 'POST', body }, res);
    assert.equal(res.code, 200);
  }
  assert.deepEqual(calls.map(([action]) => action), ['break-start', 'break-end', 'report', 'verify', 'leave']);
  assert.equal(calls.every(([, input]) => input.userId === 'student-1'), true);
  assert.equal(calls[2][1].targetUserId, 'target');
});

test('Istanbul day key follows the library timezone', () => {
  assert.equal(getIstanbulDayKey(new Date('2026-10-07T21:30:00.000Z')), '2026-10-08');
});
