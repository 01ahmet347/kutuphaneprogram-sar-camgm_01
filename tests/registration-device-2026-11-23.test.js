import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validRegistrationDevice, registrationDeviceHash } from '../server/registration-device-policy.js';
import { createStudentLoginHandler } from '../server/student-auth.js';

const response=()=>({code:0,body:null,setHeader(){},status(n){this.code=n;return this;},json(value){this.body=value;return this;}});
const code='12345678',pin='87654321';
const oldUser={id:'old-uid',specialCode:code,pin,name:'Eski öğrenci'};
const newUser={...oldUser,id:'new-uid',registrationDeviceHash:registrationDeviceHash('DEV-firstdevice01')};
const handlerFor=user=>createStudentLoginHandler({
  findBySpecialCode:async()=>[{id:user.id,user,deleted:false}],
  createCustomToken:async()=> 'token',isRateLimited:async()=>false,clearAttempts:async()=>{}
});

test('device ID is validated; hash is deterministic and does not reveal raw ID',()=>{
  assert.equal(validRegistrationDevice('DEV-abc123xyz'),true);
  assert.equal(validRegistrationDevice('DEV-abc123'),true);
  assert.equal(validRegistrationDevice('other-abc123'),false);
  assert.equal(validRegistrationDevice('DEV-../../secrets'),false);
  assert.equal(registrationDeviceHash('DEV-abc123xyz'),registrationDeviceHash('DEV-abc123xyz'));
  assert.notEqual(registrationDeviceHash('DEV-abc123xyz'),registrationDeviceHash('DEV-xyz123abc'));
  assert.equal(registrationDeviceHash('DEV-abc123xyz').length,64);
});

test('old student login preserves token behavior',async()=>{
  const res=response();await handlerFor(oldUser)({method:'POST',body:{specialCode:code,pin}},res);
  assert.equal(res.code,200);assert.equal(res.body.token,'token');
});

test('new student can use same account from a different device without extra leader approval',async()=>{
  const res=response();await handlerFor(newUser)({method:'POST',body:{specialCode:code,pin,deviceId:'DEV-seconddevice1'}},res);
  assert.equal(res.code,200);assert.equal(res.body.token,'token');
});

test('new student still cannot login until Google Form is verified',async()=>{
  const res=response();await handlerFor({...newUser,formGateEnabled:true,registrationFormStatus:'awaiting_submission'})({method:'POST',body:{specialCode:code,pin}},res);
  assert.equal(res.code,403);assert.equal(res.body.error,'form_not_verified');
});

test('form status can be checked without issuing token',async()=>{
  const res=response();await handlerFor(newUser)({method:'POST',body:{specialCode:code,pin,action:'form_status'}},res);
  assert.equal(res.code,200);assert.equal(res.body.token,undefined);
});

test('new device collection is protected and registration remains server-side',()=>{
  const rules=readFileSync(new URL('../firestore.rules',import.meta.url),'utf8');
  assert.ok(rules.includes('match /artifacts/{appId}/public/data/sgmRegistrationDevices/{id} { allow read, write: if false; }'));
  const registration=readFileSync(new URL('../api/student-register.js',import.meta.url),'utf8');
  assert.ok(registration.includes('tx.create(deviceRef'));
  assert.ok(registration.includes('email_already_registered'));
  const form=readFileSync(new URL('../server/form-verification.js',import.meta.url),'utf8');
  assert.ok(form.includes("registrationFormStatus === 'verified'"));
});
