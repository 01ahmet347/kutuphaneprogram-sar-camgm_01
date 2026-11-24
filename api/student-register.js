import { verifyFormSignature } from '../server/form-signature.js';
import { acceptFormSubmission } from '../server/form-verification.js';
import { createHash } from 'node:crypto';
import { validRegistrationDevice, registrationDeviceHash } from '../server/registration-device-policy.js';
import { getAuth } from 'firebase-admin/auth';
import { adminApp, dataCollection } from '../server/firebase-admin.js';
import {
  createStudentRecord,
  createStudentRegistrationHandler,
  generateStudentCredential
} from '../server/student-registration.js';

// Kayıt hatasının ayrıntısını yalnızca sunucu loglarına yazar.
function registrationDiagnostic(stage, action) {
  return async (...args) => {
    try {
      return await action(...args);
    } catch (error) {
      const message = String(error?.message || 'Hata mesajı bulunamadı.')
        .replace(/-----BEGIN[\s\S]*?-----END[^\r\n]*-----/g, '[GİZLİ ANAHTAR]')
        .replace(/Bearer\s+\S+/gi, 'Bearer [GİZLİ]')
        .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[GİZLİ TOKEN]')
        .slice(0, 500);

      console.error('[SGM öğrenci kayıt ayrıntısı]', {
        stage,
        code: error?.code ?? 'kod_yok',
        name: error?.name || 'Error',
        message,
        configured: {
          FIREBASE_ADMIN_PROJECT_ID: Boolean(process.env.FIREBASE_ADMIN_PROJECT_ID),
          FIREBASE_ADMIN_CLIENT_EMAIL: Boolean(process.env.FIREBASE_ADMIN_CLIENT_EMAIL),
          FIREBASE_ADMIN_PRIVATE_KEY: Boolean(process.env.FIREBASE_ADMIN_PRIVATE_KEY),
          FIREBASE_APP_ID: Boolean(process.env.FIREBASE_APP_ID || process.env.VITE_FIREBASE_APP_ID)
        }
      });

      throw error;
    }
  };
}

// Kimlik yalnızca doğrulanmış token'dan alınır; istemci userId seçemez.
const registrationIdentityKey = Symbol('verifiedRegistrationIdentity');
async function verifyAnonymousUser(req) {
  if (Object.prototype.hasOwnProperty.call(req, registrationIdentityKey)) {
    return req[registrationIdentityKey]?.uid || null;
  }
  const token = /^Bearer\s+(.+)$/i.exec(req.headers?.authorization || '')?.[1];
  if (!token) return null;
  const decoded = await getAuth(adminApp()).verifyIdToken(token);
  const provider = decoded.firebase?.sign_in_provider;
  const verifiedGoogle = provider === 'google.com' && decoded.email_verified === true &&
    typeof decoded.email === 'string' && decoded.email.includes('@');
  const identity = provider === 'anonymous' || verifiedGoogle ?
    {uid:decoded.uid,email:verifiedGoogle?decoded.email.trim().toLowerCase():null} : null;
  req[registrationIdentityKey] = identity;
  return identity?.uid || null;
}

function registrationResult(user, uid) {
  if (user.id != null && String(user.id) !== String(uid)) {
    throw new Error('Kayıt belgesi doğrulanmış oturumla eşleşmiyor.');
  }
  const specialCode = String(user.specialCode || '');
  const pin = String(user.pin || '');
  if (!/^\d{8}$/.test(specialCode) || !/^\d{8}$/.test(pin)) {
    throw new Error('Mevcut hesabın GM Özel Kod veya şifre bilgisi eksik. Sorumlu kontrolü gereklidir.');
  }
  const { pin: _pin, ...profile } = user;
  return { user: { ...profile, id: uid }, credentials: { specialCode, pin } };
}

const handler = createStudentRegistrationHandler({
  verifyAnonymousUser: registrationDiagnostic('oturum_dogrulama', verifyAnonymousUser),

  isRateLimited: registrationDiagnostic('kayit_limiti', async req => {
    // Aynı hesabın bilgilerinin yeniden getirilmesi yeni hesap oluşturma sayılmaz.
    const uid = await verifyAnonymousUser(req);
    if (uid) {
      const existing = await dataCollection('sgmUsers').doc(uid).get();
      if (existing.exists) return false;
    }

    const clientAddress =
      req.headers?.['x-vercel-forwarded-for'] ||
      req.headers?.['x-forwarded-for']?.split(',')[0]?.trim() ||
      req.socket?.remoteAddress ||
      'unknown';

    // Shared Wi-Fi: ten tries are counted per verified anonymous device,
    // with a higher shared-network abuse ceiling retained for protection.
    const ipHash = createHash('sha256').update(String(clientAddress)).digest('hex');
    const key = createHash('sha256').update(`${ipHash}:${uid}`).digest('hex');
    const ref = dataCollection('sgmRegistrationAttempts').doc(key);
    const networkRef = dataCollection('sgmRegistrationAttempts').doc(`network-${ipHash}`);
    const at = Date.now();

    return ref.firestore.runTransaction(async tx => {
      const [snapshot, networkSnapshot] = await Promise.all([tx.get(ref), tx.get(networkRef)]);
      const previous = snapshot.data() || {};
      const network = networkSnapshot.data() || {};
      const windowStart = Number(previous.windowStart || 0);
      const networkStart = Number(network.windowStart || 0);
      const attempts = windowStart > at - 60 * 60 * 1000
        ? Number(previous.attempts || 0) + 1 : 1;
      const networkAttempts = networkStart > at - 60 * 60 * 1000
        ? Number(network.attempts || 0) + 1 : 1;
      tx.set(ref, { attempts, windowStart: attempts === 1 ? at : windowStart, updatedAt: at });
      tx.set(networkRef, { attempts: networkAttempts,
        windowStart: networkAttempts === 1 ? at : networkStart, updatedAt: at });
      return attempts > 10 || networkAttempts > 100;
    });
  }),

  createStudent: registrationDiagnostic('hesap_olusturma', async (uid, req) => {
    const authCodes = dataCollection('sgmAuthCodes');
    const email = req[registrationIdentityKey]?.email || null;
    const emailHash = email ? createHash('sha256').update(email).digest('hex') : null;
    const emailRef = emailHash ? dataCollection('sgmRegistrationEmails').doc(emailHash) : null;
    const requestedDevice = req.body?.deviceId;
    const deviceHash = validRegistrationDevice(requestedDevice) ? registrationDeviceHash(requestedDevice) : null;
    const deviceRef = deviceHash ? dataCollection('sgmRegistrationDevices').doc(deviceHash) : null;
    const users = dataCollection('sgmUsers');
    const config = await dataCollection('sgmConfig').doc('settings').get();
    const settings = config.data() || {};

    for (let attempt = 0; attempt < 12; attempt++) {
      const specialCode = generateStudentCredential();
      const pin = generateStudentCredential();
      const user = createStudentRecord({ uid, specialCode, pin, settings });
      if (emailHash) { user.verifiedEmailHash=emailHash; user.formGateEmailRequired=true; }
      if (deviceHash) user.registrationDeviceHash=deviceHash;

      const result = await users.firestore.runTransaction(async tx => {
        const userRef = users.doc(uid);
        const userSnap = await tx.get(userRef);
        const emailSnap = emailRef ? await tx.get(emailRef) : null;
        const deviceSnap = deviceRef ? await tx.get(deviceRef) : null;
        const deletedSnap = await tx.get(dataCollection('sgmDeletedUsers').doc(uid));
        if (deletedSnap.exists) throw Object.assign(new Error('Silinmiş hesap yeniden oluşturulamaz.'), {
          status:410, code:'deleted_account', publicMessage:'Bu hesap daha önce silinmiş. Kütüphane sorumlusuyla görüşün.'});

        // Yeniden denemede hesabı, şifreyi, onayı ve kısıtları aynen koru.
        if (userSnap.exists) {
          const existingUser = userSnap.data();
          const existingResult = registrationResult(existingUser, uid);
          const existingCodeRef = authCodes.doc(existingResult.credentials.specialCode);
          const existingCodeSnap = await tx.get(existingCodeRef);
          if (existingCodeSnap.exists && existingCodeSnap.data()?.userId !== uid) {
            throw new Error('Mevcut GM Özel Kod başka hesaba bağlı. Sorumlu kontrolü gereklidir.');
          }
          // Eski kayıtta eksik kod eşleştirmesi varsa aynı hesabı onar.
          if (!existingCodeSnap.exists) {
            tx.create(existingCodeRef, { userId: uid, createdAt: Date.now() });
          }
          return existingResult;
        }

        // Uygulama kaydı anonim Firebase oturumuyla yapılır; Google ile uygulama girişi istenmez.
        // Doğrulanmış e-posta, varsa ANA GOOGLE FORM'un gönderiminde bağlanır.
        if (emailSnap?.exists) throw Object.assign(new Error('E-posta daha önce kullanılmış.'), {
          status:409, code:'email_already_registered', publicMessage:'Bu e-posta ile zaten kayıt oluşturulmuş. Yeni kod üretilemez; mevcut hesabınızla giriş yapın.'});
        if (!deviceHash) throw Object.assign(new Error('Tarayıcı kayıt kimliği oluşturulamadı.'), {
          status:400,code:'device_id_required',publicMessage:'Bu tarayıcıda cihaz tanımlaması yapılamadı. Gizli sekme yerine normal sekmede tekrar deneyin.'});
        // Cihaz kaydı ancak bağlı hesap hâlâ mevcutsa ikinci kaydı engeller.
        // Silinmiş hesaba ait eski işaret yeni öğrenciyi haksız yere engellemez.
        let deviceOwnerActive = false;
        if (deviceSnap?.exists && deviceSnap.data()?.userId !== uid) {
          const ownerId = deviceSnap.data()?.userId;
          if (typeof ownerId === 'string' && ownerId && !ownerId.includes('/')) {
            const [owner, ownerDeleted] = await Promise.all([
              tx.get(users.doc(ownerId)), tx.get(dataCollection('sgmDeletedUsers').doc(ownerId))
            ]);
            deviceOwnerActive = owner.exists && !ownerDeleted.exists;
          }
        }
        if (deviceOwnerActive || (deviceSnap?.exists && deviceSnap.data()?.userId === uid)) {
          throw Object.assign(new Error('Bu tarayıcıda daha önce kayıt oluşturulmuş.'), {
            status:409,code:'device_already_registered',publicMessage:'Bu tarayıcıya bağlı mevcut bir hesap var. Yeni GM Özel Kod üretilmedi. Mevcut kod ve şifrenizle giriş yapın; kaybettiyseniz liderle görüşün.'});
        }
        const codeRef = authCodes.doc(specialCode);
        const codeSnap = await tx.get(codeRef);
        if (codeSnap.exists) return null;
        const newResult = registrationResult(user, uid);
        tx.create(codeRef, { userId: uid, createdAt: Date.now() });
        tx.create(userRef, user);
        if (emailRef && !emailSnap?.exists) tx.create(emailRef, {userId:uid,createdAt:Date.now()});
        if (deviceSnap?.exists) tx.set(deviceRef, {userId:uid,createdAt:Date.now()});
        else tx.create(deviceRef, {userId:uid,createdAt:Date.now()});
        return newResult;
      });

      if (result) return result;
    }
    throw new Error('Unable to allocate unique student credentials.');
  })
});

export default async function registrationWithFormWebhook(req,res) {
  if(req.method === 'POST' && req.body?.action === 'recover_existing') {
    res.setHeader('Cache-Control','no-store');
    try {
      const uid=await verifyAnonymousUser(req);
      if(!uid) return res.status(401).json({ok:false,exists:false});
      const user=await dataCollection('sgmUsers').doc(uid).get();
      const deleted=await dataCollection('sgmDeletedUsers').doc(uid).get();
      return res.status(200).json({ok:true,exists:user.exists&&!deleted.exists});
    } catch(error) {return res.status(503).json({ok:false,message:'Mevcut kayıt kontrol edilemedi.'});}
  }
  if(req.method === 'POST' && req.body?.action === 'form_webhook') {
    res.setHeader('Cache-Control','no-store');
    const {specialCode,submissionId,timestamp,email} = req.body || {};
    const signature = req.headers?.['x-sgm-form-signature'];
    const secret = process.env.SGM_FORM_WEBHOOK_SECRET;
    if (!verifyFormSignature({secret,timestamp,code:specialCode,submissionId,email,signature})) {
      return res.status(401).json({ok:false,error:'invalid_form_signature'});
    }
    try {
      const result=await acceptFormSubmission({code:specialCode,submissionId,email});
      return res.status(200).json({ok:true,...result});
    } catch(error) {
      if (!error.status) console.error('Form webhook error:',error.code||error.message);
      return res.status(error.status||503).json({ok:false,error:'form_submission_failed',message:error.status?error.message:'Form doğrulanamadı.'});
    }
  }
  return handler(req,res);
}
