import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

// Run the isolated business logic without Firebase Admin credentials or a live database.
const source=readFileSync(new URL('../server/form-verification.js',import.meta.url),'utf8')
  .replace(/^import .*;\n/gm,'')
  .replace('export async function acceptFormSubmission','async function acceptFormSubmission');
const acceptFormSubmission=new Function('createHash','dataCollection','isFormGatePending','validGMCode',
  `${source}\nreturn acceptFormSubmission;`)(createHash,()=>{},()=>{},c=>/^\d{8}$/.test(c));
function fakeDb(seed) {
  const records=new Map(Object.entries(seed));
  const firestore={async runTransaction(fn){
    const tx={
      async get(ref){const value=records.get(ref.path);return {exists:value!==undefined,data:()=>value};},
      create(ref,value){if(records.has(ref.path)) throw Error('duplicate');records.set(ref.path,value);},
      update(ref,patch){records.set(ref.path,{...records.get(ref.path),...patch});}
    };
    return fn(tx);
  }};
  const collection=name=>({doc:id=>({path:`${name}/${id}`,firestore})});
  return {records,collection};
}
const baseUser=(code)=>({specialCode:code,formGateEnabled:true,registrationFormStatus:'awaiting_submission',pendingApproval:true,restrictionReason:'Form bekleniyor'});
const email='ogrenci@example.com';

test('one main Google Form verifies code, opens login and creates a single email binding',async()=>{
  const db=fakeDb({'sgmAuthCodes/12345678':{userId:'a'},'sgmUsers/a':baseUser('12345678')});
  const args={code:'12345678',submissionId:'form-response-123',email,collection:db.collection,now:()=>12345};
  assert.deepEqual(await acceptFormSubmission(args),{accepted:true,duplicate:false});
  assert.equal(db.records.get('sgmUsers/a').registrationFormStatus,'verified');
  assert.equal(db.records.get('sgmUsers/a').pendingApproval,false);
  assert.equal(db.records.get('sgmUsers/a').leaderReviewStatus,'pending');
  assert.equal(db.records.get('sgmFormEmails/'+createHash('sha256').update(email).digest('hex')).userId,'a');
  assert.deepEqual(await acceptFormSubmission(args),{accepted:true,duplicate:true});
  await assert.rejects(()=>acceptFormSubmission({...args,submissionId:'form-response-456'}),/zaten doğrulanmış/);
});

test('same verified form email cannot activate a second student code',async()=>{
  const db=fakeDb({'sgmAuthCodes/12345678':{userId:'a'},'sgmUsers/a':baseUser('12345678'),
    'sgmAuthCodes/87654321':{userId:'b'},'sgmUsers/b':baseUser('87654321')});
  await acceptFormSubmission({code:'12345678',submissionId:'response-one-123',email,collection:db.collection});
  await assert.rejects(()=>acceptFormSubmission({code:'87654321',submissionId:'response-two-456',email,collection:db.collection}),/başka bir hesap/);
  assert.equal(db.records.get('sgmUsers/b').registrationFormStatus,'awaiting_submission');
});

test('older form without respondent email still works, without claiming email uniqueness',async()=>{
  const db=fakeDb({'sgmAuthCodes/12345678':{userId:'a'},'sgmUsers/a':baseUser('12345678')});
  assert.equal((await acceptFormSubmission({code:'12345678',submissionId:'response-old-123',email:'',collection:db.collection})).accepted,true);
  assert.equal(db.records.get('sgmUsers/a').registrationFormStatus,'verified');
});

test('previous Google-bound account still requires matching form email',async()=>{
  const db=fakeDb({'sgmAuthCodes/12345678':{userId:'a'},'sgmUsers/a':{...baseUser('12345678'),formGateEmailRequired:true,verifiedEmailHash:createHash('sha256').update(email).digest('hex')}});
  await assert.rejects(()=>acceptFormSubmission({code:'12345678',submissionId:'response-abc-123',email:'other@example.com',collection:db.collection}),/eşleşmiyor/);
  assert.equal(db.records.get('sgmUsers/a').registrationFormStatus,'awaiting_submission');
});

test('app registration has no Google login popup and leader has no device-change privilege',()=>{
  const ui=readFileSync(new URL('../kutuphaneprogramıguncell.jsx',import.meta.url),'utf8');
  const api=readFileSync(new URL('../api/student-register.js',import.meta.url),'utf8');
  const leader=readFileSync(new URL('../api/admin-maintenance.js',import.meta.url),'utf8');
  const script=readFileSync(new URL('../google-apps-script/gm-kod-aktarimi.gs',import.meta.url),'utf8');
  assert.ok(!ui.includes('signInWithPopup'));
  assert.ok(!ui.includes('Google Hesabını Doğrula'));
  assert.ok(!api.includes('verified_google_required'));
  assert.ok(!leader.includes('leader_device_decide'));
  assert.ok(script.includes('onMainFormSubmit'));
  assert.ok(script.includes('GM_CODES_SPREADSHEET_ID'));
  assert.ok(script.includes("'/api/student-register'"));
});
