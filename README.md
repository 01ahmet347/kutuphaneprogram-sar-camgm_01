# Sarıçam Gençlik Merkezi Kütüphane Masa Takip Sistemi

Sürüm: **2026.10.07.1**. Öğrenci GM Özel Kod ve şifreyle giriş yapar; masa seçimi/QR doğrulama, mola, boş masa ihbarı ve dilek/şikayet kullanılır. Yönetici kullanıcıları, masaları, kayıt/onayları, krokileri, ayarları, ihlalleri ve logları yönetir. Tutanak arayüzü ve belge üretimi kaldırılmıştır; ceza kuralları ve loglar korunmuştur.

Bu paket henüz canlıya uygulanmadı. Yerel testlerin geçmesi, gerçek Firestore kurallarının ve telefondaki push teslimatının doğrulandığı anlamına gelmez.

## Kurulum ve kontrol

Node.js 22 LTS kullanın. `npm ci`, `npm test`, `npm run build` komutlarıyla kurulum, test ve derleme yapılır. Geliştirme: `npm run dev`. Firebase ayarı olmadan yerel önizleme gerçek veritabanına bağlanmaz. `dist` tarayıcı çıktısıdır; Vercel'e yalnızca dist yüklemeyin. `/api` ve `/server` dizinlerinin de bulunduğu proje kökünü yükleyin.

## Yeni Vercel projesi

1. Bu proje kökünü yeni hesaba aktarın. Framework Vite, Build Command `npm run build`, Output Directory `dist`.
2. Aşağıdaki ortam değişkenlerini Production kapsamına ekleyin. Preview gerçek veritabanına bağlanacaksa ayrıca bilinçli tanımlayın. Değişkenlerden sonra yeniden Deploy gerekir.
3. Firebase Authentication'da Anonymous sağlayıcısı açık olmalı. Yeni Vercel alan adını Authentication > Settings > Authorized domains listesine ekleyin. Aynı Firebase projesini kullanın.
4. Öğrenci kayıt, profil, masa, mola, ihbar, geri bildirim, günlük olay ve push-token yazmaları Admin SDK kullanan sunucu uç noktalarından geçer; Firestore Rules doğrudan öğrenci yazmalarını reddeder. Bu değişikliklerden sonra depodaki `firestore.rules` kurallarını Firebase Console/CLI ile ayrıca yayınlayın. Vercel deploy'u Firestore Rules dosyasını Firebase'e yayınlamaz. Önce doğru Firebase projesi ve servis hesabını doğrulayın; servis hesabı JSON'unu veya özel anahtarını sohbet üzerinden göndermeyin.
5. Telefonla öğrenci girişi, masa alma/QR, yönetici girişi, dilek/şikayet, yönetici mesajı ve ekran kapalı ihbar bildirimini test edin. Bildirim tarayıcı/işletim sistemi iznine ve ağ bağlantısına bağlıdır; ekran kapalı teslimatı kod testiyle garanti edilemez.
6. Geçiş tamamlandığında eski Vercel uygulamasının veri yazmasını durdurun. Eski açık istemciler, yeni kodun silme korumasına uymayabilir; bunu veritabanı kurallarıyla da engellemek gerekir. Eski canlı deployment veya Firebase Cloud Function bu paketten dosya kaldırılmasıyla otomatik silinmez.

| Değişken | Değer / amaç |
| --- | --- |
| `VITE_FIREBASE_CONFIG` | Mevcut Firebase web config JSON'u, olduğu gibi. |
| `VITE_FIREBASE_APP_ID` | Mevcut verilerin `artifacts/...` yolundaki uygulama kimliği, **değiştirmeyin**. Firebase web config içindeki appId ile aynı kavram değildir. |
| `FIREBASE_APP_ID` | Yukarıdaki uygulama kimliğiyle aynı; verilmezse sunucu VITE_FIREBASE_APP_ID kullanır. |
| `ADMIN_USERNAME` | Yönetici giriş ekranındaki kullanıcı adı. |
| `ADMIN_PASSWORD` | Yönetici giriş ekranındaki şifre. |
| `FIREBASE_ADMIN_PROJECT_ID` | Aynı Firebase projesinin servis hesabı project_id değeri. |
| `FIREBASE_ADMIN_CLIENT_EMAIL` | Servis hesabının client_email değeri. |
| `FIREBASE_ADMIN_PRIVATE_KEY` | Servis hesabının private_key değeri. Gerçek satır sonu veya `\n` desteklenir. **VITE_ öneki vermeyin**. |
| `APP_URL` | Yeni canlı adres, ör. `https://yeni-proje.vercel.app`. Push tıklamasının doğru adresi açması için önerilir; yoksa Vercel'in adres değişkeni kullanılır. |

`.env` dosyasındaki eski web ayarları korunmuştur. `.env` dosyasını Git'e eklemeyin. Sunucu sırlarını kaynak koduna veya ön yüz değişkenlerine koymayın. Yönetici girişinde başarılı kullanıcı adı/şifre sonrası Firebase `admin: true` claim'li oturum açılır; yalnızca arayüzü kapatmak güvenlik sağlamaz.

**Yetkilendirme sınırı:** Öğrenci GM Özel Kod + şifre doğrulaması `/api/student-login` sunucu uç noktasında yapılır ve başarılı giriş, Firebase'de öğrenci ID'sine bağlı özel oturum açar. Öğrenci arayüzü tüm kullanıcı koleksiyonunu dinlemez; yalnızca kendi kullanıcı belgesini dinler. Öğrenci kayıt, masa ayırma/QR, mola, ihbar, masadan ayrılma, geri bildirim, güvenli olay kaydı ve push-token yazmaları Admin SDK ile doğrulanır. Rules doğrudan öğrenci yazmalarını reddeder. Firebase Emulator ile kurallar doğrulaması ve gerçek projede uçtan uca test yapılmadan canlı kullanım onaylanmış sayılmaz. Kuralları `allow read, write: if true` yaparak çözmeyin.

**Firebase güvenlik geçişi:** `firebase.json` depodaki `firestore.rules` dosyasını kullanır, ancak Vercel deploy'u bu kuralları yayınlamaz. Admin claim'i mevcut yönetici işlemlerine erişir; öğrenciler yalnızca kendi kullanıcı belgesini/mesajını, masa durumlarını ve ayarları okuyabilir. Öğrenci yazmaları Admin SDK endpoint'lerine taşınmıştır. Kurallar henüz Firebase projesine yayınlanmadıysa Console'daki mevcut kapalı kurallar uygulamayı çalıştırmaz; Rules dosyasını yayımladıktan sonra üretimde kayıt, giriş, masa ayırma/QR, mola, ihbar/doğrulama, masa bırakma, geri bildirim ve bildirim akışlarını smoke test edin. Geniş istemci yazma izni açmayın.

## Bu pakette düzeltilenler

- Genel log, ihlal ve dilek/şikayet arşivleri yalnızca yönetici paneli açıkken dinlenir. Öğrenci masa/kullanıcı verilerini mevcut akış için almaya devam eder; kendi yönetici mesajını tek kişisel belgeden alır.
- Eski logların açılışta tekrar tekrar yazılması, aynı logun iki arşive yeni kayıt olarak yazılması ve uzak veri değişiminin gereksiz genel log üretmesi kaldırıldı. İşlemler kendi olay loglarını üretir.
- Yazma yalnızca değişen alanlarda yapılır. Masa durumunu ve sahibini birbirinden koparacak eski cihaz güncellemeleri reddedilir. Gerekli transaction ve kayıt işlemleri korunur; kota aşılmayacağı garantisi verilmez.
- Kullanıcı silme paylaşılan silme işaretiyle korunur. Başarısız silmeler cihazda bekler ve yönetici bağlantısı düzelince yeniden denenir. Yeni istemci, eski kullanıcı listesini yeniden yaratmaz. Eski sürümleri durdurma/Rules adımı yine gereklidir.
- Aynı masayı, kullanıcıyı veya cihazı eşzamanlı rezervasyona sokma transaction ile kontrol edilir. QR ile oturma ve yönetici masa ataması da atomik doğrulanır. Mola/ihbar süresi dolduğunda aynı ceza birden fazla cihazda tekrar verilmez.
- Öğrenci oturumu gün değişimi veya kapanış nedeniyle kapatılmaz. Kapanışta masanın boşalması korunur. Hesap silinmesi veya açıkça çıkış yapılması oturumu sonlandırır. Yeni alan adı tarayıcı için ayrı bir sitedir: öğrencinin bir kez tekrar giriş yapması ve bildirim iznini vermesi gerekir; eski alanın localStorage oturumu taşınmaz.
- Kimlik doğrulama ve terminal Firestore dinleyici hatalarında yeniden bağlanma eklendi. Gönderilemeyen log/ihlal/dilek-şikayet yerel gönderim kuyruğunda tutulur. Kullanıcı sunucuya ulaşmayan dilek/şikayet için yanlış başarı mesajı görmez. Bu cihazın site verileri temizlenirse bekleyen yerel kayıtlar kaybolabilir.
- İhbar ve yönetici mesajı FCM ile, sunucuda doğrulanmış Firebase oturumundan gönderilir. Aynı olay tekrar gönderilmez; geçersiz telefon tokenları temizlenir. FCM'in otomatik arka plan bildiriminin ayrıca ikinci kez gösterilmesi önlendi. FCM kabulü, telefona kesin teslim edildiği anlamına gelmez.
- Apps Script için kullanılmayan eski kayıt API'si ve eski allData yapısını dinleyen Cloud Function kaynak dosyaları kaldırıldı. Geçmiş allData ve loglar otomatik silinmez; yönetici geçişinde geçmiş kayıtlar bir kez aktarılır.
- Tutanak paneli, ayarları ve belge üretimi kaldırıldı. İhlal/geri bildirim Word/PDF çıktıları ve geçmiş log kayıtları korundu. Kullanılmayan docx paketi kaldırıldı.
- İlk kayıt sonucunda GM Özel Kod şifreden önce gösterilir.

## Canlı sürümü öğrenme

Yeni sürüm ekranın altında `Sürüm 2026.10.07.1` yazar. `/api/version` canlı sunucu sürümünü ve Vercel commit kimliğini; `/version.json` ön yüz derlemesini gösterir. Eski sürümde Vercel > Project > Deployments > Production deployment > Source/Commit ve domain ataması kontrol edilir. Gönderilen eski arşivin dist çıktısı ile kaynak kodu aynı sürüm değildir; mevcut canlı bundle da bu arşivdeki dist'ten farklıdır. Yalnız arşive bakarak canlı commit kesin belirlenemez.

## Test kapsamı

`npm test`: eşzamanlı masa/kullanıcı/cihaz rezervasyonları, QR, admin ataması, tek seferlik ceza, silme koruması, eski cihazın kaydı yeniden yazmaması, oturum devamlılığı, sınırlı eşzamanlı işlemler, tüm 17 panel/görünümün sunucu render kontrolü ve service worker bildirimi testleri. Transaction testleri bellek içi eşzamanlı veritabanı ile yapılır; Firebase emulator veya üretim veritabanı testi değildir. Gerçek Rules, Vercel fonksiyonları ve telefon teslimatı ayrıca doğrulanmalıdır.
#   k u t u p h a n e p r o g r a m - s a r - c a m g m _ 0 1  
 