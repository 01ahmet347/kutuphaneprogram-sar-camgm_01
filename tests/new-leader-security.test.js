import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { hashLeaderPassword,verifyLeaderPassword,validLeaderPassword,validLeaderUsername } from '../server/leader-password.js';
import { verifyFormSignature } from '../server/form-signature.js';

test('leader passwords are salted, hash-verified, never stored as plain text',()=>{
 const first=hashLeaderPassword('SaglamTestSifrem!2026');
 const second=hashLeaderPassword('SaglamTestSifrem!2026');
 assert.notEqual(first,second);
 assert.ok(verifyLeaderPassword('SaglamTestSifrem!2026',first));
 assert.equal(verifyLeaderPassword('yanlis-sifre',first),false);
 assert.ok(!first.includes('SaglamTestSifrem!2026'));
});
test('leader input validation rejects weak passwords and invalid IDs',()=>{
 assert.equal(validLeaderPassword('kisa'),false);
 assert.equal(validLeaderUsername('bad/path'),false);
 assert.equal(validLeaderUsername('lider1'),true);
});
test('Google Form HMAC uses matching timestamp/code/response ID',()=>{
 const secret='test-en-az-32-karakter-cok-guclu-sifre-12345678';
 const timestamp=1699999999999,code='01234567',submissionId='response-test-123456';
 const signature=createHmac('sha256',secret).update(`${timestamp}:${code}:${submissionId}`).digest('hex');
 const input={secret,timestamp,code,submissionId,signature,now:timestamp};
 assert.equal(verifyFormSignature(input),true);
 assert.equal(verifyFormSignature({...input,code:'12345678'}),false);
 assert.equal(verifyFormSignature({...input,now:timestamp+6*60*1000}),false);
 assert.equal(verifyFormSignature({...input,signature:'f'.repeat(64)}),false);
 assert.equal(verifyFormSignature({...input,secret:''}),false);
});
