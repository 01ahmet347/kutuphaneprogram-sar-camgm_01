// Faaliyetler yeni koleksiyonlarda tutulur. Mevcut QR, ihbar ve kullanıcı belgeleri silinmez.
// Masa koruması mevcut on_break + breakEndTime altyapısını kullanır.
import { randomUUID } from 'node:crypto';
import { getIstanbulDayKey } from './student-desk.js';
import { allowedBreakDuration, dailyBreakState } from '../src/break-policy.js';

const fail = (message, status = 409) => Object.assign(new Error(message), { status });
const validId = id => typeof id === 'string' && /^[\w-]{1,160}$/.test(id);
const safeUser = user => ({ name: String(user?.name || 'Öğrenci').slice(0, 120), specialCode: String(user?.specialCode || '') });
const eligible = (user, at) => user && !user.blocked && !user.pendingApproval && !user.formInfoRestricted && Number(user.restrictedUntil || 0) <= at;
const publicActivity = (id, a) => ({ id, title:a.title, leaderId:a.leaderId, leaderName:a.leaderName,
  day:a.day, startTime:a.startTime, status:a.status, pendingCount:a.pendingCount || 0,
  approvedCount:a.approvedCount || 0, rejectedCount:a.rejectedCount || 0, closedAt:a.closedAt || null });
const publicApplication = (id, a) => a ? ({ id, activityId:a.activityId, title:a.title, leaderName:a.leaderName,
  status:a.status, deskId:a.deskId, submittedAt:a.submittedAt, decidedAt:a.decidedAt || null,
  decidedBy:a.decidedBy || null,
  startedAt:a.startedAt || null, endAt:a.endAt || null, extraBreakType:a.extraBreakType || null,
  studentName:a.studentName, studentCode:a.studentCode, userId:a.userId, leaderId:a.leaderId }) : null;

export function createActivityService({collection, now=Date.now, dayKey=()=>getIstanbulDayKey(new Date(now()))}) {
  const activities = collection('sgmActivities'), applications = collection('sgmActivityApplications'), audit = collection('sgmActivityAudit');
  const users = collection('sgmUsers'), desks = collection('sgmDesks');
  const currentDay = () => dayKey();
  const appRef = uid => applications.doc(`${currentDay()}_${uid}`);
  const log = (tx, action, data, at) => {
    const id = randomUUID();
    tx.create(audit.doc(id), { action, at, ...data });
  };
  const getTodayActivities = async () => {
    const snap = await activities.where('day', '==', currentDay()).limit(100).get();
    return snap.docs.map(d => publicActivity(d.id, d.data())).sort((a,b) => a.startTime.localeCompare(b.startTime));
  };
  return {
    async studentList(uid) {
      const [rows, application] = await Promise.all([getTodayActivities(), appRef(uid).get()]);
      return { activities: rows.filter(row=>row.status==='open'),
        application: application.exists ? publicApplication(application.id, application.data()) : null };
    },
    async leaderList(leader) {
      const [rows, appRows] = await Promise.all([getTodayActivities(), applications.where('day','==',currentDay()).limit(500).get()]);
      const mine = rows.filter(a=>a.leaderId===leader.username);
      return {activities:mine, applications:appRows.docs.map(d=>publicApplication(d.id,d.data()))
        .filter(a=>a.leaderId===leader.username).sort((a,b)=>b.submittedAt-a.submittedAt)};
    },
    async adminList() {
      const [rows, appRows, history] = await Promise.all([
        getTodayActivities(), applications.where('day','==',currentDay()).limit(500).get(),
        audit.orderBy('at','desc').limit(100).get()]);
      return { activities:rows, applications:appRows.docs.map(d=>publicApplication(d.id,d.data())),
        history:history.docs.map(d=>({id:d.id,...d.data()})) };
    },
    async create(leader, input) {
      const title = String(input.title || '').trim();
      const startTime = String(input.startTime || '');
      if (title.length < 3 || title.length > 100 || !/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime)) throw fail('Faaliyet adı (3–100 karakter) ve saat giriniz.',400);
      const id=randomUUID(), at=now(), day=currentDay();
      const data={title, startTime, day, leaderId:leader.username, leaderName:leader.name,
        status:'open', pendingCount:0, approvedCount:0, rejectedCount:0, createdAt:at};
      await activities.doc(id).create(data);
      return {activity:publicActivity(id,data)};
    },
    async apply(uid, input) {
      if (!validId(input.activityId)) throw fail('Faaliyet seçiniz.',400);
      const at=now(), day=currentDay(), ref=appRef(uid), activityRef=activities.doc(input.activityId);
      return applications.firestore.runTransaction(async tx=>{
        const [aSnap,oldSnap,uSnap,deleted]=await Promise.all([
          tx.get(activityRef),tx.get(ref),tx.get(users.doc(uid)),tx.get(collection('sgmDeletedUsers').doc(uid))]);
        const a=aSnap.data(), u=uSnap.data();
        if (!aSnap.exists || a.day!==day || a.status!=='open') throw fail('Faaliyet başvuruları kapalı.');
        if (!uSnap.exists || deleted.exists || !eligible(u,at)) throw fail('Hesabınız faaliyet başvurusuna uygun değil.');
        if (u.activityUsedDay===day || ['pending','approved'].includes(oldSnap.data()?.status)) throw fail('Bugünkü faaliyet hakkınız veya başvurunuz zaten mevcut.');
        const deskId=Number(u.activeDeskId);
        if (!Number.isInteger(deskId) || deskId<1 || deskId>35) throw fail('Başvuru için aktif masanız olmalı.');
        const dSnap=await tx.get(desks.doc(String(deskId))), desk=dSnap.data();
        if (!dSnap.exists || desk.occupant!==uid || desk.status!=='occupied') throw fail('Başvuru için masanız aktif olmalı.');
        const data={day,activityId:activityRef.id,title:a.title,leaderId:a.leaderId,leaderName:a.leaderName,
          userId:uid,studentName:safeUser(u).name,studentCode:safeUser(u).specialCode,deskId,
          status:'pending',submittedAt:at,decidedAt:null,startedAt:null,endAt:null,extraBreakType:null};
        tx.set(ref,data);tx.update(activityRef,{pendingCount:Number(a.pendingCount||0)+1});
        log(tx,'application_created',{userId:uid,activityId:activityRef.id,leaderId:a.leaderId,deskId},at);
        return {application:publicApplication(ref.id,data)};
      });
    },
    async decide(leader, input, decision) {
      if (!validId(input.applicationId) || !['approve','reject'].includes(decision)) throw fail('Geçersiz başvuru.',400);
      const ref=applications.doc(input.applicationId), at=now(), day=currentDay();
      return applications.firestore.runTransaction(async tx=>{
        const appSnap=await tx.get(ref), app=appSnap.data();
        if (!appSnap.exists || app.day!==day || app.status!=='pending' || app.leaderId!==leader.username) throw fail('Bu başvuru beklemede değil veya yetkiniz yok.');
        const aRef=activities.doc(app.activityId), uRef=users.doc(app.userId), dRef=desks.doc(String(app.deskId));
        const [aSnap,uSnap,dSnap,deleted]=await Promise.all([tx.get(aRef),tx.get(uRef),tx.get(dRef),tx.get(collection('sgmDeletedUsers').doc(app.userId))]);
        const a=aSnap.data(), u=uSnap.data(), d=dSnap.data();
        if (!aSnap.exists || a.status!=='open' || a.leaderId!==leader.username) throw fail('Faaliyet artık başvuru kabul etmiyor.');
        if (!uSnap.exists || deleted.exists) throw fail('Öğrenci hesabı artık mevcut değil.');
        const approved=decision==='approve';
        if (approved && (!eligible(u,at) || u.activityUsedDay===day || Number(u.activeDeskId)!==Number(app.deskId) ||
          !dSnap.exists || d.occupant!==app.userId || d.status!=='occupied')) throw fail('Öğrencinin aktif masası veya faaliyet hakkı uygun değil. Onay verilmedi.');
        const endAt=approved ? at+60*60000 : null;
        const next={...app,status:approved?'approved':'rejected',decidedAt:at,decidedBy:leader.username,
          startedAt:approved?at:null,endAt};
        tx.update(ref,{status:next.status,decidedAt:at,decidedBy:leader.username,startedAt:next.startedAt,endAt});
        tx.update(aRef,{pendingCount:Math.max(0,Number(a.pendingCount||0)-1),
          [approved?'approvedCount':'rejectedCount']:Number(a[approved?'approvedCount':'rejectedCount']||0)+1});
        if (approved) {
          const sessionId=`activity-${ref.id}`;
          tx.update(dRef,{status:'on_break',breakEndTime:endAt,breakStartedAt:at,breakType:'activity',
            breakOwnerId:app.userId,breakSessionId:sessionId,breakDurationMinutes:60,
            activityId:app.activityId,activityExtraType:null});
          tx.update(uRef,{activityUsedDay:day,lastBreakSession:{id:sessionId,deskId:app.deskId,type:'activity',startedAt:at,endAt,status:'active'}});
        }
        log(tx,approved?'application_approved':'application_rejected',{userId:app.userId,activityId:app.activityId,
          leaderId:leader.username,deskId:app.deskId},at);
        return {application:publicApplication(ref.id,next)};
      });
    },
    async close(leader, input) {
      if (!validId(input.activityId)) throw fail('Geçersiz faaliyet.',400);
      const ref=activities.doc(input.activityId), at=now();
      return activities.firestore.runTransaction(async tx=>{
        const snap=await tx.get(ref), a=snap.data();
        if (!snap.exists || a.leaderId!==leader.username || a.day!==currentDay()) throw fail('Bu faaliyet sizin değil.');
        if (a.status==='closed') return {closed:true,alreadyClosed:true};
        if (Number(a.pendingCount||0)>0) throw fail('Önce bekleyen başvuruları onaylayın veya reddedin.');
        tx.update(ref,{status:'closed',closedAt:at,closedBy:leader.username});
        log(tx,'applications_closed',{activityId:ref.id,leaderId:leader.username},at);
        return {closed:true};
      });
    },
    async appendBreak(uid, input) {
      const type=input.type;
      if (!['short','long'].includes(type)) throw fail('Faaliyete yalnızca 15 veya 30 dakikalık normal mola eklenebilir.',400);
      const at=now(),day=currentDay(),ref=appRef(uid);
      const config=(await collection('sgmConfig').doc('settings').get()).data() || {};
      const duration=allowedBreakDuration(config,type);
      if (duration==null) throw fail('Mola ayarı geçersiz.');
      return applications.firestore.runTransaction(async tx=>{
        const [appSnap,uSnap,deleted]=await Promise.all([tx.get(ref),tx.get(users.doc(uid)),tx.get(collection('sgmDeletedUsers').doc(uid))]);
        const a=appSnap.data(),u=uSnap.data();
        if (!appSnap.exists || a.status!=='approved' || a.day!==day || !uSnap.exists || deleted.exists || !eligible(u,at)) throw fail('Aktif ve onaylı faaliyet bulunamadı.');
        if (a.extraBreakType) throw fail('Bu faaliyete zaten bir mola eklendi. İkinci mola peş peşe eklenemez.');
        if (Number(a.endAt)<=at) throw fail('Faaliyet süresi sona ermiş; ek mola eklenemez.');
        const count=u.mergeDay===day?Number(u.mergeCount||0):0;
        const daily=dailyBreakState(u,config,at,day);
        if (count>=2) throw fail('Günlük iki birleştirme hakkınız doldu.');
        if (Number(daily.breaks?.[type]||0)<=0) throw fail('Bu normal mola hakkınız kalmadı.');
        const dRef=desks.doc(String(a.deskId)),dSnap=await tx.get(dRef),d=dSnap.data();
        if (!dSnap.exists || d.occupant!==uid || d.status!=='on_break' || d.breakType!=='activity' ||
            d.breakSessionId!==`activity-${ref.id}` || Number(u.activeDeskId)!==Number(a.deskId)) throw fail('Faaliyet masası artık aktif değil.');
        const endAt=Number(d.breakEndTime)+duration*60000;
        tx.update(dRef,{breakEndTime:endAt,breakDurationMinutes:60+duration,activityExtraType:type});
        tx.update(users.doc(uid),{breaks:{...daily.breaks,[type]:Number(daily.breaks[type])-1},
          breaksResetDate:daily.breaksResetDate,mergeDay:day,mergeCount:count+1,
          lastBreakSession:{...u.lastBreakSession,endAt}});
        tx.update(ref,{extraBreakType:type,extraMinutes:duration,endAt});
        log(tx,'activity_break_appended',{userId:uid,activityId:a.activityId,deskId:a.deskId,breakType:type,duration},at);
        return {endAt,mergeRemaining:1-count,extraBreakType:type};
      });
    }
  };
}
