import { getAuth } from 'firebase-admin/auth';
import { adminApp } from '../server/firebase-admin.js';
import { createAdminSessionStatusHandler, requireActiveAdmin } from '../server/admin-session.js';

export default createAdminSessionStatusHandler({
  async authenticate(req) {
    const token = /^Bearer\s+(.+)$/i.exec(String(req.headers?.authorization || ''))?.[1];
    if (!token) throw Object.assign(new Error('Kimlik doğrulaması gerekli.'), { status: 401 });
    return getAuth(adminApp()).verifyIdToken(token);
  },
  validate: requireActiveAdmin
});
