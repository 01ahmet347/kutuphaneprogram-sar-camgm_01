import test from 'node:test';
import assert from 'node:assert/strict';
import { releaseExpiredBreak, releaseExpiredBreaksForDesk, sweepExpiredBreaks } from '../server/break-auto-release.js';

const NOW = Date.parse('2026-10-23T10:00:00Z'); // 13:00 İstanbul
const baseUser = {
  name: 'Öğrenci', specialCode: '12345678', pin: '87654321',
  activeDeskId: 12, activeDeskRole: 'owner', strikes: 1,
  violationsResetDate: '2026-10-23', breaks: { short: 1, long: 2 },
  lastBreakSession: { id: 'b-12', deskId: 12, type: 'short', endAt: NOW - 1_000, status: 'active' },
  restrictedUntil: 0, pushTokens: ['unchanged-token'], deviceId: 'device-1'
};
const baseDesk = {
  id: 12, status: 'on_break', occupant: 'u1', ownerDeviceId: 'device-1',
  sessionStartTime: NOW - 2 * 60 * 60_000,
  breakEndTime: NOW - 1_000, breakType: 'short',
  breakSessionId: 'b-12', breakStartedAt: NOW - 15 * 60_000,
  breakOwnerId: 'u1', breakDurationMinutes: 15,
  qrCode: 'SGM-12', pendingOccupant: null, guestOccupant: null
};
const clone = value => structuredClone(value);
function database({ user = baseUser, desk = baseDesk, other = {} } = {}) {
  const rows = new Map(Object.entries(other).map(([k,v])=>[k,clone(v)]));
  if (user) rows.set('sgmUsers/u1', clone(user));
  if (desk) rows.set('sgmDesks/12', clone(desk));
  const writes = [];
  const firestore = {
    async runTransaction(callback) {
      let writing = false;
      const pending = [];
      const tx = {
        async get(ref) {
          assert.equal(writing, false, 'Firestore requires all reads before writes');
          return { exists: rows.has(ref.key), data: () => clone(rows.get(ref.key)), ref };
        },
        set(ref, value, options) {
          writing = true;
          pending.push([ref.key, options?.merge ? {...(rows.get(ref.key) || {}),...clone(value)} : clone(value)]);
        },
        create(ref, value) {
          writing = true;
          assert.equal(rows.has(ref.key), false, 'duplicate audit creation');
          pending.push([ref.key,clone(value)]);
        }
      };
      const result = await callback(tx);
      for (const [key, value] of pending) { rows.set(key,value); writes.push(key); }
      return result;
    }
  };
  const collection = bucket => ({
    firestore,
    doc: id => ({key: `${bucket}/${id}`, async get() {
      const key = `${bucket}/${id}`;
      return {exists:rows.has(key),data:()=>clone(rows.get(key))};
    }}),
    where(field, op, value) {
      return { async get() {
        const docs = [...rows.entries()].filter(([key, record]) => key.startsWith(`${bucket}/`) &&
          (op === '==' ? record[field] === value : op === '>' ? record[field] > value : false))
          .map(([key, record])=>({id:key.slice(bucket.length+1),data:()=>clone(record)}));
        return {docs,size:docs.length};
      }};
    },
    async get() {
      const docs = [...rows.entries()].filter(([key])=>key.startsWith(`${bucket}/`))
        .map(([key, value])=>({id:key.slice(bucket.length+1),data:()=>clone(value)}));
      return {docs,size:docs.length};
    }
  });
  return {rows,writes,collection};
}
const options = db => ({deskId:12,collection:db.collection,now:()=>NOW});
const logTypes = db => [...db.rows.entries()].filter(([key])=>key.startsWith('sgmAudit/')).map(([,val])=>val.type);

test('süre dolunca masa boşalır; yalnızca oturum alanları değişir, 30 dakika ve YP kayıtları oluşur', async()=>{
  const db = database();
  const result = await releaseExpiredBreak(options(db));
  assert.equal(result.released, true);
  const d = db.rows.get('sgmDesks/12');
  const u = db.rows.get('sgmUsers/u1');
  assert.equal(d.status,'available');
  assert.equal(d.occupant,null);
  assert.equal(d.qrCode,'SGM-12');
  assert.equal(d.breakEndTime,null);
  assert.equal(u.activeDeskId,null);
  assert.equal(u.deskReclaimDeskId,12);
  assert.equal(u.deskReclaimAllowedAt,NOW + 30 * 60_000);
  assert.equal(u.strikes,1);
  assert.equal(u.pin,baseUser.pin);
  assert.equal(u.specialCode,baseUser.specialCode);
  assert.deepEqual(u.breaks,baseUser.breaks);
  assert.deepEqual(u.pushTokens,baseUser.pushTokens);
  assert.equal(u.lastBreakSession.status,'auto_expired');
  assert.match(u.lastAutoBreakRelease.reason,/QR koduyla dönüş yapmadığınız/);
  assert.equal(u.lastAutoBreakRelease.breakType,'short');
  assert.deepEqual(logTypes(db).sort(),[
    'MOLA_SURESI_DOLDU_DONUS_YAPILMADI',
    'MOLA_SURESI_DOLDU_MASA_OTOMATIK_BOSALTILDI'
  ].sort());
  const autoLog = [...db.rows.values()].find(x=>x?.type==='MOLA_SURESI_DOLDU_MASA_OTOMATIK_BOSALTILDI');
  assert.equal(autoLog.violationApplied,false);
  assert.equal(autoLog.penaltyFree,true);
  assert.equal(autoLog.reclaimAllowedAt,NOW + 30 * 60_000);
  assert.equal(autoLog.userInfo,'Öğrenci (GM: 12345678)');
  const queue = db.rows.get(`sgmBreakPushOutbox/${result.eventId}`);
  assert.equal(queue.status, 'pending');
  assert.equal(queue.userId, 'u1');
  assert.equal(queue.deskId, 12);
});

test('süre tam 00:00 olduğunda boşaltılır, ikinci kontrol 30 dakikayı uzatmaz',async()=>{
  const db = database({user:{...baseUser,lastBreakSession:{...baseUser.lastBreakSession,endAt:NOW}},desk:{...baseDesk,breakEndTime:NOW}});
  assert.equal((await releaseExpiredBreak(options(db))).released,true);
  const reclaim = db.rows.get('sgmUsers/u1').deskReclaimAllowedAt;
  assert.equal((await releaseExpiredBreak(options(db))).released,false);
  assert.equal(db.rows.get('sgmUsers/u1').deskReclaimAllowedAt,reclaim);
  assert.equal(logTypes(db).length,2);
  assert.equal([...db.rows.keys()].filter(key=>key.startsWith('sgmBreakPushOutbox/')).length,1);
});

test('QR ile erken dönüş, henüz bitmeyen süre veya farklı kullanıcı asla düşürülmez',async()=>{
  for (const candidate of [
    { ...baseDesk, status:'occupied',breakEndTime:null },
    { ...baseDesk, breakEndTime:NOW+1000 },
    { ...baseDesk, occupant:'new-user' },
    { ...baseDesk, sessionStartTime:NOW+1000 },
    { ...baseDesk, breakEndTime:NOW-1000,sessionStartTime:Date.parse('2026-10-22T18:00:00Z') },
    { ...baseDesk, status:'reported',breakEndTime:NOW-1000 }
  ]) {
    const db=database({desk:candidate});
    const result=await releaseExpiredBreak(options(db));
    assert.equal(result.released,false);
    assert.deepEqual(db.rows.get('sgmDesks/12'),candidate);
    assert.equal(db.writes.length,0);
    assert.equal([...db.rows.keys()].some(k=>k.startsWith('sgmBreakPushOutbox/')),false);
  }
});

test('hesap kaybolmuş, silinmiş veya başka masaya bağlanmışsa öğrenci ve masa korunur',async()=>{
  for (const props of [
    {user:null},
    {other:{'sgmDeletedUsers/u1':{deletedAt:NOW}}},
    {user:{...baseUser,activeDeskId:16}}
  ]) {
    const db=database(props);
    assert.equal((await releaseExpiredBreak(options(db))).released,false);
    assert.equal(db.writes.length,0);
    assert.equal([...db.rows.keys()].some(k=>k.startsWith('sgmBreakPushOutbox/')),false);
  }
});

test('YP tarafından silinmiş önceki 00:00 logu geri oluşturulmaz',async()=>{
  const db=database();
  const first=await releaseExpiredBreak(options(db));
  const id=[...db.rows.keys()].find(k=>k.startsWith('sgmAudit/MOLA-BITIS-'));
  const db2=database({other:{[`sgmDeletedRecords/logs-${id.slice('sgmAudit/'.length)}`]:{deletedAt:NOW}}});
  assert.equal((await releaseExpiredBreak(options(db2))).released,true);
  assert.equal(logTypes(db2).length,1);
  assert.equal(first.released,true);
});

test('ana kullanıcı düşürülürken geçerli misafir silinmez, masa misafire geçer',async()=>{
  const guest={name:'Misafir',activeDeskId:12,activeDeskRole:'guest',deviceId:'guest-device',strikes:0};
  const db=database({desk:{...baseDesk,guestOccupant:'guest-1',guestSessionStartTime:NOW-60_000},other:{'sgmUsers/guest-1':guest}});
  const r=await releaseExpiredBreak(options(db));
  assert.equal(r.released,true);
  assert.equal(db.rows.get('sgmDesks/12').occupant,'guest-1');
  assert.equal(db.rows.get('sgmDesks/12').status,'occupied');
  assert.equal(db.rows.get('sgmUsers/guest-1').activeDeskRole,'owner');
  assert.equal(db.rows.get('sgmUsers/guest-1').strikes,0);
  assert.equal(db.rows.get('sgmUsers/u1').activeDeskId,null);
});

test('ana kullanıcı düşerken misafirin devam eden molası korunur',async()=>{
  const endAt=NOW + 7 * 60_000;
  const guest={name:'Misafir',activeDeskId:12,activeDeskRole:'guest',deviceId:'guest-device',
    lastBreakSession:{id:'g-1',deskId:12,type:'long',startedAt:NOW-3*60_000,endAt,status:'active'}};
  const db=database({desk:{...baseDesk,guestOccupant:'guest-1',guestSessionStartTime:NOW-45*60_000,guestBreakEndTime:endAt},other:{'sgmUsers/guest-1':guest}});
  assert.equal((await releaseExpiredBreak(options(db))).released,true);
  const row=db.rows.get('sgmDesks/12');
  assert.equal(row.occupant,'guest-1');
  assert.equal(row.status,'on_break');
  assert.equal(row.breakEndTime,endAt);
  assert.equal(row.breakType,'long');
  assert.equal(db.rows.get('sgmUsers/guest-1').activeDeskId,12);
});

test('geçersiz misafir kayıtları bütün masayı silmeye yol açmaz',async()=>{
  const db=database({desk:{...baseDesk,guestOccupant:'unknown',guestSessionStartTime:NOW-60_000}});
  assert.equal((await releaseExpiredBreak(options(db))).reason,'guest_session_needs_review');
  assert.equal(db.writes.length,0);
});

test('eski misafirin molası dolunca yalnızca misafir düşer',async()=>{
  const guest={name:'Misafir',activeDeskId:12,activeDeskRole:'guest',strikes:1,deviceId:'guest-device',lastBreakSession:{id:'g-12',deskId:12,endAt:NOW-1000,status:'active',type:'long'}};
  const db=database({desk:{...baseDesk,status:'occupied',breakEndTime:null,guestOccupant:'guest-1',guestSessionStartTime:NOW-60_000,guestBreakEndTime:NOW-1000},other:{'sgmUsers/guest-1':guest}});
  const result=await releaseExpiredBreak({...options(db),isGuest:true});
  assert.equal(result.released,true);
  assert.equal(db.rows.get('sgmDesks/12').occupant,'u1');
  assert.equal(db.rows.get('sgmDesks/12').guestOccupant,null);
  assert.equal(db.rows.get('sgmUsers/guest-1').activeDeskId,null);
  assert.equal(db.rows.get('sgmUsers/guest-1').strikes,1);
  assert.equal(db.rows.get('sgmUsers/u1').activeDeskId,12);
});

test('telefon kapalıyken zamanlayıcı tüm masa adaylarını sunucudan kontrol eder',async()=>{
  const db=database();
  const result=await sweepExpiredBreaks({collection:db.collection,now:()=>NOW});
  assert.equal(result.checked,1);
  assert.equal(result.candidates,1);
  assert.equal(result.releasedCount,1);
  assert.deepEqual(result.releasedDeskIds,[12]);
  assert.deepEqual(result.errors,[]);
  const repeated=await sweepExpiredBreaks({collection:db.collection,now:()=>NOW+3000});
  assert.equal(repeated.releasedCount,0);
  assert.equal(db.rows.get('sgmUsers/u1').deskReclaimAllowedAt,NOW+30*60_000);
});

test('misafir ile sahibi aynı anda moladaysa her iki öğrenci ayrı ayrı düşer',async()=>{
  const guest={name:'G',activeDeskId:12,activeDeskRole:'guest',strikes:0,lastBreakSession:{id:'g',deskId:12,type:'short',endAt:NOW-1000,status:'active'}};
  const db=database({desk:{...baseDesk,guestOccupant:'guest-1',guestSessionStartTime:NOW-60_000,guestBreakEndTime:NOW-1000},other:{'sgmUsers/guest-1':guest}});
  const result=await releaseExpiredBreaksForDesk(options(db));
  assert.equal(result.released.length,2);
  assert.equal(db.rows.get('sgmDesks/12').occupant,null);
  assert.equal(db.rows.get('sgmDesks/12').guestOccupant,null);
  assert.equal(db.rows.get('sgmUsers/guest-1').activeDeskId,null);
  assert.equal(db.rows.get('sgmUsers/u1').activeDeskId,null);
});
