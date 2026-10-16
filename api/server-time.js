export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  if (req.method !== 'GET') return res.status(405).json({ ok: false });
  return res.status(200).json({ ok: true, at: Date.now() });
}
