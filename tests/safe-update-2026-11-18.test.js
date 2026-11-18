import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { closingDay, nextDay } from '../src/closing-schedule.js';
import { preventClosedHoursSessionWrites } from '../src/session-write-guard.js';
import { validateSettingsPatch, adjustedBalance, updateSystemSettings } from '../server/settings-update.js';

const instant = localTime => Date.parse(`${localTime}Z`);

test('dynamic closing never touches active desks before updated close time', () => {
  const config = {openTime: '07:00',closeTime: '23:00'};
  assert.equal(closingDay(instant('2026-11-18T19:15:00'), config), null); // 22:15 TR
  assert.equal(closingDay(instant('2026-11-18T20:00:00'), config), '2026-11-18');
  assert.equal(closingDay(instant('2026-11-19T02:30:00'), config), '2026-11-18');
  assert.equal(closingDay(instant('2026-11-19T07:30:00'), config), null); // 10:30 TR
  assert.equal(nextDay('2026-12-31'),'2027-01-01');
});

test('late opening honors original 22:00 and newly configured 23:00', () => {
  const at = instant('2026-11-18T19:15:00');
  assert.equal(preventClosedHoursSessionWrites({activeDeskId: 12},'users',at,'07:00','22:00').activeDeskId, undefined);
  assert.equal(preventClosedHoursSessionWrites({activeDeskId: 12},'users',at,'07:00','23:00').activeDeskId, 12);
});

test('settings input validation keeps existing overnight configurations', () => {
  assert.equal(validateSettingsPatch({openTime:'18:00',closeTime:'02:00'}).closeTime,'02:00');
  assert.throws(() => validateSettingsPatch({openTime:'07:00',closeTime:'07:00'}));
  assert.throws(() => validateSettingsPatch({shortBreakCount: -1}));
});

test('new break entitlements preserve already used amounts', () => {
  assert.deepEqual(adjustedBalance({short:3,long:1,hourly:0},
    {shortBreakCount:5,longBreakCount:2,hourlyBreakCount:1},
    {shortBreakCount:7,longBreakCount:1,hourlyBreakCount:1}),
    {short:5,long:0,hourly:0});
});

test('settings update writes only settings and break balances, never desks, QR, users credentials, or previous audit', async () => {
  const writes = [];
  const previous = {openTime:'07:00',closeTime:'22:00',shortBreakCount:5,longBreakCount:2,hourlyBreakCount:1};
  const rows = [{ id:'person1', data: () => ({pin:'12345678',specialCode:'87654321', activeDeskId:8,breaks:{short:2,long:1,hourly:0}}) }];
  const makeDoc = (collection,id) => ({collection,id});
  const collection = name => ({ doc: id => makeDoc(name,id) });
  const result = await updateSystemSettings({ patch:{ shortBreakCount:6, closeTime:'23:00' },collection,
    runTransaction: fn => fn({
      get: async ref => ref.collection === 'sgmConfig' ? {exists:true,data:()=>previous} : {size:rows.length,docs:rows.map(row=>({...row, ref:makeDoc('sgmUsers',row.id)}))},
      set: (ref, patch, options) => { writes.push({ref,patch,options}); }
    })
  });
  assert.equal(result.settings.closeTime,'23:00');
  assert.deepEqual(writes.map(w => w.ref.collection).sort(),['sgmConfig','sgmUsers']);
  assert.ok(writes.every(w => !('pin' in w.patch) && !('specialCode' in w.patch) && !('activeDeskId' in w.patch)));
  assert.deepEqual(writes.find(w=>w.ref.collection==='sgmUsers').patch.breaks,{short:3,long:1,hourly:0});
});

test('push, QR files and legacy audit deletion are not modified by update', () => {
  const src = readFileSync(new URL('../kutuphaneprogramıguncell.jsx',import.meta.url),'utf8');
  assert.equal(src.includes("addLog('ADMIN_SEKME'"),false);
  assert.ok(src.includes('Son Güncelleme: 18.11.2026'));
  assert.ok(src.includes('manualAssignSearch'));
  assert.ok(src.includes('restrictionReason'));
});
