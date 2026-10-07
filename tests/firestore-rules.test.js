import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');

test('Firestore rules grant global access only to admin custom claims', () => {
  assert.match(rules, /function isAdmin\(\)[\s\S]*?request\.auth\.token\.admin == true/);
  assert.match(rules, /match \/artifacts\/\{appId\}\/public\/data\/sgmUsers\/\{userId\}[\s\S]*?allow list: if isAdmin\(\);[\s\S]*?allow write: if isAdmin\(\);/);
  assert.match(rules, /match \/artifacts\/\{appId\}\/public\/data\/\{collection\}\/\{documentId\}[\s\S]*?allow read, write: if isAdmin\(\);/);
});

test('student Firestore access is bound to the matching UID and does not grant writes', () => {
  assert.match(rules, /function isStudent\(userId\)[\s\S]*?request\.auth\.token\.role == 'student'[\s\S]*?request\.auth\.uid == userId/);
  assert.match(rules, /match \/artifacts\/\{appId\}\/public\/data\/sgmUsers\/\{userId\}[\s\S]*?allow get: if isAdmin\(\) \|\| isStudent\(userId\);[\s\S]*?allow list: if isAdmin\(\);[\s\S]*?allow write: if isAdmin\(\);/);
  assert.match(rules, /match \/artifacts\/\{appId\}\/public\/data\/sgmMessages\/\{userId\}[\s\S]*?allow get: if isAdmin\(\) \|\| isStudent\(userId\);[\s\S]*?allow write: if isAdmin\(\);/);
  assert.match(rules, /match \/\{document=\*\*\}[\s\S]*?allow read, write: if false;/);
  assert.doesNotMatch(rules, /allow read, write: if request\.auth != null/);
});
