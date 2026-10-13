// Firestore is the single source of truth for the active administrator session.
import { randomUUID } from 'node:crypto';
import { dataCollection } from './firebase-admin.js';

export const adminSessionRef = () => dataCollection('sgmAdminSessions').doc('active');
export async function activateAdminSession(createCustomToken) {
  const sessionId = randomUUID();
  const token = await createCustomToken('sgm-admin', { admin: true, adminSessionId: sessionId });
  await adminSessionRef().set({ sessionId, startedAt: Date.now(), uid: 'sgm-admin' });
  return token;
}
export async function requireActiveAdmin(decoded, getCurrent = () => adminSessionRef().get()) {
  if (decoded?.admin !== true || typeof decoded.adminSessionId !== 'string') {
    throw Object.assign(new Error('Yönetici yetkisi gerekli.'), { status: 403, code: 'admin_required' });
  }
  const current = await getCurrent();
  if (!current.exists || current.data()?.sessionId !== decoded.adminSessionId) {
    throw Object.assign(new Error('Başka bir yönetici giriş yaptı. Yeniden giriş yapın.'), { status: 403, code: 'admin_session_replaced' });
  }
  return decoded;
}


// A transient Firestore listener/network failure must never be mistaken for a
// replaced manager. Only the server's confirmed admin_session_replaced result
// should remove an otherwise valid active manager from the UI.
export function createAdminSessionStatusHandler({ authenticate, validate }) {
  return async function adminSessionStatusHandler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    }
    try {
      const decoded = await authenticate(req);
      await validate(decoded);
      return res.status(200).json({ ok: true });
    } catch (error) {
      if (error.code === 'admin_session_replaced') {
        return res.status(403).json({ ok: false, error: 'admin_session_replaced', message: error.message });
      }
      if (error.status === 401 || String(error.code || '').startsWith('auth/')) {
        return res.status(401).json({ ok: false, error: 'invalid_admin_session' });
      }
      if (error.status === 403) {
        return res.status(403).json({ ok: false, error: 'admin_required' });
      }
      console.error('Admin session check failed:', error.code || 'unknown');
      return res.status(503).json({ ok: false, error: 'admin_session_check_unavailable' });
    }
  };
}
