// Server-side, penalty-free 22:00 cleanup. QR codes and user credentials are untouched.
import { dataCollection } from './firebase-admin.js';
import { getIstanbulDayKey } from './student-desk.js';

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
    pendingDeviceId: null, breakEndTime: null, reportIssuedAt: null,
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

export async function closeLibraryDay({ at = Date.now(), collection = dataCollection } = {}) {
  if (!afterClosing(at)) return { closed: false, reason: 'before_close' };
  const day = istanbulClock(at).dayKey;
  const desksCol = collection('sgmDesks');
  const usersCol = collection('sgmUsers');
  const marker = collection('sgmDailyClosures').doc(day);
  return desksCol.firestore.runTransaction(async tx => {
    // All reads happen before any writes, with transaction retries on concurrent updates.
    const [previous, deskRows, userRows] = await Promise.all([
      tx.get(marker), tx.get(desksCol), tx.get(usersCol)
    ]);
    if (previous.exists) return { closed: false, reason: 'already_closed', day };
    let deskCount = 0;
    let userCount = 0;
    for (const doc of deskRows.docs) {
      const desk = doc.data();
      const active = Boolean(desk.occupant || desk.pendingOccupant || desk.guestOccupant ||
        desk.status === 'on_break' || desk.status === 'reported');
      if (!active) continue;
      tx.set(doc.ref, closingDesk(desk));
      deskCount++;
    }
    for (const doc of userRows.docs) {
      const user = doc.data();
      if (!user.activeDeskId && !user.pendingDeskId && !user.adminDeskOverrideDeskId) continue;
      tx.set(doc.ref, closingUser(user));
      userCount++;
    }
    tx.create(marker, { day, closedAt: at, deskCount, userCount, penaltyFree: true });
    return { closed: true, day, deskCount, userCount };
  });
}
