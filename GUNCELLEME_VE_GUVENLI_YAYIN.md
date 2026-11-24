# SGM Kütüphane — Masa ve Mola Düzeltmesi (16.10.2026)

## Değişiklikler

- Masa sahipliğinin doğrulanmış kaynağı `sgmDesks` belgesindeki sunucu oturumudur. Bir hesapta `activeDeskId` bulunsa bile başka bir öğrenci o masanın `occupant` alanındaysa eski kullanıcıya **aktif masa** gösterilmez.
- YP eski snapshot'larının `occupant`, `activeDeskId`, `status`, `breakEndTime`, rezervasyon ve oturum alanlarını tekrar Firestore'a yazması engellendi (`src/authoritative-session.js`, JSX). Yeni `firestore.rules` aynı alanları eski yönetici tarayıcılarından da korur.
- YP boşaltma/kapatma işlemi masa ve ilgili **tüm eski kullanıcı bağlantılarını aynı sunucu transaction'ında** kaldırır. Önceki oturum ile güncel oturum uyuşmazsa yönetici işlemi reddedilir. YP'nin masa aç/kapat ve ihbar iptali sunucu API'sine taşındı.
- Mevcut öğrenci silme, süre dolumu ve kullanıcı hesabı temizleme işlemleri yeni Firestore izinleriyle uyumlu güvenli sunucu API'sine taşındı (`/api/admin-maintenance`).
- Kullanıcı ekranı bir masayı sadece gerçek sahibi olduğunda aktif sayar. Aynı masada iki profilin molada görünmesi engellenir.
- `on_break` durumunda geçersiz/süresi dolmuş mola bitiş zamanı artık yanıltıcı şekilde **"Mola Devam Ediyor — 00:00"** diye sunulmaz; ayrı süre doğrulama/doldu mesajı gösterilir. Sayaç cihazın tarihi yerine `/api/server-time` üzerinden belirlenen sunucu saat farkını kullanır.
- Her yeni molaya benzersiz `breakSessionId` atanır. Bir işlem isteğinin tekrarında ikinci kez mola hakkı düşmez. Sunucuda doğrulanmış, **süre bitmeden meydana gelen belirli kayıt bozulmalarında** hak transaction ile bir kez iade edilir. QR ile normal/erken dönüşte veya doğal mola bitiminde iade yoktur. Sunucu audit kayıtları eklenmiştir.
- Normal kısa mola **5 × 15 dakika**, uzun mola **2 × 30 dakika** varsayılandır. Türkiye takvimine göre yalnız cuma günü açılan **1 × 60 dakika**, öğrenci ekranında **"1 Saatlik Mola"** olarak gösterilir. YP'den açma/kapatma, adet ve süre ayarı vardır; 30 dakikalık çalışma zorunluluğu korunur.
- Mola süresi/adedi ayarına sayı ve aralık doğrulaması eklendi. Başlamış mevcut molaların `breakEndTime` değeri ayar değişikliği nedeniyle yeniden hesaplanmaz.
- Sunucuda onaylanmış masa ataması tarayıcıdaki eski **Geri Al** snapshot'ı üzerinden geri getirilemez; diğer yerel geri alma ve günlük işlevler olabildiğince korunur.

## CANLI ORTAMA GEÇMEDEN ÖNCE — ZORUNLU

1. **Canlı Firestore verilerinin dışa aktarılmış yedeğini** alın; Firebase projesi ve üretim ortamı kimliklerini değiştirmeyin. ZIP içinde gerçek kullanıcı verisi/yedeği yoktur.
2. Proje **aynen mevcut Vercel projesine** (`api`, `server`, `src`, ana `.jsx`, `package.json` birlikte) yayımlanmalı. `npm ci && npm test && npm run build` CI'da başarılı olmadan canlıya çıkmayın.
3. **Firestore Rules** ayrı bir yayınlama adımıdır. Yalnızca Vercel'e bu ZIP'i yüklemek güvenlik kurallarını etkinleştirmez. Firebase projesinin doğru olduğundan emin olarak `firestore.rules` dosyasını Firebase Console → Firestore Database → Rules üzerinden yayımlayın veya uygun projeyle `firebase deploy --only firestore:rules` kullanın. **Kurallar ve yeni API'ler birlikte etkinleştirilmeli**; eski yönetici sekmeleri yenilenmelidir. Kuralları güncellemeden önce ve sonra Firebase Emulator ile mevcut yönetim işlevlerini test edin.
4. Firestore `sgmConfig/settings` belgesindeki **mevcut mola ayarları otomatik ezilmez.** Eski canlı ayarda uzun mola hâlâ 60 dakika ise YP → Sistem Ayarları'ndan **2 adet / 30 dk** olarak değiştirin. 1 Saatlik Mola: etkin / 1 adet / 60 dk. Mevcut kullanıcıların kaç molası kaldığını kontrol edin; topluca sıfırlama yapmayın.
5. Eski kullanıcıların bağlantıları hâlâ bozuksa YP → Kayıtlı Kullanıcılar → **Masa-Hesap Uyuşmazlığını Onar** özelliğini yedek sonrası çalıştırın. Bu işlem geçerli masa sahipliğini korur, ancak canlıda tutarsız kayıtları değiştireceği için sonucu gözlemleyin.
6. Test: (a) Ahmet Masa 30'u kullanırken YP boşaltır ve Mehmet'e atar, iki ekran açık kalır; (b) Mehmet 15 dk mola başlatır, sayfa yeniler, sayaç devam eder; (c) farklı cihaz saatleri; (d) iki kullanıcıdan eski olan QR/mola başlatamaz; (e) cuma 1 Saatlik Mola kullanılır, başka gün reddedilir; (f) mola sırasında YP masa boşaltır, haklar kontrol edilir; (g) YP 30→60→30 süre ayarı; (h) kullanıcı silme ve eski tarayıcı sekmesi; (i) 22.00 kapanış ve cron.
7. Yayından sonra Vercel Function Logs, Firebase kullanım kotaları, yeni audit kayıtları ve öğrenci/Yönetici ekranlarının gerçek zamanlı güncellenmesini gözlemleyin. Özellikle ilk değişikliklerin başarılı olmasına ve mola haklarına dikkat edin.

## Bilinen sınırlar / dikkat

- **Canlı veri erişimi yapılmadı.** Gerçek Firestore içeriği görülmedi; mevcut bozuk kayıtlar paketin açılmasıyla kendiliğinden tamamen onarılmaz. Onarım için YP'deki sunucu kontrolü gerekir.
- Otomatik mola iadesi **yalnız sunucu kayıtlarıyla ispatlanan, halen aynı kullanıcıda aktif masada bulunan ve süresi dolmamış yeni işlem kayıtları** için yapılır. Eski sürümden kalan, başlangıç kaydı olmayan takılı molalara otomatik hak iadesi yapmak hatalı hak yaratabileceğinden YP doğrulaması gerekebilir. YP'nin bilerek masa boşaltması otomatik sistem-hatası iadesi sayılmaz.
- Yeni Firestore kuralları eski yönetici istemcilerin masa/oturum alanlarını doğrudan değiştirmesini **bilerek reddeder**. Eski sürüm sekmelerini yenileyin. Yedek geri yükleme gibi işlemler aktif oturumları korumalı; geriye dönük aktif masa ataması otomatik restore edilmemelidir.
- Mevcut `sgmConfig/settings` önceki günün ayarlarını korur. Cuma özelliği için sunucuda yeni alanlar varsayılanlarla geriye uyumludur.
- Yerel incelemede Node tabanlı **62 çekirdek test** geçti ve JSX sözdizimi ayrıştırıldı. Bu ortamda `npm ci --offline` eksik bağımlılık nedeniyle başarısız oldu; bu yüzden **tam Vite derlemesi, tüm testler, Firestore Emulator ve canlı Vercel/Firebase entegrasyon testi henüz çalıştırılamadı**. Canlı sisteme yüklemeden önce yapılmalıdır.
