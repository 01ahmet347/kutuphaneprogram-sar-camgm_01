export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ version: '2026.10.07.1', commit: process.env.VERCEL_GIT_COMMIT_SHA || 'manual-upload' });
}
