import { createHash } from 'node:crypto';
import { getAuth } from 'firebase-admin/auth';
import { adminApp, dataCollection } from '../server/firebase-admin.js';
import {
  createStudentRecord,
  createStudentRegistrationHandler,
  generateStudentCredential
} from '../server/student-registration.js';

// Kayıt hatasının ayrıntısını yalnızca sunucu loglarına yazar.
function registrationDiagnostic(stage, action) {
  return async (...args) => {
    try {
      return await action(...args);
    } catch (error) {
      const message = String(error?.message || 'Hata mesajı bulunamadı.')
        .replace(/-----BEGIN[\s\S]*?-----END[^\r\n]*-----/g, '[GİZLİ ANAHTAR]')
        .replace(/Bearer\s+\S+/gi, 'Bearer [GİZLİ]')
        .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[GİZLİ TOKEN]')
        .slice(0, 500);

      console.error('[SGM öğrenci kayıt ayrıntısı]', {
        stage,
        code: error?.code ?? 'kod_yok',
        name: error?.name || 'Error',
        message,
        configured: {
          FIREBASE_ADMIN_PROJECT_ID: Boolean(process.env.FIREBASE_ADMIN_PROJECT_ID),
          FIREBASE_ADMIN_CLIENT_EMAIL: Boolean(process.env.FIREBASE_ADMIN_CLIENT_EMAIL),
          FIREBASE_ADMIN_PRIVATE_KEY: Boolean(process.env.FIREBASE_ADMIN_PRIVATE_KEY),
          FIREBASE_APP_ID: Boolean(process.env.FIREBASE_APP_ID || process.env.VITE_FIREBASE_APP_ID)
        }
      });

      throw error;
    }
  };
}

// Kimlik yalnızca doğrulanmış token'dan alınır; istemci userId seçemez.
const anonymousUidKey = Symbol('verifiedAnonymousRegistrationUid');
async function verifyAnonymousUser(req) {
  if (Object.prototype.hasOwnProperty.call(req, anonymousUidKey)) {
    return req[anonymousUidKey];
  }
  const token = /^Bearer\s+(.+)$/i.exec(req.headers?.authorization || '')?.[1];
  if (!token) return null;
  const decoded = await getAuth(adminApp()).verifyIdToken(token);
  const uid = decoded.firebase?.sign_in_provider === 'anonymous' ? decoded.uid : null;
  req[anonymousUidKey] = uid;
  return uid;
}

function registrationResult(user, uid) {
  if (user.id != null && String(user.id) !== String(uid)) {
    throw new Error('Kayıt belgesi doğrulanmış oturumla eşleşmiyor.');
  }
  const specialCode = String(user.specialCode || '');
  const pin = String(user.pin || '');
  if (!/^\d{8}$/.test(specialCode) || !/^\d{8}$/.test(pin)) {
    throw new Error('Mevcut hesabın GM Özel Kod veya şifre bilgisi eksik. Sorumlu kontrolü gereklidir.');
  }
  const { pin: _pin, ...profile } = user;
  return { user: { ...profile, id: uid }, credentials: { specialCode, pin } };
}

const handler = createStudentRegistrationHandler({
  verifyAnonymousUser: registrationDiagnostic('oturum_dogrulama', verifyAnonymousUser),

  isRateLimited: registrationDiagnostic('kayit_limiti', async req => {
    // Aynı hesabın bilgilerinin yeniden getirilmesi yeni hesap oluşturma sayılmaz.
    const uid = await verifyAnonymousUser(req);
    if (uid) {
      const existing = await dataCollection('sgmUsers').doc(uid).get();
      if (existing.exists) return false;
    }

    const clientAddress =
      req.headers?.['x-vercel-forwarded-for'] ||
      req.headers?.['x-forwarded-for']?.split(',')[0]?.trim() ||
      req.socket?.remoteAddress ||
      'unknown';

    const key = createHash('sha256').update(String(clientAddress)).digest('hex');
    const ref = dataCollection('sgmRegistrationAttempts').doc(key);
    const at = Date.now();

    return ref.firestore.runTransaction(async tx => {
      const snapshot = await tx.get(ref);
      const previous = snapshot.data() || {};
      const windowStart = Number(previous.windowStart || 0);
      const attempts = windowStart > at - 60 * 60 * 1000
        ? Number(previous.attempts || 0) + 1
        : 1;

      tx.set(ref, {
        attempts,
        windowStart: attempts === 1 ? at : windowStart,
        updatedAt: at
      });
      return attempts > 10;
    });
  }),

  createStudent: registrationDiagnostic('hesap_olusturma', async uid => {
    const authCodes = dataCollection('sgmAuthCodes');
    const users = dataCollection('sgmUsers');
    const config = await dataCollection('sgmConfig').doc('settings').get();
    const settings = config.data() || {};

    for (let attempt = 0; attempt < 12; attempt++) {
      const specialCode = generateStudentCredential();
      const pin = generateStudentCredential();
      const user = createStudentRecord({ uid, specialCode, pin, settings });

      const result = await users.firestore.runTransaction(async tx => {
        const userRef = users.doc(uid);
        const userSnap = await tx.get(userRef);

        // Yeniden denemede hesabı, şifreyi, onayı ve kısıtları aynen koru.
        if (userSnap.exists) {
          const existingUser = userSnap.data();
          const existingResult = registrationResult(existingUser, uid);
          const existingCodeRef = authCodes.doc(existingResult.credentials.specialCode);
          const existingCodeSnap = await tx.get(existingCodeRef);
          if (existingCodeSnap.exists && existingCodeSnap.data()?.userId !== uid) {
            throw new Error('Mevcut GM Özel Kod başka hesaba bağlı. Sorumlu kontrolü gereklidir.');
          }
          // Eski kayıtta eksik kod eşleştirmesi varsa aynı hesabı onar.
          if (!existingCodeSnap.exists) {
            tx.create(existingCodeRef, { userId: uid, createdAt: Date.now() });
          }
          return existingResult;
        }

        const codeRef = authCodes.doc(specialCode);
        const codeSnap = await tx.get(codeRef);
        if (codeSnap.exists) return null;
        const newResult = registrationResult(user, uid);
        tx.create(codeRef, { userId: uid, createdAt: Date.now() });
        tx.create(userRef, user);
        return newResult;
      });

      if (result) return result;
    }
    throw new Error('Unable to allocate unique student credentials.');
  })
});

export default handler;
