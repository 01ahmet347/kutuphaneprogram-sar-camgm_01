import { createHash } from 'node:crypto';
import { dataCollection } from './firebase-admin.js';
import { isFormGatePending } from './form-status.js';
import { validGMCode } from './form-signature.js';
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
export async function acceptFormSubmission({code,submissionId,email,collection=dataCollection,now=Date.now}) {
  if (!validGMCode(code) || !/^[\w-]{8,160}$/.test(String(submissionId||''))) throw fail('Geçersiz form yanıtı.');
  const codeRef=collection('sgmAuthCodes').doc(code);
  const submissionRef=collection('sgmFormSubmissions').doc(submissionId);
  return codeRef.firestore.runTransaction(async tx=>{
    const [codeSnap, prior] = await Promise.all([tx.get(codeRef),tx.get(submissionRef)]);
    if (prior.exists) {
      if(prior.data()?.code!==code) throw fail('Form yanıt kimliği başka bir GM Özel Koda ait.',409);
      return {accepted:true,duplicate:true};
    }
    const uid=codeSnap.data()?.userId;
    if (!codeSnap.exists || !uid) throw fail('GM Özel Kod bulunamadı.',404);
    const userRef=collection('sgmUsers').doc(uid);
    const tombstoneRef=collection('sgmDeletedUsers').doc(uid);
    const [userSnap,tombstone]=await Promise.all([tx.get(userRef),tx.get(tombstoneRef)]);
    const user=userSnap.data();
    if (!userSnap.exists || tombstone.exists || user.specialCode!==code) throw fail('Kullanıcı veya kod uyuşmuyor.',409);
    // Aynı hesap için yeni bir Form yanıtı ikinci kez doğrulanamaz.
    // Aynı submissionId ise yukarıdaki idempotent yol çalışır.
    if (user.formGateEnabled === true && user.registrationFormStatus === 'verified') {
      throw fail('Bu GM Özel Kod ile Google Form zaten doğrulanmış. Tekrar kayıt yapılmaz.',409);
    }
    const at=now();
    // Yeni Google kayıtlarında Form'un doğrulanmış yanıt e-postası, kayıt
    // sırasında Google ile doğrulanan adresle aynı olmalıdır.
    const emailHash=typeof email==='string' && email.includes('@') ?
      createHash('sha256').update(email.trim().toLowerCase()).digest('hex') : null;
    // Google Form doğrulanmış e-posta gönderiyorsa, aynı e-postaya ikinci
    // doğrulanmış kayıt açılmaz. Google uygulama girişi gerekmez.
    // Önceki Google kayıtlarında eşleşme zorunluluğu aynen korunur.
    if (user.formGateEmailRequired === true &&
        (!emailHash || (user.verifiedEmailHash && emailHash !== user.verifiedEmailHash))) {
      throw fail('Form e-postası kayıtlı doğrulanmış e-postayla eşleşmiyor.',409);
    }
    if (emailHash) {
      const formEmailRef=collection('sgmFormEmails').doc(emailHash);
      const registrationEmailRef=collection('sgmRegistrationEmails').doc(emailHash);
      const [priorFormEmail,priorRegistrationEmail]=await Promise.all([
        tx.get(formEmailRef),tx.get(registrationEmailRef)
      ]);
      if (priorFormEmail.exists && priorFormEmail.data()?.userId!==uid ||
          priorRegistrationEmail.exists && priorRegistrationEmail.data()?.userId!==uid) {
        throw fail('Bu e-postayla başka bir hesap doğrulanmış. Yeni kayıt kabul edilmez.',409);
      }
      if (!priorFormEmail.exists) tx.create(formEmailRef,{userId:uid,firstSubmissionId:submissionId,receivedAt:at});
      if (!priorRegistrationEmail.exists) tx.create(registrationEmailRef,{userId:uid,createdAt:at});
    }
    // Önceki hesaplar ile yöneticinin elle uyguladığı cezalar asla otomatik açılmaz.
    if (user.formGateEnabled === true && user.registrationFormStatus !== 'verified') {
      tx.update(userRef,{registrationFormStatus:'verified',formVerifiedAt:at,formSubmissionId:submissionId,
        ...(emailHash ? {verifiedEmailHash:emailHash} : {}),
        pendingApproval:false,restrictionReason:user.pendingApproval ? '' : user.restrictionReason || '',
        leaderReviewStatus:'pending'});
    }
    tx.create(submissionRef,{code,userId:uid,receivedAt:at});
    return {accepted:true,duplicate:false};
  });
}
