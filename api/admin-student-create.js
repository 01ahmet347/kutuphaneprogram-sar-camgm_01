import { randomUUID } from 'node:crypto';
import { getAuth } from 'firebase-admin/auth';
import { adminApp, dataCollection } from '../server/firebase-admin.js';
import {
  createStudentRecord,
  generateStudentCredential
} from '../server/student-registration.js';

function publicProfile(user) {
  const { pin: _pin, ...profile } = user;
  return profile;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false });
  }

  try {
    const token = /^Bearer\s+(.+)$/i.exec(
      req.headers?.authorization || ''
    )?.[1];
    if (!token) {
      return res.status(401).json({
        ok: false,
        error: 'unauthenticated',
        message: 'Yönetici oturumu doğrulanamadı.'
      });
    }

    const decoded = await getAuth(adminApp()).verifyIdToken(token);
    if (decoded.admin !== true) {
      return res.status(403).json({
        ok: false,
        error: 'admin_required',
        message: 'Bu işlem için yönetici yetkisi gerekir.'
      });
    }

    const { name, requestId } = req.body || {};
    if (
      typeof name !== 'string' ||
      !name.trim() ||
      name.trim().length > 120 ||
      typeof requestId !== 'string' ||
      !/^[A-Za-z0-9_-]{8,100}$/.test(requestId)
    ) {
      return res.status(400).json({
        ok: false,
        error: 'invalid_request',
        message: 'Ad soyad veya işlem kimliği geçersiz.'
      });
    }

    const users = dataCollection('sgmUsers');
    const authCodes = dataCollection('sgmAuthCodes');
    const requestRef = dataCollection('sgmAdminStudentRequests')
      .doc(requestId);
    const settingsSnapshot = await dataCollection('sgmConfig')
      .doc('settings')
      .get();
    const settings = settingsSnapshot.data() || {};
    const userId = randomUUID();

    for (let attempt = 0; attempt < 12; attempt++) {
      const specialCode = generateStudentCredential();
      const pin = generateStudentCredential();
      const user = {
        ...createStudentRecord({
          uid: userId,
          specialCode,
          pin,
          settings
        }),
        name: name.trim()
      };

      const result = await users.firestore.runTransaction(async tx => {
        const requestSnapshot = await tx.get(requestRef);

        if (requestSnapshot.exists) {
          const existingUserId = requestSnapshot.data()?.userId;
          if (!existingUserId) {
            throw new Error('Önceki hesap oluşturma işlemi eksik.');
          }

          const existingUserRef = users.doc(String(existingUserId));
          const existingUserSnapshot = await tx.get(existingUserRef);
          if (!existingUserSnapshot.exists) {
            throw new Error('Önceki işlemde oluşturulan hesap bulunamadı.');
          }

          return existingUserSnapshot.data();
        }

        const userRef = users.doc(userId);
        const codeRef = authCodes.doc(specialCode);
        const [userSnapshot, codeSnapshot] = await Promise.all([
          tx.get(userRef),
          tx.get(codeRef)
        ]);

        if (userSnapshot.exists || codeSnapshot.exists) return null;

        tx.create(codeRef, {
          userId,
          createdAt: Date.now()
        });
        tx.create(userRef, user);
        tx.create(requestRef, {
          userId,
          createdAt: Date.now()
        });

        return user;
      });

      if (result) {
        return res.status(201).json({
          ok: true,
          user: {
            ...publicProfile(result),
            pin: result.pin
          }
        });
      }
    }

    throw new Error('Unable to allocate unique student credentials.');
  } catch (error) {
    if (error.code?.startsWith('auth/')) {
      return res.status(401).json({
        ok: false,
        error: 'invalid_admin_session',
        message: 'Yönetici oturumu geçersiz veya süresi dolmuş.'
      });
    }

    console.error('Admin student creation error:', error.code || error.message);
    return res.status(503).json({
      ok: false,
      error: 'student_creation_unavailable',
      message: 'Öğrenci hesabı oluşturulamadı. Sunucu ayarlarını kontrol edin.'
    });
  }
}