import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {isActivityPhase,deskDisplayStatus} from '../src/activity-phase.js';
const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
test('faaliyet ilk 60 dakika mor etiket, ek mola sonraki sürede MOLADA',()=>{
 const now=Date.UTC(2026,10,24,12);const d={status:'on_break',breakType:'activity',breakStartedAt:now,breakEndTime:now+90*60000};
 assert.equal(isActivityPhase(d,now+30*60000),true);
 assert.equal(deskDisplayStatus(d,now+30*60000),'FAALİYETTE');
 assert.equal(isActivityPhase(d,now+65*60000),false);
 assert.equal(deskDisplayStatus(d,now+65*60000),'MOLADA');
 assert.equal(d.breakEndTime,now+90*60000);
});
test('yetkilendirilmiş lider kaldırma ve admin ihbarı sunucuda doğrulanır',()=>{
 const activity=read('../server/activity-module.js');const admin=read('../api/admin-desk.js');const ui=read('../kutuphaneprogramıguncell.jsx');
 assert.match(activity,/if \(!leader\.canRemoveActivities\)/);
 assert.match(activity,/a\.leaderId!==leader\.username/);
 assert.match(activity,/activity_removed_by_authorized_leader/);
 assert.match(admin,/desk\.status !== 'occupied'/);
 assert.match(admin,/tx\.update\(deskRef,\{status:'reported'/);
 assert.match(admin,/actorId:'ADMIN'/);
 assert.match(ui,/title:'Masanız İhbar Edildi!'/);
 assert.doesNotMatch(ui,/title:'Yönetici İhbar/);
});
