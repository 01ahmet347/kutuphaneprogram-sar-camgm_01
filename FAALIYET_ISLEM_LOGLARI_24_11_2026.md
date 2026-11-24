# Sarıçam GM — Faaliyet ve mola işlem kayıtları (test paketi)

## Bu güncellemede değişenler
- `server/activity-module.js`: Önceden mevcut `sgmActivityAudit` kayıtlarına ek olarak, faaliyet başvurusu, lider onayı/reddi, faaliyete eklenen 15/30 dakikalık mola ve faaliyet yönetim işlemlerini **aynı Firestore transaction** içinde `sgmAudit` (ana yönetici sistem kayıtları) koleksiyonuna da yazar.
- Genel loglar, öğrenci kimliği (`userId`), varsa GM Özel Kodu (`userInfo`), masa (`deskId`), lider kimliği, işlem zamanı, faaliyet kimliği ve ek mola dakikasını içerir. Kod, öğrencinin şifresini kaydetmez.
- `tests/activity-audit-integrity-2026-11-24.test.js`: Günlük olaylarının iki arşive yazıldığını doğrulayan ek statik regresyon kontrolleri.

## Önceden var olan ve değiştirmediğimiz davranışlar
- Normal mola başlatma/birleştirme zaten `sgmAudit` içine `MOLA_BASLATILDI_SUNUCU` olarak kaydediliyordu; `mergedWith` ile birleştirme bilgisi bulunuyor.
- Mola bitiminde QR ile dönülmemişse sunucudaki `releaseExpiredBreak` işlevi oturumu doğrular, masa boşaltır ve 30 dakika aynı masayı almama süresi uygular. `MOLA_SURESI_DOLDU_DONUS_YAPILMADI` ve `MOLA_SURESI_DOLDU_MASA_OTOMATIK_BOSALTILDI` logları oluşturur. Bu işlem yeni ihlal puanı vermez.
- QR kod üretimi ve doğrulaması, öğrenci bilgileri, masa işlemleri, ihbar/ceza kuralları ve mevcut Firebase verileri için kod değişikliği yapılmadı.
- Faaliyet 60 dakikalık özel mola; faaliyete 15/30 dakika normal mola eklenirse birleştirme hakkı harcanır.

## Güvenli canlıya alma
1. Canlı Firestore'u bağımsız yedekleyin, yedeği geri yükleme açısından test edin.
2. Ayrı Firebase/Vercel test ortamında yeni ve mevcut öğrenci oturumlarını, QR dönüşlerini, 00:00 oturum boşaltmasını ve 30 dakika bekleme kuralını doğrulayın.
3. Otomatik boşaltmanın işleyebilmesi için mevcut harici scheduler/cron tetikleyicisinin çalıştığından emin olun.
4. Aktif öğrenciler varken dağıtım öncesinde uyumluluk kontrolü yapın. Kod paketi canlı Firebase'e hiç bağlanmamıştır; sıfır veri kaybı garanti edilemez.

## Test özeti
- 177 testten 168'i geçti, 9'u başarısız veya bağımlılık eksikliği nedeniyle çalışmadı.
- Yeni faaliyet audit testleri ve mevcut faaliyet/mola otomatik boşaltma testleri geçti.
- Kalan 9 sorun 5 adet ortam bağımlılığı gerektiren dosya yükleme testi ve 3 adet eski sabah masa/ihbar senaryosu, 1 ek UI testi yükleme hatasıdır; bunları canlıya çıkmadan önce çözün.
