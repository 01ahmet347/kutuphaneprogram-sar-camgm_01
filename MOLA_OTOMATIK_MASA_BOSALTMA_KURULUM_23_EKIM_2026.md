# 23 Ekim 2026 — Mola süresi bitince otomatik masa boşaltma

## Özellik

- Kısa, uzun ve mevcut saatlik molalarda **sunucunun doğruladığı bitiş zamanı** gelirse ve süresi dolmadan QR dönüşü tamamlanmamışsa ana öğrenci masa oturumundan düşer.
- Öğrenci telefonu kapatsa bile **ayrı, dakikalık sunucu zamanlayıcısı kurulduğunda** masa otomatik boşaltılır. Telefonun açık olması gerekmez.
- Masa öğrencinin hesabından kaldırılır; öğrenci, hesap, şifre/PIN, GM kodu, kalan mola hakları, ihlal geçmişi ve YP kayıtları silinmez.
- Boşalan masa başka bir öğrenciye açık olur. Düşürülen öğrenci aynı masayı boşaltma anından itibaren **30 dakika** yeniden alamaz; başka boş masaları alabilir.
- **İhlal uygulanmaz**; mevcut ihlal sayısı artmaz.
- YP'de mevcut `MOLA_SURESI_DOLDU_DONUS_YAPILMADI` log türü ve yeni `MOLA_SURESI_DOLDU_MASA_OTOMATIK_BOSALTILDI` log türü yer alır. Yeni logda öğrenci bilgisi, GM kodu, masa, mola türü, bitiş, boşaltma, 30 dk engelin sonu ve açıklama bulunur.
- Öğrenci uygulamaya açtığında hesabındaki `lastAutoBreakRelease` olayı üzerinden nedeni görebilir. Bildirim aynı cihazda yalnızca bir kez açılır; farklı cihaza ilk girişte aynı geçmiş olay gösterilebilir.
- 22:00 kapanışı için mevcut **cezasız günlük kapatma** görevi aynen korunur. İptal edilmiş mola, QR dönüşü yapılmış mola, eski güne ait veya başkasının oturumuna taşınmış kayıt silinmez.
- Geçerli bir misafir varsa masası korunur. Misafir hala moladaysa kalan mola süresi de korunur. Tutarsız misafir verisi bulunduğunda yanlışlıkla kullanıcı çıkarmak yerine işlem güvenli şekilde atlanır.

## YAYINA ALMADAN ÖNCE ZORUNLU: canlı veri yedeği

**Bu ZIP yedek değildir; canlı Firebase verilerini içermez.** Canlı projedeki **doğru FIREBASE_APP_ID** ile kullanılan Firestore yolunun ve koleksiyonlarının ayrı tam yedeğini (örneğin Firestore managed export) alın ve geri yükleme prosedürünü doğrulayın. `sgmUsers`, `sgmDesks`, `sgmAudit`, `sgmLogs`, `sgmConfig`, `sgmDeletedUsers`, `sgmDeletedRecords`, `sgmDeviceLocks`, `sgmMessages`, `sgmViolations`, `sgmAdminSessions` ve diğer tüm koleksiyonları kapsam dışında bırakmayın. Firestore dışındaki Auth kullanıcı kayıtları ve ilgili ayarların kurtarma planını ayrıca tutun. Projeyi **yeni Firebase projesi / yeni FIREBASE_APP_ID** ile yayına almayın; mevcut veri yolunu koruyun.

1. Test/deneme ortamında yeni ZIP'in bağımlılıklarını `npm ci` ile yükleyip `npm test` ve `npm run build` çalıştırın. Canlıya hazırlık için ZIP üzerinde gerçek Firestore'la test yapmadan toplu veri taşıma/silme çalıştırmayın.
2. `firestore.rules` dosyasını mevcut Firebase projesine, diğer kuralları koruyarak kontrollü yayımlayın. Yeni `lastAutoBreakRelease` ve `deskReleasedAt` alanlarının eski istemciler tarafından üzerine yazılmasını engeller. Bu dosya kendiliğinden Firebase'e yüklenmez.
3. Vercel'de mevcut Firebase sunucu ortam değişkenlerini koruyun. Yeni ve güçlü bir **`BREAK_CRON_SECRET`** oluşturun; `CRON_SECRET` ile aynı değer olmaması önerilir. Değeri hiçbir kullanıcı ekranına, kaynak koda, URL parametresine veya herkese açık loga yazmayın.
4. Projeyi Vercel'e normal yöntemle yayımlayın. **`api/` klasöründe 12 fonksiyon vardır, 13. fonksiyon açılmadı.** Mevcut `19:00 UTC` günlük kapanış cron'u (Türkiye 22:00) değişmedi.
5. Vercel Hobby zamanlayıcısı sık aralıklı iş için yeterli değildir. **Ayrıca** yetkili bir harici HTTPS cron/zamanlayıcı sağlayıcısında her dakika aşağıdaki çağrıyı ayarlayın:

   - Yöntem: `GET`
   - URL: `https://<MEVCUT-VERCEL-ALAN-ADINIZ>/api/cron-close?task=breaks`
   - HTTP başlığı: `Authorization: Bearer <BREAK_CRON_SECRET_DEĞERİNİZ>`
   - Sıklık: `* * * * *` (her dakika). Sağlayıcının dakikada bir ve özel Authorization başlığı göndermeyi desteklediğini kontrol edin.
   - Başarılı yanıt: HTTP 200 ve `{"ok":true,"result":{"releasedCount":...,"errors":[]}}` (diğer sayılar değişebilir).
   - 401: secret/başlık yanlış; 503: görev hata verdi. Başarısız çağrıların uyarı/yeniden denemesini sağlayıcıda ayarlayın.

**Önemli:** Sadece ZIP'i yüklemek telefon kapalıyken dakikasında otomatik işlem için **yeterli değildir**. `BREAK_CRON_SECRET` ve harici periyodik tetikleme çalışır durumda olmalıdır. Dakikada bir tarama tam `00:00` anını saniyesi saniyesine garanti etmez; genelde sonraki taramada (yaklaşık 0–60 saniye içinde, ağ/gecikme ayrıca olabilir) gerçekleşir. Kesin saniye hassasiyeti isteniyorsa ayrı ücretli/sunucu destekli görev altyapısı değerlendirilmelidir.

## Canlı ortamda kontrol senaryosu

1. Deneme öğrencisiyle kısa mola başlatıp süre dolmadan QR döndürün: otomatik düşme/ihlal olmamalı.
2. İkinci mola başlatıp QR okutmayın, telefonu/interneti kapatın: takvim görevi sonunda ilgili masa boşalmış, öğrenci masası kaldırılmış olmalı.
3. Aynı masayı 30 dakika dolmadan tekrar seçmeye çalışın: öğrenciye **30 dakika engeli** gösterilmeli; başka masa seçilebilmeli.
4. Öğrencinin uygulamasını açın: “Masanız Otomatik Boşaltıldı” açıklamasını görün.
5. YP arşivinde eski 00:00 kaydını ve yeni otomatik boşaltma kaydını doğrulayın; test öğrencisinin ihlal, GM/PIN/mola hakları ve önceden kayıtlı başka öğrenciler değişmemeli.
6. Zamanlayıcıyı üst üste iki kez tetikleyin: çift masa bırakma/çift ihlal/yeni bekleme olmamalı.
7. `CRON_SECRET` ile çalışan `/api/cron-close` günlük kapanışının halen çalıştığını kontrol edin.

## Teknik notlar ve geri dönüş

- Sunucu `server/break-auto-release.js` içinde Firestore transaction kullanır. Önce masa, kullanıcı, tombstone, eski/yeni log kaydı okunur; sadece hâlâ doğrulanmış aktif ve süresi dolmuş oturum güncellenir. YP'nin silinmiş logları geri yaratılmaz.
- `api/cron-close.js` GET + ayrı secret ile dakikalık mola kontrolü yapar. Sorgular, Firestore maliyeti için yalnızca `status == on_break` ve `guestBreakEndTime > 0` belgelerini okur.
- `api/student-desk.js` sunucu isteklerinden önce süresi dolmuş masayı kontrol ederek harici cron geciktiğinde yanlış QR dönüşünü engeller. QR süresi dolduktan sonra kabul edilmez.
- `firestore.rules` ve `src/authoritative-session.js` yeni oturum alanlarını eski YP/yerel önbellekten gelebilecek yazılara karşı korur.
- Geri dönüş: **önce** harici mola zamanlayıcısını durdurun, **sonra** önceki çalışan kod sürümünü tekrar yayımlayın. Yeni kayıtlara uygulanan masa boşaltmaları otomatik geri alınmaz; sorun yaşayan öğrenciler için YP üzerinden tek tek işlem yapın. Firestore'u körlemesine eski anlık görüntüye döndürmek yeni öğrencilerin kayıtlarını kaybettirebilir.
- Bu çalışma canlı Firestore'a bağlanmadı, mevcut öğrencilerin gerçek veri yedeğini almadı ve Vercel/Firebase yayını yapmadı. Canlıda hatasız davranışı garanti etmek için kontrollü test gerekir.

## 23 Ekim 2026 — Otomatik masa boşaltma PUSH bildirimi (ek)

- **Var olan push altyapısı değiştirilmedi**: `api/send-push.js`, `public/firebase-messaging-sw.js`, iPhone/Android push kayıt ve izin ekranları, YP Push Durumu ve mevcut push tipleri aynı kodlarla bırakıldı. Yeni özellik aynı Firebase Admin Messaging/FCM servisini ayrı bir sunucu işlemi olarak kullanır. Mevcut Firestore güvenlik kuralları da korunur.
- Öğrencinin **kısa / uzun / saatlik mola** süresi bitip masa sunucuda gerçekten boşaltıldığında, **aynı Firestore transaction** içinde `sgmBreakPushOutbox` koleksiyonunda olay kimliğine bağlı **tek** bekleyen bildirim işi oluşturulur. **Kayıtlı push tokenları, kullanıcı profili, GM/PIN, ihlal verileri değiştirilmez.** Push, masa bırakma transaction'ının *dışında* gönderilir; push hatası masa boşaltmayı geri almaz.
- Dakikalık `GET /api/cron-close?task=breaks` kontrolü, süre dolan masaları bıraktıktan sonra mevcut/önceden bekleyen işleri Firebase Cloud Messaging'e gönderir. Öğrencinin telefonu veya tarayıcısı açık olmasa da sunucudan gönderim denemesi yapılır. Öğrencinin uygulama içi uyarısı ayrı olarak çalışmaya devam eder.
- Push örneği: **“Mola süreniz doldu — masanız boşaltıldı”**. Açıklama; masa numarası, kısa/uzun mola türü, bitiş saati, otomatik boşaltma, **30 dakika aynı masaya engel** ve **ihlal uygulanmadı** bilgilerini içerir. İhlal sayısı artırılmaz.
- Aynı olay birden fazla kez tetiklendiğinde kayıtlı iş `sent` ise yeniden gönderilmez. İşler FCM geçici hatalarında otomatik, en fazla 5 deneme ile tekrar denenir. Paralel çağrılar için sunucu tarafı geçici kilit kullanılır. **FCM bildirimi kabul ettikten hemen sonra sonuç kaydı yazılamayan nadir bağlantı kesintilerinde bir kez daha gönderim ihtimali tamamen sıfırlanamaz**; bildirim etiketi (`tag`) aynı olay için sabittir.
- Firebase bildirim servisi en az bir token için gönderimi kabul ederse YP arşivine `MOLA_OTOMATIK_BOSALTMA_PUSH_GONDERILDI` logu yazılır (aynı olay için tek kayıt). Bu logda kaç cihaza kabul edildiği ve saat yer alır. YP'deki önceki **00:00** ve **otomatik masa boşaltma** logları da korunur. Push logu, **okundu belgesi değildir**; öğrencinin telefonu kapalı, push izni kapalı veya geçersiz token varsa teslim/görüntüleme garanti edilmez.
- `sgmBreakPushOutbox` yalnızca yeni bildirim olaylarının durumu için **ilave** bir koleksiyondur; mevcut koleksiyonların verileri taşınmaz veya silinmez. İşler `pending`, `sending`, `sent`, `skipped` veya `failed` durumunu saklar. Tokenu olmayan ya da hesabı silinmiş öğrenciye push gönderilmez; uygulama içi uyarı ve YP otomatik boşaltma logu korunur. 24 saatten eski beklemiş işler gecikmiş/yanıltıcı bildirim olmasın diye gönderilmez. FCM mesajları web push için 24 saat TTL ile gönderilir.

### Yayında bildirimi etkinleştirme

1. Önce canlı Firestore ve Auth kayıtlarının yedeğini alın; doğru **mevcut** Firebase proje ve `FIREBASE_APP_ID` ayarlarını koruyun.
2. Mevcut FCM/Firebase sunucu ortam değişkenleri (`FIREBASE_ADMIN_*`) ve Vercel ayarlarını değiştirmeyin. Önceden kurulu olmayan harici dakikalık zamanlayıcıyı **yukarıdaki kurulum talimatları** ile (HTTPS GET + `Authorization: Bearer <BREAK_CRON_SECRET>`) devreye alın. Bu zamanlayıcı yoksa öğrenci uygulaması kapalıyken ne boşaltma ne push zamanında çalışması garanti edilir.
3. Test öğrencisinin bildirim izninin açık ve geçerli `pushTokens` kaydının mevcut olduğundan emin olun. Mola bitince cron yanıtında `push.sentCount`, `push.skippedCount`, `push.retryCount`, `push.failedCount` değerlerini izleyin; başarılı gönderimde YP arşivinde push logunu doğrulayın.
4. **iPhone özel notu:** iOS web push için desteklenen iOS sürümü, ana ekrana eklenmiş web uygulaması ve önceden verilmiş push izni gerekir. Bildirim kapalıysa veya cihaz çevrimdışıysa FCM'in kabulü tek başına ekranda göründüğünü kanıtlamaz.
5. Canlı test: kısa ve uzun mola + QR ile süresinden önce dönüş (push **yok**); kısa veya uzun mola bitişinde telefon kapalı (otomatik boşaltma ve FCM gönderimi); bildirim tokenı yok (sadece uygulama içi uyarı); dakikalık kontrolü iki kere çalıştırma (aynı olay için ikinci gönderim **yok**). YP push test ve mevcut ihbar mesajlarının hâlâ çalıştığını ayrıca doğrulayın.

Not: ZIP'teki kodu hazırlamak **canlı Vercel'e veya Firebase'e dağıtım yapmak değildir**; ne cron ne gerçek cihaz push teslimi burada canlı test edilmiştir.
