# PC yönetici oturumu düzeltmesi — 13.10.2026 (2026.10.13.2)

Bu paket bir önceki 2026.10.13.1 projesindeki bütün düzenlemeleri korur. **Yalnızca yönetici oturumunun yanlış sonlanması** için ek düzeltme içerir.

**Sorun:** PC tarayıcısında Firestore `sgmAdminSessions/active` dinleyicisi ilk olarak önbellekteki eski değeri döndürdüğünde, geçici ağ hatası veya `permission-denied` aldığında yönetici gerçek oturumu geçerli olsa dahi birkaç saniye içinde giriş ekranına gönderiliyordu.

**Düzeltme:** Yeni `/api/admin-session` endpoint'i Firebase kimliğini ve en son etkin yöneticinin sunucu oturumunu doğrular. Tarayıcı ancak sunucu **403 `admin_session_replaced`** cevabını doğrularsa mevcut yönetici oturumunu kapatır. Önbellek veya geçici bağlantı/izin hatası çıkışa neden olmaz. Etkin yönetici bilgisi gerçek zamanlı dinlenmeye devam eder; buna ek olarak açık sekmede periyodik, sekmeye dönüşte ve internet geri geldiğinde sunucu kontrolü vardır. Diğer yönetici giriş yaparsa **yalnızca son giriş yapan yönetici yetkili kalır**. Sunucu API ve Firestore kural kontrolleri kaldırılmadı.

**Yayın:** `api/admin-session.js` dosyası, React istemcisi ve `server/admin-session.js` **aynı dağıtımda** yayımlanmalıdır. Önceki `firestore.rules` içindeki en son yönetici kontrolünü kaldırmayın; önceki paketteki gibi bu kuralların Firebase'de yayımlandığından emin olun. Yeni ortam değişkeni veya kullanıcı kodu/QR güncellemesi gerekmiyor.

**PC üzerinde kontrol:** Son giriş yapan olarak PC'de yönetici paneline giriş yapın; en az 2 dakika açık bırakın, sayfayı yenileyin ve kullanıcı listesini açın. Telefon zaten yönetici panelindeyse PC girişi telefondaki eski oturumun yetkisini iptal etmelidir; telefon daha sonra yeniden giriş yaparsa PC oturumunun kapanması **istenen tek-yönetici kuralıdır**. PC'de açılır açılmaz tekrar giriş ekranına dönme yaşanırsa Vercel logları ve tarayıcı geliştirici konsolunda `/api/admin-session` dönüş kodunu kontrol edin. Bir hatada kullanıcı kodlarını, PIN'leri veya Firebase private key'i paylaşmayın.

**Yerel doğrulama:** Node birim testleri 69/69 başarılıdır. Bu ortamda native Vite derlemesi Windows tabanlı eski `node_modules` nedeniyle doğrulanamıyor. Canlı ortam testi ve Firebase güvenlik kuralı yayını ayrıca yapılmalıdır.

---

# Sarıçam Gençlik Merkezi – 13.10.2026 düzenleme notları

**Durum:** Kod hazırlığı ve yerel birim/ekran testleri tamamlandı. Canlı Firebase / Vercel yayını **yapılmadı**. Bu paket otomatik olarak canlı sistemi değiştirmez.

## Konuşulan kuralların uygulaması

- Mola: Evet/Hayır onayı, mevcut mola zamanından geri sayım, erken veya süresi geçmiş mola için QR ile geri dönüş. **Mola bitişi tek başına ceza vermez.** Biten mola ihbar edilebilir.
- İhbar: 5 dakikalık QR doğrulama süresi. Süresinde doğrulama ihbarı iptal eder. Süresi geçmiş geçerli ihbar bir kez ihlal yazar ve masayı boşaltır. Eşzamanlı işlemler Firestore transaction ile çakışmaya karşı korunur.
- İhlal: Mevcut `violationHistory` verisi korunarak son 7 günde iki ihlale 7 gün kısıtlama (`restrictedUntil`) uygulanır. Günlük sayaçlar ve geçmiş kayıtlar ayrı tutulur.
- Gönüllü masa bırakma: Yalnızca bırakılan masaya 30 dakika bekleme; farklı uygun masa seçilebilir.
- Yönetici: Onaylanmış cezalı kullanıcıya özel istisnayla masa atar; kısıtlama ve ihlal geçmişi değiştirilmez. Aynı masa iki kullanıcıya atanamaz. Dolu masayı onayla ve sunucuda audit kaydıyla, cezasız boşaltır.
- Tek yönetici: Yeni yönetici girişinde `sgmAdminSessions/active` belge kimliği yenilenir; Rules ve sunucu API'leri yalnızca en son oturuma izin verir. Öğrencilerin oturumları bu işlemden etkilenmez.
- Hesap kaydetme: Yönetici kullanıcı yazmaları başarısız «devam eden işlem» uyarısı üretmek yerine sıraya girer.
- 22.00: `/api/cron-close` ve `vercel.json` içindeki günlük `0 19 * * *` (UTC) zamanlayıcısı, Türkiye saati 22.00'de 35 masayı ve rezervasyonları **cezasız** kapatmak için eklenmiştir. Masa/hesap/QR kimlikleri değiştirilmez. İşlem günlük işaret belgesi ile tekrara karşı korunur. Gece kapanışını aşan gecikmiş ihbarlar ayrıca cezalandırılmaz.
- Giriş/işlem kayıtları: Öğrenci audit izin listesi genişletildi; değişmeyen bildirim tokenı yeniden yazılmaz; öğrenci giriş denemesi limiti IP + GM kod, yeni kayıt limiti doğrulanmış anonim oturum + IP (ayrıca ortak ağ üst sınırı) temelinde tutulur; başarılı giriş sayaç silme sorunu nedeniyle başarısız olmaz.
- Sabit QR değerleri, GM özel kodlar, PIN'ler, hesap kimlikleri, kroki ve görünüm korunur.

## Canlı yayına geçmeden önce **zorunlu adımlar**

1. **Firestore veritabanının yedeğini alın.** Özellikle `sgmUsers`, `sgmDesks`, `sgmConfig`, `sgmAudit`, `sgmViolations`, `sgmAuthCodes`, `sgmDeletedUsers`, `sgmDeviceLocks` ve diğer `sgm*` koleksiyonlarını güvenli bir şekilde yedekleyin. Bu dosya paketi canlı veritabanı yedeği içermez.
2. Aynı Firebase projesini, aynı `VITE_FIREBASE_APP_ID` / `FIREBASE_APP_ID` uygulama veri yolunu ve aynı yetkili domaine erişimi kullanın. **Bu kimlikleri değiştirirseniz mevcut kullanıcı verileri görünmez.**
3. Vercel Production ortam değişkenlerinde mevcut Firebase, Admin SDK ve yönetici bilgilerini koruyun. **Yeni olarak güçlü, rastgele `CRON_SECRET`** tanımlayın. Gerçek `.env`, servis hesabı private key veya PIN listesi bu dağıtım ZIP'ine kasıtlı olarak eklenmedi. Mevcut gizli ortam değişkenlerinizi kendiniz taşıyın.
4. Önce Vercel'de **yeni kaynak kodu ve API'leri** yayımlayın. Sonrasında `firestore.rules` dosyasını Firebase Console/CLI üzerinden uygun proje için **ayrıca yayınlayın**. Vercel deployment kuralları Firebase'e otomatik yayınlamaz. Kural güncellemesi eski yönetici oturumlarını geçersiz kılar; yöneticinin yeni sürümden **yeniden giriş yapması** gerekir. Öğrenci kullanıcılarına toplu çıkış yaptırılmaz.
5. Vercel projenizde Cron Jobs etkin ve güncel plan için günlük UTC 19.00 çalıştırma destekli olmalıdır. Vercel Logs'ta `/api/cron-close` yanıtını doğrulayın. Plan sınırları, cron gecikmesi, sunucu hatası veya kota aşımı nedeniyle kapanışın milisaniyesi garanti edilemez.
6. Test ortamında: eski hesabın QR'sı, yeni kayıt ve onay, cezalıya atama, kendi bırakılan masa için 30 dk, farklı masa alma, iki eşzamanlı masa seçimi, mola geri sayımı/erken QR dönüş, mola aşımı/ihbar/5 dk doğrulama, geçerli ihbarın tek ihlal yazması, 21.58 ihbarı / 22.00 kapanışı, toplu kısıt kaldırma, tek aktif yönetici, Android bildirimleri, internet gidip gelmesi ve güncelleme sırasında oturumun korunmasını doğrulayın.
7. Production'da `npm ci`, `npm test`, `npm run build` komutlarını **o platform için yeniden kurulmuş `node_modules` ile** çalıştırın. Windows kaynaklı `node_modules` klasörünü Linux build ortamına kopyalamayın. ZIP içinde `node_modules` yoktur.

## Yerel test doğrulaması (13.10.2026)

- Node testleri: **63/63 başarılı**. Transaction örnekleri gerçek Firestore Emulator yerine bellek içi simülasyon kullanır.
- JSX sözdizimi, bütün API / sunucu JS dosyaları ve mevcut React ekranlarının sunucu render kontrolleri başarılı.
- Bu çalışma ortamında mevcut bağımlılıklar Windows platformu için derlenmiş olduğundan Vite'nin Linux-native paketleri (`esbuild`, `rollup`) eksikti. **Tam `npm run build` doğrulanamadı.** Hedef işletim sisteminde `npm ci && npm test && npm run build` gereklidir.
- Canlı Vercel deployment'ı, Firebase Rules Simulator/Emulator kontrolü, gerçek push bildirimi, Android pil davranışı ve üretim cron çalışması **henüz doğrulanmadı**.

## Bilinen sınırlar

- Firebase istemci kimliği `browserSessionPersistence` ile sekme oturumu olarak korunur. Sayfa yenileme ve geçici ağ sorunu sırasında kurtarma sağlanır; **tarayıcının oturum verileri tamamen silinir veya tarayıcı tüm sekmelerle kapatılırsa yeniden giriş gerekebilir**. Bunun tüm cihazlarda kesin olarak devam edeceği söylenemez.
- İhbar zaman aşımı sunucuda transaction ile işlense de bir cihaz isteği veya çalışan API tetiklenmesi olmadan dakikası dakikasına işlenmesi için ayrıca sık aralıklı arka plan görev altyapısı gerekir. Mevcut yeni cron özellikle **22.00 kapanışı** içindir.
- İlk kullanım pil optimizasyonu yönergesi Android sistem ayarının yerine geçemez; tarayıcı işletim sistemi iznini kendisi veremez.
- Yeni sürümü canlıya alınca aynı veri tabanına yazmaya devam edebilen **eski açık sürümler** değerlendirilmelidir; geçişi test etmeden eski istemcilerle üretim üzerinde çalıştırmayın.

## Değiştirilen / eklenen ana kodlar

`kutuphaneprogramıguncell.jsx`, `src/cloud-transactions.js`, `src/sync-core.js`, `server/student-auth.js`, `server/student-activity.js`, `server/admin-session.js` (yeni), `server/daily-close.js` (yeni), `api/admin-login.js`, `api/admin-student-create.js`, `api/admin-desk.js` (yeni), `api/send-push.js`, `api/student-login.js`, `api/student-desk.js`, `api/cron-close.js` (yeni), `server/student-desk.js`, `firestore.rules`, `vercel.json`, `src/version.js`, `public/version.json`, ilgili test dosyaları. Mevcut kapsam dışı uygulama özellikleri kasıtlı olarak kaldırılmadı.
