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
    throw Object.assign(new Error('Yönetici yetkisi gerekli.'), { status: 403 });
  }
  const current = await getCurrent();
  if (!current.exists || current.data()?.sessionId !== decoded.adminSessionId) {
    throw Object.assign(new Error('Başka bir yönetici giriş yaptı. Yeniden giriş yapın.'), { status: 403 });
  }
  return decoded;
}
