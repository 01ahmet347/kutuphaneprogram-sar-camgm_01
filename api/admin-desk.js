import { getAuth } from 'firebase-admin/auth';
import { adminApp, dataCollection } from '../server/firebase-admin.js';
import { requireActiveAdmin } from '../server/admin-session.js';
import { outsideLibraryHours, closingDesk, closingUser } from '../server/daily-close.js';
import { createCloudActions } from '../src/cloud-transactions.js';
import { getIstanbulDayKey } from '../server/student-desk.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ ok: false });
  const { action, deskId, userId } = req.body || {};
  if (!['release', 'assign'].includes(action) || !Number.isInteger(deskId) || deskId < 1 || deskId > 35 ||
      (action === 'assign' && (typeof userId !== 'string' || !userId || userId.includes('/') || userId.length > 180))) {
    return res.status(400).json({ ok: false, error: 'invalid_request' });
  }
  try {
    const token = /^Bearer\s+(.+)$/i.exec(req.headers?.authorization || '')?.[1];
    if (!token) return res.status(401).json({ ok: false });
    const admin = await getAuth(adminApp()).verifyIdToken(token);
    await requireActiveAdmin(admin);
    if (action === 'assign') {
      const settingsSnapshot = await dataCollection('sgmConfig').doc('settings').get();
      const settings = settingsSnapshot.data() || {};
      if (outsideLibraryHours(Date.now(), settings.openTime || '07:00')) return res.status(409).json({ ok: false, message: 'Kütüphane kapalıyken masa atanamaz.' });
      const firestore = dataCollection('sgmDesks').firestore;
      const actions = createCloudActions({
        db: firestore, runTransaction: (_db, callback) => firestore.runTransaction(callback),
        ref: (bucket, id) => dataCollection(bucket).doc(String(id)),
        settings: () => settings, dayKey: () => getIstanbulDayKey(),
        isRestricted: user => user.blocked || user.pendingApproval || Number(user.restrictedUntil || 0) > Date.now(),
        lostDeskToday: () => false, applyViolationPolicy: () => ({})
      });
      const assigned = await actions.assign({ userId, deskId });
      return res.status(200).json({ ok: true, ...assigned });
    }
    const deskRef = dataCollection('sgmDesks').doc(String(deskId));
    const result = await deskRef.firestore.runTransaction(async tx => {
      const deskSnap = await tx.get(deskRef);
      if (!deskSnap.exists) throw Object.assign(new Error('Masa bulunamadı.'), { status: 404 });
      const desk = deskSnap.data();
      if (desk.status === 'available' && !desk.occupant && !desk.pendingOccupant && !desk.guestOccupant) {
        return { desks: [desk], users: [], user: null, alreadyApplied: true };
      }
      const userIds = [...new Set([desk.occupant, desk.guestOccupant, desk.pendingOccupant].filter(Boolean))];
      const userSnapshots = await Promise.all(userIds.map(id => tx.get(dataCollection('sgmUsers').doc(id))));
      const at = Date.now();
      const nextDesk = closingDesk(desk);
      const users = [];
      userSnapshots.forEach(snap => {
        if (!snap.exists) return;
        const user = snap.data();
        const updated = { ...user };
        if (Number(user.activeDeskId) === deskId) Object.assign(updated, {
          activeDeskId: null, activeDeskRole: null,
          adminDeskOverrideDeskId: null, adminDeskOverrideSessionStart: null
        });
        if (Number(user.pendingDeskId) === deskId) Object.assign(updated, {
          pendingDeskId: null, pendingDeskDeadline: null
        });
        tx.set(snap.ref, updated);
        const { pin: _pin, pushTokens: _pushTokens, ...publicUser } = updated;
        users.push(publicUser);
      });
      const auditRef = dataCollection('sgmAudit').doc(`admin-release-${deskId}-${at}`);
      tx.set(deskRef, nextDesk);
      tx.create(auditRef, {
        id: auditRef.id, time: at, type: 'ADMIN_MASA_BOSALTMA',
        message: `Masa ${deskId} yönetici onayıyla cezasız boşaltıldı.`,
        deskId, userId: desk.occupant || null,
        actorId: 'ADMIN', actorFirebaseUid: admin.uid,
        actorSessionId: admin.adminSessionId,
        penaltyFree: true
      });
      return { desks: [nextDesk], users, user: users[0] || null };
    });
    return res.status(200).json({ ok: true, ...result });
  } catch (error) {
    return res.status(error.status || (error.code?.startsWith('auth/') ? 401 : 503))
      .json({ ok: false, message: error.status ? error.message : 'Masa işlemi doğrulanamadı veya kaydedilemedi.' });
  }
}
