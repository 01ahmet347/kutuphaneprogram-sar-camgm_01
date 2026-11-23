// Authenticated, penalty-free daily closing. Only called by cron, never from navigation.
// Printed QR codes, passwords, push tokens and historical violations are preserved.
import { dataCollection } from './firebase-admin.js';
import { deskNeedsClosing } from './desk-integrity.js';
import { allowedBreakCount } from '../src/break-policy.js';

import { closingDay, nextDay } from '../src/closing-schedule.js';
export { closingDay, istanbulClock, afterClosing, outsideLibraryHours } from '../src/closing-schedule.js';

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

export async function closeLibraryDay({ at = Date.now(), collection = dataCollection, force = false, settings } = {}) {
  const firestore = collection('sgmDesks').firestore;
  const settingsRef = collection('sgmConfig').doc('settings');
  const desksCol = collection('sgmDesks');
  const usersCol = collection('sgmUsers');
  return firestore.runTransaction(async tx => {
    // Saat ayarını aynı transaction içinde oku: yönetici saat değiştirirken
    // gecikmiş cron, yeni saatten önce aktif masaları boşaltamaz.
    const config = settings || (await tx.get(settingsRef)).data() || {};
    const day = closingDay(at, config);
    if (!force && !day) return { closed: false, reason: 'before_close' };
    const closingKey = day || istanbulClock(at).dayKey;
    const nextKey = nextDay(closingKey);
    const nextMidday = Date.parse(`${nextKey}T12:00:00Z`);
    const marker = collection('sgmDailyClosures').doc(closingKey);
    const [previous, desks, users] = await Promise.all([
      tx.get(marker), tx.get(desksCol), tx.get(usersCol)
    ]);
    // All reads finish before any writes. No delete operations.
    const deskUpdates = desks.docs.filter(doc => deskNeedsClosing(doc.data()));
    const userDeskUpdates = users.docs.filter(doc => {
      const u = doc.data();
      return !!(u.activeDeskId || u.pendingDeskId || u.adminDeskOverrideDeskId);
    });
    const breakUpdates = users.docs.filter(doc => {
      const u = doc.data();
      return u.breaksResetDate !== nextKey || u.violationsResetDate !== nextKey || Number(u.strikes || 0) !== 0;
    });
    // Firestore transactions have a 500-write cap; fail without partial writes.
    if (deskUpdates.length * 2 + users.docs.length + 1 > 450) {
      throw new Error('closing_transaction_too_large');
    }
    if (previous.exists && !deskUpdates.length && !userDeskUpdates.length && !breakUpdates.length) {
      return { closed: false, reason: 'already_closed', day: closingKey, deskCount: 0, userCount: 0, breakUsersCount: 0 };
    }
    const userDeskIds = new Set(userDeskUpdates.map(doc => doc.id));
    const breakIds = new Set(breakUpdates.map(doc => doc.id));
    for (const doc of deskUpdates) tx.set(doc.ref, closingDesk(doc.data()));
    for (const doc of users.docs) {
      const u = doc.data();
      const patch = {};
      if (userDeskIds.has(doc.id)) Object.assign(patch, {
        activeDeskId: null, activeDeskRole: null, pendingDeskId: null, pendingDeskDeadline: null,
        adminDeskOverrideDeskId: null, adminDeskOverrideSessionStart: null
      });
      if (breakIds.has(doc.id)) Object.assign(patch, {
        breaks: { ...u.breaks,
          short: allowedBreakCount(config, 'short', nextMidday),
          long: allowedBreakCount(config, 'long', nextMidday),
          hourly: allowedBreakCount(config, 'hourly', nextMidday)
        },
        breaksResetDate: nextKey,
        violationsResetDate: nextKey,
        strikes: 0
      });
      if (Object.keys(patch).length) tx.set(doc.ref, patch, { merge: true });
    }
    for (const doc of deskUpdates) {
      const d = doc.data();
      const log = collection('sgmAudit').doc(`cron-close-${closingKey}-${doc.id}`);
      tx.set(log, {
        id: log.id, time: at, type: 'KAPANIS_MASA_OTOMATIK_BOSALTILDI',
        message: `Kapanışta Masa ${doc.id} cezasız otomatik boşaltıldı.`,
        deskId: Number(doc.id), userId: d.occupant || d.guestOccupant || d.pendingOccupant || null,
        actorId: 'SYSTEM', penaltyFree: true
      });
    }
    const existing = previous.exists ? previous.data() : {};
    const deskCount = deskUpdates.length;
    const userCount = userDeskUpdates.length;
    const breakUsersCount = breakUpdates.length;
    tx.set(marker, {
      day: closingKey, closedAt: existing.closedAt || at,
      lastCheckedAt: at, deskCount: Number(existing.deskCount || 0) + deskCount,
      userCount: Number(existing.userCount || 0) + userCount,
      breakUsersCount: Number(existing.breakUsersCount || 0) + breakUsersCount,
      penaltyFree: true, status: 'completed',
      runCount: Number(existing.runCount || 0) + 1
    }, { merge: true });
    return { closed: true, day: closingKey, deskCount, userCount, breakUsersCount, recovered: previous.exists };
  });
}
