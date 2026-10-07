import { createHash } from 'node:crypto';
import { getAuth } from 'firebase-admin/auth';
import { adminApp, dataCollection } from '../server/firebase-admin.js';
import { createStudentLoginHandler } from '../server/student-auth.js';

const attemptRef = req => {
  const clientAddress = req.headers?.['x-vercel-forwarded-for'] ||
    req.headers?.['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    'unknown';
  const key = createHash('sha256').update(String(clientAddress)).digest('hex');
  return dataCollection('sgmAuthAttempts').doc(key);
};

const handler = createStudentLoginHandler({
  async findBySpecialCode(specialCode) {
    const matches = await dataCollection('sgmUsers')
      .where('specialCode', '==', specialCode)
      .limit(2)
      .get();
    return Promise.all(matches.docs.map(async snapshot => {
      const deleted = await dataCollection('sgmDeletedUsers').doc(snapshot.id).get();
      return { id: snapshot.id, user: snapshot.data(), deleted: deleted.exists };
    }));
  },
  createCustomToken(uid, claims) {
    return getAuth(adminApp()).createCustomToken(uid, claims);
  },
  async isRateLimited(req) {
    const ref = attemptRef(req);
    const at = Date.now();
    return ref.firestore.runTransaction(async tx => {
      const snapshot = await tx.get(ref);
      const previous = snapshot.data() || {};
      const windowStart = Number(previous.windowStart || 0);
      const attempts = windowStart > at - 10 * 60 * 1000 ? Number(previous.attempts || 0) + 1 : 1;
      tx.set(ref, { attempts, windowStart: attempts === 1 ? at : windowStart, updatedAt: at });
      return attempts > 8;
    });
  },
  async clearAttempts(req) {
    await attemptRef(req).delete();
  }
});

export default handler;
