import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import handler from '../api/server-time.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function request(method, query = {}) {
  const headers = {};
  const result = { headers, statusCode: null, body: null };
  const response = {
    setHeader(name, value) { headers[name] = value; return this; },
    status(code) { result.statusCode = code; return this; },
    json(body) { result.body = body; return this; }
  };
  handler({ method, query }, response);
  return result;
}

test('Vercel Hobby has 12 or fewer API entry points', () => {
  const functions = readdirSync(resolve(root, 'api')).filter(f => f.endsWith('.js'));
  assert.equal(functions.length, 12);
});

test('public /api/version URL is preserved with rewrite', () => {
  const config = JSON.parse(readFileSync(resolve(root, 'vercel.json'), 'utf8'));
  assert.ok(config.rewrites.some(r => r.source === '/api/version' && r.destination === '/api/server-time?route=version'));
  const response = request('GET', { route: 'version' });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.version, '2026.10.07.1');
  assert.ok(typeof response.body.commit === 'string');
  assert.equal(response.headers['Cache-Control'], 'no-store');
});

test('student break timer server-time response remains unchanged', () => {
  const before = Date.now();
  const response = request('GET');
  const after = Date.now();
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.ok, true);
  assert.ok(response.body.at >= before && response.body.at <= after);
  assert.equal(response.headers['Cache-Control'], 'no-store, no-cache, must-revalidate');
  assert.equal(request('POST').statusCode, 405);
});
