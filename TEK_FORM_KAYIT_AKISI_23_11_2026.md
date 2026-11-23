# Sarıçam GM – Tek Form Kayıt Akışı (TEST, 2026.11.23.2)

Bu paket, kullanıcının son gönderdiği `Saricam_GM_Kayit_Guvenligi_Eklenmis_23_11_2026_TEST.zip` üzerine **kayıt akışını eski kullanım biçimine döndürmek** amacıyla hazırlandı. Canlı Firebase'e bağlanılmadı, öğrenci hesabı veya Firestore kaydı değiştirilmedi. Mevcut masa, QR, ihbar, ceza, mola, faaliyet ve kapanış dosyaları değiştirilmedi.

## İstenen öğrenci akışı

1. **Kayıt Ol** → kütüphane kurallarını kabul et.
2. Firebase'in **anonim kayıt oturumu** ile tek GM Özel Kod + 8 haneli şifre üret. **Uygulamada Google hesabı giriş penceresi açılmaz.**
3. Öğrenci **tek Ana Google Form** doldurur; formdaki `GM Özel Kod` sorusuna üretilen 8 haneli kodu yazar.
4. Ana Form'a bağlı Apps Script, yanıtı gizli imzayla `/api/student-register` adresine gönderir. Sunucu kodun kayıtlı hesapla eşleşmesini doğrular ve formu onaylar. **İkinci Google Sheets kod listesi** yalnızca onaylanan yanıtın GM Özel Kodunu alır. Öğrenci ikinci bir form doldurmaz.
5. Form doğrulanınca **Sisteme Giriş Yap** aktif olur; öğrenci GM Özel Kod + şifre ile giriş yapar. Liderin **ön onayı gerekmez**.
6. Liderin ayrı panelinde **Ana Google Form** ve **GM Özel Kod listesi (Google Sheets)** bağlantıları görünür. Lider **Kontrol Edildi**, **Gerekçeli Bilgi Hatası Kısıtı**, **Bu Kısıtı Kaldır** işlemlerini yapabilir. Ana yönetici liderlerin işlem geçmişini görür. Daha önce istenen faaliyet oluşturma/onaylama yetkisi korunur; liderlere genel masa, ceza, silme, yönetici ayarı yetkisi verilmez.

## Tekrar kayıt kontrolü

- **Aynı Firebase kayıt UID'si** ile tekrar kayıt denemesi, mevcut GM Özel Kod ve şifreyi döndürür; yeni kod üretmez.
- **Aynı tarayıcı kimliği** hâlâ kayıtlı aktif bir hesaba bağlıysa yeni hesap engellenir. Sadece silinmiş hesaba ait eski işaret tek başına yeni kaydı engellemez. Bu tanımlayıcı fiziksel cihazın değişmez kimliği değildir.
- **Google Form'dan doğrulanmış e-posta** gelirse sunucuda `sgmRegistrationEmails` ve `sgmFormEmails` üzerinden aynı e-postanın ikinci *doğrulanmış* hesapta kullanılmasına izin verilmez. Tek form yanıt kimliği iki kez işlenmez; farklı yanıtla aynı kod ikinci kez doğrulanmaz.
- **Sınır:** Kayıt sırasında e-posta henüz bilinmediği için başka tarayıcıdan ikinci *bekleyen* kod üretilmesi tamamen engellenemez. Ayrıca Form doğrulanmış e-posta toplamıyorsa e-posta tekilliği uygulanamaz. Kesin kişi tekilliği için Form'da doğrulanmış e-posta ve lider kontrolü veya kod üretilmeden önce ayrıca güvenilir kimlik doğrulaması gerekir. Uygulamada Google giriş penceresi bu pakette **zorunlu değildir**.
- Öğrenci başka cihazdan **mevcut hesabına giriş yapabilir**. Liderin ayrıca cihaz değiştirme onayı vermesi gerekmez. Önceki sürümden kalan cihaz onayı belgeleri silinmedi, fakat yeni onay talebi üretilmiyor.

## Ana yönetici / lider bağlantıları

Ana yönetici → **Lider Yönetimi → Form Bağlantıları** bölümüne:
- `Ana Google Form bağlantısı`: `https://forms.gle/...` veya `https://docs.google.com/forms/...`
- `GM Özel Kod listesi bağlantısı`: `https://docs.google.com/spreadsheets/...`

Bağlantılar lider panelinde görüntülenir. Kod listesi Google hesabı izinleriyle yalnızca yetkili liderlere açık olmalıdır. **Bağlantıları kaydetmek tek başına otomatik aktarımı başlatmaz.**

## Otomatik aktarım için zorunlu kurulum

1. Ana Google Form'da **GM Özel Kod** başlıklı 8 rakamlık soru bulunsun.
2. Ana Form → Apps Script içine `google-apps-script/gm-kod-aktarimi.gs` kodunu koyun.
3. Script Properties:
   - `SGM_APP_URL`: uygulamanın HTTPS ana adresi
   - `SGM_FORM_WEBHOOK_SECRET`: Vercel'deki aynı 32+ karakterlik gizli değer; GitHub'a koymayın
   - `GM_CODES_SPREADSHEET_ID`: yalnız kodların yazılacağı Google Sheets belge kimliği
   - `GM_CODE_QUESTION_TITLE`: `GM Özel Kod` (soru başlığıyla birebir aynı)
4. Tetikleyici: `onMainFormSubmit` → `From form` → `On form submit`. İsteğe bağlı telafi: `reconcileRecentResponses` zaman tetikleyicisi.
5. **Önerilen:** Google Form ayarlarında e-posta toplama = **Doğrulanmış**, yanıt sayısı = **1**. Bu ayar uygulama içinde Google Authentication girişi gerektirmez, ancak Form Google hesabıyla oturum isteyebilir. Bu ayar olmadan e-posta bazlı tekrar kayıt engeli garanti edilemez.
6. Ayrı test Firebase / Vercel / Form / Sheets ortamında yeni kayıt, form gönderimi, kod listesine aktarım, buton açılması ve lider kontrolünü test edin. Canlı ortamda mevcut hesap, aktif masa, QR, ihbar, ceza ve faaliyet regresyon testleri olmadan yayınlamayın.

## Güvenlik / veri koruma

- Firestore koleksiyonlarını silen, tüm hesapları taşıyan, mevcut şifreleri değiştiren veya aktif masaları sonlandıran bir betik yoktur.
- Eski öğrencilerde `formGateEnabled` yoksa yeni Form giriş kilidi uygulanmaz.
- Önce **salt okunur Firestore yedeği**, Google Form ve Sheets yedeği alın; PIN ve GM kodu içeren yedekleri herkese açık yerde saklamayın.
- Gerçek canlı Firebase, Vercel, Google Form uçtan uca testi yapılmadı. Bu nedenle sıfır veri kaybı veya otomatik aktarımın canlıda çalıştığı garanti edilmez.
