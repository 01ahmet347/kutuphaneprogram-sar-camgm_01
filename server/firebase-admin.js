import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

export function adminApp() {
  const existing = getApps().find(app => app.name === 'sgm-server');
  if (existing) return existing;
  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  const privateKey = String(process.env.FIREBASE_ADMIN_PRIVATE_KEY || '').replace(/^"(.*)"$/s, '$1').replace(/\\n/g, '\n');
  if (!projectId || !clientEmail || !privateKey) {
    const error = new Error('Firebase sunucu ayarları eksik. Vercel ortam değişkenlerini kontrol edin.');
    error.code = 'server_not_configured';
    throw error;
  }
  return initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) }, 'sgm-server');
}

export function dataCollection(name) {
  const appId = process.env.FIREBASE_APP_ID || process.env.VITE_FIREBASE_APP_ID;
  if (!appId) throw new Error('FIREBASE_APP_ID eksik; mevcut veri yolu korunmalıdır.');
  return getFirestore(adminApp()).collection('artifacts').doc(appId).collection('public').doc('data').collection(name);
}

export async function authenticate(req) {
  const token = /^Bearer (.+)$/.exec(String(req.headers.authorization || ''))?.[1];
  if (!token) throw Object.assign(new Error('Oturum doğrulanamadı.'), { status: 401 });
  try { return await getAuth(adminApp()).verifyIdToken(token); }
  catch (error) {
    if (error.code === 'server_not_configured') throw error;
    throw Object.assign(new Error('Oturum doğrulanamadı.'), { status: 401 });
  }
}
