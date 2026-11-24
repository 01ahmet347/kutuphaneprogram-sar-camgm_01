import { closeLibraryDay } from '../server/daily-close.js';
import { sweepExpiredBreaks } from '../server/break-auto-release.js';
import { getMessaging } from 'firebase-admin/messaging';
import { adminApp, dataCollection } from '../server/firebase-admin.js';
import { sendPendingBreakPushNotifications } from '../server/break-auto-push.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ ok: false });
  // Vercel'in günlük kapanışı korunur; harici dakikalık kontrol aynı API üzerinden çalışır.
  const breaks = req.query?.task === 'breaks';
  const secret = breaks ? process.env.BREAK_CRON_SECRET : process.env.CRON_SECRET;
  if (!secret || req.headers?.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }
  try {
    if (breaks) {
      const result = await sweepExpiredBreaks({ collection: dataCollection });
      // Masa düşürüldükten sonra, öğrencinin telefonu kapalı olsa bile FCM'e gönder.
      // Önceden başka bir API isteğiyle düşürülen oturumların bekleyen bildirimleri de işlenir.
      const push = await sendPendingBreakPushNotifications({
        collection: dataCollection,
        sendMulticast: message => getMessaging(adminApp()).sendEachForMulticast(message),
        siteAddress: process.env.APP_URL || process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL
      });
      const ok = !result.errors.length && !push.errors.length;
      return res.status(ok ? 200 : 503).json({ ok, result, push });
    }
    return res.status(200).json({ ok: true, result: await closeLibraryDay() });
  } catch (error) {
    console.error('Daily close failed:', error?.code || error?.message || 'unknown');
    return res.status(503).json({ ok: false, error: 'closing_failed' });
  }
}
