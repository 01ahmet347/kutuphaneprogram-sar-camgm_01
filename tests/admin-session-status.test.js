import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdminSessionStatusHandler, requireActiveAdmin } from '../server/admin-session.js';
import { readFileSync } from 'node:fs';

const response = () => ({
  headers: {}, setHeader(name, value) { this.headers[name] = value; },
  status(code) { this.code = code; return this; },
  json(value) { this.body = value; return this; }
});

const active = { exists: true, data: () => ({sessionId: 'manager-new'}) };
const validate = decoded => requireActiveAdmin(decoded, async () => active);
const handlerFor = authenticate => createAdminSessionStatusHandler({ authenticate, validate });

 test('manager session status reports valid, live administrator', async () => {
  const res = response();
  await handlerFor(async () => ({ admin: true, adminSessionId: 'manager-new' }))({ method: 'GET' }, res);
  assert.equal(res.code, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.equal(res.headers['Cache-Control'], 'no-store');
});

test('previous administrator is rejected with unambiguous replacement code', async () => {
  const res = response();
  await handlerFor(async () => ({ admin: true, adminSessionId: 'manager-old' }))({ method: 'GET' }, res);
  assert.equal(res.code, 403);
  assert.equal(res.body.error, 'admin_session_replaced');
});

test('network/Firebase fault remains a 503, not a false replaced-manager result', async () => {
  const res = response();
  await handlerFor(async () => ({ admin: true, adminSessionId: 'manager-new' }))({ method: 'GET' }, res);
  assert.equal(res.code, 200);
  const fails = createAdminSessionStatusHandler({
    authenticate: async () => ({ admin: true, adminSessionId: 'manager-new' }),
    validate: async () => { throw Object.assign(new Error('Connection temporarily failed'), { code: 'unavailable' }); }
  });
  const errorRes = response();
  await fails({ method: 'GET' }, errorRes);
  assert.equal(errorRes.code, 503);
  assert.equal(errorRes.body.error, 'admin_session_check_unavailable');
});

test('unauthenticated visitor and non-manager are never accepted', async () => {
  const unauthorized = response();
  await handlerFor(async () => { throw Object.assign(new Error('Login required'), { status: 401 }); })({ method: 'GET' }, unauthorized);
  assert.equal(unauthorized.code, 401);
  const nonmanager = response();
  await handlerFor(async () => ({ role: 'student' }))({ method: 'GET' }, nonmanager);
  assert.equal(nonmanager.code, 403);
  assert.equal(nonmanager.body.error, 'admin_required');
});

test('status endpoint allows only GET', async () => {
  const res = response();
  await handlerFor(async () => ({ admin: true, adminSessionId: 'manager-new' }))({method: 'POST'}, res);
  assert.equal(res.code, 405);
  assert.equal(res.headers.Allow, 'GET');
});

test('admin UI does not sign out on Firestore cache/error or unknown HTTP failures', () => {
  const src = readFileSync(new URL('../kutuphaneprogramıguncell.jsx', import.meta.url), 'utf8');
  const start = src.indexOf('  // Yönetici oturumunu sadece sunucunun kesin kararına göre kapat.');
  const end = src.indexOf('  const stableJson = value =>', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const listener = src.slice(start, end);
  assert.match(listener, /snap\.metadata\.fromCache\) return/);
  assert.match(listener, /response\.status !== 403\) return/);
  assert.match(listener, /result\?\.error !== 'admin_session_replaced'\) return/);
  assert.match(listener, /onSnapshot\(/);
  assert.match(listener, /verifyWithServer\(\)/);
  assert.doesNotMatch(listener, /\(\) => replaced\(\)/);
});
