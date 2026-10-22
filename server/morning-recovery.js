// Öğrenciler de açılışta tetikleyebilir; veri değişikliklerini yalnızca
// yetkili sunucu gerçekleştirir. Önceki güne ait kesinleşmiş masa bağları cezasız silinir.
import { closingDesk, hasPreviousClosingSession, lastIstanbulClosingAt } from '../src/desk-day-safety.js';

export async function recoverPreviousDayDesks({ at = Date.now(), collection } = {}) {
  if (!collection) ({ dataCollection: collection } = await import('./firebase-admin.js'));
  const desksCol = collection('sgmDesks');
  const usersCol = collection('sgmUsers');
  return desksCol.firestore.runTransaction(async tx => {
    const deskRows = await tx.get(desksCol);
    const oldDesks = deskRows.docs.filter(doc => hasPreviousClosingSession(doc.data(), at));
    if (!oldDesks.length) return { recoveredDesks: 0, recoveredUsers: 0 };

    const affectedIds = [...new Set(oldDesks.flatMap(doc => [
      doc.data().occupant, doc.data().guestOccupant, doc.data().pendingOccupant
    ]).filter(Boolean).map(String))];
    // Firestore işlemleri: tüm okumalar bitmeden hiçbir yazma yapılmaz.
    const users = await Promise.all(affectedIds.map(id => tx.get(usersCol.doc(id))));
    const linkPatches = new Map();
    for (const doc of oldDesks) {
      const desk = doc.data();
      for (const uid of [desk.occupant, desk.guestOccupant, desk.pendingOccupant].filter(Boolean).map(String)) {
        const userSnap = users[affectedIds.indexOf(uid)];
        if (!userSnap.exists) continue;
        const user = userSnap.data();
        const patch = linkPatches.get(uid) || {};
        if (Number(user.activeDeskId) === Number(doc.id)) Object.assign(patch, {
          activeDeskId: null, activeDeskRole: null,
          adminDeskOverrideDeskId: null, adminDeskOverrideSessionStart: null
        });
        if (Number(user.pendingDeskId) === Number(doc.id)) Object.assign(patch, {
          pendingDeskId: null, pendingDeskDeadline: null
        });
        if (Object.keys(patch).length) linkPatches.set(uid, patch);
      }
    }

    for (const doc of oldDesks) {
      tx.set(doc.ref, closingDesk(doc.data()));
      // Sabit kayıt kimliği: tekrar denendiğinde çift kayıt oluşturulmaz.
      const log = collection('sgmAudit').doc(`morning-recovery-${lastIstanbulClosingAt(at)}-${doc.id}`);
      tx.set(log, {
        id: log.id, time: at, type: 'KAPANIS_GECIKEN_MASA_CEZASIZ_TEMIZLENDI',
        message: `Masa ${doc.id} önceki kapanıştan kalan oturum nedeniyle cezasız boşaltıldı.`,
        deskId: Number(doc.id), userId: doc.data().occupant || null,
        actorId: 'SYSTEM', penaltyFree: true
      });
    }
    for (const [uid, patch] of linkPatches) tx.set(usersCol.doc(uid), patch, { merge: true });
    return { recoveredDesks: oldDesks.length, recoveredUsers: linkPatches.size };
  });
}
