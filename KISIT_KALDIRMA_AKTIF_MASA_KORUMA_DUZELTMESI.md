# Kısıt kaldırma / aktif masa koruma — 17 Ekim 2026

## Yaşanan sorun
Sorumlu öğrencinin kısıtını kaldırdıktan sonra öğrenci masa seçebiliyor; daha sonra eski yetki verisi / gecikmiş ihbar / eski ihlal geçmişi tekrar kısıta yol açabiliyor ve masa tarayıcı tarafından otomatik boşaltılabiliyordu.

## Bu sürümde yapılanlar
- Sunucu hesabın onaylandığı anı `restrictionClearedAt` olarak yazar. Eski `violationHistory`, `strikes`, mola hakları, şifreler, GM özel kod ve masa oturumları **silinmez**.
- İki ihlal / 7 gün kuralı yalnızca son onaydan **sonra gerçekleşen** ihlalleri sayar. Onay sonrası gerçek iki yeni ihlal olursa normal kısıt çalışır.
- Kısıt onayından önce açılmış bir QR ihbarı, onaydan sonra gecikmiş olarak kapanırsa masayı boşaltmaz ve yeni ceza üretmez.
- Canlı Firebase oturumları, yönetici tarayıcısında eski kısıt göründü diye yerel olarak boşaltılmaz. Gerçek QR/ihbar zaman aşımı ve normal ayrılma işlemleri sunucu transaction'ları üzerinden işlemeye devam eder.
- Yönetici hesap düzenleme ve ihbar yetkisini geri açma işlemleri sunucu API'sinden yürür. Aynı hesapta daha sonra gerçekleşen onay/kısıt değişiklikleri, eski form kayıtlarının yetki alanlarını üzerine yazmasını engeller.
- Arka plandaki yönetici senkronizasyonu artık hesap yetkisi alanlarını yazmaz. Firebase güvenlik kuralları da **eski açık yönetici sekmelerinin** doğrudan bu alanlara yazmasını engeller.

## Yayına alınması
1. Mevcut canlı Firebase verilerini yedekleyin. Bu paket hiçbir canlı veriyi otomatik dönüştürmez, sıfırlamaz veya aktif masaları topluca boşaltmaz.
2. Uygulamayı ve Vercel sunucu fonksiyonlarını **birlikte** yayınlayın (`api/admin-maintenance.js` güncellendi; yeni API dosyası eklenmedi).
3. Yeni API yayında olduktan sonra, paketteki `firestore.rules` dosyasını kendi Firebase projenize deploy edin (`firebase deploy --only firestore:rules`). Bu adım atlanırsa eski açık sekmelerin yetkileri geri yazmasını engelleyen **sunucu kuralı** devreye girmez.
4. Yönetici panelinde çalışan eski açık sekmeleri yeni sürüme yenileyin. Eski sekmelerin doğrudan kısıt düzenlemesi, yeni kural yayınlandıktan sonra reddedilir; güncel panel API üzerinden işlem yapar.
5. Kısıtlı örnek bir hesapta onay -> masa seçme -> QR -> bekleme senaryosunu canlıya almadan önce bir test ortamında doğrulayın. Eski ihlaller görünür kalmalı; masa ve mola kayıtları değişmemeli.

## Test durumu
- Eklenen 5 regresyon testi ve mevcut ilgili testler başarıyla çalıştı.
- JSX/JS kaynak dosyaları TypeScript sözdizimi ayrıştırıcısıyla ayrıca kontrol edildi.
- Tam `npm test` denemesinde 99 testten 93'ü geçti. Kalan 6 test bu ortamda `firebase-admin` veya `sucrase`/`react` paketleri kurulu olmadığı için **başlatılamadı**; bunların mantıksal olarak geçtiği iddia edilmiyor.
- Gerçek Firebase bağlantısında uçtan uca test ve üretim yayını **yapılmadı**.

## Değişen dosyalar
`server/user-approval.js`, `api/admin-maintenance.js`, `api/student-desk.js`, `src/restriction-policy.js` (yeni), `src/authoritative-session.js`, `src/cloud-transactions.js`, `kutuphaneprogramıguncell.jsx`, `firestore.rules`, `tests/firestore-rules.test.js`, `tests/restriction-lift-regression.test.js` (yeni).
