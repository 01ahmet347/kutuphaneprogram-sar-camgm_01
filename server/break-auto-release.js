// Mola bitişinde cezasız masa boşaltma. Yalnızca sunucu Admin SDK kullanır.
// Telefon açık olmasa da harici zamanlayıcı bu modülü tetikleyebilir.
import { createHash } from 'node:crypto';
import { expiredBreakDetails } from '../src/break-expiry-audit.js';
import { releaseUserFromDesk } from '../src/sync-core.js';

const RECLAIM_MS = 30 * 60 * 1000;
const exists = snap => snap?.exists === true;
const breakName = type => type === 'short' ? 'Kısa mola' : type === 'long' ? 'Uzun mola' : type === 'hourly' ? 'Saatlik mola' : 'Mola';

// Bir masadaki yalnızca belirli öğrenci oturumunu atomik olarak sonlandırır.
// QR, PIN, kullanıcı listesi, ihlal ve geçmiş kaydı asla silinmez.
export async function releaseExpiredBreak({ deskId, isGuest = false, collection, now = Date.now } = {}) {
  if (typeof collection !== 'function') throw new Error('Firestore koleksiyonu gerekli.');
  if (!Number.isInteger(Number(deskId)) || Number(deskId) < 1 || Number(deskId) > 35) {
    throw new Error('Geçersiz masa.');
  }
  const id = Number(deskId);
  const desks = collection('sgmDesks');
  const deskRef = desks.doc(String(id));
  return desks.firestore.runTransaction(async tx => {
    const deskSnap = await tx.get(deskRef);
    if (!exists(deskSnap)) return { released: false, reason: 'desk_missing' };
    const desk = deskSnap.data();
    const uid = String(isGuest ? desk.guestOccupant || '' : desk.occupant || '');
    const at = now();
    const endAt = Number(isGuest ? desk.guestBreakEndTime : desk.breakEndTime);
    if (!uid || !Number.isFinite(endAt) || endAt <= 0 || endAt > at ||
        (!isGuest && desk.status !== 'on_break')) {
      return { released: false, reason: 'not_expired_or_returned' };
    }

    const userRef = collection('sgmUsers').doc(uid);
    const deletedRef = collection('sgmDeletedUsers').doc(uid);
    const guestUid = !isGuest && desk.guestOccupant ? String(desk.guestOccupant) : null;
    const guestRef = guestUid ? collection('sgmUsers').doc(guestUid) : null;
    const guestDeletedRef = guestUid ? collection('sgmDeletedUsers').doc(guestUid) : null;
    const [userSnap, deletedSnap, guestSnap, guestDeleted] = await Promise.all([
      tx.get(userRef), tx.get(deletedRef), guestRef ? tx.get(guestRef) : null,
      guestDeletedRef ? tx.get(guestDeletedRef) : null
    ]);
    if (!exists(userSnap) || exists(deletedSnap)) return { released: false, reason: 'user_missing_or_deleted' };
    const user = userSnap.data();
    // Eski oturuma ait zamanlayıcı yeni/başka bir masayı asla değiştiremez.
    const details = expiredBreakDetails({
      desk: { ...desk, id }, userId: uid, activeDeskId: user.activeDeskId,
      isGuest, at
    });
    if (!details || (isGuest && user.activeDeskRole !== 'guest')) {
      return { released: false, reason: 'session_changed' };
    }
    if (guestUid && (!exists(guestSnap) || exists(guestDeleted) ||
        String(guestSnap.data().activeDeskId) !== String(id) ||
        guestSnap.data().activeDeskRole !== 'guest')) {
      // Geçersiz legacy misafir varsa rastgele masayı boşaltmak yerine YP onarımı beklenir.
      return { released: false, reason: 'guest_session_needs_review' };
    }

    const digest = createHash('sha256').update(`${uid}|${id}|${isGuest}|${endAt}`).digest('hex').slice(0, 32);
    const oldLogId = `MOLA-BITIS-DONUS-YOK-${digest}`;
    const eventId = `MOLA-OTOMATIK-MASA-BOSALTMA-${digest}`;
    const oldLogRef = collection('sgmAudit').doc(oldLogId);
    const newLogRef = collection('sgmAudit').doc(eventId);
    // Aynı transaction içinde tekil bir push gönderim işi oluşturulur.
    // QR dönüşü olmuş / masa değişmiş oturum için bu noktaya gelinmez.
    const pushJobRef = collection('sgmBreakPushOutbox').doc(eventId);
    const [oldLog, newLog, oldDeleted, newDeleted, existingPushJob] = await Promise.all([
      tx.get(oldLogRef), tx.get(newLogRef),
      tx.get(collection('sgmDeletedRecords').doc(`logs-${oldLogId}`)),
      tx.get(collection('sgmDeletedRecords').doc(`logs-${eventId}`)),
      tx.get(pushJobRef)
    ]);
    const reclaimAllowedAt = at + RECLAIM_MS;
    const type = isGuest ? user.lastBreakSession?.type : desk.breakType || user.lastBreakSession?.type;
    const kind = breakName(type);
    const reason = `${kind} süreniz sona erdi ve süre dolmadan QR koduyla dönüş yapmadığınız için Masa ${id} otomatik boşaltıldı.`;
    const userInfo = `${String(user.name || '')}${user.specialCode ? ` (GM: ${user.specialCode})` : ''}`;
    const lastAutoBreakRelease = {
      eventId, deskId: id, breakType: type || null, breakEndAt: endAt,
      releasedAt: at, reclaimAllowedAt, reason
    };
    const userPatch = {
      activeDeskId: null, activeDeskRole: null,
      adminDeskOverrideDeskId: null, adminDeskOverrideSessionStart: null,
      deskReleasedAt: at, deskReclaimAllowedAt: reclaimAllowedAt,
      deskReclaimDeskId: id, gmDeskAccessAt: at,
      lastAutoBreakRelease
    };
    if (user.lastBreakSession?.status === 'active' &&
        Number(user.lastBreakSession.deskId) === id &&
        Number(user.lastBreakSession.endAt) === endAt) {
      userPatch.lastBreakSession = { ...user.lastBreakSession, status: 'auto_expired', autoExpiredAt: at };
    }
    let nextDesk;
    if (isGuest) {
      nextDesk = releaseUserFromDesk(desk, uid);
    } else if (guestUid) {
      // Eski sürümün geçerli misafirini ve (varsa) henüz bitmeyen molasını koru.
      const guestBreakOngoing = Number(desk.guestBreakEndTime || 0) > at;
      const guestBreak = guestSnap.data().lastBreakSession;
      nextDesk = {
        ...desk, status: guestBreakOngoing ? 'on_break' : 'occupied', occupant: guestUid,
        ownerDeviceId: guestSnap.data().deviceId || null,
        sessionStartTime: desk.guestSessionStartTime || at,
        guestOccupant: null, guestSessionStartTime: null, guestBreakEndTime: null,
        guestReported: false, guestReportEndTime: null, guestReportIssuedAt: null,
        guestReportVerifiedAt: null,
        breakEndTime: guestBreakOngoing ? desk.guestBreakEndTime : null,
        breakSessionId: guestBreakOngoing ? guestBreak?.id || null : null,
        breakStartedAt: guestBreakOngoing ? guestBreak?.startedAt || desk.guestSessionStartTime : null,
        breakType: guestBreakOngoing ? guestBreak?.type || null : null,
        breakOwnerId: guestBreakOngoing ? guestUid : null,
        breakDurationMinutes: guestBreakOngoing ?
          Math.max(0, Math.ceil((Number(desk.guestBreakEndTime) - Number(guestBreak?.startedAt || desk.guestSessionStartTime || at)) / 60000)) : null,
        reportEndTime: null,
        reportIssuedAt: null, reportVerifiedAt: null
      };
    } else {
      nextDesk = {
        ...releaseUserFromDesk(desk, uid),
        // Başka bir öğrencinin henüz geçerli rezervasyonu varsa koru.
        status: desk.status === 'disabled' ? 'disabled' : 'available'
      };
    }

    tx.set(deskRef, nextDesk);
    tx.set(userRef, userPatch, { merge: true });
    if (guestUid) tx.set(guestRef, { activeDeskRole: 'owner' }, { merge: true });
    // Eski 00:00 log tipi korunur. Yönetici tarafından silinmiş log yeniden oluşturulmaz.
    if (!exists(oldLog) && !exists(oldDeleted)) {
      tx.create(oldLogRef, {
        id: oldLogId, time: at, breakEndAt: endAt, deskId: id, userId: uid,
        type: 'MOLA_SURESI_DOLDU_DONUS_YAPILMADI',
        message: `Masa ${id}: Mola süresi 00:00 oldu. Kontrol anında öğrenci henüz QR koduyla masaya dönüş yapmamıştı. Otomatik ihlal uygulanmadı.`,
        userInfo, actorId: 'SYSTEM', actorInfo: 'Sistem - doğrulanmış mola kontrolü',
        actorFirebaseUid: uid, deviceInfo: String(user.deviceId || ''), guest: isGuest
      });
    }
    if (!exists(newLog) && !exists(newDeleted)) {
      tx.create(newLogRef, {
        id: eventId, time: at, breakEndAt: endAt, deskId: id, userId: uid,
        type: 'MOLA_SURESI_DOLDU_MASA_OTOMATIK_BOSALTILDI',
        message: `${reason} Aynı masa ${new Date(reclaimAllowedAt).toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' })} itibarıyla tekrar alınabilir. İhlal uygulanmadı.`,
        userInfo, actorId: 'SYSTEM', actorInfo: 'Sistem - otomatik mola boşaltma',
        guest: isGuest, breakType: type || null, releasedAt: at,
        reclaimAllowedAt, penaltyFree: true, violationApplied: false
      });
    }
    if (!exists(existingPushJob)) {
      tx.create(pushJobRef, {
        eventId, userId: uid, deskId: id, breakType: type || null,
        releasedAt: at, breakEndAt: endAt, reclaimAllowedAt,
        status: 'pending', attempts: 0, leaseUntil: 0, nextAttemptAt: at
      });
    }
    return { released: true, deskId: id, userId: uid, eventId, reclaimAllowedAt, isGuest };
  });
}

export async function releaseExpiredBreaksForDesk({ deskId, collection, now = Date.now } = {}) {
  if (typeof collection !== 'function') throw new Error('Firestore koleksiyonu gerekli.');
  const row = await collection('sgmDesks').doc(String(deskId)).get();
  if (!exists(row)) return { released: [], reason: 'desk_missing' };
  const desk = row.data();
  const at = now();
  const guestExpired = Boolean(desk.guestOccupant &&
    Number(desk.guestBreakEndTime || 0) > 0 && Number(desk.guestBreakEndTime) <= at);
  const ownerExpired = Boolean(desk.occupant && desk.status === 'on_break' &&
    Number(desk.breakEndTime || 0) > 0 && Number(desk.breakEndTime) <= at);
  if (!guestExpired && !ownerExpired) return { released: [], reason: 'not_expired_or_returned' };
  // Gerçek durum transaction içinde TEKRAR doğrulanır (QR/masa devri yarışına dayanıklı).
  const guest = guestExpired ? await releaseExpiredBreak({ deskId, isGuest: true, collection, now }) : null;
  const owner = ownerExpired ? await releaseExpiredBreak({ deskId, isGuest: false, collection, now }) : null;
  return { released: [guest, owner].filter(item => item?.released), guest, owner };
}

export async function sweepExpiredBreaks({ collection, now = Date.now } = {}) {
  if (typeof collection !== 'function') throw new Error('Firestore koleksiyonu gerekli.');
  // 35 masanın tamamını dakikada bir okumak Firestore ücretsiz kotasını tüketir.
  // Yalnızca moladaki ana oturumları ve süreli legacy misafirleri sorgula.
  const col = collection('sgmDesks');
  const [ownerSnap, guestSnap] = await Promise.all([
    col.where('status', '==', 'on_break').get(),
    col.where('guestBreakEndTime', '>', 0).get()
  ]);
  const byId = new Map([...ownerSnap.docs, ...guestSnap.docs].map(doc => [doc.id, doc]));
  const candidates = [...byId.values()].filter(doc => {
    const d = doc.data();
    const at = now();
    return (d.occupant && d.status === 'on_break' && Number(d.breakEndTime || 0) > 0 && Number(d.breakEndTime) <= at) ||
      (d.guestOccupant && Number(d.guestBreakEndTime || 0) > 0 && Number(d.guestBreakEndTime) <= at);
  });
  const results = [];
  const errors = [];
  for (let i = 0; i < candidates.length; i += 4) {
    await Promise.all(candidates.slice(i, i + 4).map(async doc => {
      try { results.push(await releaseExpiredBreaksForDesk({ deskId: Number(doc.id), collection, now })); }
      catch (error) { errors.push({ deskId: doc.id, code: error?.code || 'transaction_failed' }); }
    }));
  }
  const released = results.flatMap(row => row.released);
  return { checked: byId.size, candidates: candidates.length, releasedCount: released.length,
    releasedDeskIds: released.map(row => row.deskId), errors };
}
