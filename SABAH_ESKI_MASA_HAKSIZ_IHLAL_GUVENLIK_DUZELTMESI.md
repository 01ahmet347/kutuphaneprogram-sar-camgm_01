# SGM Kütüphane — Sabah Eski Masa / Haksız İhlal Güvenlik Düzeltmesi

**Kapsam:** Yalnızca önceki günden kalmış masa/mola bilgilerinin ertesi sabah yeni ihbarla haksız cezaya dönüşmesini önlemek. **2 dakikalık ek mola + otomatik ceza özelliği BU PAKETTE YOKTUR; onay bekler.**

## Yapılanlar

- **Sunucu ihbar güvenliği:** `src/cloud-transactions.js` rapor/ihbar kabul etmeden önce ana masa oturumunun son İstanbul 22:00 kapanışından sonra başladığını doğrular. Dünden kalan veya başlangıç zamanı belirsiz oturum için ihbar açılmaz.
- **İhlal güvenliği:** Eski bir oturuma ait ihbar bir nedenle daha önce açılmışsa, 5 dakika sonraki sunucu işlemi **yeni ihlal veya kısıt üretmeden** eski masayı boşaltır (yalnız eski kullanıcının masa bağlantısını temizler). Yeni günün gerçekten alınmış masasına işlem uygulanmaz.
- **Sabah onarımı:** Öğrenci uygulamayı açıp Firestore masa listesini yüklediğinde eski kapanıştan kalma kesinleşmiş oturumlar algılanırsa doğrulanmış `/api/student-desk` işlemi (`recover-stale`) çağrılır. İşlem canlı belgeleri transaction içinde yeniden okuyup yalnız tarihleri kanıtlanmış **önceki günün** masa/rezervasyon bağlarını cezasız temizler. İşlem başarıyla tamamlandıktan sonra o gün aynı öğrenciden tekrar istenmez. Ek Vercel cron veya yeni API dosyası eklenmez.
- **Arayüz güvenliği:** Eski/belirsiz dolu masa kayıtları öğrenci ve kamu krokisinde mola/aktif masa gibi gösterilmek yerine `DOĞRULANIYOR` görünür, ihbar edilemez. Bugüne ait geçerli oturumlarda mevcut davranış sürer.
- **Dosya adı:** ZIP'te `kutuphaneprogram#U0131guncell.jsx` olarak gelen dosya, `main.js` içindeki gerçek import adıyla eşleşen `kutuphaneprogramıguncell.jsx` adına düzeltildi. İçeriği korunup yalnız yukarıdaki güvenlik kontrolleri eklendi.

## Özellikle korunanlar

- Mevcut **öğrenci hesapları**, kayıt/onay durumu, GM özel kodu, PIN/şifre, Firebase Auth kullanıcıları, QR etiketleri ve QR içerikleri
- **İhlal kayıtları**, geçmiş ihlaller, cezalar/kısıtlar, mola hakları ve geçmişi, ayarlar, öğrenci ve yönetici ekranları
- O gün gerçekten alınmış masalar ve halen geçerli rezervasyonlar
- Önceden kurulu **22:00 Vercel cron** (dosya ve cron saatleri değiştirilmedi), Firebase kuralları ve projenin canlı veri yolu

**Veri yazma sınırı:** Otomatik sabah düzeltmesi yalnız masa belgelerinin oturum alanlarını ve ilgili hesapların `activeDeskId`, `activeDeskRole`, `pendingDeskId`, `pendingDeskDeadline`, `adminDeskOverrideDeskId`, `adminDeskOverrideSessionStart` bağlantı alanlarını gerekirse sıfırlar. `sgmAudit` bölümüne cezasız düzeltme kaydı ekler. Kullanıcı belgelerini silmez. Hesap/ihlal geçmişini topluca sıfırlamaz. Başlangıç zamanı belirsiz kayıtlar **haksız ihbar için engellenir**, fakat veri kaybı olmasın diye otomatik silinmez; gerektiğinde yönetici kontrol eder.

## Canlıya almadan önce (ÖNEMLİ)

1. **Mutlaka canlı Firestore yedeğini dışa aktarın.** Bu ZIP yalnız **kaynak kodudur**; canlı kullanıcı verisi/yedeği bu ZIP'te yoktur. İndirilen eski ZIP'i ayrıca saklayın.
2. Aynı **mevcut Vercel/Firebase projesini** kullanın. `FIREBASE_APP_ID`, `VITE_FIREBASE_APP_ID`, diğer Firebase tanımları ve Vercel gizli ortam değişkenlerini değiştirmeyin. **Yeni Firebase veritabanı açmayın, veri koleksiyonlarını silmeyin, import/reset yapmayın.** Yeni `firestore.rules` yayını gerekmiyor, mevcut kurallar değiştirilmedi.
3. Önce test/staging ortamında `npm ci && npm test && npm run build` çalıştırın. Sonra canlıya tüm proje dosyalarını birlikte yükleyin (`src`, `server`, `api`, `main.js` ve doğru adlı JSX birlikte). Eski açıktaki öğrenci ve yönetici sekmelerini yenileyin.
4. Test edin: (a) Dün 21:00'de başlayan masa sabah 07:15'te görünürse **ihbar reddedilir**, ceza üretmez, açılış düzeltmesiyle cezasız boşalır; (b) bugün 07:05'te alınmış masa korunur ve normal ihbar akışı sürer; (c) hesap kodu, PIN, QR, geçmiş ihlaller ve kısıt bilgileri aynı kalır; (d) 22:00 otomatik kapanış logları ve Vercel cron çalışması doğrulanır.
5. Vercel Functions loglarında, öğrenci senkronizasyonunda ve `sgmAudit` kayıtlarında anormallik olup olmadığını izleyin. Sistem canlıya alınırken **FireStore Rules ve Firebase kimlik bilgilerini değiştirmeyin.**

## Test sınırı

- Bu çalışma ortamında **108 Node testinin 102'si geçti**. 6 test dosyası yalnız eksik kurulu `firebase-admin` / `sucrase` / React bağımlılıkları yüzünden burada başlatılamadı; uygulama canlıya bağlanmadı, Vite build ve gerçek Firestore entegrasyon testi burada yapılmadı.
- `tests/morning-safety.test.js` 6 yeni test: eski gün ihbar engeli, sabah 5 dakikalık gecikmiş cezanın engeli, güncel oturum korunması, hesap/QR/ihlal geçmişinin korunması, tekrar çalışmanın idempotentliği ve öğrenci doğrulaması.
- Günlük sabah kurtarma, ayrıca yeni bir bağımsız **07:00 cron** değildir: ilk doğrulanmış öğrenci ekranı eski kayıt görürse tetiklenir. Kapanış için mevcut 22:00 cron aynen kalır. Eski oturumdan haksız ihlal riski sunucu kontrolüyle her durumda engellenir.
- Canlı Firestore verilerinin kendi geçmiş kayıtları tarafımızdan görülmedi; önceki yanlış verilen ihlaller **otomatik silinmedi**. Yönetici canlı loglarla inceleyerek ayrı düzeltmelidir.
