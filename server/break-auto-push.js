// Mola nedeniyle otomatik boşaltılan masa için sunucudan push.
// Eski /api/send-push, iOS izin kaydı ve service worker akışlarına dokunmaz.
// Bildirim işi masa boşaltma transaction'ında oluşturulur; FCM işlemi transaction DIŞINDADIR.

const MAX_ATTEMPTS = 5;
const LEASE_MS = 2 * 60_000;
const BATCH_SIZE = 50;
const MAX_NOTIFICATION_AGE_MS = 24 * 60 * 60_000;
const NOTIFICATION_TYPE = 'MOLA_SURESI_DOLDU_MASA_OTOMATIK_BOSALTILDI';
const exists = snapshot => snapshot?.exists === true;

const breakLabel = type => type === 'short' ? 'Kısa mola' : type === 'long' ? 'Uzun mola' :
  type === 'hourly' ? 'Saatlik mola' : 'Mola';

export function breakReleasePushMessage(job, siteAddress) {
  const deskId = Number(job.deskId);
  if (!Number.isInteger(deskId) || deskId < 1 || deskId > 35) throw new Error('Invalid desk id');
  const title = 'Mola süreniz doldu — masanız boşaltıldı';
  const releaseTime = new Date(Number(job.breakEndAt || job.releasedAt)).toLocaleString('tr-TR', {
    timeZone: 'Europe/Istanbul', day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit'
  });
  const body = `Masa ${deskId}: ${breakLabel(job.breakType)} süreniz ${releaseTime} itibarıyla sona erdi. ` +
    'Masanız otomatik boşaltıldı. Aynı masa için 30 dakika engel uygulandı. İhlal yok.';
  const eventId = String(job.eventId);
  const tag = `sgm-${eventId}`;
  let notificationLink;
  if (siteAddress) {
    try {
      const url = new URL(siteAddress.startsWith('http') ? siteAddress : `https://${siteAddress}`);
      if (url.protocol === 'https:') notificationLink = new URL('/', url).href;
    } catch { /* Hatalı URL push gönderimini engellemesin. */ }
  }
  return { title, body, tag, notificationLink, type: NOTIFICATION_TYPE };
}

export async function sendPendingBreakPushNotifications({ collection, sendMulticast,
  siteAddress, now = Date.now } = {}) {
  if (typeof collection !== 'function' || typeof sendMulticast !== 'function') {
    throw new Error('Firestore ve push göndericisi gerekli.');
  }
  const jobs = collection('sgmBreakPushOutbox');
  // Tek alan filtresi: bileşik Firestore indeksi gerektirmez. 'sending' lease'i
  // süresi geçmişse sonraki cron tarafından devralınabilir.
  const snapshot = await jobs.where('status', 'in', ['pending', 'sending']).limit(BATCH_SIZE).get();
  const stats = { checked: snapshot.docs.length, sentCount: 0, skippedCount: 0,
    retryCount: 0, failedCount: 0, errors: [] };

  for (const candidate of snapshot.docs) {
    const jobRef = jobs.doc(candidate.id);
    const at = now();
    const data = candidate.data();
    if (Number(data.nextAttemptAt || 0) > at ||
        (data.status === 'sending' && Number(data.leaseUntil || 0) > at)) continue;
    let claimed;
    try {
      claimed = await jobs.firestore.runTransaction(async tx => {
        const jobSnap = await tx.get(jobRef);
        if (!exists(jobSnap)) return null;
        const current = jobSnap.data();
        const currentAt = now();
        if (!['pending', 'sending'].includes(current.status) ||
            Number(current.nextAttemptAt || 0) > currentAt ||
            (current.status === 'sending' && Number(current.leaseUntil || 0) > currentAt)) return null;
        const [userSnap, deletedSnap] = await Promise.all([
          tx.get(collection('sgmUsers').doc(String(current.userId || ''))),
          tx.get(collection('sgmDeletedUsers').doc(String(current.userId || '')))
        ]);
        const attempts = Number(current.attempts || 0) + 1;
        if (!exists(userSnap) || exists(deletedSnap)) {
          tx.set(jobRef, { status: 'skipped', reason: 'user_deleted', completedAt: currentAt }, { merge: true });
          return { skipped: true };
        }
        if (!Number.isFinite(Number(current.releasedAt)) ||
            currentAt - Number(current.releasedAt) > MAX_NOTIFICATION_AGE_MS) {
          tx.set(jobRef, { status: 'skipped', reason: 'too_old', completedAt: currentAt }, { merge: true });
          return { skipped: true };
        }
        const user = userSnap.data();
        const tokens = [...new Set((Array.isArray(user.pushTokens) ? user.pushTokens : [])
          .filter(t => typeof t === 'string' && t))];
        if (!tokens.length) {
          tx.set(jobRef, { status: 'skipped', reason: 'no_token', completedAt: currentAt }, { merge: true });
          return { skipped: true };
        }
        const leaseUntil = currentAt + LEASE_MS;
        tx.set(jobRef, { status: 'sending', attempts, leaseUntil, startedAt: currentAt }, { merge: true });
        const userInfo = `${String(user.name || '')}${user.specialCode ? ` (GM: ${user.specialCode})` : ''}`;
        return { job: current, tokens, attempts, leaseUntil, userInfo };
      });
    } catch (error) {
      stats.errors.push({ code: error?.code || 'push_claim_failed' });
      continue;
    }
    if (!claimed) continue;
    if (claimed.skipped) { stats.skippedCount++; continue; }

    let successCount = 0;
    let failureCount = 0;
    let lastError = null;
    try {
      const { title, body, tag, notificationLink, type } = breakReleasePushMessage(claimed.job, siteAddress);
      for (let offset = 0; offset < claimed.tokens.length; offset += 500) {
        const result = await sendMulticast({
          tokens: claimed.tokens.slice(offset, offset + 500),
          notification: { title, body },
          webpush: {
            notification: { title, body, tag, requireInteraction: true },
            headers: { TTL: '86400' },
            ...(notificationLink ? { fcmOptions: { link: notificationLink } } : {})
          },
          data: { title, body, type, deskId: String(claimed.job.deskId),
            userId: String(claimed.job.userId), logId: String(claimed.job.eventId), url: '/', tag }
        });
        successCount += Number(result.successCount || 0);
        failureCount += Number(result.failureCount || 0);
      }
    } catch (error) {
      lastError = error?.code || 'fcm_send_failed';
    }
    const completedAt = now();
    const accepted = successCount > 0;
    const permanentlyFailed = !accepted && claimed.attempts >= MAX_ATTEMPTS;
    const status = accepted ? 'sent' : permanentlyFailed ? 'failed' : 'pending';
    try {
      // Süresi geçmiş başka görev eski lease'i devralmışsa onun sonucunu ezme.
      await jobs.firestore.runTransaction(async tx => {
        const auditId = `${claimed.job.eventId}-PUSH`;
        const auditRef = collection('sgmAudit').doc(auditId);
        const deletedLogRef = collection('sgmDeletedRecords').doc(`logs-${auditId}`);
        const [fresh, auditSnap, deletedLogSnap] = await Promise.all([
          tx.get(jobRef), accepted ? tx.get(auditRef) : null,
          accepted ? tx.get(deletedLogRef) : null
        ]);
        if (!exists(fresh) || fresh.data().status !== 'sending' ||
            Number(fresh.data().leaseUntil) !== claimed.leaseUntil ||
            Number(fresh.data().attempts) !== claimed.attempts) return;
        tx.set(jobRef, {
          status, successCount, failureCount, completedAt,
          leaseUntil: 0,
          ...(accepted ? { sentAt: completedAt } : {
            nextAttemptAt: completedAt + Math.min(claimed.attempts ** 2 * 60_000, 30 * 60_000),
            lastError: lastError || 'fcm_rejected'
          })
        }, { merge: true });
        // YP'ye yalnızca FCM'in en az bir cihaz tokenı için kabul ettiği gönderimi yaz.
        // Kabul edildi = okundu / cihazda gösterildi demek değildir.
        if (accepted && !exists(auditSnap) && !exists(deletedLogSnap)) {
          tx.create(auditRef, {
            id: auditId, time: completedAt, deskId: Number(claimed.job.deskId),
            userId: claimed.job.userId, userInfo: claimed.userInfo,
            type: 'MOLA_OTOMATIK_BOSALTMA_PUSH_GONDERILDI',
            message: `Masa ${claimed.job.deskId} için otomatik boşaltma push bildirimi ` +
              `${successCount} cihaz için Firebase bildirim servisine başarıyla iletildi. ` +
              'Öğrencinin bildirimi okuduğu veya telefonunda gördüğü doğrulanamaz.',
            actorId: 'SYSTEM', actorInfo: 'Sistem - otomatik mola push',
            sourceEventId: claimed.job.eventId, pushAcceptedCount: successCount,
            pushRejectedCount: failureCount, pushAcceptedAt: completedAt
          });
        }
      });
      if (accepted) stats.sentCount++;
      else if (permanentlyFailed) stats.failedCount++;
      else stats.retryCount++;
      if (!accepted) stats.errors.push({ code: lastError || 'fcm_rejected' });
    } catch (error) {
      // Görev 'sending' olarak kalır; lease bitince sonraki cron tekrar dener.
      stats.errors.push({ code: error?.code || 'push_receipt_failed' });
    }
  }
  return stats;
}
