import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validRegistrationDevice, registrationDeviceHash } from '../server/registration-device-policy.js';
import { createStudentLoginHandler } from '../server/student-auth.js';

const response=()=>({code:0,body:null,setHeader(){},status(n){this.code=n;return this;},json(value){this.body=value;return this;}});
const code='12345678',pin='87654321';
const oldUser={id:'old-uid',specialCode:code,pin,name:'Eski öğrenci'};
const newUser={...oldUser,id:'new-uid',registrationDeviceHash:registrationDeviceHash('DEV-firstdevice01')};
const handlerFor=(user,checkDevice)=>createStudentLoginHandler({
  findBySpecialCode:async()=>[{id:user.id,user,deleted:false}],
  createCustomToken:async()=> 'token',isRateLimited:async()=>false,
  clearAttempts:async()=>{},checkDevice
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

test('old student login bypasses new device check and preserves existing token behavior',async()=>{
  let calls=0;const handler=handlerFor(oldUser,async()=>{calls++;return {allowed:false};});const res=response();
  await handler({method:'POST',body:{specialCode:code,pin,deviceId:'DEV-otherdevice01'}},res);
  assert.equal(res.code,200);assert.equal(res.body.token,'token');assert.equal(calls,0);
});

test('new student on registered device can log in',async()=>{
  const handler=handlerFor(newUser,async({deviceId})=>({allowed:registrationDeviceHash(deviceId)===newUser.registrationDeviceHash}));
  const res=response();await handler({method:'POST',body:{specialCode:code,pin,deviceId:'DEV-firstdevice01'}},res);
  assert.equal(res.code,200);assert.equal(res.body.token,'token');
});

test('new student on another device is queued for leader approval without issuing a token',async()=>{
  const handler=handlerFor(newUser,async()=>({allowed:false,reason:'device_approval_required'}));
  const res=response();await handler({method:'POST',body:{specialCode:code,pin,deviceId:'DEV-seconddevice1'}},res);
  assert.equal(res.code,403);assert.equal(res.body.error,'device_approval_required');assert.equal(res.body.token,undefined);
});

test('form status and old user fields are unaffected by new device check',async()=>{
  const handler=handlerFor(newUser,async()=>{throw new Error('form status must not change device binding');});
  const res=response();await handler({method:'POST',body:{specialCode:code,pin,action:'form_status'}},res);
  assert.equal(res.code,200);
});

test('new device collections are protected and registered only server-side',()=>{
  const rules=readFileSync(new URL('../firestore.rules',import.meta.url),'utf8');
  for(const name of ['sgmRegistrationDevices','sgmDeviceChangeRequests']) {
    assert.ok(rules.includes(`match /artifacts/{appId}/public/data/${name}/{id} { allow read, write: if false; }`));
    assert.ok(rules.includes(`'${name}'`));
  }
  const registration=readFileSync(new URL('../api/student-register.js',import.meta.url),'utf8');
  assert.ok(registration.includes('tx.create(deviceRef'));
  assert.ok(registration.includes('tx.create(emailRef'));
  assert.ok(registration.includes('email_already_registered'));
  const form=readFileSync(new URL('../server/form-verification.js',import.meta.url),'utf8');
  assert.ok(form.includes("registrationFormStatus === 'verified'"));
});
