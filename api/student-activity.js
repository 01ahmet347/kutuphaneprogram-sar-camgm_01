import { getAuth } from 'firebase-admin/auth';
import { adminApp, dataCollection } from '../server/firebase-admin.js';
import { createStudentActivityHandler, createStudentProfileWriters } from '../server/student-activity.js';
import { releaseExpiredBreaksForDesk } from '../server/break-auto-release.js';
import { createActivityService } from '../server/activity-module.js';

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

const activityService=createActivityService({collection:dataCollection});
export default async function studentActivityRouter(req,res) {
  if (req.method==='POST' && ['activity_list','activity_apply','activity_append_break'].includes(req.body?.action)) {
    res.setHeader('Cache-Control','no-store');
    try {
      const token=/^Bearer\s+(.+)$/i.exec(req.headers?.authorization||'')?.[1];
      if (!token) return res.status(401).json({ok:false,message:'Öğrenci oturumu gerekli.'});
      const decoded=await getAuth(adminApp()).verifyIdToken(token);
      if(decoded.role!=='student') return res.status(403).json({ok:false,message:'Öğrenci yetkisi gerekli.'});
      const action=req.body.action;
      const result=action==='activity_list' ? await activityService.studentList(decoded.uid) :
        action==='activity_apply' ? await activityService.apply(decoded.uid,req.body) :
        await activityService.appendBreak(decoded.uid,req.body);
      return res.status(200).json({ok:true,result});
    } catch(error) {
      if(!error.status) console.error('Activity error:',error.code||error.message);
      return res.status(error.status||503).json({ok:false,message:error.status?error.message:'Faaliyet işlemi tamamlanamadı.'});
    }
  }
  return handler(req,res);
}
