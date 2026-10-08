import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/admin-student-create.js';

const response = () => ({
  headers: {},
  setHeader(name, value) {
    this.headers[name] = value;
  },
  status(code) {
    this.code = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  }
});

test('admin student creation refuses non-POST requests', async () => {
  const res = response();

  await handler({ method: 'GET' }, res);

  assert.equal(res.code, 405);
  assert.equal(res.headers.Allow, 'POST');
});

test('admin student creation requires an authorization token', async () => {
  const res = response();

  await handler({ method: 'POST', body: {} }, res);

  assert.equal(res.code, 401);
  assert.equal(res.body.error, 'unauthenticated');
  assert.equal(res.headers['Cache-Control'], 'no-store');
});
