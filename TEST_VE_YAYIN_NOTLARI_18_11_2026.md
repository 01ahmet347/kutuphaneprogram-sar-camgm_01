# Test ve yayın durumu — 18.11.2026

- Kaynak kod içinde eski QR değerlerini üreten fonksiyon ve QR yedeklemesi değiştirilmedi.
- Firebase messaging service worker, manifest, ikonlar, `api/send-push.js`, `server/break-auto-push.js`, `server/break-auto-release.js`, `src/restriction-policy.js`, `firestore.rules` dosyalarının kaynak ZIP ile SHA256 içerik karşılaştırması **birebir aynı** çıktı.
- Yeni `tests/safe-update-2026-11-18.test.js` ve güncellenen masa bütünlüğü testleri çalıştırıldı: **12/12 geçti**.
- Bütün test komutu (`node --test tests/*.test.js`) **142 toplam, 133 geçti, 9 başarısız** sonuçlandı. 6 test dosyası (yönetici giriş/oturum, `closing.test.js`, `ui.test.js`) ortamda Firebase/React/npm bağımlılıkları kurulu olmadığı için yüklenemedi. 3 eski `morning-safety.test.js` testi kaynak ZIP üzerinde de başarısızdı; bu güncelleme bu ilgisiz sorunu gidermiyor.
- `npm ci --offline` denendi, eksik `yargs-parser` tarball'ı npm cache'de bulunmadığından tamamlanamadı. Bu ortamda `npm run build` çalıştırılamadı. Bunun yerine güncel React JSX kaynak dosyaları global TypeScript JSX ayrıştırıcısında ve transpilerinde **0 sözdizimi hatası** ile doğrulandı; bu, gerçek Vite derlemesinin yerini tutmaz.
- **Canlı Firebase/Firestore/FCM sistemine erişilmedi; canlı kullanıcılar/masalar bu çalışma sırasında değiştirilmedi.**

## Önemli üretim öncesi adımlar

1. Canlı Firestore veritabanının yedeği alınmalı, geri yükleme test edilmeli.
2. Ayrı Vercel test ortamına yüklenip `npm ci`, `npm test`, `npm run build` testleri tümüyle geçmeli; özellikle kaynak ZIP'deki üç sabah güvenlik testi ayrıca incelenmeli.
3. Aktif kullanıcıların sahip oldukları masa ve mola verileri birebir kıyaslanmalı.
4. Otomatik kapanış saati değişebiliyorsa `.github/workflows/sgm-automatic-closing.yml` için GitHub Actions secrets ayarlanmalı veya Vercel Pro üzerinde uygun zamanlayıcı yapılandırılmalı. Hazırdaki Vercel cron hâlâ 22.00 için günlük çağrıdır.
5. Eski QR kodları ve mevcut Android/iPhone push akışları gerçek cihazlarda denenmeden canlıya alınmamalı.

**Bu ZIP bir geliştirme adayıdır; canlı dağıtımı otomatik olarak gerçekleştirilmemiştir.**
