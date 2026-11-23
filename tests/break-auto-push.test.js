import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { breakReleasePushMessage, sendPendingBreakPushNotifications } from '../server/break-auto-push.js';

const now = Date.parse('2026-10-23T11:30:00.000Z');
const id = 'MOLA-OTOMATIK-MASA-BOSALTMA-test1';
const job = { eventId: id, userId: 'u1', deskId: 12, breakType: 'short',
  releasedAt: now, reclaimAllowedAt: now + 1_800_000,
  status: 'pending', attempts: 0, leaseUntil: 0, nextAttemptAt: now };
const user = { name:'Öğrenci', specialCode:'1234', pushTokens:['t1','t1','t2'],
  pin: 'abcdef', strikes: 3, activeDeskId: null };
const clone = o => structuredClone(o);
function mockDB({ queued = job, student = user, other = {} } = {}) {
  const rows = new Map(Object.entries(other).map(([k, v]) => [k, clone(v)]));
  if (queued) rows.set(`sgmBreakPushOutbox/${id}`, clone(queued));
  if (student) rows.set('sgmUsers/u1', clone(student));
  const writes = [];
  const firestore = {
    async runTransaction(callback) {
      let writing = false;
      const changes = [];
      const tx = {
        async get(ref) {
          assert.equal(writing, false, 'reads must precede writes');
          return { exists: rows.has(ref.key), data: () => clone(rows.get(ref.key)) };
        },
        set(ref, value, options) {
          writing = true;
          changes.push([ref.key, options?.merge ? {...(rows.get(ref.key) || {}),...clone(value)} : clone(value)]);
        },
        create(ref, value) {
          writing = true;
          assert.equal(rows.has(ref.key), false);
          changes.push([ref.key, clone(value)]);
        }
      };
      const result = await callback(tx);
      for (const [key, value] of changes) { rows.set(key, value); writes.push(key); }
      return result;
    }
  };
  const collection = bucket => ({
    firestore,
    doc: key => ({ key: `${bucket}/${key}` }),
    where(field, op, statuses) {
      assert.equal(field, 'status'); assert.equal(op, 'in');
      return {limit(count) {return {async get() {
        const docs = [...rows.entries()].filter(([key, value]) =>
          key.startsWith(`${bucket}/`) && statuses.includes(value.status)).slice(0, count)
          .map(([key, value]) => ({id:key.substring(bucket.length+1),data:()=>clone(value)}));
        return {docs};
      }};}};
    }
  });
  return {rows, collection, writes};
}
const notify = (db, sender, time = now) => sendPendingBreakPushNotifications({
  collection: db.collection, sendMulticast: sender, siteAddress: 'https://sgm.example', now:()=>time
});

test('bildirim kısa mola, masa, 30 dk engeli ve ihlal yok metnini içerir', () => {
  const message = breakReleasePushMessage(job, 'https://sgm.example');
  assert.match(message.title,/masanız boşaltıldı/);
  assert.match(message.body,/Kısa mola/);
  assert.match(message.body,/Masa 12/);
  assert.match(message.body,/30 dakika/);
  assert.match(message.body,/İhlal yok/);
  assert.equal(message.notificationLink, 'https://sgm.example/');
  assert.match(breakReleasePushMessage({...job,breakType:'long'}, null).body, /Uzun mola/);
});

test('FCM kabulü sonrasında tek gönderim ve YP logu; kullanıcı/tokenlar değişmez', async () => {
  const db=mockDB(); const calls=[];
  const sender=async payload => { calls.push(payload); return {successCount:2,failureCount:0}; };
  const first=await notify(db,sender);
  assert.equal(first.sentCount,1);
  assert.equal(first.errors.length,0);
  assert.equal(calls.length,1);
  assert.deepEqual(calls[0].tokens,['t1','t2']);
  assert.equal(calls[0].data.type,'MOLA_SURESI_DOLDU_MASA_OTOMATIK_BOSALTILDI');
  assert.equal(calls[0].webpush.fcmOptions.link,'https://sgm.example/');
  assert.equal(calls[0].webpush.notification.requireInteraction,true);
  assert.equal(db.rows.get(`sgmBreakPushOutbox/${id}`).status,'sent');
  const log=db.rows.get(`sgmAudit/${id}-PUSH`);
  assert.equal(log.type,'MOLA_OTOMATIK_BOSALTMA_PUSH_GONDERILDI');
  assert.match(log.message,/okuduğu .* doğrulanamaz/);
  assert.deepEqual(db.rows.get('sgmUsers/u1'),user);
  assert.equal((await notify(db,sender)).sentCount,0);
  assert.equal(calls.length,1);
});

test('push token yoksa FCM çağrılmaz, kayıtlara zarar gelmez', async () => {
  const db=mockDB({student:{...user,pushTokens:[]}});
  let sent=false;
  const result=await notify(db,async()=>{sent=true;});
  assert.equal(sent,false);
  assert.equal(result.skippedCount,1);
  assert.equal(db.rows.get(`sgmBreakPushOutbox/${id}`).status,'skipped');
  assert.equal(db.rows.get('sgmUsers/u1').pin,user.pin);
});

test('silinmiş öğrenciye bildirim gönderilmez', async () => {
  const db=mockDB({other:{'sgmDeletedUsers/u1':{deletedAt:now}}});
  let sent=false;
  const result=await notify(db,async()=>{sent=true;});
  assert.equal(sent,false);
  assert.equal(result.skippedCount,1);
  assert.equal(db.rows.get(`sgmBreakPushOutbox/${id}`).reason,'user_deleted');
});

test('FCM arızası otomatik tekrar denenir, 5 denemede durur ve YP gönderildi logu oluşmaz', async () => {
  const db=mockDB();
  let callCount=0;
  const sender=async()=>{callCount++;throw Object.assign(new Error('temporary'),{code:'fcm_down'});};
  for (let n=1;n<=5;n++) {
    const result=await notify(db,sender, now + n*1000_000);
    assert.equal(result.errors.length,1);
    assert.equal(db.rows.get(`sgmBreakPushOutbox/${id}`).attempts,n);
  }
  assert.equal(callCount,5);
  assert.equal(db.rows.get(`sgmBreakPushOutbox/${id}`).status,'failed');
  assert.equal((await notify(db,sender,now+6*1000_000)).checked,0);
  assert.equal(db.rows.has(`sgmAudit/${id}-PUSH`),false);
});

test('yeni veya halen işlemdeki lease tekrar aynı anda push yollamaz',async()=>{
  const db=mockDB({queued:{...job,status:'sending',attempts:1,leaseUntil:now+60_000}});
  let sends=0;
  assert.equal((await notify(db,async()=>{sends++;})).sentCount,0);
  assert.equal(sends,0);
  assert.equal((await notify(db,async()=>{sends++;return {successCount:1,failureCount:0};},now+120_000)).sentCount,1);
  assert.equal(sends,1);
});

test('çok eski push gönderilmez; yanlış öğrenciye geç gitmez',async()=>{
  const db=mockDB({queued:{...job,releasedAt:now-2*86400_000}});
  let sends=0;
  assert.equal((await notify(db,async()=>{sends++;})).skippedCount,1);
  assert.equal(sends,0);
  assert.equal(db.rows.get(`sgmBreakPushOutbox/${id}`).reason,'too_old');
});

test('YP logu bilerek silinmişse tekrar oluşturulmaz, push yine gönderilir',async()=>{
  const db=mockDB({other:{[`sgmDeletedRecords/logs-${id}-PUSH`]:{deletedAt:now}}});
  assert.equal((await notify(db,async()=>({successCount:1,failureCount:0}))).sentCount,1);
  assert.equal(db.rows.has(`sgmAudit/${id}-PUSH`),false);
});

test('mevcut push API, iPhone service worker ve bildirim kayıt akışı dosyaları korunur',async()=>{
  const root=fileURLToPath(new URL('..',import.meta.url));
  const push=await readFile(path.join(root,'api/send-push.js'),'utf8');
  const worker=await readFile(path.join(root,'public/firebase-messaging-sw.js'),'utf8');
  const jsx=await readFile(path.join(root,'kutuphaneprogramıguncell.jsx'),'utf8');
  assert.match(push,/ADMIN_PUSH_TEST/);
  assert.match(push,/sendEachForMulticast/);
  assert.match(worker,/notificationclick/);
  assert.match(jsx,/const registerPhonePush =/);
});
