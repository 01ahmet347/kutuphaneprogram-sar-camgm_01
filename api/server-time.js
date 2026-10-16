// Keep both public utility endpoints in one Vercel function so the project
// stays within the Hobby plan limit (12 Serverless Functions).
// /api/version is rewritten here with ?route=version in vercel.json.
export default function handler(req, res) {
  const route = Array.isArray(req.query?.route)
    ? req.query.route[0]
    : req.query?.route;

  if (route === 'version') {
    // Maintain the existing /api/version response and cache semantics.
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      version: '2026.10.07.1',
      commit: process.env.VERCEL_GIT_COMMIT_SHA || 'manual-upload'
    });
  }

  // Preserve the existing /api/server-time contract for break timers.
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  if (req.method !== 'GET') return res.status(405).json({ ok: false });
  return res.status(200).json({ ok: true, at: Date.now() });
}
