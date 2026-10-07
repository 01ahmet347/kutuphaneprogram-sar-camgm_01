import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import vm from 'node:vm';

const project=fileURLToPath(new URL('..',import.meta.url));
const memory=new Map([['sgm_settings',JSON.stringify({openTime:'00:00',closeTime:'23:59'})]]);
const storage={getItem:key=>memory.get(key)??null,setItem:(key,value)=>memory.set(key,value),removeItem:key=>memory.delete(key)};
globalThis.localStorage=storage;globalThis.sessionStorage=storage;
globalThis.window={location:{hostname:'localhost',origin:'http://localhost',href:'http://localhost/'},innerWidth:1280};
Object.defineProperty(globalThis,'navigator',{value:{userAgent:'test',onLine:true},configurable:true});
const fixtureUser={id:'test',name:'Deneme Öğrenci',identityNo:'12345678',pin:'87654321',specialCode:'23456789',activeDeskId:null,strikes:0,breaks:{short:2,long:1},violationHistory:[],lostDeskIds:[]};

test('all retained panels render without runtime reference errors',async()=>{
 const source=await readFile(path.join(project,'kutuphaneprogramıguncell.jsx'),'utf8');
 const temp=await mkdtemp(path.join(project,'.ui-test-'));
 try{
  const screens=[...['permission_gate','role_select','student_login','student_dash','feedback','public','admin_login'].map(view=>[view,'desks']),...['desks','layout_editor','users','registration','settings','violations','feedback','logs','push_status','qr_print'].map(tab=>['admin_dash',tab])];
  for(const [view,tab] of screens){
   const fixture=source.replace("useState('permission_gate')",`useState('${view}')`).replace("useState('desks')",`useState('${tab}')`).replace('const [currentUser, setCurrentUser] = useState(null)',`const [currentUser, setCurrentUser] = useState(${JSON.stringify(fixtureUser)})`);
   const result=await build({stdin:{contents:fixture,sourcefile:'kutuphaneprogramıguncell.jsx',resolveDir:project,loader:'jsx'},bundle:true,platform:'node',format:'esm',packages:'external',write:false,define:{'import.meta.env':'{}','__BUILD_COMMIT__':'"test"'}});
   const output=path.join(temp,`${view}-${tab}.mjs`);await writeFile(output,result.outputFiles[0].contents);
   const {default:App}=await import(pathToFileURL(output).href);
   const html=renderToStaticMarkup(React.createElement(App));
   assert.ok(html.length>100,`${view}/${tab} rendered`);
   assert.ok(!html.includes('Tutanak'),`${view}/${tab} has no Tutanak controls`);
  }
 }finally{await rm(temp,{recursive:true,force:true});}
});

test('background notification payload is displayed once; data-only payload uses worker',async()=>{
 const source=await readFile(path.join(project,'public/firebase-messaging-sw.js'),'utf8');
 const displays=[],handlers={};let background;
 const context={URL,importScripts:()=>{},clients:{},self:{location:{origin:'https://example.com',href:'https://example.com/firebase-messaging-sw.js'},addEventListener:(name,cb)=>handlers[name]=cb,registration:{showNotification:(...args)=>displays.push(args)}},firebase:{initializeApp:()=>{},messaging:()=>({onBackgroundMessage:cb=>background=cb})}};
 vm.runInNewContext(source,context);
 await background({notification:{title:'İhbar'},data:{type:'İHBAR'}});assert.equal(displays.length,0);
 await background({data:{title:'İhbar',body:'Masanıza dönün',type:'İHBAR',logId:'1'}});assert.equal(displays.length,1);
 assert.equal(displays[0][1].requireInteraction,true);assert.equal(typeof handlers.notificationclick,'function');
});
