import { getAuth } from 'firebase-admin/auth';
import { adminApp, dataCollection } from '../server/firebase-admin.js';
import { requireActiveAdmin } from '../server/admin-session.js';
import { outsideLibraryHours, closingDesk, closeLibraryDay } from '../server/daily-close.js';
import { userLinkPatch, releasedDeskUserPatch, publicUser, deskNeedsClosing } from '../server/desk-integrity.js';
import { createCloudActions } from '../src/cloud-transactions.js';
import { getIstanbulDayKey } from '../server/student-desk.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ ok: false });
  const { action, deskId, userId } = req.body || {};
  if (!['release', 'assign', 'repair', 'close_day'].includes(action) ||
      (!['repair', 'close_day'].includes(action) && (!Number.isInteger(deskId) || deskId < 1 || deskId > 35)) ||
      (action === 'assign' && (typeof userId !== 'string' || !userId || userId.includes('/') || userId.length > 180))) {
    return res.status(400).json({ ok: false, error: 'invalid_request' });
  }
  try {
    const token = /^Bearer\s+(.+)$/i.exec(req.headers?.authorization || '')?.[1];
    if (!token) return res.status(401).json({ ok: false });
    const admin = await getAuth(adminApp()).verifyIdToken(token);
    await requireActiveAdmin(admin);
    if (action === 'close_day') {
      // Admin onaylı manuel gün sonu işlemi de yalnızca yerel state'i değil,
      // masa ve öğrenci belgelerini tek Firestore transaction içinde temizler.
      const result = await closeLibraryDay({ force: true });
      return res.status(200).json({ ok: true, result });
    }
    if (action === 'repair') {
      // Yalnızca boşa düşmüş bağlantılar; gerçek ana kullanıcı ve misafirler kalır.
      const firestore = dataCollection('sgmDesks').firestore;
      const result = await firestore.runTransaction(async tx => {
        const [desks, users] = await Promise.all([
          tx.get(dataCollection('sgmDesks')), tx.get(dataCollection('sgmUsers'))
        ]);
        const deskMap = new Map(desks.docs.map(row => [String(row.id), row.data()]));
        const repaired = [];
        const at = Date.now();
        for (const row of users.docs) {
          const patch = userLinkPatch(row.data(), row.id, deskMap, at);
          if (!Object.keys(patch).length) continue;
          tx.set(row.ref, patch, { merge: true });
          repaired.push(publicUser({ ...row.data(), ...patch }, row.id));
        }
        if (repaired.length) {
          const auditRef = dataCollection('sgmAudit').doc(`admin-repair-${at}`);
          tx.create(auditRef, {
            id: auditRef.id, time: at, type: 'ADMIN_MASA_HESAP_ONARIMI',
            message: `${repaired.length} öğrencinin geçersiz masa/rezervasyon bağlantısı onarıldı.`,
            actorId: 'ADMIN', actorFirebaseUid: admin.uid, actorSessionId: admin.adminSessionId,
            repairedCount: repaired.length, penaltyFree: true
          });
        }
        return { repairedCount: repaired.length, users: repaired };
      });
      return res.status(200).json({ ok: true, ...result });
    }
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
      // Masa zaten boş olsa bile ona bağlı eski öğrenci belgelerini ara.
      const [deskSnap, allUsers] = await Promise.all([
        tx.get(deskRef), tx.get(dataCollection('sgmUsers'))
      ]);
      if (!deskSnap.exists) throw Object.assign(new Error('Masa bulunamadı.'), { status: 404 });
      const desk = deskSnap.data();
      const updates = [];
      for (const snap of allUsers.docs) {
        const patch = releasedDeskUserPatch(snap.data(), deskId);
        if (Object.keys(patch).length) updates.push({ snap, patch });
      }
      const occupied = deskNeedsClosing(desk);
      if (!occupied && !updates.length) {
        return { desks: [desk], users: [], user: null, alreadyApplied: true };
      }
      const at = Date.now();
      const nextDesk = closingDesk(desk);
      const users = [];
      for (const { snap, patch } of updates) {
        tx.set(snap.ref, patch, { merge: true });
        users.push(publicUser({ ...snap.data(), ...patch }, snap.id));
      }
      const auditRef = dataCollection('sgmAudit').doc(`admin-release-${deskId}-${at}`);
      if (occupied) tx.set(deskRef, nextDesk);
      tx.create(auditRef, {
        id: auditRef.id, time: at, type: 'ADMIN_MASA_BOSALTMA',
        message: `Masa ${deskId} yönetici onayıyla cezasız boşaltıldı; ${updates.length} kullanıcı bağlantısı temizlendi.`,
        deskId, userId: desk.occupant || null,
        actorId: 'ADMIN', actorFirebaseUid: admin.uid,
        actorSessionId: admin.adminSessionId, penaltyFree: true
      });
      return { desks: [nextDesk], users, user: users[0] || null };
    });
    return res.status(200).json({ ok: true, ...result });
  } catch (error) {
    return res.status(error.status || (error.code?.startsWith('auth/') ? 401 : 503))
      .json({ ok: false, message: error.status ? error.message : 'Masa işlemi doğrulanamadı veya kaydedilemedi.' });
  }
}
