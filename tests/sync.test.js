import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { mergePendingRows, rowMap, nonConflictingPatch, atomicFieldPatch, mapLimited, sessionCanRestore } from '../src/sync-core.js';
import { createCloudActions } from '../src/cloud-transactions.js';

const clone = value => value === undefined ? undefined : structuredClone(value);
function memoryDatabase(seed = {}) {
  const data = new Map(Object.entries(seed).map(([key,value]) => [key,clone(value)]));
  const versions = new Map(); const writes = [];
  const ref = (bucket,id) => `${bucket}/${id}`;
  async function runTransaction(_db, callback) {
    for (let attempt=0; attempt<30; attempt++) {
      const view = new Map(Array.from(data, ([key,value])=>[key,clone(value)]));
      const observedVersions = new Map(versions); const reads = new Set(), pending = [];
      let writing = false;
      const tx = {
        async get(key) {
          assert.equal(writing,false,'Firestore transactions must read before writing');
          reads.add(key); const value=clone(view.get(key));
          await Promise.resolve();
          return { ref:key, exists:()=>view.has(key), data:()=>clone(value) };
        },
        set(key,value,options) { writing=true; pending.push({key,value:clone(value),merge:options?.merge}); },
        create(key,value) { assert.equal(view.has(key),false,'Firestore create must target a missing document'); writing=true; pending.push({key,value:clone(value)}); },
        delete(key) { writing=true; pending.push({key,delete:true}); }
      };
      const result=await callback(tx);
      if (Array.from(reads).some(key=>(versions.get(key)||0)!==(observedVersions.get(key)||0))) continue;
      for(const item of pending){
        if(item.delete)data.delete(item.key);
        else data.set(item.key,item.merge?{...data.get(item.key),...item.value}:item.value);
        versions.set(item.key,(versions.get(item.key)||0)+1); writes.push(item);
      }
      return result;
    }
    throw new Error('transaction retry limit');
  }
  return {data,writes,ref,runTransaction};
}
const user = id => ({id,name:id,blocked:false,pendingApproval:false,strikes:0,restrictedUntil:0,activeDeskId:null,pendingDeskId:null,pendingDeskDeadline:null,violationHistory:[]});
const desk = id => ({id,status:'available',occupant:null,ownerDeviceId:null,pendingOccupant:null,pendingDeskDeadline:null,qrCode:`QR-${id}-test`});
function actions(db,clock=()=>1000) {
  return createCloudActions({db,runTransaction:db.runTransaction,ref:db.ref,settings:()=>({strikeLimit:2,breakCooldown:30,shortBreakCount:5,longBreakCount:2,shortBreakDuration:15,longBreakDuration:60,reportsEnabled:true,reportWaitTime:5}),dayKey:()=> '2026-10-07',
    isRestricted:u=>u.pendingApproval||u.restrictedUntil>clock(),lostDeskToday:()=>false,now:clock,
    applyViolationPolicy:(u,id,at)=>({violationHistory:[...(u.violationHistory||[]),at],lostDeskIds:[id]})});
}

test('remote deletion wins even when a device has an unsent edit',()=>{
  const old=user('u1');
  assert.deepEqual(mergePendingRows([],[{...old,activeDeskId:1}],rowMap([old])),[]);
});
test('only explicitly created unsent accounts survive an empty remote query',()=>{
  const row=user('new');
  assert.deepEqual(mergePendingRows([],[row],new Map()),[]);
  assert.deepEqual(mergePendingRows([],[row],new Map(),{creates:new Set(['new'])}),[row]);
});
test('local changes do not replace another devices new fields',()=>{
  const before={name:'A',pin:'12345678',strikes:0};
  const remote={...before,pin:'99999999',strikes:1};
  const patch=nonConflictingPatch(remote,before,{...before,name:'B'});
  assert.deepEqual({...remote,...patch},{name:'B',pin:'99999999',strikes:1});
});
test('a stale release cannot leave a new occupant on an available desk',()=>{
  const before={status:'occupied',occupant:'old'},remote={status:'occupied',occupant:'new'};
  const patch=atomicFieldPatch(remote,before,{status:'available',occupant:null},['status','occupant']);
  assert.deepEqual(patch,{});
});
test('two students reserving the same desk get only one successful reservation',async()=>{
  const db=memoryDatabase({'sgmUsers/a':user('a'),'sgmUsers/b':user('b'),'sgmDesks/1':desk(1)}),api=actions(db);
  const result=await Promise.allSettled([api.reserve({userId:'a',deskId:1,deviceId:'A'}),api.reserve({userId:'b',deskId:1,deviceId:'B'})]);
  assert.equal(result.filter(r=>r.status==='fulfilled').length,1);
  const winner=db.data.get('sgmDesks/1').pendingOccupant;
  assert.equal(db.data.get(`sgmUsers/${winner}`).pendingDeskId,1);
  assert.equal(db.data.get(`sgmUsers/${winner==='a'?'b':'a'}`).pendingDeskId,null);
});
test('same user cannot reserve two different desks simultaneously',async()=>{
  const db=memoryDatabase({'sgmUsers/a':user('a'),'sgmDesks/1':desk(1),'sgmDesks/2':desk(2)}),api=actions(db);
  const result=await Promise.allSettled([api.reserve({userId:'a',deskId:1,deviceId:'A'}),api.reserve({userId:'a',deskId:2,deviceId:'B'})]);
  assert.equal(result.filter(r=>r.status==='fulfilled').length,1);
  assert.equal([1,2].filter(id=>db.data.get(`sgmDesks/${id}`).pendingOccupant).length,1);
});
test('same device with different accounts cannot reserve two desks simultaneously',async()=>{
  const db=memoryDatabase({'sgmUsers/a':user('a'),'sgmUsers/b':user('b'),'sgmDesks/1':desk(1),'sgmDesks/2':desk(2)}),api=actions(db);
  const result=await Promise.allSettled([api.reserve({userId:'a',deskId:1,deviceId:'A'}),api.reserve({userId:'b',deskId:2,deviceId:'A'})]);
  assert.equal(result.filter(r=>r.status==='fulfilled').length,1);
});
test('QR claim validates reservation and writes user/desk together',async()=>{
  const db=memoryDatabase({'sgmUsers/a':user('a'),'sgmDesks/1':desk(1)}),api=actions(db);
  await api.reserve({userId:'a',deskId:1,deviceId:'A'});
  await assert.rejects(api.claim({userId:'a',deskId:1,deviceId:'A',qrCode:'wrong'}),/QR/);
  await api.claim({userId:'a',deskId:1,deviceId:'A',qrCode:'QR-1-test'});
  assert.equal(db.data.get('sgmDesks/1').occupant,'a');assert.equal(db.data.get('sgmUsers/a').activeDeskId,1);
});
test('break actions are verified and persisted with the desk and student together',async()=>{
  const student={...user('a'),activeDeskId:1,lastActiveTime:-2000000,breaks:{short:1,long:1},breaksResetDate:'2026-10-07'};
  const db=memoryDatabase({'sgmUsers/a':student,'sgmDesks/1':{...desk(1),status:'occupied',occupant:'a'}});
  const api=actions(db);
  await api.startBreak({userId:'a',deskId:1,type:'short'});
  assert.equal(db.data.get('sgmDesks/1').status,'on_break');
  assert.equal(db.data.get('sgmUsers/a').breaks.short,0);
  await api.endBreak({userId:'a',deskId:1,qrCode:'QR-1-test'});
  assert.equal(db.data.get('sgmDesks/1').status,'occupied');
  assert.equal(db.data.get('sgmUsers/a').lastActiveTime,1000);
});
test('daily student limits reset on the server before a new break is started',async()=>{
  const student={...user('a'),activeDeskId:1,lastActiveTime:-2000000,breaks:{short:0,long:0},breaksResetDate:'2026-10-06',strikes:2,violationsResetDate:'2026-10-06'};
  const db=memoryDatabase({'sgmUsers/a':student,'sgmDesks/1':{...desk(1),status:'occupied',occupant:'a'}});
  const api=actions(db);
  await api.startBreak({userId:'a',deskId:1,type:'short'});
  assert.equal(db.data.get('sgmUsers/a').breaks.short,4);
  assert.equal(db.data.get('sgmUsers/a').strikes,0);
  assert.equal(db.data.get('sgmUsers/a').breaksResetDate,'2026-10-07');
  assert.equal(db.data.get('sgmUsers/a').violationsResetDate,'2026-10-07');
});
test('late QR return cannot bypass an expired break penalty',async()=>{
  const db=memoryDatabase({
    'sgmUsers/a':{...user('a'),activeDeskId:1},
    'sgmDesks/1':{...desk(1),status:'on_break',occupant:'a',breakEndTime:900}
  });
  await assert.rejects(actions(db).endBreak({userId:'a',deskId:1,qrCode:'QR-1-test'}),/Moladan/);
});
test('student report and presence verification are transactional and scoped to authenticated students',async()=>{
  const db=memoryDatabase({
    'sgmUsers/reporter':{...user('reporter'),activeDeskId:2,canReport:true,name:'R'},
    'sgmUsers/target':{...user('target'),activeDeskId:1,name:'T',specialCode:'12345678'},
    'sgmDesks/1':{...desk(1),status:'occupied',occupant:'target'},
    'sgmDesks/2':{...desk(2),status:'occupied',occupant:'reporter'}
  });
  test('late QR report verification cannot bypass an expired report penalty',async()=>{
    const db=memoryDatabase({
      'sgmUsers/a':{...user('a'),activeDeskId:1},
      'sgmDesks/1':{...desk(1),status:'reported',occupant:'a',reportEndTime:900}
    });
    await assert.rejects(actions(db).verifyPresence({userId:'a',deskId:1,qrCode:'QR-1-test'}),/doğrulayabilirsiniz/);
  });
  test('leaving after break expiry cannot bypass the timeout transaction',async()=>{
    const db=memoryDatabase({
      'sgmUsers/a':{...user('a'),activeDeskId:1},
      'sgmDesks/1':{...desk(1),status:'on_break',occupant:'a',breakEndTime:900}
    });
    await assert.rejects(actions(db).leaveDesk({userId:'a',deskId:1}),/otomatik işlem/);
  });
  const api=actions(db);
  const report=await api.reportDesk({userId:'reporter',deskId:1,targetUserId:'target'});
  assert.equal(report.desk.status,'reported');
  assert.equal(db.data.get(`sgmAudit/${report.eventId}`).userId,'target');
  assert.equal(db.data.get(`sgmAudit/${report.eventId}`).actorFirebaseUid,'reporter');
  await api.verifyPresence({userId:'target',deskId:1,qrCode:'QR-1-test'});
  assert.equal(db.data.get('sgmDesks/1').status,'occupied');
  assert.equal(db.data.get('sgmUsers/target').lastActiveTime,1000);
});
test('student leave applies the server controlled cooldown',async()=>{
  const db=memoryDatabase({
    'sgmUsers/a':{...user('a'),activeDeskId:1,activeDeskRole:'owner'},
    'sgmDesks/1':{...desk(1),status:'occupied',occupant:'a'}
  });
  const result=await actions(db).leaveDesk({userId:'a',deskId:1});
  assert.equal(result.desk.status,'available');
  assert.equal(db.data.get('sgmUsers/a').activeDeskId,null);
  assert.equal(db.data.get('sgmUsers/a').deskReclaimAllowedAt,1801000);
});
test('a reservation past its deadline cannot be claimed',async()=>{
  let time=1000;const db=memoryDatabase({'sgmUsers/a':user('a'),'sgmDesks/1':desk(1)}),api=actions(db,()=>time);
  await api.reserve({userId:'a',deskId:1,deviceId:'A'});time+=300001;
  await assert.rejects(api.claim({userId:'a',deskId:1,deviceId:'A',qrCode:'QR-1-test'}),/sona/);
});
test('administrator assignment racing a student reservation preserves one owner',async()=>{
  const db=memoryDatabase({'sgmUsers/a':user('a'),'sgmUsers/b':user('b'),'sgmDesks/1':desk(1)}),api=actions(db);
  const result=await Promise.allSettled([api.assign({userId:'a',deskId:1}),api.reserve({userId:'b',deskId:1,deviceId:'B'})]);
  assert.equal(result.filter(r=>r.status==='fulfilled').length,1);
  const d=db.data.get('sgmDesks/1');assert.equal(Boolean(d.occupant)&&Boolean(d.pendingOccupant),false);
});
test('two observers process one timeout and only one penalty',async()=>{
  const db=memoryDatabase({'sgmUsers/a':{...user('a'),activeDeskId:1},'sgmDesks/1':{...desk(1),status:'on_break',occupant:'a',breakEndTime:900}}),api=actions(db);
  const result=await Promise.all([api.expireDesk(1),api.expireDesk(1)]);
  assert.equal(result.filter(Boolean).length,1);assert.equal(db.data.get('sgmUsers/a').strikes,1);
  assert.equal(db.data.get('sgmUsers/a').violationHistory.length,1);assert.equal(db.data.get('sgmDesks/1').status,'available');
});
test('an already verified report does not produce a new penalty',async()=>{
  const db=memoryDatabase({'sgmUsers/a':{...user('a'),activeDeskId:1},'sgmDesks/1':{...desk(1),status:'reported',occupant:'a',reportIssuedAt:500,reportVerifiedAt:600,reportEndTime:900}}),api=actions(db);
  const result=await api.expireDesk(1);assert.equal(result.verified,true);assert.equal(db.data.get('sgmUsers/a').strikes,0);
});
test('user deletion writes a shared tombstone and clears active and reserved desks',async()=>{
  const db=memoryDatabase({'sgmUsers/a':{...user('a'),activeDeskId:1,pendingDeskId:2},'sgmDesks/1':{...desk(1),status:'occupied',occupant:'a'},'sgmDesks/2':{...desk(2),pendingOccupant:'a'}}),api=actions(db);
  await api.deleteUser('a',[db.data.get('sgmDesks/1'),db.data.get('sgmDesks/2')]);
  assert.equal(db.data.has('sgmUsers/a'),false);assert.equal(db.data.has('sgmDeletedUsers/a'),true);
  assert.equal(db.data.get('sgmDesks/1').occupant,null);assert.equal(db.data.get('sgmDesks/2').pendingOccupant,null);
});
test('a deleted account cannot reserve even if an old client has recreated its document',async()=>{
  const db=memoryDatabase({'sgmUsers/a':user('a'),'sgmDeletedUsers/a':{id:'a'},'sgmDesks/1':desk(1)});
  await assert.rejects(actions(db).reserve({userId:'a',deskId:1,deviceId:'A'}),/silinmiş/);
});
test('the application persistence function does not recreate a deleted user from stale state',async()=>{
  const old=user('a'),db=memoryDatabase({'sgmDeletedUsers/a':{id:'a'}});
  const source=readFileSync(new URL('../kutuphaneprogramıguncell.jsx',import.meta.url),'utf8');
  const a=source.indexOf('  const persistRowsNow ='),b=source.indexOf('  const persistGranularStateNow =',a);
  const context={db,runTransaction:db.runTransaction,getLiveDoc:db.ref,rowsToMap:rowMap,stableJson:JSON.stringify,
    mapLimited,atomicFieldPatch,granularBaselineRef:{current:{users:rowMap([old])}},isRecordDeleted:()=>false,
    pendingUserCreatesRef:{current:new Set()},serverDeletedUserIdsRef:{current:new Set()},usersRef:{current:[old]},setUsers:()=>{},normalizeRemoteUsers:r=>r,normalizeRemoteDesks:r=>r};
  vm.createContext(context);vm.runInContext(source.slice(a,b)+';globalThis.persist=persistRowsNow;',context);
  await context.persist('sgmUsers',[{...old,activeDeskId:1}],'users');
  assert.equal(db.data.has('sgmUsers/a'),false);assert.equal(db.writes.length,0);
});
test('session restoration does not expire at midnight or closing time',()=>{
  assert.equal(sessionCanRestore({userId:'a',day:'2020-01-01'},user('a')),true);
  assert.equal(sessionCanRestore({userId:'a'},null),false);
});
test('bulk requests respect concurrency and preserve failures',async()=>{
  let current=0,peak=0;
  const results=await mapLimited([1,2,3,4,5,6],async value=>{current++;peak=Math.max(current,peak);await Promise.resolve();current--;if(value===3)throw new Error('offline');return value;},2);
  assert.ok(peak<=2);assert.equal(results[2].status,'rejected');assert.equal(results[5].value,6);
});

function applicationAppend(db, online=true) {
 const source=readFileSync(new URL('../kutuphaneprogramıguncell.jsx',import.meta.url),'utf8');
 const a=source.indexOf('  const readAppendOutbox ='),b=source.indexOf('  const flushAuditOutbox =',a);
 const store=new Map();
 const context={db,fbUser:{uid:'test'},adminAuthorized:true,navigator:{onLine:online},quotaBackoffUntilRef:{current:0},appendOutboxRef:{current:null},getLiveDoc:db.ref,runTransaction:db.runTransaction,stableJson:JSON.stringify,isRecordDeleted:()=>false,localStorage:{getItem:key=>store.get(key)??null,setItem:(key,value)=>store.set(key,value),removeItem:key=>store.delete(key)},console};
 vm.createContext(context);vm.runInContext(source.slice(a,b)+';globalThis.persist=persistAppendItem;globalThis.pending=readAppendOutbox;',context);
 return context;
}
test('replayed audit records never create additional writes',async()=>{
 const db=memoryDatabase(),ctx=applicationAppend(db),item={bucket:'sgmAudit',documentId:'event',record:{id:'event',time:1,type:'GIRIS'}};
 ctx.pending()['sgmAudit/event']=item;await ctx.persist(item);assert.equal(db.writes.length,1);
 ctx.pending()['sgmAudit/event']=item;await ctx.persist(item);assert.equal(db.writes.length,1);
});
test('feedback stays pending offline and is confirmed only after retry',async()=>{
 const db=memoryDatabase(),ctx=applicationAppend(db,false),item={bucket:'sgmFeedback',documentId:'feedback',record:{id:'feedback',time:1,message:'Öneri'}};
 ctx.pending()['sgmFeedback/feedback']=item;await assert.rejects(ctx.persist(item),/bekliyor/);
 assert.ok(ctx.pending()['sgmFeedback/feedback']);assert.equal(db.data.size,0);
 ctx.navigator.onLine=true;await ctx.persist(item);assert.ok(db.data.has('sgmFeedback/feedback'));assert.equal(ctx.pending()['sgmFeedback/feedback'],undefined);
});
test('shared deletion markers prevent replayed log resurrection',async()=>{
 const db=memoryDatabase({'sgmDeletedRecords/logs-event':{id:'event'}}),ctx=applicationAppend(db);
 await ctx.persist({bucket:'sgmAudit',documentId:'event',record:{id:'event',time:1}});
 assert.equal(db.data.has('sgmAudit/event'),false);assert.equal(db.writes.length,0);
});
test('personal message replay cannot replace a newer message',async()=>{
 const db=memoryDatabase({'sgmMessages/student':{id:'new',time:20,message:'Yeni'}}),ctx=applicationAppend(db);
 await ctx.persist({bucket:'sgmMessages',documentId:'student',record:{id:'old',time:10,message:'Eski'},replace:true});
 assert.equal(db.data.get('sgmMessages/student').id,'new');assert.equal(db.writes.length,0);
});
