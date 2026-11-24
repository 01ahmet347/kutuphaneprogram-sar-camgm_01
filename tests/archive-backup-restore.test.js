import test from 'node:test';
import assert from 'node:assert/strict';
import { makeArchiveBackup, inspectArchiveBackup } from '../src/archive-backup.js';
test('each archive bucket exports validated versioned backup', () => {
 for (const bucket of ['logs', 'violations', 'feedback']) {
  const doc = makeArchiveBackup(bucket, [{id:'record-1',time:1763900000000,message:'korunacak'}]);
  assert.equal(inspectArchiveBackup(JSON.parse(JSON.stringify(doc)), bucket).records.length, 1);
 }
});
test('cross-section imports and invalid content are rejected', () => {
 const backup = makeArchiveBackup('logs', [{id:'safe',time:100}]);
 assert.throws(() => inspectArchiveBackup(backup,'violations'));
 assert.throws(() => inspectArchiveBackup({...backup,records:[{id:'x/y',time:100}]},'logs'));
 assert.throws(() => inspectArchiveBackup({...backup,records:[{id:'x',time:100},{id:'x',time:100}]},'logs'));
});
