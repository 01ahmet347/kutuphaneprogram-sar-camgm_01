# iPhone Bildirim Desteği — Veri Koruma ve Güvenli Yayın

## Değişen yerler
- `index.html`: iOS PWA metadata ve manifest bağlantısı.
- `public/manifest.webmanifest`, `public/icons/*`: Ana Ekran kurulumu için yeni simgeler.
- `src/pwa-support.js`: iPhone Ana Ekran tespiti, kurulum yönergeleri (sadece okuma).
- `kutuphaneprogramıguncell.jsx`: iPhone Safari'den doğrudan izin istemek yerine kurulum yönergeleri; iOS Ana Ekran uygulamasında kullanıcı telefon simgesine bastığında izin isteme sırası düzenlendi.
- `tests/ios-pwa-push.test.js`: iPhone Safari ve Ana Ekran durumları için testler.

## Bilerek değiştirilmedi
- `firestore.rules`, `firebase.json`, `vercel.json`, `api/*`, `server/*`, `src/cloud-transactions.js`, `src/restriction-policy.js`, `public/firebase-messaging-sw.js`.
- Aktif öğrenci, masa sahibi, QR, ihlal, kısıt, mola hakkı, kullanıcı hesabı ve sunucu veri şeması.
- Otomatik Service Worker sayfa önbellekleme / otomatik yenileme eklenmedi. Sürüm yükseltmesiyle açık sayfaların zorla yenilenmesi hedeflenmiyor.
- Diğer platformlardaki bildirim izni akışı değiştirilmedi.

## iPhone kullanımı
1. iOS 16.4 veya üzeri, HTTPS üzerinden Safari'de yayımlanan siteyi açın.
2. Safari → Paylaş → Ana Ekrana Ekle; ana ekrandaki SGM Kütüphane simgesinden açın.
3. Öğrenci girişini yapın, üstteki telefon simgesine basın, **İzin Ver** deyin.
4. YP → Push Durumu'nda Firebase Cloud Messaging **Web Push Public VAPID** anahtarı tanımlı olmalıdır. FCM/Service Worker kontrollerini yapın.
5. Ayrı bir test iPhone'uyla **YP → Push Durumu** üzerinden test push bildirimi gönderin. Telefon kilitliyken ayrıca test edin.
6. Bildirim gelmiyorsa iPhone Ayarlar → Bildirimler → SGM Kütüphane'yi kontrol edin. iPhone odak ayarları ve sistemin push teslim politikası gecikme/engelleme yapabilir.

## Canlı sistem verileri için gerekli önlemler
- **ZIP bir veritabanı yedeği değildir.** Canlı Firestore verilerinin ve mevcut Vercel yapılandırmasının yedeğini ayrıca alın.
- Canlı siteyi doğrudan üzerine yazmadan **Vercel önizleme deployment** oluşturup PWA kurulumu / push'u test edin (test ortamı aynı veritabanına bağlıysa öğrenciyle masa/QR işlemi yapmayın).
- Yalnızca frontend statik PWA dosyaları ve belirtilen küçük JSX değişikliği yayımlanmalıdır. Firestore kuralları, data temizleme scriptleri, API ve sunucu kodlarına bu iPhone özelliği için dokunmayın.
- Yayın anında mevcut açık cihazlarda beklenmedik reload yapmayın; masa, bekleyen QR ve aktif molaları farklı cihazlardan izleyin. Bildirim kaydı masa sahipliğine dokunmaz.
- Canlı verinin kayıpsız kalacağı **kesin garanti edilemez**, canlı Firestore ve iPhone teslim testi yapılmadan gerçek sonuç onaylanamaz.
- Problemde hemen önceki dağıtıma **kod rollback** yapın; Firestore veritabanı geri alma işlemlerini canlı masalar sürerken otomatik başlatmayın.

## Sınır
Firebase FCM sunucusunun isteği kabul etmesi bildirimin Apple sistemince cihazda **kesin teslim edileceği** anlamına gelmez. Apple cihaz üzerinde gerçek test gereklidir.
