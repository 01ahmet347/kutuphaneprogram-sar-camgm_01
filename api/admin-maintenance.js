import { getAuth } from 'firebase-admin/auth';
import { adminApp, dataCollection } from '../server/firebase-admin.js';
import { requireActiveAdmin } from '../server/admin-session.js';
import { createCloudActions } from '../src/cloud-transactions.js';
import { getIstanbulDayKey } from '../server/student-desk.js';
import { approveAccounts, validApprovalIds, updateAdminAccount, restoreReportPermission } from '../server/user-approval.js';
import { violationPolicyPatch } from '../src/restriction-policy.js';
import { updateSystemSettings } from '../server/settings-update.js';
import { requireLeader, manageLeader } from '../server/leader-auth.js';
import { leaderQueue, leaderHistory, adminLeaderHistory, reviewStudent, saveLeaderFormLinks } from '../server/leader-review.js';
import { createActivityService } from '../server/activity-module.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ ok: false });
  const { action, userId, userIds, deskId, patch, expectedPermission } = req.body || {};
  const newActions = ['admin_leader_list','admin_leader_create','admin_leader_password','admin_leader_status','admin_leader_history','admin_leader_config','admin_leader_links','leader_queue','leader_history','leader_check','leader_restrict','leader_unrestrict',
    'leader_activity_list','leader_activity_create','leader_activity_decide','leader_activity_close','leader_activity_remove_request','admin_activity_list','admin_activity_remove_decide','admin_activity_remove'];
  if (newActions.includes(action)) return handleNewAction(req, res, action);
  if (!['delete_user', 'expire', 'approve_user', 'approve_users', 'update_user', 'restore_report_permission','update_settings','close_history'].includes(action) ||
      action === 'approve_user' && !validApprovalIds([userId]) ||
      action === 'approve_users' && !validApprovalIds(userIds) ||
      ['update_user','restore_report_permission'].includes(action) && !validApprovalIds([userId]) ||
      action === 'delete_user' && (typeof userId !== 'string' || !userId || userId.includes('/') || userId.length > 180) ||
      action === 'expire' && (!Number.isInteger(deskId) || deskId < 1 || deskId > 35)) {
    return res.status(400).json({ ok: false, message: 'Geçersiz işlem.' });
  }
  try {
    const token = /^Bearer\s+(.+)$/i.exec(req.headers?.authorization || '')?.[1];
    if (!token) return res.status(401).json({ ok: false });
    const admin = await getAuth(adminApp()).verifyIdToken(token);
    await requireActiveAdmin(admin);
    if (action === 'update_settings') {
      const result = await updateSystemSettings({
        patch, collection: dataCollection,
        runTransaction: callback => dataCollection('sgmConfig').firestore.runTransaction(callback)
      });
      return res.status(200).json({ ok: true, result });
    }
    if (action === 'close_history') {
      const snapshot = await dataCollection('sgmDailyClosures').orderBy('closedAt', 'desc').limit(14).get();
      return res.status(200).json({ ok: true, result: { history: snapshot.docs.map(doc => ({ day: doc.id, ...doc.data() })) } });
    }
    if (action === 'approve_user' || action === 'approve_users') {
      const ids = action === 'approve_user' ? [userId] : userIds;
      const users = await approveAccounts({
        ids, collection: dataCollection,
        runTransaction: callback => dataCollection('sgmUsers').firestore.runTransaction(callback)
      });
      return res.status(200).json({ ok: true, result: { users } });
    }
    if (action === 'update_user' || action === 'restore_report_permission') {
      const base = {
        id: userId,
        collection: dataCollection,
        runTransaction: callback => dataCollection('sgmUsers').firestore.runTransaction(callback)
      };
      const user = action === 'update_user'
        ? await updateAdminAccount({ ...base, patch, expectedPermission })
        : await restoreReportPermission(base);
      return res.status(200).json({ ok: true, result: { user } });
    }
    const firestore = dataCollection('sgmDesks').firestore;
    const settings = (await dataCollection('sgmConfig').doc('settings').get()).data() || {};
    const dayKey = () => getIstanbulDayKey();
    const actions = createCloudActions({
      db: firestore,
      runTransaction: (_db, callback) => firestore.runTransaction(callback),
      ref: (bucket, id) => dataCollection(bucket).doc(String(id)),
      settings: () => settings, dayKey,
      isRestricted: (user, at) => user?.formInfoRestricted || user?.blocked || user?.pendingApproval || Number(user?.restrictedUntil || 0) > at,
      lostDeskToday: () => false,
      applyViolationPolicy: (user, id, at) => violationPolicyPatch(user, id, at, dayKey)
    });
    let result;
    if (action === 'delete_user') {
      const snapshot = await dataCollection('sgmDesks').get();
      const desks = snapshot.docs.map(d => ({ ...d.data(), id: Number(d.id) }));
      result = await actions.deleteUser(userId, desks);
    } else {
      result = await actions.expireDesk(deskId);
    }
    if (result?.user) {
      const { pin: _pin, pushTokens: _tokens, ...user } = result.user;
      result = { ...result, user };
    }
    return res.status(200).json({ ok: true, result });
  } catch (error) {
    console.error('Admin maintenance error:', error.code || error.message);
    return res.status(error.status || 503).json({ ok: false, message:
      error.status && ['update_user','update_settings'].includes(action) ? error.message :
      error.status === 409 && (action === 'approve_user' || action === 'approve_users')
        ? 'Seçilen kullanıcılardan biri bulunamadı veya silinmiş. Listeyi yenileyin.'
        : 'Yönetici sunucu işlemi tamamlanamadı.' });
  }
}

async function handleNewAction(req,res,action) {
  try {
    const token=/^Bearer\s+(.+)$/i.exec(String(req.headers?.authorization||''))?.[1];
    if(!token) return res.status(401).json({ok:false,message:'Oturum gerekli.'});
    const decoded=await getAuth(adminApp()).verifyIdToken(token);
    const isLeaderAction=action.startsWith('leader_');
    let leader;
    if(isLeaderAction) leader=await requireLeader(decoded);
    else await requireActiveAdmin(decoded);
    const input=req.body||{};
    let result;
    const activityService=createActivityService({collection:dataCollection});
    if(action==='leader_activity_list') result=await activityService.leaderList(leader);
    else if(action==='leader_activity_create') result=await activityService.create(leader,input);
    else if(action==='leader_activity_decide') result=await activityService.decide(leader,input,input.decision);
    else if(action==='leader_activity_close') result=await activityService.close(leader,input);
    else if(action==='admin_activity_list') result=await activityService.adminList();
    else if(action==='leader_activity_remove_request') result=await activityService.requestRemoval(leader,input);
    else if(action==='admin_activity_remove_decide') result=await activityService.resolveRemoval(decoded,input);
    else if(action==='admin_activity_remove') result=await activityService.adminRemove(input);
    else if(action==='leader_queue') result=await leaderQueue({});
    else if(action==='leader_history') result=await leaderHistory({leaderId:leader.username});
    else if(['leader_check','leader_restrict','leader_unrestrict'].includes(action)) {
      result=await reviewStudent({action,userId:input.userId,reason:input.reason,leader});
    } else if(action==='admin_leader_history') result=await adminLeaderHistory({});
    else if(action==='admin_leader_config') {
      const [settings,list]=await Promise.all([dataCollection('sgmConfig').doc('settings').get(),dataCollection('sgmLeaderConfig').doc('forms').get()]);
      result={formUrl:settings.data()?.registrationFormUrl||'',codeListUrl:list.data()?.gmCodeListUrl||''};
    }
    else if(action==='admin_leader_links') result=await saveLeaderFormLinks(input);
    else result=await manageLeader({action,input});
    return res.status(200).json({ok:true,result});
  } catch(error) {
    if(!error.status) console.error('Leader maintenance error:',error.code||error.message);
    return res.status(error.status||503).json({ok:false,message:error.status?error.message:'Lider işlemi tamamlanamadı.'});
  }
}
