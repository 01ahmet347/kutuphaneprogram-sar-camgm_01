> **ÖNEMLİ:** Bu belge önceki **2026.11.23.1** sürümünün tarihsel notudur. Yeni **2026.11.23.2** sürümünde uygulama Google hesabıyla giriş zorunluluğu kaldırılmıştır. Güncel kurulum için `TEK_FORM_KAYIT_AKISI_23_11_2026.md` dosyasını esas alın.

# Sarıçam GM – 23.11.2026 kontrollü güncelleme (TEST)

Bu paket **canlı Firebase'e bağlanmadı**; canlı kullanıcılar, QR kodlar, ihbarlar, ceza kayıtları ve masa oturumları üzerinde işlem yapılmadı. Yeni modül ve tek-e-posta kuralı kodlandı. Gerçek ortamda yayına almadan önce **yedek + test** zorunludur.

## 1. Canlıya geçmeden önce

1. Mevcut Vercel sürümünü ve Firestore kurallarını saklayın. Firebase projesinde **PITR / zamanında geri yükleme** ve mümkünse yönetilen Firestore dışa aktarımı ayarlayın. Uygun erişim varsa `node scripts/backup-firestore.mjs /guvenli-klasor/sgm-2026-11-23.json` komutuyla mevcut koleksiyonların **salt okunur** JSON yedeğini alın. JSON, PIN/GM kodu gibi hassas bilgiler içerir; GitHub'a veya herkese açık bir ortama koymayın. Google Form ve Google Sheets yanıtlarını ayrıca yedekleyin.
2. Ayrı **test Firebase + test Google Form + test Google Sheets + test Vercel** üzerinde deneme yapın. Aynı canlı Firestore'a bağlı bir test sürümünde gerçek öğrencilerle deneme yapmayın.
3. Firebase Authentication > Sign-in method > **Google** sağlayıcısını etkinleştirin. Vercel uygulamasının gerçek alan adını Authentication > Authorized domains listesine ekleyin. Mevcut anonim/öğrenci giriş yöntemini **kapatmayın**.
4. Ana Google Form > Ayarlar > Yanıtlar > **E-posta adreslerini topla: Doğrulanmış** ve **1 yanıtla sınırla** seçeneklerini açın. Google Form yanıtlarını silmeyin.
5. Google Apps Script içindeki `google-apps-script/gm-kod-aktarimi.gs` dosyasını güncelleyin; `onMainFormSubmit` tetikleyicisi, `SGM_FORM_WEBHOOK_SECRET`, `SGM_APP_URL`, `GM_CODES_SPREADSHEET_ID` ve `GM_CODE_QUESTION_TITLE` değerlerini doğrulayın. Vercel ortamında aynı 32+ karakterlik gizli anahtar bulunmalı.
6. `firestore.rules` kurallarını **yeni koleksiyonların doğrudan istemci erişimini kapatacak şekilde** yayınlayın. Mevcut kuralları topluca sıfırlamayın. Vercel'de aynı `FIREBASE_APP_ID` ve Firebase Admin değişkenleri kullanılmalı.
7. Önce testte yeni kayıt, tekrar aynı e-posta, form webhook'u, eski öğrenci girişi, lider onayı, faaliyet + mola, QR dönüşü, ihbar, kapanış ve masa sahipliği senaryolarını kontrol edin.
8. Canlıya geçişi kütüphane kapalıyken yapın; aktif masalar varsa otomatik sonlandırma veya manuel veri taşıma **yapmayın**. Sorunda önceki Vercel sürümüne dönün; Firestore verilerini otomatik silmeyin.

## 2. Yeni kayıt – tek e-posta

Yeni öğrenci kayıt oluştururken Firebase Google hesabını doğrular. Sunucuda `sgmRegistrationEmails` koleksiyonunda e-postanın SHA-256 özeti ile **tek** öğrenci UID'si eşleştirilir. Aynı doğrulanmış e-postaya ikinci GM Özel Kod veya PIN verilmez. Formun doğrulanmış yanıt e-postası kayıt e-postasıyla eşleşmezse form onaylanmaz. `sgmFormEmails` ikinci form yanıtını engeller. Daha önce oluşturulmuş **anonim kayıtlar** mevcut kodlarıyla korunur.

**Sınır:** Farklı Google e-postaları kullanan aynı fiziksel kişinin tek kişi olduğunu teknik olarak kesin kanıtlamak mümkün değildir; lider kontrolü sürer. Önceden kayıtlı olup e-posta bilgisi bulunmayan öğrenciler geriye dönük eşleştirilmez. Telefon değişimi mevcut GM kodu + şifreyle girişe engel değildir. Google girişi ve Form ayarı yapılmazsa yeni kayıt tamamlanamaz; eski öğrencilerin girişi devam eder.

## 3. Faaliyet ve mola

- Lider kendi hesabından bugüne ait faaliyet oluşturur; öğrenci aktif masasıyla başvurur. Bekleyen başvuru masa durumunu değiştirmez.
- Lider onayladığında mevcut masada `on_break` oturumu 60 dakika başlar; öğrenciye **Faaliyet** gösterilir. Günlük en fazla bir faaliyet hakkı `activityUsedDay` alanında tutulur.
- Öğrenci faaliyete **tek** 15 veya 30 dk normal mola ekleyebilir; cuma 60 dk molası eklenemez. Eklenen mola mevcut bakiyeden düşer ve günlük iki birleştirme işleminden birini kullanır. Aynı faaliyet zincirine ikinci ek mola konamaz.
- Normal molalar 15+15, 15+30 veya 30+30 olarak tek işlemde birleştirilebilir. Her işlem bir günlük hak tüketir; sonraki birleştirme için QR ile dönüş ve normal çalışma beklemesi gerekir.
- Lider **Başvuruları Kapat** yapmadan önce bekleyen tüm başvuruları sonuçlandırır. Kapatma onaylı öğrencilerin sayaçlarını kesmez. Yönetici tüm faaliyetleri ve son işlem geçmişini görür.
- Faaliyet süreleri mevcut `on_break` masa / QR dönüş / otomatik mola bitiş altyapısını kullanır. Yeni modül hiçbir QR veya ihbar kaydını silmez.

## 4. Yeni koleksiyonlar

`sgmActivities`, `sgmActivityApplications`, `sgmActivityAudit`, `sgmRegistrationEmails`, `sgmFormEmails`. Mevcut koleksiyonlar silinmez veya topluca dönüştürülmez. Öğrenci ve masa belgelerine yalnızca işlem sırasında gereken yeni alanlar eklenir.

## 5. Test sınırlaması

Kaynak kod düzeyinde Node testleri çalıştırılabilir; ancak gerçek Firebase, Vercel, Google Forms ve tarayıcı uçtan uca testi bu paketi hazırlarken yapılmadı. **Canlı ortamda sıfır veri kaybı garantisi, doğrulanmış yedek ve kontrollü dağıtım olmadan verilemez.**
