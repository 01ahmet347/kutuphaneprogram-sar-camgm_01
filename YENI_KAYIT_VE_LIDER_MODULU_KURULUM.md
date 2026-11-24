# Sarıçam GM — Kayıt Doğrulama ve Lider Denetim Modülü

Bu paket 18.11.2026 sürümünü temel alır. Orijinal ZIP değiştirilmedi. Masa, QR, mola, cron, disiplin ve eski hesap verileri yeni sistemin dışında tutulur. Bu sürüm **önce test ortamında** kurulmalıdır.

## İşleyiş

1. Öğrenci eski kayıt ekranında GM Özel Kod ve 8 haneli şifre alır. Yeni kayıt `formGateEnabled=true` ve `registrationFormStatus='awaiting_submission'` durumunda oluşturulur.
2. Öğrenci sadece **ana Google Form'u** doldurur. Formdaki soru başlığı `GM Özel Kod` olmalıdır; kod başındaki sıfırlar korunmalıdır.
3. Ana forma bağlı Apps Script yanıt ID ve kodu HMAC ile imzalayıp `/api/student-register` uç noktasına gönderir. Sunucu kodun `sgmAuthCodes` kaydı ve ilgili öğrencinin koduyla eşleştiğini doğrular, gönderim kaydını tutar, kayıt bekleyen hesabın `pendingApproval` kısıtını kaldırır. Bu akış başka aktif cezaları değiştirmez.
4. Apps Script kodu **ikinci bir Google Sheets** belgesine (yalnızca GM Kodları) yazar. Öğrenci ikinci bir form doldurmaz. Kod kaynağı bir Google Form değil, Sheets tablosudur; sistem form gönderimini yalnızca korumalı webhook'a dayanarak doğrular, tablonun varlığı tek başına onay kanıtı değildir.
5. Öğrencinin kayıt ekranındaki giriş butonu doğrulama sonrasında aktifleşir. Doğrulama her 30 saniyede bir ve elle kontrol edilebilir. Sunucu da doğrulanmamış yeni hesaba öğrenci tokenı vermez.
6. Lider, kendine özel hesapla giriş yapar. Yeni kayıtları inceler: **Kontrol Edildi**, **Gerekçeli Bilgi Hatası Kısıtı** ve **Yalnızca Bu Kısıtı Kaldır** işlemleri vardır. Kısıt konulunca aktif masa ve rezervasyon sunucu işlemiyle iptal edilir; ihlal sayısı artırılmaz. Aynı masadaki başka geçerli misafir varsa oturumu sahibi olarak korunmaya çalışılır. Eski masa kısıt kalkınca geri verilmez.
7. Ana yönetici `Lider Yönetimi` sekmesinden kullanıcı adı, ad-soyad, en az 12 karakterlik ilk şifre oluşturur, şifre değiştirir ve lideri pasifleştirir. Lider eylemleri `sgmLeaderAudit` içinde izlenir; değişen hesapların geçmişi silinmez. Liderlerin disiplin, masa yönetimi, silme ve diğer yönetici yetkileri yoktur.

## Test ortamına kurulum

1. Yeni **Firebase projesi** ve yeni **Vercel projesi** açın. Canlı veritabanına bu test sürümünü bağlamayın. 12 API fonksiyonu sınırını aşmamak için yeni lider ve form işlemleri mevcut `/api/admin-login`, `/api/admin-maintenance`, `/api/student-login` ve `/api/student-register` uç noktalarına eklendi.
2. Mevcut sürümdeki Firebase istemci ve Admin SDK yapılandırmasını **test Firebase** bilgileriyle Vercel ortam değişkenlerinde tanımlayın (`VITE_FIREBASE_CONFIG`, `VITE_FIREBASE_APP_ID`, `FIREBASE_APP_ID`, `FIREBASE_ADMIN_PROJECT_ID`, `FIREBASE_ADMIN_CLIENT_EMAIL`, `FIREBASE_ADMIN_PRIVATE_KEY`, `ADMIN_USERNAME`, `ADMIN_PASSWORD` vb.). İstemci `VITE_FIREBASE_APP_ID` ile sunucu `FIREBASE_APP_ID` aynı test uygulama yolunu göstermelidir.
3. Ek olarak Vercel ortam değişkenine güçlü rastgele en az 32 karakterlik `SGM_FORM_WEBHOOK_SECRET` ekleyin; **asla VITE_ ile başlamasın** ve Git'e eklemeyin. Test ve canlı ortamın ayrı gizli anahtarları olsun.
4. Test Firebase Firestore kurallarını `firestore.rules` dosyasından yükleyin. Yeni lider koleksiyonlarına istemci erişimi yasaktır; sunucu Admin SDK kullanır.
5. Google Drive'da **test ana Google Form'u** ve ayrı **test GM Kodları Google Sheets belgesi** oluşturun. Formda `GM Özel Kod` adlı kısa yanıt sorusu bulunmalı, yanıt 8 rakamla kısıtlanmalı.
6. Formun Apps Script düzenleyicisine `google-apps-script/gm-kod-aktarimi.gs` dosyasını yapıştırın. Project Settings → Script Properties altına `SGM_APP_URL`, `SGM_FORM_WEBHOOK_SECRET`, `GM_CODES_SPREADSHEET_ID`, `GM_CODE_QUESTION_TITLE` ekleyin. Ana Form → Apps Script → Triggers: `onMainFormSubmit`, `From form`, `On form submit`. Yetkilendirmeyi formun sahibi vermeli. Güvenilir telafi için `reconcileRecentResponses` her saat zaman tetikleyicisi de kurabilirsiniz.
7. Google Sheet'i yalnızca yetkili liderlerin Google hesaplarıyla paylaşın. **Herkese açık / bağlantıya sahip herkes** erişimi vermeyin. Google Form yanıtlarının görüntülenmesi için liderlere gerekli sınırlı Google erişimini ayrıca tanımlayın. Panelde yalnızca bağlantı bulunması Google dosyası erişimi sağlamaz.
8. YP'deki `Lider Yönetimi` sekmesinden ana form URL'si ve GM Kodları Google Sheets URL'sini kaydedin; liderleri ekleyip şifrelerini atayın.
9. Deneme hesabı oluşturup formu gönderin. Form kontrolü, buton açılması, lider kısıt + masa boşaltma, kısıt kaldırma, yönetici audit geçmişi ve disiplin cezalarının korunmasını doğrulayın. Testte gerçek kullanıcı / masa verisi kullanmayın.

## Verilerin korunması / sürüm uyumluluğu

- Mevcut hesaplarda `formGateEnabled` yoksa yeni form-giriş kilidi uygulanmaz. Böylece eski öğrencilerin mevcut giriş yöntemi bozulmaz.
- Yönetici tarafından manuel oluşturulan hesaplar da eski ilk onay mantığında kalır.
- Yeni bilgi-hatası kısıtı `formInfoRestricted` alanında saklanır ve disiplin alanları (`restrictedUntil`, `strikes`, `blocked`, `pendingApproval`) ayrı tutulur.
- Yeni hesaplarda lider inceleme beklemek erişim engeli oluşturmaz; yalnızca doğrulanmış form gönderimi kapıyı açar.
- Lider işlemleri sadece yeni form kapısı bulunan öğrenci kayıtlarına uygulanır. Mevcut eski öğrenci hesaplarında özel bir geçiş yapılmaz.
- Tarihçe `sgmLeaderAudit` koleksiyonunda kalıcı tutulur. Panel son 250 kaydı gösterir. Tam geçmiş istenirse ayrı sayfalama geliştirilebilir.
- Kod eşleşmesi, formun gönderildiğini kanıtlar; formdaki **kimlik bilgilerinin doğru olduğunu veya formu kodun gerçek sahibinin doldurduğunu tek başına ispat etmez**. Bu nedenle liderin sonradan incelemesi önemli.
- Canlı sistem için geçiş ancak ayrı testte Firebase security rules, webhook, öğrenci giriş akışı ve masa tutarlılığı kontrolünden sonra yapılmalı; Firestore yedeği alınmalıdır.

## Bilinen kontroller

- Bu teslim ortamında `npm ci` internete erişemediğinden Vite üretim derlemesi tamamlanamadı. Kaynak dosyalarda JavaScript ve JSX sözdizimi kontrolü yapıldı; bağımsız testler çalıştırıldı. Canlı yayın öncesinde bağlı internetli ortamda `npm ci`, `npm test`, `npm run build` çalıştırın.
- Orijinal pakette bazı `morning-safety` testleri zaten başarısızdı; bu sürümde sıfır hata raporlanmıyor.
