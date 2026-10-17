import { getAuth } from 'firebase-admin/auth';
import { adminApp, dataCollection } from '../server/firebase-admin.js';
import { requireActiveAdmin } from '../server/admin-session.js';
import { createCloudActions } from '../src/cloud-transactions.js';
import { getIstanbulDayKey } from '../server/student-desk.js';
import { approveAccounts, validApprovalIds, updateAdminAccount, restoreReportPermission } from '../server/user-approval.js';
import { violationPolicyPatch } from '../src/restriction-policy.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ ok: false });
  const { action, userId, userIds, deskId, patch, expectedPermission } = req.body || {};
  if (!['delete_user', 'expire', 'approve_user', 'approve_users', 'update_user', 'restore_report_permission'].includes(action) ||
      action === 'approve_user' && !validApprovalIds([userId]) ||
      action === 'approve_users' && !validApprovalIds(userIds) ||
      ['update_user','restore_report_permission'].includes(action) && !validApprovalIds([userId]) ||
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
    if (action === 'update_user' || action === 'restore_report_permission') {
      const base = {
        id: userId,
        collection: dataCollection,
        runTransaction: callback => dataCollection('sgmUsers').firestore.runTransaction(callback)
      };
      const user = action === 'update_user'
        ? await updateAdminAccount({ ...base, patch, expectedPermission })
        : await restoreReportPermission(base);
      return res.status(200).json({ ok: true, result: { user } });
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
      applyViolationPolicy: (user, id, at) => violationPolicyPatch(user, id, at, dayKey)
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
      error.status && action === 'update_user' ? error.message :
      error.status === 409 && (action === 'approve_user' || action === 'approve_users')
        ? 'Seçilen kullanıcılardan biri bulunamadı veya silinmiş. Listeyi yenileyin.'
        : 'Yönetici sunucu işlemi tamamlanamadı.' });
  }
}
