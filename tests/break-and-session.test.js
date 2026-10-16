import test from 'node:test';
import assert from 'node:assert/strict';
import { createCloudActions } from '../src/cloud-transactions.js';
import { allowedBreakCount, allowedBreakDuration, dailyBreakState, isHourlyBreakAvailable } from '../src/break-policy.js';
import { withoutSessionWrites, isDeskOwnedByUser, safeBreakCountdown } from '../src/authoritative-session.js';
import { releasedDeskUserPatch } from '../server/desk-integrity.js';

const friday = Date.parse('2026-10-16T10:00:00Z');
const thursday = friday - 86400000;
const settings = {
  shortBreakCount: 5, longBreakCount: 2, shortBreakDuration: 15,
  longBreakDuration: 30, hourlyBreakCount: 1, hourlyBreakDuration: 60,
  hourlyBreakEnabled: true, breakCooldown: 30
};

function fixture(at = friday) {
  const id = 'u1';
  const map = new Map([
    ['sgmUsers/u1', { id, activeDeskId: 30, breaks: { short: 5, long: 2 },
      breaksResetDate: '2026-10-16', lastActiveTime: at - 3600000,
      violationsResetDate: '2026-10-16', strikes: 0 }],
    ['sgmDesks/30', { id: 30, occupant: id, status: 'occupied', sessionStartTime: at - 3700000,
      qrCode: 'QR-30-test' }]
  ]);
  const ref = (col, id) => `${col}/${id}`;
  const runTransaction = async (_, callback) => {
    const writes = [];
    const result = await callback({
      async get(key) { const record = map.get(key); return { exists: () => record !== undefined,
        data: () => structuredClone(record), ref: key }; },
      set(key, value) { writes.push([key, structuredClone(value)]); }
    });
    writes.forEach(([key, value]) => map.set(key, value));
    return result;
  };
  let clock = at;
  const actions = createCloudActions({ db: {}, runTransaction, ref, settings: () => settings,
    dayKey: () => '2026-10-16', now: () => clock, isRestricted: () => false,
    lostDeskToday: () => false, applyViolationPolicy: () => ({}) });
  return { map, actions, setClock: value => { clock = value; } };
}

test('one hour break is visible on Fridays only and is independent of the other breaks', () => {
  assert.equal(isHourlyBreakAvailable(settings, friday), true);
  assert.equal(isHourlyBreakAvailable(settings, thursday), false);
  assert.equal(allowedBreakCount(settings, 'hourly', friday), 1);
  assert.equal(allowedBreakCount(settings, 'hourly', thursday), 0);
  assert.equal(allowedBreakDuration(settings, 'long'), 30);
  assert.equal(allowedBreakDuration(settings, 'hourly'), 60);
  assert.equal(dailyBreakState({breaksResetDate: '2026-10-15', breaks: {short: 0}}, settings, friday).breaks.hourly, 1);
  assert.equal(dailyBreakState({breaksResetDate: '2026-10-16', breaks: {short: 4,long:1,hourly:0}}, settings, friday).breaks.hourly, 0);
});

test('a single 60-minute Friday break debits only once across retries', async () => {
  const { map, actions } = fixture();
  const input = { userId: 'u1', deskId: 30, type: 'hourly', requestId: 'req-unique' };
  const first = await actions.startBreak(input);
  assert.equal(first.desk.breakEndTime - first.at, 3600000);
  assert.equal(map.get('sgmUsers/u1').breaks.hourly, 0);
  const retry = await actions.startBreak(input);
  assert.equal(retry.alreadyApplied, true);
  assert.equal(map.get('sgmUsers/u1').breaks.hourly, 0);
  await assert.rejects(actions.startBreak({...input,requestId:'second-request'}),/aktif olmalısınız/);
});

test('verified early interruption refunds once without touching a new owner', async () => {
  const { map, actions, setClock } = fixture();
  await actions.startBreak({userId:'u1',deskId:30,type:'short',requestId:'bad-timer'});
  const desk = map.get('sgmDesks/30');
  map.set('sgmDesks/30', {...desk, breakEndTime: null});
  setClock(friday + 1000);
  const recovered = await actions.repairInterruptedBreak({userId:'u1',deskId:30});
  assert.equal(recovered.refunded, true);
  assert.equal(map.get('sgmUsers/u1').breaks.short, 5);
  assert.equal(map.get('sgmDesks/30').status, 'occupied');
  const again = await actions.repairInterruptedBreak({userId:'u1',deskId:30});
  assert.equal(again.alreadyApplied, true);
  assert.equal(map.get('sgmUsers/u1').breaks.short, 5);
});

test('legitimate QR return never refunds; another owner cannot use old account', async () => {
  const { map, actions } = fixture();
  await actions.startBreak({userId:'u1',deskId:30,type:'long',requestId:'normal'});
  await actions.endBreak({userId:'u1',deskId:30,qrCode:'QR-30-test'});
  assert.equal(map.get('sgmUsers/u1').breaks.long, 1);
  await assert.rejects(actions.repairInterruptedBreak({userId:'u1',deskId:30}),/erken sistem hatası/);
  assert.equal(isDeskOwnedByUser({id:30, occupant:'u2'}, {id:'u1', activeDeskId:30}), false);
  assert.equal(releasedDeskUserPatch({activeDeskId:30},30).activeDeskId,null);
});

test('admin stale snapshots cannot write ownership, timer or daily quota', () => {
  const next = withoutSessionWrites({activeDeskId:30,breaks:{short:9},name:'User'}, 'users');
  assert.deepEqual(next,{name:'User'});
  const desk = withoutSessionWrites({status:'on_break',occupant:'u1',breakEndTime:0,qrCode:'QR-30'},'desks');
  assert.deepEqual(desk,{qrCode:'QR-30'});
  assert.deepEqual(safeBreakCountdown({breakEndTime: null}, friday), {kind:'invalid',remaining:null});
  assert.equal(safeBreakCountdown({breakEndTime: friday - 1000}, friday).kind, 'expired');
});
