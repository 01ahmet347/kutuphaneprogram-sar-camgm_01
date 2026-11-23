import test from 'node:test';
import assert from 'node:assert/strict';
import { createActivityService } from '../server/activity-module.js';
import { createCloudActions } from '../src/cloud-transactions.js';
import { verifyFormSignature } from '../server/form-signature.js';
import { createHmac } from 'node:crypto';

const at=Date.parse('2026-11-23T11:00:00.000Z');
const day='2026-11-23';
function fakeFirestore() {
  const rows=new Map([
    ['sgmUsers/u1',{id:'u1',name:'Öğrenci',specialCode:'12345678',activeDeskId:12,
      breaks:{short:5,long:2},breaksResetDate:day,lastActiveTime:at-3600000,violationsResetDate:day}],
    ['sgmDesks/12',{id:12,occupant:'u1',status:'occupied',qrCode:'QR-12-ORIGINAL',sessionStartTime:at-3700000}],
    ['sgmConfig/settings',{shortBreakDuration:15,longBreakDuration:30,breakCooldown:30}]
  ]);
  let clock=at;
  const clone=x=>structuredClone(x);
  const ref=(name,id)=>{
    const r={key:`${name}/${id}`,id:String(id)};
    r.get=async()=>snapshot(r);
    r.create=async data=>{if(rows.has(r.key))throw new Error('duplicate');rows.set(r.key,clone(data));};
    return r;
  };
  const snapshot=r=>({exists:rows.has(r.key),data:()=>clone(rows.get(r.key)),id:r.id,ref:r});
  const firestore={async runTransaction(callback){
    const writes=[];
    const tx={async get(r){return snapshot(r);},
      create(r,v){writes.push(['create',r.key,clone(v)]);},
      update(r,v){writes.push(['update',r.key,clone(v)]);},
      set(r,v){writes.push(['set',r.key,clone(v)]);}};
    const result=await callback(tx);
    for(const [type,key,value] of writes){
      if(type==='create'&&rows.has(key))throw new Error('duplicate');
      rows.set(key,type==='update'?{...rows.get(key),...value}:value);
    }
    return result;
  }};
  const docs=(name,filter=()=>true)=>[...rows.entries()]
    .filter(([k,v])=>k.startsWith(name+'/')&&filter(v))
    .map(([k,v])=>({id:k.split('/')[1],data:()=>clone(v)}));
  const collection=name=>({
    firestore,doc:id=>ref(name,id),
    where(field,op,value){return {limit(n){return {async get(){return {docs:docs(name,v=>v[field]===value).slice(0,n)};}};}};},
    orderBy(field,dir){return {limit(n){return {async get(){return {docs:docs(name).sort((a,b)=>b.data()[field]-a.data()[field]).slice(0,n)};}};}};}
  });
  return {rows,collection,now:()=>clock,setClock:v=>{clock=v;}};
}
const leader={username:'leader-1',name:'Lider 1'};

test('faaliyet: onay bekleme masayı değiştirmez; onayda 60 dk başlar; kapatma mevcut oturumu kesmez',async()=>{
  const f=fakeFirestore(),service=createActivityService({collection:f.collection,now:f.now,dayKey:()=>day});
  const {activity}=await service.create(leader,{title:'Robotik Kodlama',startTime:'14:00'});
  const {application}=await service.apply('u1',{activityId:activity.id});
  assert.equal(f.rows.get('sgmDesks/12').status,'occupied');
  await assert.rejects(service.close(leader,{activityId:activity.id}),/bekleyen/);
  await service.decide(leader,{applicationId:application.id},'approve');
  assert.equal(f.rows.get('sgmDesks/12').status,'on_break');
  assert.equal(f.rows.get('sgmDesks/12').breakEndTime-at,60*60000);
  assert.equal(f.rows.get('sgmDesks/12').qrCode,'QR-12-ORIGINAL');
  assert.equal(f.rows.get('sgmUsers/u1').activityUsedDay,day);
  await service.close(leader,{activityId:activity.id});
  assert.equal(f.rows.get('sgmDesks/12').status,'on_break');
  assert.equal(f.rows.get('sgmDesks/12').breakEndTime-at,60*60000);
  await assert.rejects(service.apply('u1',{activityId:activity.id}),/kapalı|zaten/);
});

test('faaliyet: yalnızca tek 15/30 dk ek mola, 1 birleştirme hakkı; çift ekleme yasak',async()=>{
  const f=fakeFirestore(),service=createActivityService({collection:f.collection,now:f.now,dayKey:()=>day});
  const {activity}=await service.create(leader,{title:'Robotik Kodlama',startTime:'14:00'});
  const {application}=await service.apply('u1',{activityId:activity.id});
  await service.decide(leader,{applicationId:application.id},'approve');
  const result=await service.appendBreak('u1',{type:'short'});
  assert.equal(result.endAt-at,75*60000);
  assert.equal(f.rows.get('sgmUsers/u1').breaks.short,4);
  assert.equal(f.rows.get('sgmUsers/u1').mergeCount,1);
  assert.equal(f.rows.get('sgmDesks/12').breakType,'activity');
  await assert.rejects(service.appendBreak('u1',{type:'long'}),/zaten/);
  await assert.rejects(service.appendBreak('u1',{type:'hourly'}),/yalnızca/);
});

test('normal 15+30 mola tek transaction ile iki bakiye düşürür, iki hak sınırını uygular',async()=>{
  const f=fakeFirestore();
  const get=(r)=>({exists:()=>f.rows.has(r),data:()=>structuredClone(f.rows.get(r)),ref:r});
  const actions=createCloudActions({db:{},ref:(name,id)=>`${name}/${id}`,
    runTransaction:async(_,cb)=>{
      const writes=[];const result=await cb({get:async r=>get(r),set:(r,v)=>writes.push([r,v])});
      writes.forEach(([r,v])=>f.rows.set(r,v));return result;
    },settings:()=>({shortBreakDuration:15,longBreakDuration:30,breakCooldown:30}),
    now:f.now,dayKey:()=>day,isRestricted:()=>false,lostDeskToday:()=>false,applyViolationPolicy:()=>({})});
  const result=await actions.startBreak({userId:'u1',deskId:12,type:'short',secondType:'long',requestId:'merge-1'});
  assert.equal(result.desk.breakEndTime-at,45*60000);
  assert.deepEqual(f.rows.get('sgmUsers/u1').breaks,{short:4,long:1,hourly:0});
  assert.equal(f.rows.get('sgmUsers/u1').mergeCount,1);
  assert.equal(f.rows.get('sgmDesks/12').qrCode,'QR-12-ORIGINAL');
});

test('form imzası e-posta dahilken değiştirilmiş e-postayı reddeder; eski imzalar uyumlu kalır',()=>{
  const secret='x'.repeat(40),timestamp=at,code='12345678',submissionId='response-123456';
  const email='student@example.com';
  const signature=createHmac('sha256',secret).update(`${timestamp}:${code}:${submissionId}:${email}`).digest('hex');
  assert.equal(verifyFormSignature({secret,timestamp,code,submissionId,email,signature,now:at}),true);
  assert.equal(verifyFormSignature({secret,timestamp,code,submissionId,email:'other@example.com',signature,now:at}),false);
  const old=createHmac('sha256',secret).update(`${timestamp}:${code}:${submissionId}`).digest('hex');
  assert.equal(verifyFormSignature({secret,timestamp,code,submissionId,signature:old,now:at}),true);
});

test('reddedilen öğrenci masası, QR ve mola bakiyesi değişmeden kalır; başka lider onaylayamaz',async()=>{
  const f=fakeFirestore(),service=createActivityService({collection:f.collection,now:f.now,dayKey:()=>day});
  const {activity}=await service.create(leader,{title:'Yapay Zekâ Atölyesi',startTime:'15:00'});
  const {application}=await service.apply('u1',{activityId:activity.id});
  await assert.rejects(service.decide({username:'leader-2',name:'Diğer Lider'},{applicationId:application.id},'approve'),/yetkiniz/);
  await service.decide(leader,{applicationId:application.id},'reject');
  assert.equal(f.rows.get('sgmDesks/12').status,'occupied');
  assert.equal(f.rows.get('sgmDesks/12').qrCode,'QR-12-ORIGINAL');
  assert.deepEqual(f.rows.get('sgmUsers/u1').breaks,{short:5,long:2});
  assert.equal(f.rows.get('sgmUsers/u1').activityUsedDay,undefined);
  await service.close(leader,{activityId:activity.id});
});

test('faaliyet ek mola iki günlük birleştirme hakkı dolduğunda reddedilir',async()=>{
  const f=fakeFirestore(),service=createActivityService({collection:f.collection,now:f.now,dayKey:()=>day});
  const {activity}=await service.create(leader,{title:'Sanat Atölyesi',startTime:'15:00'});
  const {application}=await service.apply('u1',{activityId:activity.id});
  await service.decide(leader,{applicationId:application.id},'approve');
  f.rows.set('sgmUsers/u1',{...f.rows.get('sgmUsers/u1'),mergeDay:day,mergeCount:2});
  await assert.rejects(service.appendBreak('u1',{type:'short'}),/iki birleştirme/);
  assert.equal(f.rows.get('sgmUsers/u1').breaks.short,5);
  assert.equal(f.rows.get('sgmDesks/12').breakEndTime,at+60*60000);
});
