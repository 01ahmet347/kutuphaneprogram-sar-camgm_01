import { randomInt, randomUUID } from 'node:crypto';

export function createStudentRegistrationHandler({ verifyAnonymousUser, isRateLimited, createStudent }) {
  return async function studentRegistrationHandler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ ok: false });
    }
    try {
      const uid = await verifyAnonymousUser(req);
      if (!uid) return res.status(401).json({
        ok: false, error: 'anonymous_session_required',
        message: 'Kayıt için anonim cihaz oturumu doğrulanamadı. Kayıt ekranından yeniden deneyin.'
      });
      if (await isRateLimited?.(req)) return res.status(429).json({
        ok: false, error: 'too_many_attempts',
        message: 'Kısa sürede çok fazla kayıt denemesi yapıldı. Daha sonra tekrar deneyin.'
      });
      const created = await createStudent(uid);
      return res.status(201).json({ok: true, user: created.user, credentials: created.credentials});
    } catch (error) {
      if (error.status) return res.status(error.status).json({ok: false, error: error.code, ...(error.publicMessage ? {message: error.publicMessage} : {})});
      if (['auth/id-token-expired', 'auth/id-token-revoked', 'auth/argument-error', 'auth/invalid-id-token', 'auth/user-disabled', 'auth/user-not-found'].includes(error.code)) {
        return res.status(401).json({ok: false, error: 'invalid_registration_session', message: 'Kayıt oturumu sunucuda doğrulanamadı. Yeniden giriş yapın; hata sürerse Firebase proje ayarları kontrol edilmelidir.'});
      }
      console.error('Student registration error:', error.code || 'unknown');
      return res.status(503).json({ok: false, error: 'student_registration_unavailable', message: 'Yeni öğrenci kaydı şu anda oluşturulamadı. Firebase sunucu ayarlarını kontrol edin.'});
    }
  };
}

export function createStudentRecord({uid, specialCode, pin, settings, now = Date.now()}) {
  const registrationSession = randomUUID();
  return {
    id: uid, name: `Yeni Kayıt • ${specialCode}`, identityNo: specialCode, specialCode, pin,
    registrationSession, registrationFormStatus: 'manual_review', pendingApproval: true,
    restrictedUntil: 0, restrictionReason: 'Google Form kontrolü ve kütüphane sorumlusu onayı bekleniyor',
    activeDeskId: null, activeDeskRole: null, pendingDeskId: null, pendingDeskDeadline: null,
    breaks: {short: Number(settings.shortBreakCount) || 5, long: Number(settings.longBreakCount) || 2},
    strikes: 0, blocked: false, canReport: true, createdAt: now
  };
}
export function generateStudentCredential() { return String(randomInt(10_000_000, 100_000_000)); }
