/**
 * SGM Google Forms -> Sunucu doğrulaması -> Yalnızca GM kodlarından oluşan Google Sheets.
 * BU BETİĞİ ANA GOOGLE FORMUNA BAĞLI APPS SCRIPT PROJESİNE EKLEYİN.
 * Script Properties:
 *   SGM_APP_URL                  https://KENDI-TEST-SITENIZ.vercel.app
 *   SGM_FORM_WEBHOOK_SECRET      Vercel ortamındaki aynı 32+ karakterlik gizli anahtar
 *   GM_CODES_SPREADSHEET_ID      Sadece liderlerin eriştiği kod takip tablosunun ID'si
 *   GM_CODE_QUESTION_TITLE       GM Özel Kod  (formdaki soru başlığıyla birebir aynı)
 *
 * Apps Script / Triggers: onMainFormSubmit -> From form -> On form submit
 * Optional safety reconciliation: reconcileRecentResponses -> Time-driven every hour.
 * Test ortamında ayrı Form, ayrı Google Sheet ve ayrı Vercel/Firebase kullanın.
 */
function onMainFormSubmit(e) {
  if (!e || !e.response) throw new Error('Google Form submit tetikleyicisini seçin.');
  transferSubmission_(e.response);
}

function transferSubmission_(formResponse) {
  const props=PropertiesService.getScriptProperties();
  const formTitle=props.getProperty('GM_CODE_QUESTION_TITLE') || 'GM Özel Kod';
  const answer=formResponse.getItemResponses().find(item=>item.getItem().getTitle().trim()===formTitle);
  const code=String(answer ? answer.getResponse() : '').trim();
  if (!/^\d{8}$/.test(code)) throw new Error('Yanıtta geçerli GM Özel Kod bulunamadı.');
  // Form ayarları > Yanıtlar > E-posta adreslerini topla > Doğrulanmış.
  // Formda doğrulanmış e-posta toplama açıksa aynı kişinin ikinci kaydı da engellenebilir.
  // Uygulama içinde Google giriş penceresi açılmaz.
  const email=String(formResponse.getRespondentEmail() || '').trim().toLowerCase();
  const submissionId=formResponse.getId();
  if (!/^[A-Za-z0-9_-]{8,160}$/.test(submissionId)) throw new Error('Google yanıt kimliği doğrulanamadı.');
  const sheetId=props.getProperty('GM_CODES_SPREADSHEET_ID');
  const secret=props.getProperty('SGM_FORM_WEBHOOK_SECRET');
  const appUrl=props.getProperty('SGM_APP_URL');
  if (!sheetId || !secret || secret.length<32 || !/^https:\/\//.test(appUrl||'')) {
    throw new Error('Script Properties eksik.');
  }
  const lock=LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const spreadsheet=SpreadsheetApp.openById(sheetId);
    const sheet=spreadsheet.getSheetByName('GM_Kodlar') || spreadsheet.insertSheet('GM_Kodlar');
    if(sheet.getLastRow()===0) sheet.appendRow(['GM Özel Kod','Gönderim tarihi','Google yanıt ID']);
    // Google Form yanıtı tekrar işlenirse Sheet'e aynı satır ikinci kez eklenmez.
    const existing=sheet.getLastRow()>1 ? sheet.getRange(2,3,sheet.getLastRow()-1,1).getValues().flat() : [];
    if (existing.includes(submissionId)) return;
    const timestamp=Date.now();
    const payload={action:'form_webhook',specialCode:code,submissionId,timestamp,email};
    const bytes=Utilities.computeHmacSha256Signature(`${timestamp}:${code}:${submissionId}${email ? `:${email}` : ''}`,secret);
    const signature=bytes.map(byte=>('0'+(byte&255).toString(16)).slice(-2)).join('');
    const res=UrlFetchApp.fetch(appUrl.replace(/\/$/,'')+'/api/student-register',{
      method:'post',contentType:'application/json',
      headers:{'x-sgm-form-signature':signature},
      payload:JSON.stringify(payload),muteHttpExceptions:true
    });
    const status=res.getResponseCode();
    if (status!==200) throw new Error('SGM API form doğrulaması başarısız: HTTP '+status+' '+res.getContentText().slice(0,150));
    const nextRow=sheet.getLastRow()+1;
    sheet.getRange(nextRow,1).setNumberFormat('@'); // 0 ile başlayan kodu koru.
    sheet.getRange(nextRow,1,1,3).setValues([[code,new Date(),submissionId]]);
  } finally {lock.releaseLock();}
}

// Ağ kesintilerinden sonra gönderilememiş yanıtlar için isteğe bağlı telafi.
function reconcileRecentResponses() {
  const form=FormApp.getActiveForm();
  if(!form) throw new Error('Betik ana Google Formuna bağlı olmalıdır.');
  const responses=form.getResponses();
  // İş yükünü sınırlamak için son 100 yanıtı inceler; eski yanıtlar manuel toplu işlenebilir.
  responses.slice(-100).forEach(response=>{
    try {transferSubmission_(response);} catch(err){console.error(response.getId()+': '+err.message);}
  });
}
