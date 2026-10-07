import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { adminApp, dataCollection } from '../server/firebase-admin.js';
import { createStudentDeskHandler, getIstanbulDayKey } from '../server/student-desk.js';
import { createCloudActions } from '../src/cloud-transactions.js';

const handler = createStudentDeskHandler({
  async authenticateStudent(req) {
    const token = /^Bearer\s+(.+)$/i.exec(req.headers?.authorization || '')?.[1];
    if (!token) return null;
    const decoded = await getAuth(adminApp()).verifyIdToken(token);
    return decoded.role === 'student' ? decoded.uid : null;
  },
  async createActions() {
    const app = adminApp();
    const firestore = getFirestore(app);
    const settingsSnapshot = await dataCollection('sgmConfig').doc('settings').get();
    const settings = settingsSnapshot.data() || {};
    const ref = (bucket, id) => dataCollection(bucket).doc(String(id));
    const dayKey = at => getIstanbulDayKey(at ? new Date(at) : new Date());
    const isRestricted = (user, at) => user?.pendingApproval === true || Number(user?.restrictedUntil || 0) > at;
    const lostDeskToday = (user, deskId) =>
      user?.lostDeskDate === dayKey() && (user?.lostDeskIds || []).includes(Number(deskId));
    const applyViolationPolicy = (user, deskId, at) => {
      const week = 7 * 24 * 60 * 60 * 1000;
      const history = [...(Array.isArray(user.violationHistory) ? user.violationHistory : []), at];
      const recent = history.filter(time => Number(time) > at - week && Number(time) <= at);
      return {
        violationHistory: history,
        restrictedUntil: recent.length >= 2 ? Math.max(Number(user.restrictedUntil || 0), at + week) : Number(user.restrictedUntil || 0),
        restrictionReason: recent.length >= 2 ? 'Son 7 gün içinde iki ihlal: 7 gün kısıtlama' : (user.restrictionReason || ''),
        lostDeskDate: dayKey(new Date(at)),
        lostDeskIds: [...new Set([...(user.lostDeskDate === dayKey(new Date(at)) ? user.lostDeskIds || [] : []), Number(deskId)])]
      };
    };

    const actions = createCloudActions({
      db: firestore,
      runTransaction: (_db, callback) => firestore.runTransaction(callback),
      ref,
      settings: () => settings,
      dayKey,
      isRestricted,
      lostDeskToday,
      applyViolationPolicy
    });
    return {
      ...actions,
      cancel: ({ userId, deskId }) => firestore.runTransaction(async tx => {
        const userRef = ref('sgmUsers', userId);
        const deskRef = ref('sgmDesks', deskId);
        const [userSnapshot, deskSnapshot] = await Promise.all([tx.get(userRef), tx.get(deskRef)]);
        if (!userSnapshot.exists() || !deskSnapshot.exists()) throw new Error('Rezervasyon bulunamadı.');
        const user = userSnapshot.data();
        const desk = deskSnapshot.data();
        if (desk.pendingOccupant !== userId || Number(user.pendingDeskId) !== Number(deskId)) {
          throw new Error('Bu masa için iptal edilebilir rezervasyonunuz yok.');
        }
        const nextDesk = {
          ...desk,
          pendingOccupant: null,
          pendingDeskRole: null,
          pendingDeskDeadline: null,
          pendingDeviceId: null
        };
        const nextUser = { ...user, pendingDeskId: null, pendingDeskDeadline: null };
        tx.set(deskRef, nextDesk);
        tx.set(userRef, nextUser);
        return { desk: nextDesk, user: nextUser };
      })
    };
  }
});

export default handler;
