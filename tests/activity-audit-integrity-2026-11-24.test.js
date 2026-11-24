import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../server/activity-module.js', import.meta.url), 'utf8');
test('Faaliyet hareketleri hem kendi arşivine hem ana sistem auditine atomik yazılır', () => {
  assert.match(source, /tx\.create\(audit\.doc\(id\)/);
  assert.match(source, /tx\.create\(systemAudit\.doc\(`activity-\$\{id\}`\)/);
  assert.match(source, /studentCode:a\.studentCode/);
  assert.match(source, /studentCode:app\.studentCode/);
  assert.match(source, /durationMinutes: data\.duration/);
});
test('Ek mola, başvuru ve onay işlemlerinin türleri ayrı ayrı loglanır', () => {
  for (const key of ['application_created','application_approved','application_rejected','activity_break_appended']) {
    assert.match(source, new RegExp(key+':'));
  }
});
