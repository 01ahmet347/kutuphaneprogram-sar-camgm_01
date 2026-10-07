import { FieldValue } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { adminApp, authenticate, dataCollection } from '../server/firebase-admin.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method not allowed' });
  try {
    const caller = await authenticate(req);
    const { userId, logId, type } = req.body || {};
    if (typeof userId !== 'string' || !userId || userId.includes('/') || userId.length > 180) return res.status(400).json({ success: false, message: 'Geçersiz kullanıcı.' });
    let title, body, notificationType, deskId;
    const test = type === 'ADMIN_PUSH_TEST';
    if (test) {
      if (caller.admin !== true) return res.status(403).json({ success: false, message: 'Yönetici yetkisi gerekli.' });
      title = 'SGM Push Testi'; body = 'Telefon push bildirim sistemi çalışıyor.'; notificationType = type; deskId = null;
    } else {
      if (typeof logId !== 'string' || !logId || logId.includes('/') || logId.length > 180) return res.status(400).json({ success: false, message: 'Bildirim kaydı gerekli.' });
      const snap = await dataCollection('sgmAudit').doc(logId).get();
      if (!snap.exists) return res.status(409).json({ success: false, message: 'Bildirim kaydı henüz sunucuya ulaşmadı.' });
      const event = snap.data();
      if (event.userId !== userId || event.actorFirebaseUid !== caller.uid || !['İHBAR', 'İHBAR_MISAFIR', 'ADMIN_MASA_MESAJI'].includes(event.type)) {
        return res.status(403).json({ success: false, message: 'Bu bildirim için yetkiniz yok.' });
      }
      if (event.type === 'ADMIN_MASA_MESAJI' && caller.admin !== true) return res.status(403).json({ success: false, message: 'Yönetici yetkisi gerekli.' });
      notificationType = event.type; deskId = event.deskId;
      if (event.type === 'ADMIN_MASA_MESAJI') {
        title = event.notificationTitle || 'Yönetici Masa Kontrol Mesajı'; body = event.notificationBody || event.message;
      } else {
        const config = await dataCollection('sgmConfig').doc('settings').get();
        const minutes = Number(config.data()?.reportWaitTime) || 5;
        title = 'Masanız İhbar Edildi!';
        body = `Masa ${deskId} boş olduğu gerekçesiyle ihbar edildi. ${minutes} dakika içinde dönüp QR kod ile “Masadayım” doğrulaması yapın.`;
      }
    }
    const target = await dataCollection('sgmUsers').doc(userId).get();
    const deleted = await dataCollection('sgmDeletedUsers').doc(userId).get();
    if (!target.exists || deleted.exists) return res.status(410).json({ success: false, message: 'Kullanıcı hesabı silinmiş.' });
    const tokens = [...new Set((target.data().pushTokens || []).filter(token => typeof token === 'string' && token))];
    if (!tokens.length) return res.status(200).json({ success: false, skipped: true, reason: 'no-token' });
    const receiptRef = dataCollection('sgmPushReceipts').doc(test ? `test-${logId || Date.now()}` : logId);
    const firestore = receiptRef.firestore;
    const acquired = await firestore.runTransaction(async tx => {
      const snap = await tx.get(receiptRef);
      const receipt = snap.data() || {};
      if (receipt.status === 'sent') return 'sent';
      if (receipt.status === 'sending' && Number(receipt.leaseUntil) > Date.now()) return 'busy';
      tx.set(receiptRef, { status: 'sending', leaseUntil: Date.now() + 60000, userId, type: notificationType });
      return 'acquired';
    });
    if (acquired === 'sent') return res.status(200).json({ success: true, deduplicated: true });
    if (acquired === 'busy') return res.status(409).json({ success: false, message: 'Bildirim gönderimi sürüyor.' });
    const siteAddress = process.env.APP_URL || process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
    let notificationLink;
    if (siteAddress) {
      const url = new URL(siteAddress.startsWith('http') ? siteAddress : `https://${siteAddress}`);
      if (url.protocol === 'https:') notificationLink = new URL('/', url).href;
    }
    let successCount = 0, failureCount = 0;
    const invalidTokens = [];
    try {
      for (let offset = 0; offset < tokens.length; offset += 500) {
        const result = await getMessaging(adminApp()).sendEachForMulticast({
          tokens: tokens.slice(offset, offset + 500),
          notification: { title, body },
          webpush: {
            notification: { title, body, requireInteraction: notificationType.includes('İHBAR'), tag: `sgm-${logId || 'test'}` },
            ...(notificationLink ? { fcmOptions: { link: notificationLink } } : {})
          },
          data: { title: String(title), body: String(body), type: String(notificationType), deskId: String(deskId || ''), userId, logId: String(logId || ''), url: '/', tag: `sgm-${logId || 'test'}` }
        });
        successCount += result.successCount; failureCount += result.failureCount;
        result.responses.forEach((response, index) => {
          if (['messaging/invalid-registration-token', 'messaging/registration-token-not-registered'].includes(response.error?.code)) invalidTokens.push(tokens[offset + index]);
        });
      }
      if (invalidTokens.length) await target.ref.update({ pushTokens: FieldValue.arrayRemove(...invalidTokens) }).catch(() => {});
      await receiptRef.set({ status: successCount ? 'sent' : 'failed', sentAt: Date.now(), successCount, failureCount, userId, type: notificationType });
      if (!successCount && invalidTokens.length === tokens.length) return res.status(200).json({ success: false, skipped: true, reason: 'no-token' });
      return res.status(successCount ? 200 : 502).json({ success: successCount > 0, successCount, failureCount, message: successCount ? undefined : 'Telefon push servisi bildirimi kabul etmedi.' });
    } catch (error) {
      await receiptRef.set({ status: 'failed', failedAt: Date.now() }, { merge: true }).catch(() => {});
      throw error;
    }
  } catch (error) {
    console.error('Push send error:', error.code || error.status || 'unknown');
    return res.status(error.status || 503).json({ success: false, message: error.status ? error.message : 'Bildirim sunucusu ayarlarını ve Firebase bağlantısını kontrol edin.' });
  }
}
