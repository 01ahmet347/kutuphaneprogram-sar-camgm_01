import test from 'node:test';
import assert from 'node:assert/strict';
import { expiredBreakDetails } from '../src/break-expiry-audit.js';
import { createStudentProfileWriters, createStudentActivityHandler } from '../server/student-activity.js';

const now = Date.UTC(2026, 9, 22, 9, 30); // 12:30 Turkey, 22 Oct
const user = { name: 'Deneme Öğrenci', specialCode: '12345678', activeDeskId: 12, activeDeskRole: 'owner' };
const desk = { id: 12, occupant: 'u1', guestOccupant: null, status: 'on_break', sessionStartTime: now - 120*60_000, breakEndTime: now - 10_000 };

function mockDB(u = user, d = desk, seeded = {}) {
  const store = new Map(Object.entries(seeded));
  if (u != null) store.set('sgmUsers/u1', u);
  if (d != null) store.set('sgmDesks/12', d);
  const changes = [];
  const api = {
    dataCollection(bucket) {
      return { doc(id) {
        const ref = { key: `${bucket}/${id}`, firestore: { runTransaction: async fn => fn(tx) } };
        return ref;
      } };
    }
  };
  const tx = {
    async get(ref) { return { exists: store.has(ref.key), data: () => store.get(ref.key) }; },
    create(ref, value) { assert.ok(!store.has(ref.key), 'record exists'); store.set(ref.key,value); changes.push(['create',ref.key,value]); },
    set() { throw new Error('unexpected update'); },
    update() { throw new Error('unexpected update'); },
    delete() { throw new Error('unexpected delete'); }
  };
  return { ...api, store, changes };
}

const records = mock => [...mock.store.entries()].filter(([key]) => key.startsWith('sgmAudit/'));

test('mola 00:00 olunca hâlâ moladaki öğrencinin logu sunucuda bir kez yazılır', async () => {
  const mock = mockDB();
  const writer = createStudentProfileWriters({ dataCollection:mock.dataCollection, now:()=>now });
  const a = await writer.saveBreakExpiryEvent('u1',12);
  const b = await writer.saveBreakExpiryEvent('u1',12);
  assert.equal(a.saved,true);
  assert.equal(b.deduplicated,true);
  assert.equal(records(mock).length,1);
  const item = records(mock)[0][1];
  assert.equal(item.type,'MOLA_SURESI_DOLDU_DONUS_YAPILMADI');
  assert.equal(item.deskId,12);
  assert.equal(item.userId,'u1');
  assert.equal(item.breakEndAt,desk.breakEndTime);
  assert.match(item.message,/henüz QR koduyla masaya dönüş yapmamıştı/);
  assert.deepEqual(mock.store.get('sgmUsers/u1'),user);
  assert.deepEqual(mock.store.get('sgmDesks/12'),desk);
  assert.equal(mock.changes.length,1);
});

test('mola süresi bitmemiş, QR dönüşü yapılmış veya masa el değiştirmişse log yazılmaz', async () => {
  for (const variant of [
    { ...desk, breakEndTime:now+60_000 },
    { ...desk, status:'occupied', breakEndTime:null },
    { ...desk, occupant:'u2' },
    { ...desk, sessionStartTime:now + 1_000 },
    { ...desk, sessionStartTime:Date.UTC(2026,9,21,18,0), breakEndTime:Date.UTC(2026,9,21,18,30) },
  ]) {
    const mock = mockDB(user,variant);
    const writer = createStudentProfileWriters({dataCollection:mock.dataCollection,now:()=>now});
    assert.deepEqual(await writer.saveBreakExpiryEvent('u1',12),{saved:false,reason:'not_expired_or_returned'});
    assert.equal(records(mock).length,0);
  }
});

test('kullanıcının güncel masa bağlantısı yoksa log yazılmaz', async () => {
  const mock = mockDB({ ...user,activeDeskId:null },desk);
  const writer = createStudentProfileWriters({dataCollection:mock.dataCollection,now:()=>now});
  assert.equal((await writer.saveBreakExpiryEvent('u1',12)).saved,false);
  assert.equal(mock.changes.length,0);
});

test('süre tam 00:00 olduğunda sunucu log yazar', async () => {
  const mock = mockDB(user,{...desk,breakEndTime:now});
  const writer = createStudentProfileWriters({dataCollection:mock.dataCollection,now:()=>now});
  assert.equal((await writer.saveBreakExpiryEvent('u1',12)).saved,true);
});

test('aynı uid farklı oturumundan ikinci mola logu ayrı kaydolur', async () => {
  const mock = mockDB();
  const writer = createStudentProfileWriters({dataCollection:mock.dataCollection,now:()=>now});
  await writer.saveBreakExpiryEvent('u1',12);
  mock.store.set('sgmDesks/12', {...desk,breakEndTime:now-15_000});
  await writer.saveBreakExpiryEvent('u1',12);
  assert.equal(records(mock).length,2);
});

test('silinmiş log tombstone veya mevcut log kaydı korunur', async () => {
  const mock = mockDB();
  const writer = createStudentProfileWriters({dataCollection:mock.dataCollection,now:()=>now});
  const first = await writer.saveBreakExpiryEvent('u1',12);
  const audit = mock.changes[0][1];
  mock.store.delete(audit);
  mock.store.set('sgmDeletedRecords/logs-'+first.id, {id:first.id, deletedAt:now});
  const result = await writer.saveBreakExpiryEvent('u1',12);
  assert.deepEqual(result,{saved:false,reason:'deleted'});
  assert.equal(records(mock).length,0);
});

test('student-activity eylemi yalnızca doğrulanmış öğrencinin masası için tetiklenir', async () => {
  const handler = createStudentActivityHandler({
    async authenticateStudent(){return 'u1';},
    async saveBreakExpiryEvent(uid,deskId){return {uid,deskId,saved:true};}
  });
  const invoke = async deskId => {
    const res={ status(n){this.statusCode=n;return this;},setHeader(){return this;},json(result){this.result=result;return this;} };
    await handler({method:'POST',body:{action:'break-expired',deskId}},res);
    return res;
  };
  assert.equal((await invoke('12')).statusCode,400);
  assert.equal((await invoke(36)).statusCode,400);
  const ok=await invoke(12);
  assert.equal(ok.statusCode,200);
  assert.deepEqual(ok.result.result,{uid:'u1',deskId:12,saved:true});
});

test('öğrenci açılışında yetkisiz veya eski masaya log üretilemez',()=>{
  assert.equal(expiredBreakDetails({desk,userId:'attacker',activeDeskId:12,at:now}),null);
  assert.equal(expiredBreakDetails({desk,userId:'u1',activeDeskId:12,at:now,clockVerified:false}),null);
  assert.equal(expiredBreakDetails({desk,userId:'u1',activeDeskId:12,at:now})?.endAt,desk.breakEndTime);
});
