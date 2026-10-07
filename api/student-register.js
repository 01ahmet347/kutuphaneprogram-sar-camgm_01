import { createHash } from 'node:crypto';
import { getAuth } from 'firebase-admin/auth';
import { adminApp, dataCollection } from '../server/firebase-admin.js';
import {
  createStudentRecord,
  createStudentRegistrationHandler,
  generateStudentCredential
} from '../server/student-registration.js';

const handler = createStudentRegistrationHandler({
  async verifyAnonymousUser(req) {
    const token = /^Bearer\s+(.+)$/i.exec(req.headers?.authorization || '')?.[1];
    if (!token) return null;
    const decoded = await getAuth(adminApp()).verifyIdToken(token);
    return decoded.firebase?.sign_in_provider === 'anonymous' ? decoded.uid : null;
  },
  async isRateLimited(req) {
    const clientAddress = req.headers?.['x-vercel-forwarded-for'] ||
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
      const attempts = windowStart > at - 60 * 60 * 1000 ? Number(previous.attempts || 0) + 1 : 1;
      tx.set(ref, { attempts, windowStart: attempts === 1 ? at : windowStart, updatedAt: at });
      return attempts > 3;
    });
  },
  async createStudent(uid) {
    const authCodes = dataCollection('sgmAuthCodes');
    const users = dataCollection('sgmUsers');
    const config = await dataCollection('sgmConfig').doc('settings').get();
    const settings = config.data() || {};

    for (let attempt = 0; attempt < 12; attempt++) {
      const specialCode = generateStudentCredential();
      const pin = generateStudentCredential();
      const user = createStudentRecord({ uid, specialCode, pin, settings });
      const created = await users.firestore.runTransaction(async tx => {
        const codeRef = authCodes.doc(specialCode);
        const userRef = users.doc(uid);
        const [codeSnap, userSnap] = await Promise.all([tx.get(codeRef), tx.get(userRef)]);
        if (codeSnap.exists() || userSnap.exists()) return false;
        tx.create(codeRef, { userId: uid, createdAt: Date.now() });
        tx.create(userRef, user);
        return true;
      });
      if (!created) continue;

      const { pin: _pin, ...profile } = user;
      return { user: profile, credentials: { specialCode, pin } };
    }
    throw new Error('Unable to allocate unique student credentials.');
  }
});

export default handler;
