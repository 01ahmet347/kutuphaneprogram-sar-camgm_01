import { createHash, timingSafeEqual } from 'node:crypto';

const equalSecret = (provided, stored) => timingSafeEqual(
  createHash('sha256').update(String(provided)).digest(),
  createHash('sha256').update(String(stored)).digest()
);

export function createStudentLoginHandler({ findBySpecialCode, createCustomToken, isRateLimited, clearAttempts }) {
  return async function studentLoginHandler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ ok: false });
    }

    const { specialCode, pin } = req.body || {};
    if (typeof specialCode !== 'string' || !/^\d{8}$/.test(specialCode) ||
        typeof pin !== 'string' || !/^\d{8}$/.test(pin)) {
      return res.status(400).json({ ok: false, error: 'invalid_credentials' });
    }

    try {
      if (await isRateLimited?.(req, specialCode)) {
        return res.status(429).json({ ok: false, error: 'too_many_attempts', message: 'Çok fazla giriş denemesi yapıldı. Bir süre sonra tekrar deneyin.' });
      }
      const matches = await findBySpecialCode(specialCode);
      const valid = matches.length === 1 &&
        equalSecret(pin, matches[0].user.pin) &&
        !matches[0].deleted;
      if (!valid) return res.status(401).json({ ok: false, error: 'invalid_credentials' });

      const { id, user } = matches[0];
      await clearAttempts?.(req, specialCode);
      const token = await createCustomToken(id, { role: 'student' });
      const { pin: _pin, pushTokens: _pushTokens, ...profile } = user;
      return res.status(200).json({ ok: true, token, user: { ...profile, id } });
    } catch (error) {
      console.error('Student login error:', error.code || 'unknown');
      return res.status(503).json({
        ok: false,
        error: 'student_auth_unavailable',
        message: 'Öğrenci girişi şu anda kullanılamıyor. Firebase sunucu ayarlarını kontrol edin.'
      });
    }
  };
}
