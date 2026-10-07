import { createHash } from 'node:crypto';
import { getAuth } from 'firebase-admin/auth';
import { adminApp, dataCollection } from '../server/firebase-admin.js';
import {
  createStudentRecord,
  createStudentRegistrationHandler,
  generateStudentCredential
} from '../server/student-registration.js';

// Kayıt davranışını değiştirmeden hata ayrıntısını sunucuya kaydeder.
function registrationDiagnostic(stage, action) {
  return async (...args) => {
    try {
      return await action(...args);
    } catch (error) {
      const message = String(error?.message || 'Hata mesajı bulunamadı.')
        .replace(
          /-----BEGIN[\s\S]*?-----END[^\r\n]*-----/g,
          '[GİZLİ ANAHTAR]'
        )
        .replace(/Bearer\s+\S+/gi, 'Bearer [GİZLİ]')
        .replace(
          /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
          '[GİZLİ TOKEN]'
        )
        .slice(0, 500);

      console.error('[SGM öğrenci kayıt ayrıntısı]', {
        stage,
        code: error?.code ?? 'kod_yok',
        name: error?.name || 'Error',
        message,
        configured: {
          FIREBASE_ADMIN_PROJECT_ID:
            Boolean(process.env.FIREBASE_ADMIN_PROJECT_ID),
          FIREBASE_ADMIN_CLIENT_EMAIL:
            Boolean(process.env.FIREBASE_ADMIN_CLIENT_EMAIL),
          FIREBASE_ADMIN_PRIVATE_KEY:
            Boolean(process.env.FIREBASE_ADMIN_PRIVATE_KEY),
          FIREBASE_APP_ID:
            Boolean(
              process.env.FIREBASE_APP_ID ||
              process.env.VITE_FIREBASE_APP_ID
            )
        }
      });

      throw error;
    }
  };
}

const handler = createStudentRegistrationHandler({
  verifyAnonymousUser: registrationDiagnostic(
    'oturum_dogrulama',
    async req => {
      const token = /^Bearer\s+(.+)$/i.exec(
        req.headers?.authorization || ''
      )?.[1];

      if (!token) return null;

      const decoded = await getAuth(adminApp()).verifyIdToken(token);

      return decoded.firebase?.sign_in_provider === 'anonymous'
        ? decoded.uid
        : null;
    }
  ),

  isRateLimited: registrationDiagnostic(
    'kayit_limiti',
    async req => {
      const clientAddress =
        req.headers?.['x-vercel-forwarded-for'] ||
        req.headers?.['x-forwarded-for']?.split(',')[0]?.trim() ||
        req.socket?.remoteAddress ||
        'unknown';

      const key = createHash('sha256')
        .update(String(clientAddress))
        .digest('hex');

      const ref = dataCollection('sgmRegistrationAttempts').doc(key);
      const at = Date.now();

      return ref.firestore.runTransaction(async tx => {
        const snapshot = await tx.get(ref);
        const previous = snapshot.data() || {};
        const windowStart = Number(previous.windowStart || 0);

        const attempts =
          windowStart > at - 60 * 60 * 1000
            ? Number(previous.attempts || 0) + 1
            : 1;

        tx.set(ref, {
          attempts,
          windowStart: attempts === 1 ? at : windowStart,
          updatedAt: at
        });

        return attempts > 3;
      });
    }
  ),

  createStudent: registrationDiagnostic(
    'hesap_olusturma',
    async uid => {
      const authCodes = dataCollection('sgmAuthCodes');
      const users = dataCollection('sgmUsers');

      const config = await dataCollection('sgmConfig')
        .doc('settings')
        .get();

      const settings = config.data() || {};

      for (let attempt = 0; attempt < 12; attempt++) {
        const specialCode = generateStudentCredential();
        const pin = generateStudentCredential();

        const user = createStudentRecord({
          uid,
          specialCode,
          pin,
          settings
        });

        const created = await users.firestore.runTransaction(
          async tx => {
            const codeRef = authCodes.doc(specialCode);
            const userRef = users.doc(uid);

            const [codeSnap, userSnap] = await Promise.all([
              tx.get(codeRef),
              tx.get(userRef)
            ]);

            if (codeSnap.exists() || userSnap.exists()) return false;

            tx.create(codeRef, {
              userId: uid,
              createdAt: Date.now()
            });

            tx.create(userRef, user);
            return true;
          }
        );

        if (!created) continue;

        const { pin: _pin, ...profile } = user;

        return {
          user: profile,
          credentials: { specialCode, pin }
        };
      }

      throw new Error('Unable to allocate unique student credentials.');
    }
  )
});

export default handler;