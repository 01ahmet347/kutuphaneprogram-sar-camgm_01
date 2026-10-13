import { closeLibraryDay } from '../server/daily-close.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ ok: false });
  // Vercel automatically sends CRON_SECRET in the Authorization header.
  if (!process.env.CRON_SECRET || req.headers?.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }
  try {
    return res.status(200).json({ ok: true, result: await closeLibraryDay() });
  } catch (error) {
    console.error('Daily close failed:', error?.code || error?.message || 'unknown');
    return res.status(503).json({ ok: false, error: 'closing_failed' });
  }
}
