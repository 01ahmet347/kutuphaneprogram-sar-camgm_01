// Yeni kayıtlara yönelik tarayıcı kimliği eşleştirmesi. Fiziksel cihazı kesin tanımlamaz.
import { randomUUID } from 'node:crypto';
import { validRegistrationDevice, registrationDeviceHash } from './registration-device-policy.js';
import { dataCollection } from './firebase-admin.js';
const fail = (message,status=409) => Object.assign(new Error(message),{status});

// Eski öğrencilerin kayıtları, cihazları ve girişleri geriye dönük kilitlenmez.
export async function requestDeviceChange({uid,deviceId,collection=dataCollection,now=Date.now}) {
  const userRef=collection('sgmUsers').doc(uid);
  const requestRef=collection('sgmDeviceChangeRequests').doc(uid);
  return userRef.firestore.runTransaction(async tx=>{
    const userSnap=await tx.get(userRef);
    if(!userSnap.exists) throw fail('Hesap bulunamadı.',404);
    const user=userSnap.data();
    if(!user.registrationDeviceHash) return {allowed:true};
    if(!validRegistrationDevice(deviceId)) return {allowed:false,reason:'device_id_required'};
    const nextHash=registrationDeviceHash(deviceId);
    if(nextHash===user.registrationDeviceHash) return {allowed:true};
    const existing=await tx.get(requestRef);
    if(existing.exists && existing.data()?.status==='pending' && existing.data()?.deviceHash===nextHash) {
      return {allowed:false,reason:'device_approval_required'};
    }
    tx.set(requestRef,{userId:uid,deviceHash:nextHash,status:'pending',requestedAt:now(),
      decidedAt:null,decidedBy:null});
    return {allowed:false,reason:'device_approval_required'};
  });
}

export async function listDeviceChangeRequests({collection=dataCollection}) {
  const result=await collection('sgmDeviceChangeRequests').where('status','==','pending').limit(100).get();
  const users=await Promise.all(result.docs.map(d=>collection('sgmUsers').doc(d.id).get()));
  return result.docs.map((d,i)=>({userId:d.id,studentName:users[i].data()?.name||'Öğrenci',
    specialCode:users[i].data()?.specialCode||'',requestedAt:d.data().requestedAt||0}));
}

export async function decideDeviceChange({userId,decision,leader,collection=dataCollection,now=Date.now}) {
  if(typeof userId!=='string'||!userId||userId.length>180||userId.includes('/')||!['approve','reject'].includes(decision)) throw fail('Geçersiz cihaz onayı.',400);
  const userRef=collection('sgmUsers').doc(userId),requestRef=collection('sgmDeviceChangeRequests').doc(userId);
  const auditRef=collection('sgmLeaderAudit').doc(randomUUID());
  return userRef.firestore.runTransaction(async tx=>{
    const [userSnap,requestSnap,deleted]=await Promise.all([tx.get(userRef),tx.get(requestRef),tx.get(collection('sgmDeletedUsers').doc(userId))]);
    if(!userSnap.exists||deleted.exists) throw fail('Öğrenci bulunamadı.',404);
    if(!requestSnap.exists||requestSnap.data()?.status!=='pending') throw fail('Bekleyen cihaz değişikliği bulunamadı.');
    const user=userSnap.data(),request=requestSnap.data(),at=now();
    if(!user.registrationDeviceHash) throw fail('Eski hesap için cihaz onayı zorunlu değil.');
    if(decision==='approve') {
      // Aktif masayı, QR oturumunu veya devam eden rezervasyonu asla taşımayın.
      if(user.activeDeskId!=null||user.pendingDeskId!=null) throw fail('Öğrencinin aktif masa veya rezervasyonu var. Önce normal şekilde tamamlamasını bekleyin.');
      const oldRef=collection('sgmRegistrationDevices').doc(user.registrationDeviceHash);
      const newRef=collection('sgmRegistrationDevices').doc(request.deviceHash);
      const [oldSnap,newSnap]=await Promise.all([tx.get(oldRef),tx.get(newRef)]);
      if(newSnap.exists&&newSnap.data()?.userId!==userId) throw fail('Yeni cihaz başka bir hesaba kayıtlı.');
      if(oldSnap.exists&&oldSnap.data()?.userId===userId&&oldRef.id!==newRef.id) tx.delete(oldRef);
      if(!newSnap.exists) tx.create(newRef,{userId,createdAt:at});
      tx.update(userRef,{registrationDeviceHash:request.deviceHash,deviceBindingUpdatedAt:at});
    }
    tx.update(requestRef,{status:decision==='approve'?'approved':'rejected',decidedAt:at,decidedBy:leader.username});
    tx.create(auditRef,{leaderId:leader.username,leaderName:leader.name,userId,
      studentCode:user.specialCode,studentName:user.name,action:decision==='approve'?'leader_device_approve':'leader_device_reject',at,reason:'Cihaz değişikliği talebi'});
    return {userId,status:decision==='approve'?'approved':'rejected'};
  });
}
