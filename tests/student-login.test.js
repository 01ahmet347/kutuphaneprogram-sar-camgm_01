import test from 'node:test';
import assert from 'node:assert/strict';
import { createStudentLoginHandler } from '../server/student-auth.js';

const response = () => ({
  headers: {},
  setHeader(name, value) { this.headers[name] = value; },
  status(code) { this.code = code; return this; },
  json(body) { this.body = body; return this; }
});

const request = (body, method = 'POST') => ({ method, body });
const student = { id: 'student-1', specialCode: '12345678', pin: '87654321', name: 'Öğrenci', pushTokens: ['private-token'] };

test('student login rejects unsupported methods', async () => {
  const handler = createStudentLoginHandler({});
  const res = response();
  await handler(request({}, 'GET'), res);
  assert.equal(res.code, 405);
  assert.equal(res.headers.Allow, 'POST');
});

test('student login validates credential shape before lookup', async () => {
  let lookups = 0;
  const handler = createStudentLoginHandler({
    async findBySpecialCode() { lookups++; return []; },
    async createCustomToken() { throw new Error('must not be called'); }
  });
  const res = response();
  await handler(request({ specialCode: '1234', pin: '87654321' }), res);
  assert.equal(res.code, 400);
  assert.equal(lookups, 0);
});

test('student login throttles before querying credential records', async () => {
  let lookups = 0;
  const handler = createStudentLoginHandler({
    async isRateLimited() { return true; },
    async findBySpecialCode() { lookups++; return []; },
    async createCustomToken() { throw new Error('must not be called'); }
  });
  const res = response();
  await handler(request({ specialCode: student.specialCode, pin: student.pin }), res);
  assert.equal(res.code, 429);
  assert.equal(lookups, 0);
});

test('student login returns a student token and excludes credentials and push tokens', async () => {
  let tokenArgs;
  let attemptsCleared = false;
  const handler = createStudentLoginHandler({
    async findBySpecialCode(code) {
      return code === student.specialCode ? [{ id: student.id, user: student, deleted: false }] : [];
    },
    async createCustomToken(...args) { tokenArgs = args; return 'custom-token'; },
    async clearAttempts() { attemptsCleared = true; }
  });
  const res = response();
  await handler(request({ specialCode: student.specialCode, pin: student.pin }), res);
  assert.equal(res.code, 200);
  assert.equal(res.body.token, 'custom-token');
  assert.deepEqual(tokenArgs, [student.id, { role: 'student' }]);
  assert.equal(res.body.user.id, student.id);
  assert.equal('pin' in res.body.user, false);
  assert.equal('pushTokens' in res.body.user, false);
  assert.equal(attemptsCleared, true);
  assert.equal(res.headers['Cache-Control'], 'no-store');
});

test('student login rejects incorrect, ambiguous, and deleted credentials', async () => {
  const handler = createStudentLoginHandler({
    async findBySpecialCode() {
      return [{ id: student.id, user: student, deleted: false }];
    },
    async createCustomToken() { throw new Error('must not be called'); }
  });
  const wrongPin = response();
  await handler(request({ specialCode: student.specialCode, pin: '11111111' }), wrongPin);
  assert.equal(wrongPin.code, 401);

  const deletedHandler = createStudentLoginHandler({
    async findBySpecialCode() { return [{ id: student.id, user: student, deleted: true }]; },
    async createCustomToken() { throw new Error('must not be called'); }
  });
  const deleted = response();
  await deletedHandler(request({ specialCode: student.specialCode, pin: student.pin }), deleted);
  assert.equal(deleted.code, 401);

  const ambiguousHandler = createStudentLoginHandler({
    async findBySpecialCode() {
      return [
        { id: student.id, user: student, deleted: false },
        { id: 'duplicate', user: student, deleted: false }
      ];
    },
    async createCustomToken() { throw new Error('must not be called'); }
  });
  const ambiguous = response();
  await ambiguousHandler(request({ specialCode: student.specialCode, pin: student.pin }), ambiguous);
  assert.equal(ambiguous.code, 401);
});
