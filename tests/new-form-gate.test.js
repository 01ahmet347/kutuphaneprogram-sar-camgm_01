import test from 'node:test';
import assert from 'node:assert/strict';
import { createStudentRecord } from '../server/student-registration.js';
import { createStudentLoginHandler } from '../server/student-auth.js';
import { isFormGatePending } from '../server/form-status.js';
import { readFileSync } from 'node:fs';

function response() {return {code:0,body:null,setHeader(){},status(n){this.code=n;return this;},json(data){this.body=data;return this;}};}
const credentials={specialCode:'01234567',pin:'12345678'};
const record=()=>createStudentRecord({uid:'student-1',specialCode:credentials.specialCode,pin:credentials.pin,settings:{shortBreakCount:5,longBreakCount:2},now:1234});
function loginHandler(user, extra={}) {
 return createStudentLoginHandler({
  findBySpecialCode:async()=>[{id:'student-1',user,deleted:false}],
  createCustomToken:async()=> 'student-token',isRateLimited:async()=>false,clearAttempts:async()=>{},...extra
 });
}
test('new registration requires a verified form; old accounts are not retroactively gated',()=>{
 const user=record();assert.equal(user.formGateEnabled,true);assert.equal(user.registrationFormStatus,'awaiting_submission');
 assert.equal(isFormGatePending(user),true);
 assert.equal(isFormGatePending({...user,registrationFormStatus:'verified'}),false);
 assert.equal(isFormGatePending({pendingApproval:true,registrationFormStatus:'manual_review'}),false);
});
test('new student receives no token until submitted form is verified',async()=>{
 const handler=loginHandler(record());const res=response();
 await handler({method:'POST',body:credentials},res);
 assert.equal(res.code,403);assert.equal(res.body.error,'form_not_verified');assert.equal(res.body.token,undefined);
});
test('form status can be checked without issuing authentication token',async()=>{
 const handler=loginHandler(record());const res=response();
 await handler({method:'POST',body:{...credentials,action:'form_status'}},res);
 assert.equal(res.code,200);assert.equal(res.body.verified,false);assert.equal(res.body.token,undefined);
});
test('verified student obtains token without leader first approval',async()=>{
 const handler=loginHandler({...record(),registrationFormStatus:'verified',pendingApproval:false});const res=response();
 await handler({method:'POST',body:credentials},res);
 assert.equal(res.code,200);assert.equal(res.body.token,'student-token');
 assert.equal(res.body.user.pin,undefined);
});
test('new permissions cannot be rewritten by old admin client cache',()=>{
 const file=readFileSync(new URL('../src/authoritative-session.js',import.meta.url),'utf8');
 for(const field of ['formGateEnabled','formInfoRestricted','leaderReviewStatus']) assert.ok(file.includes(`'${field}'`));
});
test('new leader and audit collections deny direct Firestore client access',()=>{
 const text=readFileSync(new URL('../firestore.rules',import.meta.url),'utf8');
 for(const name of ['sgmLeaders','sgmLeaderAudit','sgmLeaderConfig','sgmFormSubmissions']) assert.match(text,new RegExp('match \\/artifacts\\/\\{appId\\}\\/public\\/data\\/'+name+'\\/\\{id\\} \\{ allow read, write: if false; \\}'));
});
