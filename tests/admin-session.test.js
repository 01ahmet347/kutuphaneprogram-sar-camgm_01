import test from 'node:test';
import assert from 'node:assert/strict';
import { requireActiveAdmin } from '../server/admin-session.js';
const current = { exists: true, data: () => ({ sessionId: 'latest' }) };
test('only the latest manager token is authorized', async () => {
  await requireActiveAdmin({ admin: true, adminSessionId: 'latest' }, async () => current);
  await assert.rejects(requireActiveAdmin({ admin: true, adminSessionId: 'former' }, async () => current), /Başka bir yönetici/);
  await assert.rejects(requireActiveAdmin({ admin: true }, async () => current), /yetkisi gerekli/);
  await assert.rejects(requireActiveAdmin({ role: 'student', adminSessionId: 'latest' }, async () => current), /yetkisi gerekli/);
});
