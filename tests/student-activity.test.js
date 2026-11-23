import test from 'node:test';
import assert from 'node:assert/strict';
import { createStudentActivityHandler } from '../server/student-activity.js';

const response = () => ({
  headers: {},
  setHeader(name, value) { this.headers[name] = value; },
  status(code) { this.code = code; return this; },
  json(body) { this.body = body; return this; }
});

const makeHandler = overrides => createStudentActivityHandler({
  async authenticateStudent() { return 'student-1'; },
  async saveFeedback(uid, input) { return { uid, input }; },
  async savePushToken(uid, token) { return { uid, token }; },
  async saveAuditEvent(uid, event) { return { uid, event }; },
  ...overrides
});

test('student activity endpoint only accepts POST and requires authentication', async () => {
  const handler = makeHandler({ async authenticateStudent() { return null; } });
  const getResponse = response();
  await handler({ method: 'GET' }, getResponse);
  assert.equal(getResponse.code, 405);
  assert.equal(getResponse.headers.Allow, 'POST');

  const postResponse = response();
  await handler({ method: 'POST', body: { action: 'feedback' } }, postResponse);
  assert.equal(postResponse.code, 401);
});

test('student feedback forwards only validated content and stable record id', async () => {
  const handler = makeHandler();
  const res = response();
  await handler({ method: 'POST', body: { action: 'feedback', id: 'FDB-1', type: 'complaint', message: '  Masa dolu  ' } }, res);
  assert.equal(res.code, 200);
  assert.deepEqual(res.body.result, {
    uid: 'student-1',
    input: { id: 'FDB-1', type: 'complaint', message: 'Masa dolu' }
  });

  const invalid = response();
  await handler({ method: 'POST', body: { action: 'feedback', id: 'bad/id', type: 'complaint', message: 'valid' } }, invalid);
  assert.equal(invalid.code, 400);
});

test('student activity rejects attempts to append administrative or violation records', async () => {
  const handler = makeHandler();
  for (const type of ['IHLAL', 'ADMIN_LOGIN', 'MASA_ADMIN_MUDAHALE']) {
    const res = response();
    await handler({
      method: 'POST',
      body: { action: 'audit-event', record: { id: 'event-1', type, message: 'forged', deskId: 1 } }
    }, res);
    assert.equal(res.code, 400);
  }
});

test('student push-token request validates token size and is bound to authenticated uid', async () => {
  const handler = makeHandler();
  const res = response();
  await handler({ method: 'POST', body: { action: 'register-push-token', token: 'x'.repeat(20) } }, res);
  assert.equal(res.code, 200);
  assert.equal(res.body.result.uid, 'student-1');

  const invalid = response();
  await handler({ method: 'POST', body: { action: 'register-push-token', token: 'short' } }, invalid);
  assert.equal(invalid.code, 400);
});
