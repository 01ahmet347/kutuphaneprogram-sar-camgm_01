# SGM Kütüphane - Onay, Mobil Masa Bırakma ve 22.00 Telefon Eşitlemesi

## Yeni düzeltmeler (17.10.2026)

### 1) Hesap onayı ve kısıt kaldırma
- YP'deki **Hesabı Onayla / Kısıtı Kaldır** ve **Seçili Kullanıcılar > Kısıtı Kaldır** aynı, yetkili sunucu endpoint'ini kullanır: `/api/admin-maintenance`, `approve_users`.
- Sunucu, aktif yönetici oturumunu doğrular ve seçili kullanıcıların yalnızca hesap kısıt/ihbar yetkisi alanlarını **tek Firestore transaction'ında** günceller.
- GM Özel Kod, PIN/şifre, aktif masalar, mola bakiyeleri, ihlal geçmişi ve kullanıcı kimliği değiştirilmez. Silinmiş hesap geri oluşturulmaz.
- Onay sonucu yönetici ekranına sunucu onayından sonra hemen işlenir. Eski tarayıcı verisi onay durumunu geri alamaz.
- “Düzenle” penceresindeki diğer profil değiştirme işlevleri eski güvenli düzenleme akışını korur.

### 2) Telefon internetinden masa bırakma
- `/api/student-desk` bırakma işlemi korunur; öğrenci Firebase kimliği sunucuda doğrulanır.
- Mobil bağlantıda ilk yanıt kaybolursa `leave` için **en fazla bir** güvenli yeniden deneme yapılır. 401'de kimlik tokenı yenilenir; 503/ağ zaman aşımında yeniden denenir. 409 gibi iş kuralı hatalarında otomatik yeniden deneme yoktur.
- Öğrenci, sunucu gerçek masayı temizlemeden başarı mesajı görmez. Tıklama sırasında ilerleme mesajı ve tekrar tıklama kilidi bulunur.
- Wi-Fi veya mobil veriye özel bir sınır getirilmedi; telefon ağının bazı istekleri engellemesi durumunda gerçek cihaz ve Vercel Function Logs incelenmelidir.

### 3) 22.00 kapanışı ve telefon ekranları
- Mevcut `vercel.json` cron saati korunur: **19.00 UTC = Türkiye 22.00**. Cron sunucuda toplu masa ve kullanıcı bağlantılarını cezasız temizler.
- Saat 22.00'den sonra kendi masası üzerinde kalan öğrenci, telefon uygulaması açık/çevrimiçiyken sunucuya otomatik cezasız bırakma isteği gönderir (sunucu saati doğrulanmış olmalıdır). Sonuç doğrulanınca öğrenci ekranı da güncellenir. Bekleyen rezervasyonlar iptal edilir.
- Tarayıcı arka planda uyuyorsa internet geri geldiğinde / uygulama görünür olduğunda senkronizasyon yeniden denenir. Firestore `onSnapshot` güncellemeleri ayrıca korunur.
- Kapanış işlemi yeni 30 dakikalık masa bekleme cezası üretmez; öğrenci hesabından çıkış yapılmaz. Çevrimdışı telefonda görsel değişikliğin anında gerçekleşmesi mümkün değildir; yeniden bağlanınca sunucu verisi esas alınır.

## Canlıya yükleme öncesi zorunlu güvenlik adımları

1. **Canlı Firebase / Firestore yedeğini alın.** Bu ZIP canlı verileri içermez; mevcut üretim verilerini test ortamında doğrulamadık.
2. Mevcut **aynı Vercel projesini**, **aynı Firebase projesini**, **FIREBASE_APP_ID / VITE_FIREBASE_APP_ID** değerlerini kullanın. Bunları değiştirmek kullanıcıların kaybolmuş gibi görünmesine neden olabilir.
3. ZIP'in içindeki proje klasörü içeriğini birlikte yayınlayın. `api/` ve `server/` dosyaları dahil olmalı; tek JSX dosyasını yüklemek yeterli değildir. Mevcut `vercel.json` cron kaydı korunmalı ve Vercel'de `CRON_SECRET` ayarlanmalıdır.
4. Dağıtımdan önce üretimle uyumlu bir ortamda `npm ci`, `npm test`, `npm run build` çalıştırın. `firestore.rules` mevcut dosyası değiştirilmedi; canlı kuralların önceki sürümle uyumlu olduğundan emin olun.
5. Önce 2 test hesabında onay/kısıt, Wi-Fi ve mobil veri ile masayı bırakma; sonra saat 22.00 masa durumlarının hem öğrenci hem YP ekranında güncellenmesini deneyin. **Canlı kullanıcılara toplu işlem yapmadan** sonucu doğrulayın.
6. Vercel Logs'da `/api/student-desk`, `/api/admin-maintenance` ve `/api/cron-close` hata kodlarını takip edin. Firebase kotası veya mobil operatör erişim engeli devam ederse sunucu ve ağ logları gerekir.

## Yerel kontrol sınırı

- 87 test geçti; 6 test dosyası bu sınırlı ortamda Firebase Admin / Sucrase paketleri bulunmadığı için yüklenemedi.
- JSX dosyası TypeScript ayrıştırıcısıyla sözdizimi kontrolünden geçti (0 hata).
- `npm run build` ve canlı Firebase / Vercel entegrasyon testi bu ortamda çalıştırılamadı. Herhangi bir canlı veritabanına dokunulmadı.
