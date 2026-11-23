import test from 'node:test';
import assert from 'node:assert/strict';
import { createStudentRecord, createStudentRegistrationHandler, generateStudentCredential } from '../server/student-registration.js';

const response = () => ({
  headers: {},
  setHeader(name, value) { this.headers[name] = value; },
  status(code) { this.code = code; return this; },
  json(body) { this.body = body; return this; }
});

test('student registration rejects unsupported methods', async () => {
  const handler = createStudentRegistrationHandler({});
  const res = response();
  await handler({ method: 'GET' }, res);
  assert.equal(res.code, 405);
  assert.equal(res.headers.Allow, 'POST');
});

test('student registration requires an authenticated anonymous user', async () => {
  let created = false;
  const handler = createStudentRegistrationHandler({
    async verifyAnonymousUser() { return null; },
    async createStudent() { created = true; }
  });
  const res = response();
  await handler({ method: 'POST' }, res);
  assert.equal(res.code, 401);
  assert.equal(created, false);
});

test('student registration throttles before creating another account', async () => {
  let created = false;
  const handler = createStudentRegistrationHandler({
    async verifyAnonymousUser() { return 'student-1'; },
    async isRateLimited() { return true; },
    async createStudent() { created = true; }
  });
  const res = response();
  await handler({ method: 'POST' }, res);
  assert.equal(res.code, 429);
  assert.equal(created, false);
});

test('student registration returns a profile separately from generated credentials', async () => {
  const handler = createStudentRegistrationHandler({
    async verifyAnonymousUser() { return 'student-1'; },
    async createStudent(uid) {
      assert.equal(uid, 'student-1');
      return { user: { id: uid, name: 'Yeni Kayıt' }, credentials: { specialCode: '12345678', pin: '87654321' } };
    }
  });
  const res = response();
  await handler({ method: 'POST' }, res);
  assert.equal(res.code, 201);
  assert.deepEqual(res.body.credentials, { specialCode: '12345678', pin: '87654321' });
  assert.equal(res.body.user.id, 'student-1');
  assert.equal(res.headers['Cache-Control'], 'no-store');
});

test('student record stays pending approval and credentials are eight digits', () => {
  const user = createStudentRecord({
    uid: 'student-1',
    specialCode: '12345678',
    pin: '87654321',
    settings: { shortBreakCount: 4, longBreakCount: 1 },
    now: 100
  });
  assert.equal(user.pendingApproval, true);
  assert.deepEqual(user.breaks, { short: 4, long: 1 });
  assert.equal(user.createdAt, 100);
  assert.match(generateStudentCredential(), /^\d{8}$/);
});
