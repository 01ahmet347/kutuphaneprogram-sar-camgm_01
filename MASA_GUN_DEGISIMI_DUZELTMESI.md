# Masa bırakma / yeni gün düzeltmesi — 15.10.2026 (2026.10.15.1)

**Kapsam:** Öğrencinin önceki günden kalan masa oturumu nedeniyle "Masa Bırakılamadı: Aktif masa oturumunuz bulunamadı" hatası alması; eski masa kaydının yeni gün yeni masa seçiminde takılması; mevcut eski misafir oturumunun çıkamaması.

## Değişiklikler

- Sunucu eski masayı bırakırken gerçek masanın mevcut sahibini kontrol eder. Kullanıcının eski `activeDeskId` bağlantısı artık o masayla uyuşmuyorsa **yalnızca kendi kullanıcı belgesindeki eski masa referansını** temizler. Başkasının masasına, QR koduna, hesabına veya devam eden oturumuna dokunulmaz.
- Gerçek bir masa bırakıldıysa eski 30 dakikalık yalnızca bırakılan masayı yeniden alma kısıtlaması sürer. Sadece gün sonundan kalan geçersiz referans temizlendiyse yeni bir bekleme süresi veya yanlış "masa bırakıldı" günlüğü oluşturulmaz.
- Gerçekten dolu bir masadaki (ana kullanıcı veya misafir) mevcut oturum korunur; masa bilgisiyle kullanıcı verisi uyumlu olduğu sürece sistem onu sırf gün değişti diye temizlemez.
- Misafirin masa bırakma isteği gerçek kullanıcı hesabıyla sunucuda kontrol edilip masadaki ana kullanıcıya dokunulmadan işlenir. Ana kullanıcının ayrılmasında kayıtlı misafirin masa sahibi yapılması kuralı korunur.
- Yeni masa rezerve edilirken eski/gün sonu kaynaklı hatalı hesap bağlantısı, masanın gerçek durumu tekrar kontrol edildikten sonra görmezden gelinir; geçerli aktif masası olan kullanıcı aynı anda ikinci masayı alamaz.
- `leave` endpoint'i, kullanıcı oturumunu sonlandırmak yerine güncellenmiş kullanıcı/masa kayıtlarını mevcut React oturumuna uygular. Eksik/kalıntı masa senaryoları da hata üretmek yerine ilgili kullanıcı verisini güvenli şekilde eşitler.
- Yüklenen ZIP'teki JSX dosyasının `#U0131` biçiminde bozulan adı, uygulamadaki `import` ile eşleşen `kutuphaneprogramıguncell.jsx` olarak geri düzeltildi.

## Korunanlar

Öğrenci oturum anahtarları, Firebase Auth oturumları, kullanıcı kimlikleri, PIN/GM özel kodları, QR kodları, ihlal ve geçmiş verileri, aktif diğer masa oturumları, cihaz kilitleri, ayarlar, yönetici/öğrenci ekranları ve daha önceki işlevler değiştirilmedi. Firestore koleksiyonları için toplu silme veya göç yoktur.

## Yayımlama ve test

1. **Canlı Firestore yedeği alın.** Kaynak kod ZIP'i canlı veritabanını kapsamaz.
2. Mevcut Vercel projesine tüm proje içeriğini, özellikle `src/cloud-transactions.js`, `kutuphaneprogramıguncell.jsx`, `/api` ve `/server` klasörleriyle birlikte yayımlayın. Eski `VITE_FIREBASE_APP_ID`/`FIREBASE_APP_ID`, Firebase projesi ve Vercel gizli değişkenleri değiştirilmemelidir. Veritabanını yeniden kurmayın.
3. Dağıtımdan önce hedef ortamda `npm ci && npm test && npm run build` çalıştırın. Vercel yayını sonrasında farklı bir gün kullanıcısının eski masasını bırakma/yenisini alma, aynı masadaki diğer kullanıcının etkilenmemesi, gerçek masa bırakma için 30 dk bekleme ve misafir çıkışını gerçek cihazlarla kontrol edin.
4. **Yeni sürümü yayımlamak kullanıcıların hesaplarından otomatik çıkış yapması için bir neden değildir**, ancak tarayıcı oturumu silinmişse giriş gerekebilir. Firebase ve canlı veriler bu ZIP üzerinde değiştirilmedi. Eski açık istemciler güncelleninceye kadar eski davranışı gösterebilir; üretim davranışı canlı ortamda doğrulanmalıdır.

**Yerel doğrulama:** Firestore işlemlerini simüle eden ve masa servisinin HTTP yanıtını denetleyen testler geçti. Bu çalışma ortamında bağımlılıklar (`firebase-admin`, React, Vite vb.) kurulu olmadığı için tüm bağımlılık gerektiren testler ve gerçek Vite derlemesi burada doğrulanamadı. Firebase Emulator/canlı veritabanı testi ve deploy yapılmadı.
