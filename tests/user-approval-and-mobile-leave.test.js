import test from 'node:test';
import assert from 'node:assert/strict';
import { approveAccounts, validApprovalIds } from '../server/user-approval.js';
import { createStudentDeskHandler } from '../server/student-desk.js';
import { requestStudentDesk } from '../src/desk-request.js';
import { createCloudActions } from '../src/cloud-transactions.js';
import { withoutAccountApprovalWrites } from '../src/authoritative-session.js';
import { isIstanbulAfterClose } from '../src/closing-visibility.js';

function mockAccounts() {
  const records = new Map([
    ['sgmUsers/u1', { id:'u1', pin:'12345678', specialCode:'87654321', blocked:true, pendingApproval:true, activeDeskId:9, strikes:3, violationHistory:[111] }],
    ['sgmUsers/u2', { id:'u2', pin:'23456789', blocked:true, pendingApproval:false, restrictedUntil:999999 }]
  ]);
  const collection = bucket => ({ doc: id => ({ key:`${bucket}/${id}` }) });
  const runTransaction = async callback => {
    const updates = [];
    const result = await callback({
      async get(ref) { const row = records.get(ref.key); return { exists: row !== undefined, ref, data: () => structuredClone(row) }; },
      set(ref, value, opts) { assert.equal(opts.merge,true); updates.push([ref.key,value]); }
    });
    for (const [key, patch] of updates) records.set(key, {...records.get(key), ...patch});
    return result;
  };
  return { records, collection, runTransaction };
}

test('single/bulk approval patches only permission fields and preserves credentials and sessions', async () => {
  const fixture = mockAccounts();
  const result = await approveAccounts({ ids:['u1','u2'], collection:fixture.collection, runTransaction:fixture.runTransaction });
  assert.deepEqual(result.map(u => u.id), ['u1','u2']);
  assert.equal('pin' in result[0],false);
  const u = fixture.records.get('sgmUsers/u1');
  assert.equal(u.pendingApproval,false);
  assert.equal(u.blocked,false);
  assert.equal(u.canReport,true);
  assert.equal(u.pin,'12345678');
  assert.equal(u.specialCode,'87654321');
  assert.equal(u.activeDeskId,9);
  assert.equal(u.strikes,3);
  assert.deepEqual(u.violationHistory,[111]);
  assert.deepEqual(withoutAccountApprovalWrites({ blocked:true, pendingApproval:true, name:'Ali' }), { name:'Ali' });
});

test('missing/deleted users reject entire batch rather than re-creating accounts', async () => {
  const f = mockAccounts();
  f.records.set('sgmDeletedUsers/u2', { deletedAt:111 });
  await assert.rejects(approveAccounts({ids:['u1','u2'],collection:f.collection,runTransaction:f.runTransaction}),/silinmiş/);
  assert.equal(f.records.get('sgmUsers/u1').blocked,true);
  assert.equal(validApprovalIds(['u1','u1']),false);
  assert.equal(validApprovalIds(['bad/id']),false);
  assert.equal(validApprovalIds(Array.from({length:201},(_,i)=>String(i))),false);
});

const response = () => ({setHeader(){},status(code){this.code=code; return this;},json(value){this.body=value; return this;}});

test('closed library refuses reserve but accepts authenticated penalty-free leave', async () => {
  let input;
  const handler = createStudentDeskHandler({
    async authenticateStudent(){return 'u1';},
    async createActions(){return {
      closedNow: () => true,
      async leaveDesk(args){input=args;return { desk:{id:9,status:'available',occupant:null}, user:{id:'u1',activeDeskId:null}, mode:'desk_empty',penaltyFree:true };}
    };}
  });
  const blocked = response();
  await handler({method:'POST',body:{action:'reserve',deskId:9,deviceId:'a'}},blocked);
  assert.equal(blocked.code,409);
  const left = response();
  await handler({method:'POST',body:{action:'leave',deskId:9}},left);
  assert.equal(left.code,200);
  assert.equal(input.penaltyFree,true);
  assert.equal(left.body.penaltyFree,true);
});

function mockDeskSession() {
  const now = Date.parse('2026-10-17T19:00:00Z');
  const map = new Map([
    ['sgmUsers/u1',{id:'u1',pin:'12345678',activeDeskId:7,activeDeskRole:'owner',deskReclaimAllowedAt:0,breaks:{short:5,long:2},breaksResetDate:'2026-10-17',violationsResetDate:'2026-10-17'}],
    ['sgmDesks/7',{id:7,status:'occupied',occupant:'u1',sessionStartTime:now-10000,qrCode:'PRINTED'}]
  ]);
  const actions = createCloudActions({
    db:{}, ref:(bucket,id)=>`${bucket}/${id}`,
    now:()=>now, dayKey:()=> '2026-10-17',settings:()=>({}),isRestricted:()=>false,
    runTransaction:async (_,fn)=>{
      const writes=[];
      const result=await fn({
        async get(key){const v=map.get(key);return {exists:()=>v!==undefined,data:()=>structuredClone(v),ref:key};},
        set(key,val){writes.push([key,structuredClone(val)]);}
      });
      for(const [k,v] of writes)map.set(k,v);
      return result;
    }
  });
  return {map,actions};
}

test('22:00 mobile leave clears only desk link without creating a 30-minute waiting penalty',async()=>{
  const {map,actions}=mockDeskSession();
  const first=await actions.leaveDesk({userId:'u1',deskId:7,penaltyFree:true});
  assert.equal(first.penaltyFree,true);
  assert.equal(map.get('sgmDesks/7').occupant,null);
  assert.equal(map.get('sgmDesks/7').qrCode,'PRINTED');
  assert.equal(map.get('sgmUsers/u1').deskReclaimAllowedAt,0);
  assert.equal(map.get('sgmUsers/u1').pin,'12345678');
  const retry=await actions.leaveDesk({userId:'u1',deskId:7,penaltyFree:true});
  assert.equal(retry.alreadyApplied,true);
  assert.equal(retry.user.activeDeskId,null);
});

test('mobile data response loss retries leave only, returning server-confirmed state',async()=>{
  let calls=0;
  const result=await requestStudentDesk({action:'leave',input:{deskId:7},getToken:async()=> 'token',fetcher:async()=>{
    calls++;
    if(calls===1)throw new TypeError('Failed to fetch');
    return {ok:true,json:async()=>({ok:true,user:{id:'u1',activeDeskId:null}})};
  }});
  assert.equal(calls,2);
  assert.equal(result.user.activeDeskId,null);
});

test('no false success and no automatic retry on conflict; 401 refreshes identity token',async()=>{
  let count=0;
  await assert.rejects(requestStudentDesk({action:'leave',getToken:async()=> 'token',fetcher:async()=>{count++;return {ok:false,status:409,json:async()=>({message:'Hesap uyuşmuyor'})};}}),/Hesap uyuşmuyor/);
  assert.equal(count,1);
  const refreshed=[];
  const ok=await requestStudentDesk({action:'leave',getToken:async force=>{refreshed.push(force);return 'token';},fetcher:async()=>({ok:refreshed.length===2,status:refreshed.length===2?200:401,json:async()=>refreshed.length===2?{ok:true, user:{id:'u1'}}:{ok:false}})});
  assert.ok(ok.ok);
  assert.deepEqual(refreshed,[false,true]);
});

test('Istanbul closing uses 19:00 UTC and not the phone timezone',()=>{
  assert.equal(isIstanbulAfterClose(Date.parse('2026-10-17T18:59:59Z')),false);
  assert.equal(isIstanbulAfterClose(Date.parse('2026-10-17T19:00:00Z')),true);
});

test('partial approval response cannot replace a real GM code, PIN, desk or strike count',async()=>{
  const {mergeAccountApproval}=await import('../src/approval-merge.js');
  const old={id:'u1',specialCode:'87654321',pin:'12345678',activeDeskId:19,strikes:4,breaks:{short:1},blocked:true};
  const [merged]=mergeAccountApproval([old],[{id:'u1',blocked:false,pendingApproval:false}]);
  assert.equal(merged.specialCode,'87654321');
  assert.equal(merged.pin,'12345678');
  assert.equal(merged.activeDeskId,19);
  assert.equal(merged.strikes,4);
  assert.deepEqual(merged.breaks,{short:1});
});
