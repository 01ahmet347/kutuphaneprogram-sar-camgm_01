import { timingSafeEqual, createHash } from 'node:crypto';
import { getAuth } from 'firebase-admin/auth';
import { adminApp } from '../server/firebase-admin.js';
import { activateAdminSession } from '../server/admin-session.js';
import { leaderLogin } from '../server/leader-auth.js';
const equal = (a, b) => timingSafeEqual(createHash('sha256').update(String(a)).digest(), createHash('sha256').update(String(b)).digest());
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ ok: false }); }
  if (req.body?.role === 'leader') {
    try {
      const result = await leaderLogin({
        username: req.body?.username, password: req.body?.password,
        clientAddress: req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown',
        createToken: (uid, claims) => getAuth(adminApp()).createCustomToken(uid, claims)
      });
      return res.status(200).json({ok:true,...result});
    } catch(error) {
      if (!error.status) console.error('Leader login error:',error.code || 'unknown');
      return res.status(error.status || 503).json({ok:false,error:'leader_login_failed',message:error.status ? error.message : 'Lider giriş servisine ulaşılamadı.'});
    }
  }
  const expectedUser = process.env.ADMIN_USERNAME, expectedPassword = process.env.ADMIN_PASSWORD;
  if (!expectedUser || !expectedPassword) return res.status(503).json({ ok: false, error: 'admin_auth_not_configured', message: 'Vercel’de ADMIN_USERNAME ve ADMIN_PASSWORD tanımlanmalı; ardından yeniden Deploy yapılmalı.' });
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string' || username.length > 256 || password.length > 1024 || !equal(username, expectedUser) || !equal(password, expectedPassword)) {
    return res.status(401).json({ ok: false, error: 'invalid_credentials', message: 'Yönetici kullanıcı adı veya şifresi yanlış.' });
  }
  try {
    const token = await activateAdminSession((uid, claims) => getAuth(adminApp()).createCustomToken(uid, claims));
    return res.status(200).json({ ok: true, token });
  } catch (error) {
    console.error('Admin login configuration error:', error.code || 'unknown');
    return res.status(503).json({ ok: false, error: 'server_not_configured', message: 'Firebase sunucu ayarları veya servis hesabı yetkileri eksik. Vercel ortam değişkenlerini kontrol edin.' });
  }
}
