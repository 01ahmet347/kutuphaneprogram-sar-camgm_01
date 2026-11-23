// Lider kimlik bilgileri yalnızca sunucu tarafından okunur; Firestore istemci erişimi kapalıdır.
import { createHash } from 'node:crypto';
import { dataCollection } from './firebase-admin.js';
import { normalizeLeaderName,validLeaderUsername,hashLeaderPassword,verifyLeaderPassword } from './leader-password.js';

const fail = (message, status=400) => Object.assign(new Error(message), {status});
export function publicLeader(leader) {
  return {username:leader.username, name:leader.name, active: leader.active === true,
    createdAt:leader.createdAt || 0, updatedAt:leader.updatedAt || 0};
}
export async function requireLeader(decoded, collection=dataCollection) {
  if (decoded?.role !== 'leader' || !validLeaderUsername(decoded?.leaderId) ||
      decoded.uid !== `sgm-leader-${decoded.leaderId}` || !Number.isInteger(decoded.leaderVersion)) {
    throw fail('Gençlik lideri yetkisi gerekli.', 403);
  }
  const snap = await collection('sgmLeaders').doc(decoded.leaderId).get();
  const leader = snap.data();
  if (!snap.exists || !leader?.active || Number(leader.version) !== decoded.leaderVersion) {
    throw fail('Lider oturumu kapatılmış veya şifresi değiştirilmiş.', 403);
  }
  return publicLeader(leader);
}
export async function leaderLogin({username,password,collection=dataCollection,createToken,clientAddress='unknown',now=Date.now}) {
  const key = normalizeLeaderName(username);
  if (!validLeaderUsername(key) || typeof password !== 'string' || password.length > 128) throw fail('Kullanıcı adı veya şifre hatalı.',401);
  const attemptId = createHash('sha256').update(`${clientAddress}:${key}`).digest('hex');
  const attemptRef = collection('sgmLeaderLoginAttempts').doc(attemptId);
  const at = now();
  const limited = await attemptRef.firestore.runTransaction(async tx => {
    const snap = await tx.get(attemptRef); const prev = snap.data() || {};
    const windowStart = prev.windowStart > at - 15*60*1000 ? prev.windowStart : at;
    const count = windowStart === prev.windowStart ? (prev.count || 0) + 1 : 1;
    tx.set(attemptRef, {windowStart, count, at}); return count > 8;
  });
  if (limited) throw fail('Çok fazla giriş denemesi. Daha sonra tekrar deneyin.',429);
  const snap = await collection('sgmLeaders').doc(key).get();
  const leader = snap.data();
  if (!snap.exists || leader?.active !== true || !verifyLeaderPassword(password, leader?.passwordHash)) {
    throw fail('Kullanıcı adı veya şifre hatalı.',401);
  }
  const token = await createToken(`sgm-leader-${key}`, {role:'leader',leaderId:key,leaderVersion:leader.version});
  // Başarılı girişte sayaç sıfırlanamazsa geçerli giriş reddedilmez.
  try { await attemptRef.delete(); } catch {}
  return {token,leader:publicLeader(leader)};
}
export async function manageLeader({action,input,collection=dataCollection,now=Date.now}) {
  if (action === 'admin_leader_list') {
    const rows = await collection('sgmLeaders').limit(100).get();
    return {leaders: rows.docs.map(doc=>publicLeader(doc.data())).sort((a,b)=>a.name.localeCompare(b.name,'tr'))};
  }
  const username = normalizeLeaderName(input.username);
  if (!validLeaderUsername(username)) throw fail('Kullanıcı adı 3-48 karakter olmalı; küçük harf, rakam, nokta, tire ve alt çizgi kullanılabilir.');
  const ref = collection('sgmLeaders').doc(username);
  if (action === 'admin_leader_create') {
    const name = String(input.name || '').trim();
    if (!name || name.length > 120) throw fail('Geçerli lider adı girin.');
    const passwordHash = hashLeaderPassword(input.password);
    await ref.firestore.runTransaction(async tx => {
      const existing = await tx.get(ref);
      if (existing.exists) throw fail('Bu kullanıcı adı zaten kayıtlı.',409);
      tx.create(ref, {username, name, passwordHash, active:true, version:1, createdAt:now(),updatedAt:now()});
    });
    return {leader:publicLeader({username,name,active:true,createdAt:now()})};
  }
  if (action === 'admin_leader_password') {
    const passwordHash = hashLeaderPassword(input.password);
    await ref.firestore.runTransaction(async tx=>{
      const snap=await tx.get(ref); if(!snap.exists) throw fail('Lider bulunamadı.',404);
      tx.update(ref,{passwordHash,version:Number(snap.data().version||0)+1,updatedAt:now()});
    });
    return {updated:true};
  }
  if (action === 'admin_leader_status') {
    if (typeof input.active !== 'boolean') throw fail('Geçersiz hesap durumu.');
    await ref.firestore.runTransaction(async tx=>{
      const snap=await tx.get(ref); if(!snap.exists) throw fail('Lider bulunamadı.',404);
      tx.update(ref,{active:input.active,version:Number(snap.data().version||0)+1,updatedAt:now()});
    });
    return {updated:true};
  }
  throw fail('Geçersiz lider yönetim işlemi.');
}
