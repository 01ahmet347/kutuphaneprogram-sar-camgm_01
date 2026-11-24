# Sarıçam GM — Faaliyet kaldırma onayı (TEST)

## Kullanım

- Lider panelinde faaliyet kartının yanındaki **Kaldırma Talebi** düğmesi ile gerekçe yazılır. Talep yönetici paneline ulaşır. Liderin doğrudan silme yetkisi yoktur.
- Ana yönetici **Faaliyet Yönetimi** sekmesinde talebi **Kaldırmayı Onayla** veya **Talebi Reddet** seçenekleriyle sonuçlandırır. Yönetici ayrıca gerekçe yazarak **Yönetici Olarak Kaldır** seçeneğini kullanabilir.
- Henüz bekleyen öğrenci başvurusu varsa kaldırma onaylanamaz; lider önce bunları onaylamalı veya reddetmelidir.
- Kaldırma Firestore `sgmActivities` belgesini **silmez**; durumunu `removed` yapar. Faaliyet başvuru listelerinden kalkar, ancak yönetici geçmişinde görünür.
- Önceden onaylanmış öğrencilerin faaliyet/mola sayaçları devam eder. Öğrenci masa durumunda ve masa listesinde **FAALİYETTE** etiketi gösterilir. Mevcut QR kodu, masa belgesi, öğrenci belgesi, ihbar/ceza geçmişi ve faaliyet başvurusu bu kaldırma işlemiyle değiştirilmez.
- İşlemler `sgmActivityAudit` koleksiyonuna eklenir; kayıtlar silinmez.

## Değiştirilen kod dosyaları

- `server/activity-module.js`: kaldırma talebi, yönetici onayı/reddi, doğrudan yönetici kaldırma, işlem geçmişi.
- `api/admin-maintenance.js`: yeni eylemler; sunucu tarafında lider/yönetici rol kontrolü.
- `src/activity-ui.jsx`: lider talep ve yönetici onay düğmeleri.
- `kutuphaneprogramıguncell.jsx`: yalnızca **FAALİYETTE** durum metni; QR mantığına dokunulmadı.
- `tests/activity-module-2026-11-23.test.js`: üç yeni güvenlik regresyon testi.

## Güvenli canlıya geçiş

**Bu paket henüz canlı ortamda sınanmadı.** Yayına almadan önce Firestore yedeği alın; tercihen ayrı Firebase/Vercel test projesinde lider talebi, yönetici onayı, aktif faaliyetteki öğrenci, QR dönüş ve ihbar senaryolarını test edin. Canlı öğrenciler kullanıyorken doğrulanmamış sürümü yayınlamayın.

Bu kod güncellemesi kendiliğinden veritabanı migrasyonu, toplu silme veya aktif masa sıfırlaması yapmaz. Yine de sıfır veri kaybı garanti edilemez; bağımsız yedek zorunludur.

## Testler

`node --test tests/activity-module-2026-11-23.test.js`: 9/9 geçti.
`node --test tests/*.test.js`: 164 geçti, 9 geçmedi (6 eksik bağımlılık nedeniyle çalıştırılamayan; 3 önceden var olan sabah masa/ihbar senaryosu). Bu çalışma ortamında `npm run build` tamamlanamadı (`vite: not found`). Dolayısıyla canlı yayıma hazır olarak işaretlenmedi.
