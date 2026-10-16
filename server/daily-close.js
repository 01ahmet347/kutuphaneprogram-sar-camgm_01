// Server-side, penalty-free 22:00 cleanup. QR codes and user credentials are untouched.
import { dataCollection } from './firebase-admin.js';
import { getIstanbulDayKey } from './student-desk.js';
import { deskNeedsClosing } from './desk-integrity.js';

export function istanbulClock(at = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date(at));
  const time = Object.fromEntries(parts.map(part => [part.type, Number(part.value)]));
  return { minute: time.hour * 60 + time.minute, dayKey: getIstanbulDayKey(new Date(at)) };
}

export const afterClosing = at => istanbulClock(at).minute >= 22 * 60;
export function outsideLibraryHours(at = Date.now(), openTime = '07:00') {
  const parts = /^(\d{2}):(\d{2})$/.exec(String(openTime));
  const opening = parts ? Number(parts[1]) * 60 + Number(parts[2]) : 7 * 60;
  const minute = istanbulClock(at).minute;
  return minute < opening || minute >= 22 * 60;
}

export function closingDesk(desk) {
  return {
    ...desk,
    status: desk.status === 'disabled' ? 'disabled' : 'available',
    occupant: null, ownerDeviceId: null, sessionStartTime: null,
    guestOccupant: null, guestSessionStartTime: null, guestBreakEndTime: null,
    guestReported: false, guestReportEndTime: null, guestReportIssuedAt: null,
    guestReportVerifiedAt: null,
    pendingOccupant: null, pendingDeskRole: null, pendingDeskDeadline: null,
    pendingDeviceId: null, breakEndTime: null, breakSessionId: null,
    breakStartedAt: null, breakType: null, breakOwnerId: null,
    breakDurationMinutes: null, reportIssuedAt: null,
    reportEndTime: null, reportVerifiedAt: null
  };
}
export function closingUser(user) {
  return {
    ...user, activeDeskId: null, activeDeskRole: null,
    pendingDeskId: null, pendingDeskDeadline: null,
    adminDeskOverrideDeskId: null, adminDeskOverrideSessionStart: null
  };
}

export async function closeLibraryDay({ at = Date.now(), collection = dataCollection, force = false } = {}) {
  if (!force && !afterClosing(at)) return { closed: false, reason: 'before_close' };
  const day = istanbulClock(at).dayKey;
  const desksCol = collection('sgmDesks');
  const usersCol = collection('sgmUsers');
  const marker = collection('sgmDailyClosures').doc(day);
  return desksCol.firestore.runTransaction(async tx => {
    // All reads happen before any writes, with transaction retries on concurrent updates.
    const [previous, deskRows, userRows] = await Promise.all([
      tx.get(marker), tx.get(desksCol), tx.get(usersCol)
    ]);
    // Önceki kapanış işaretine rağmen tekrar tarama yap: daha sonra gelen eski
    // tarayıcı kayıtları, boş masada kalan öğrencileri yeniden oluşturmuş olabilir.
    let deskCount = 0;
    let userCount = 0;
    const closedDesks = [];
    for (const doc of deskRows.docs) {
      const desk = doc.data();
      if (!deskNeedsClosing(desk)) continue;
      tx.set(doc.ref, closingDesk(desk));
      closedDesks.push({ id: doc.id, occupant: desk.occupant || desk.guestOccupant || desk.pendingOccupant || null });
      deskCount++;
    }
    for (const doc of userRows.docs) {
      const user = doc.data();
      if (!user.activeDeskId && !user.pendingDeskId && !user.adminDeskOverrideDeskId) continue;
      // Yalnızca masa/rezervasyon bağlantılarını değiştirir; kimlik, ihlal ve
      // geçmiş kayıtlarını olduğu gibi korur.
      tx.set(doc.ref, {
        activeDeskId: null, activeDeskRole: null,
        pendingDeskId: null, pendingDeskDeadline: null,
        adminDeskOverrideDeskId: null, adminDeskOverrideSessionStart: null
      }, { merge: true });
      userCount++;
    }
    if (previous.exists && deskCount === 0 && userCount === 0) {
      return { closed: false, reason: 'already_closed', day, deskCount: 0, userCount: 0 };
    }
    for (const desk of closedDesks) {
      const log = collection('sgmAudit').doc(`cron-close-${day}-${desk.id}`);
      tx.set(log, {
        id: log.id, time: at, type: 'KAPANIS_MASA_OTOMATIK_BOSALTILDI',
        message: `Kapanışta Masa ${desk.id} cezasız otomatik boşaltıldı.`,
        deskId: Number(desk.id), userId: desk.occupant,
        actorId: 'SYSTEM', penaltyFree: true
      });
    }
    tx.set(marker, {
      day, closedAt: previous.exists ? previous.data()?.closedAt || at : at,
      lastCheckedAt: at, deskCount, userCount, penaltyFree: true,
      runCount: Number(previous.data()?.runCount || 0) + 1
    }, { merge: true });
    return { closed: true, day, deskCount, userCount, recovered: previous.exists };
  });
}
