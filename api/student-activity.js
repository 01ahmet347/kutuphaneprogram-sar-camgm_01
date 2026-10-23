import { getAuth } from 'firebase-admin/auth';
import { adminApp, dataCollection } from '../server/firebase-admin.js';
import { createStudentActivityHandler, createStudentProfileWriters } from '../server/student-activity.js';
import { releaseExpiredBreaksForDesk } from '../server/break-auto-release.js';

const writers = createStudentProfileWriters({ dataCollection });
const handler = createStudentActivityHandler({
  async authenticateStudent(req) {
    const token = /^Bearer\s+(.+)$/i.exec(req.headers?.authorization || '')?.[1];
    if (!token) return null;
    const decoded = await getAuth(adminApp()).verifyIdToken(token);
    return decoded.role === 'student' ? decoded.uid : null;
  },
  ...writers,
  autoReleaseBreak: deskId => releaseExpiredBreaksForDesk({ deskId, collection: dataCollection })
});

export default handler;
