import { getAuth } from 'firebase-admin/auth';
import { adminApp, dataCollection } from '../server/firebase-admin.js';
import { requireActiveAdmin } from '../server/admin-session.js';
import { createCloudActions } from '../src/cloud-transactions.js';
import { getIstanbulDayKey } from '../server/student-desk.js';
import { approveAccounts, validApprovalIds } from '../server/user-approval.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ ok: false });
  const { action, userId, userIds, deskId } = req.body || {};
  if (!['delete_user', 'expire', 'approve_user', 'approve_users'].includes(action) ||
      action === 'approve_user' && !validApprovalIds([userId]) ||
      action === 'approve_users' && !validApprovalIds(userIds) ||
      action === 'delete_user' && (typeof userId !== 'string' || !userId || userId.includes('/') || userId.length > 180) ||
      action === 'expire' && (!Number.isInteger(deskId) || deskId < 1 || deskId > 35)) {
    return res.status(400).json({ ok: false, message: 'Geçersiz işlem.' });
  }
  try {
    const token = /^Bearer\s+(.+)$/i.exec(req.headers?.authorization || '')?.[1];
    if (!token) return res.status(401).json({ ok: false });
    const admin = await getAuth(adminApp()).verifyIdToken(token);
    await requireActiveAdmin(admin);
    if (action === 'approve_user' || action === 'approve_users') {
      const ids = action === 'approve_user' ? [userId] : userIds;
      const users = await approveAccounts({
        ids, collection: dataCollection,
        runTransaction: callback => dataCollection('sgmUsers').firestore.runTransaction(callback)
      });
      return res.status(200).json({ ok: true, result: { users } });
    }
    const firestore = dataCollection('sgmDesks').firestore;
    const settings = (await dataCollection('sgmConfig').doc('settings').get()).data() || {};
    const dayKey = () => getIstanbulDayKey();
    const actions = createCloudActions({
      db: firestore,
      runTransaction: (_db, callback) => firestore.runTransaction(callback),
      ref: (bucket, id) => dataCollection(bucket).doc(String(id)),
      settings: () => settings, dayKey,
      isRestricted: (user, at) => user?.blocked || user?.pendingApproval || Number(user?.restrictedUntil || 0) > at,
      lostDeskToday: () => false,
      applyViolationPolicy: (user, id, at) => {
        const history = [...(Array.isArray(user.violationHistory) ? user.violationHistory : []), at];
        const recent = history.filter(time => Number(time) > at - 7 * 86400000 && Number(time) <= at);
        return {
          violationHistory: history,
          restrictedUntil: recent.length >= 2
            ? Math.max(Number(user.restrictedUntil || 0), at + 7 * 86400000)
            : Number(user.restrictedUntil || 0),
          restrictionReason: recent.length >= 2
            ? 'Son 7 gün içinde iki ihlal: 7 gün kısıtlama' : user.restrictionReason || '',
          lostDeskDate: dayKey(),
          lostDeskIds: [...new Set([...(user.lostDeskDate === dayKey() ? user.lostDeskIds || [] : []), Number(id)])]
        };
      }
    });
    let result;
    if (action === 'delete_user') {
      const snapshot = await dataCollection('sgmDesks').get();
      const desks = snapshot.docs.map(d => ({ ...d.data(), id: Number(d.id) }));
      result = await actions.deleteUser(userId, desks);
    } else {
      result = await actions.expireDesk(deskId);
    }
    if (result?.user) {
      const { pin: _pin, pushTokens: _tokens, ...user } = result.user;
      result = { ...result, user };
    }
    return res.status(200).json({ ok: true, result });
  } catch (error) {
    console.error('Admin maintenance error:', error.code || error.message);
    return res.status(error.status || 503).json({ ok: false, message:
      error.status === 409 && (action === 'approve_user' || action === 'approve_users')
        ? 'Seçilen kullanıcılardan biri bulunamadı veya silinmiş. Listeyi yenileyin.'
        : 'Yönetici sunucu işlemi tamamlanamadı.' });
  }
}
