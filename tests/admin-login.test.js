import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/admin-login.js';
const response=()=>({headers:{},setHeader(name,value){this.headers[name]=value;},status(code){this.code=code;return this;},json(body){this.body=body;return this;}});
test('admin login refuses non-POST requests',async()=>{
 const res=response();await handler({method:'GET'},res);assert.equal(res.code,405);
});
test('missing admin credentials produces configuration error, not a successful login',async()=>{
 const previous=[process.env.ADMIN_USERNAME,process.env.ADMIN_PASSWORD];
 try{delete process.env.ADMIN_USERNAME;delete process.env.ADMIN_PASSWORD;const res=response();await handler({method:'POST',body:{username:'demo',password:'demo'}},res);assert.equal(res.code,503);assert.equal(res.body.ok,false);}
 finally{for(const [i,key] of ['ADMIN_USERNAME','ADMIN_PASSWORD'].entries()){if(previous[i]===undefined)delete process.env[key];else process.env[key]=previous[i];}}
});
