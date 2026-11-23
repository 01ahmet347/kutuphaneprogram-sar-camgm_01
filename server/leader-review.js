import { randomUUID } from 'node:crypto';
import { dataCollection } from './firebase-admin.js';
import { releaseUserFromDesk } from '../src/sync-core.js';
import { isFormGatePending } from './form-status.js';
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const validUserId=value=>typeof value==='string' && value.length>0 && value.length<=180 && !value.includes('/');
export function publicReviewUser(id,user) {
  return {id,name:user.name || '',specialCode:user.specialCode || '',
    createdAt:user.createdAt || 0,formVerified:user.registrationFormStatus==='verified',
    reviewStatus:user.leaderReviewStatus||'pending', reviewedAt:user.leaderReviewedAt||0,
    reviewedBy:user.leaderReviewedBy||'',formInfoRestricted:user.formInfoRestricted===true,
    formInfoRestrictionReason:user.formInfoRestrictionReason||'',
    formInfoRestrictionAt:user.formInfoRestrictionAt||0,
    formInfoRestrictionBy:user.formInfoRestrictionBy||'',
    // Booleans for indicators; never expose PIN, tokens, identity, other disciplinary details.
    accessRestricted: user.blocked===true || user.pendingApproval===true || Number(user.restrictedUntil||0)>Date.now()};
}
export async function leaderQueue({collection=dataCollection}) {
  const [users,config,leaderConfig] = await Promise.all([
    collection('sgmUsers').orderBy('createdAt','desc').limit(150).get(),
    collection('sgmConfig').doc('settings').get(),
    collection('sgmLeaderConfig').doc('forms').get()
  ]);
  return {students:users.docs.filter(doc=>doc.data().formGateEnabled===true).map(doc=>publicReviewUser(doc.id,doc.data())),
    formUrl:config.data()?.registrationFormUrl||'', codeListUrl:leaderConfig.data()?.gmCodeListUrl||''};
}
export async function leaderHistory({leaderId,collection=dataCollection}) {
  const results=await collection('sgmLeaderAudit').orderBy('at','desc').limit(150).get();
  return {history:results.docs.filter(doc=>doc.data().leaderId===leaderId).map(doc=>({id:doc.id,...doc.data()}))};
}
export async function adminLeaderHistory({collection=dataCollection}) {
  const results=await collection('sgmLeaderAudit').orderBy('at','desc').limit(250).get();
  return {history:results.docs.map(doc=>({id:doc.id,...doc.data()}))};
}
export async function reviewStudent({action,userId,reason,leader,collection=dataCollection,now=Date.now}) {
  if (!validUserId(userId) || !['leader_check','leader_restrict','leader_unrestrict'].includes(action)) throw fail('Geçersiz lider işlemi.');
  const isRestrict=action==='leader_restrict';
  if (isRestrict && (typeof reason!=='string' || reason.trim().length<8 || reason.length>350)) throw fail('Öğrenciye en az 8 karakterlik açıklama yazın.');
  const userRef=collection('sgmUsers').doc(userId), tombstoneRef=collection('sgmDeletedUsers').doc(userId);
  const auditRef=collection('sgmLeaderAudit').doc(randomUUID());
  return userRef.firestore.runTransaction(async tx=>{
    const [snap,tombstone]=await Promise.all([tx.get(userRef),tx.get(tombstoneRef)]);
    if (!snap.exists || tombstone.exists) throw fail('Öğrenci bulunamadı.',404);
    const user=snap.data();
    if (user.formGateEnabled!==true || isFormGatePending(user)) throw fail('Öğrencinin Google Form gönderimi henüz doğrulanmadı.',409);
    if (action==='leader_check' && user.formInfoRestricted===true) throw fail('Önce form bilgisi kısıtını kaldırın.',409);
    if (action==='leader_unrestrict' && user.formInfoRestricted!==true) throw fail('Kaldırılabilecek bilgi hatası kısıtı bulunamadı.',409);
    if (action==='leader_restrict' && user.formInfoRestricted===true) throw fail('Öğrenci zaten bilgi hatası nedeniyle kısıtlı.',409);
    const deskIds=[...new Set([user.activeDeskId,user.pendingDeskId].map(Number).filter(Number.isInteger).filter(id=>id>=1&&id<=35))];
    const deskSnaps=isRestrict ? await Promise.all(deskIds.map(id=>tx.get(collection('sgmDesks').doc(String(id))))) : [];
    // Bir masada başka geçerli misafir varsa onun oturumunu otomatik sonlandırma.
    const guestIds=[...new Set(deskSnaps.filter(s=>s.exists && s.data().occupant===userId && s.data().guestOccupant && s.data().guestOccupant!==userId).map(s=>s.data().guestOccupant))];
    const guestSnaps=await Promise.all(guestIds.map(id=>tx.get(collection('sgmUsers').doc(id))));
    const at=now();
    const patch=action==='leader_restrict'
      ? {formInfoRestricted:true,formInfoRestrictionReason:reason.trim(),formInfoRestrictionAt:at,formInfoRestrictionBy:leader.username,
          leaderReviewStatus:'restricted',leaderReviewedAt:at,leaderReviewedBy:leader.username,
          activeDeskId:null,activeDeskRole:null,pendingDeskId:null,pendingDeskDeadline:null,
          adminDeskOverrideDeskId:null,adminDeskOverrideSessionStart:null}
      : action==='leader_unrestrict'
        ? {formInfoRestricted:false,formInfoRestrictionReason:'',leaderReviewStatus:'reviewed',leaderReviewedAt:at,leaderReviewedBy:leader.username,
            restrictionClearedAt:Math.max(Number(user.restrictionClearedAt||0),at)}
        : {leaderReviewStatus:'reviewed',leaderReviewedAt:at,leaderReviewedBy:leader.username};
    // guest owner promotion; only where the targeted user was owner and guest still exists.
    for (const deskSnap of deskSnaps) {
      if (!deskSnap.exists) continue;
      const before=deskSnap.data();
      let after=releaseUserFromDesk(before,userId);
      if (before.occupant===userId && guestIds.includes(before.guestOccupant)) {
        const guest=guestSnaps.find(s=>s.id===before.guestOccupant);
        if (guest?.exists) {
          after={...after,status:'occupied',occupant:guest.id,sessionStartTime:before.guestSessionStartTime||at,
            guestOccupant:null,guestSessionStartTime:null,guestBreakEndTime:null,
            guestReported:false,guestReportEndTime:null,guestReportIssuedAt:null,guestReportVerifiedAt:null};
          tx.set(guest.ref,{activeDeskId:Number(deskSnap.id),activeDeskRole:'owner'},{merge:true});
        } else {
          after={...after,guestOccupant:null,guestSessionStartTime:null,guestBreakEndTime:null};
        }
      }
      if (JSON.stringify(before)!==JSON.stringify(after)) tx.set(deskSnap.ref,after);
    }
    tx.set(userRef,patch,{merge:true});
    tx.create(auditRef,{leaderId:leader.username,leaderName:leader.name,userId,
      studentCode:user.specialCode,studentName:user.name, action,at,
      reason:isRestrict?reason.trim():(action==='leader_unrestrict' ? user.formInfoRestrictionReason||'' : ''),
      releasedDeskIds:isRestrict?deskIds:[]});
    if (isRestrict) {
      // Tek kişisel bildirim belgesi; Firestore dinleyicisine uyumlu.
      tx.set(collection('sgmMessages').doc(userId),{id:`LEADER-${auditRef.id}`,type:'LEADER_FORM_RESTRICTION',
        userId,time:at,message:`Form bilgisi hatası nedeniyle hesabınız kısıtlandı. ${reason.trim()}`,notificationTitle:'Form Bilgisi Kontrolü',notificationBody:reason.trim()});
    }
    return {student:publicReviewUser(userId,{...user,...patch}),operationId:auditRef.id};
  });
}

export function validCodeListUrl(input) {
  try {const url=new URL(input);return url.protocol==='https:' && !url.username && !url.password &&
    (url.hostname==='docs.google.com' && (/^\/(spreadsheets|forms)\//.test(url.pathname)) || url.hostname==='forms.gle');} catch {return false;}
}
export async function saveLeaderFormLinks({formUrl,codeListUrl,collection=dataCollection,now=Date.now}) {
  if (typeof formUrl!=='string'||!validCodeListUrl(formUrl)||typeof codeListUrl!=='string'||!validCodeListUrl(codeListUrl)) throw fail('Google Form ve GM kod listesi için geçerli bağlantılar girin.');
  const at=now();
  const settingsRef=collection('sgmConfig').doc('settings');
  await settingsRef.firestore.runTransaction(async tx=>{
    const old=(await tx.get(settingsRef)).data()||{};
    const previous=String(old.registrationFormUrl||'');
    const history=Array.isArray(old.registrationFormHistory)?old.registrationFormHistory:[];
    tx.set(settingsRef,{registrationFormUrl:formUrl,registrationFormUpdatedAt:at,
      registrationFormHistory:previous&&previous!==formUrl?[{url:previous,changedAt:at},...history].slice(0,30):history},{merge:true});
  });
  await collection('sgmLeaderConfig').doc('forms').set({gmCodeListUrl:codeListUrl,updatedAt:at},{merge:true});
  return {formUrl,codeListUrl};
}
