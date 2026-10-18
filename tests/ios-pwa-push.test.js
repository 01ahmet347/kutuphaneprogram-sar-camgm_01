import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { isAppleMobileDevice, isHomeScreenApp, applePushInstallGuidance } from '../src/pwa-support.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const iosSafari = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X)' };
test('iOS Safari instructions only outside the Home Screen app', () => {
  assert.equal(isAppleMobileDevice(iosSafari), true);
  assert.equal(isAppleMobileDevice({platform:'MacIntel', maxTouchPoints:5}), true);
  assert.equal(isAppleMobileDevice({userAgent:'Mozilla/5.0 (Linux; Android 15)'}), false);
  assert.equal(isHomeScreenApp({navigatorStandalone:true}), true);
  assert.match(applePushInstallGuidance(iosSafari), /Ana Ekrana Ekle/);
  assert.equal(applePushInstallGuidance({...iosSafari,navigatorStandalone:true}), '');
  assert.equal(applePushInstallGuidance({...iosSafari,displayModeStandalone:true}), '');
  assert.equal(applePushInstallGuidance({userAgent:'Android'}), '');
});

test('manifest and Apple touch icon are served as static assets', async () => {
  const manifest = JSON.parse(await readFile(path.join(root, 'public/manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.display,'standalone');
  assert.equal(manifest.start_url,'/');
  assert.equal(manifest.scope,'/');
  assert.ok(manifest.icons.some(icon => icon.sizes === '192x192'));
  assert.ok(manifest.icons.some(icon => icon.sizes === '512x512'));
  const html = await readFile(path.join(root,'index.html'),'utf8');
  assert.match(html,/rel="manifest" href="\/manifest.webmanifest"/);
  assert.match(html,/rel="apple-touch-icon"/);
  for (const filename of ['sgm-192.png','sgm-512.png','apple-touch-icon.png']) {
    const bytes = await readFile(path.join(root,'public/icons',filename));
    assert.equal(bytes.toString('hex',0,8),'89504e470d0a1a0a');
  }
});

test('existing live desk, permissions, restriction and push server files stay untouched',async()=>{
  const jsx = await readFile(path.join(root,'kutuphaneprogramıguncell.jsx'),'utf8');
  const block = jsx.substring(jsx.indexOf('const registerPhonePush ='),jsx.indexOf('// Öğrenci sisteme giriş yaptığında daha önce bildirim izni'));
  assert.ok(block.indexOf("4_ios_bildirim_izni_isteniyor") < block.indexOf("2_fcm_destegi_kontrol_ediliyor"));
  assert.match(jsx,/currentApplePushInstallGuidance\(\)/);
  assert.match(jsx,/from '\.\/src\/restriction-policy\.js'/);
});
