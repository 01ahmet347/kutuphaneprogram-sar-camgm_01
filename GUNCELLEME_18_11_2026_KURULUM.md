# Sarıçam GM — 18.11.2026 güvenli güncelleme

## Her şeyden önce

Bu arşiv yalnızca **kaynak kodudur**; canlı Firestore verilerinin yedeği değildir. Canlıya almadan önce Firestore veritabanını tam yedekleyin, test ortamında geri yükleyin, `sgmDesks`, `sgmUsers`, `sgmAudit`, `sgmConfig` koleksiyonlarını ve yeni `sgmDailyClosures` koleksiyonunu kontrol edin. Yayın sırasında **Firestore'u sıfırlamayın**; mevcut belgeleri silmeyin veya yeniden oluşturmayın. Aktif masaları mümkünse kapanış sonrasında bir sürüm geçişiyle koruyun. Test ve yedek olmadan üretimde %100 veri kaybı garantisi verilemez.

## Neler değişti

- Giriş alt yazısı 18.11.2026 sürüm tarihini gösterir.
- Yönetici paneli **sekme gezinmeleri artık yeni `ADMIN_SEKME` audit kaydı üretmez**. Eski loglara hiçbir silme/taşıma uygulanmaz.
- Kısıt düzenleme doğrudan sunucu işlemine gider; ilgisiz kuyruğu ve ikinci zorunlu token yenilemesini beklemez. İsteğe zaman aşımı konuldu. Kısıtlama nedeni öğrenci ekranında gösterilir.
- Sistem ayarları yönetici yetkili sunucu transaction'ı ile güncellenir. Mola hakkı sayısı değişirse kullanıcıların **yalnızca `breaks` alanı**, daha önce kullandıkları haklar hesaba katılarak uyarlanır. Oturum, QR, PIN, bildirim tokenı veya geçmiş kayıt alanları değiştirilmez. Süre değişikliği başlatılmış molaların bitiş zamanını geriye dönük değiştirmez.
- Manuel masa atama arama alanı eklendi.
- Öğrenci girişinden sonra isteğe bağlı **GM özel kodunu bu cihazda hatırla** sorusu eklenir. Şifre **localStorage'a kaydedilmez**; tarayıcının yerleşik şifre yöneticisi için `autocomplete` kullanılır. Paylaşılan cihazda "Şimdi değil" seçin.
- Yönetici girişine bağımlı, sık tekrarlanan çevrim içi genel sıfırlama akışı kaldırıldı. Çevrimdışı/yerel modun mevcut davranışı korunur.
- Sunucu kapanış saati, canlı `sgmConfig/settings` belgesinden okunur. Kapanıştan önce veya ertesi gün açılış başladıktan sonra masalara dokunulmaz. Gün sonu molaları sonraki kullanım günü için bir kere yenilenir. `sgmDailyClosures` sadece **yeni** kapanış kayıtları için kullanılır ve yönetici ayarlarında geçmişi okunur.
- QR üretim/değer, FCM push gönderme, service worker, manifest ve bildirim kuralları değiştirilmedi.

## Zamanlayıcı — önemli, kurulum gerektirir

Mevcut `vercel.json` Vercel Hobby ile uyumlu günlük **19:00 UTC = 22:00 Türkiye** cron kaydını korur. Sistem bu çalışmada sunucudaki geçerli kapanış saatini dikkate alır, fakat **günde bir kez 22:00'de çalışan cron, kapanış saatini örneğin 23:00'e değiştirdiğinizde 23:00 kapanışını tek başına zamanında yapamaz.**

Panelde değiştirilebilen kapanış saatine uygun sunucu otomasyonu için *bu dosyayla verilen* `.github/workflows/sgm-automatic-closing.yml` iş akışını kullanın. GitHub deposunun `main` varsayılan dalına yüklendikten sonra **Settings → Secrets and variables → Actions** kısmına aşağıdakileri ekleyin:

- `SGM_CRON_URL`: `https://SIZIN_ALAN_ADINIZ/api/cron-close`
- `SGM_CRON_SECRET`: **Vercel proje ayarlarındaki `CRON_SECRET` ile birebir aynı gizli değer** (secrets'ı repoya koymayın).

GitHub Actions workflow, yaklaşık 5 dakikada bir sunucuya güvenli kontrol çağrısı yapar. Gerçek kapanış yalnızca ayarlanan saat geçince ve sadece o kapanış günü için uygulanır; önceki kapanış markeri aynı işlemin tekrar yapılmasını önler. GitHub zamanlanmış işler gecikebilir veya durdurulabilir; kesin dakika garantisi yoktur. Cron'un canlı ortamda başarılı çalıştığını üretim loglarında doğrulayın.

Vercel Pro tarafında aynı URL'yi daha sık çağıran bir cron kullanılabilir; Vercel planınızı doğrulamadan `vercel.json` günlük zamanlayıcısını silmeyin veya dakikalık ayara dönüştürmeyin.

**Not:** Bu iş akışı yalnızca gün sonu kapanışını çağırır. Önceden kurulu mola bitimi/dakikalık push zamanlayıcısını (`?task=breaks`, `BREAK_CRON_SECRET`) değiştirmez veya onun yerine geçmez.

## Kontrollü test senaryoları

1. Kapanış saati 22:00 iken 21:59'da aktif masalar korunuyor mu; 22:00 sonrası yalnızca gün sonu masaları boşaltılıyor mu?
2. Kapanışı 23:00 yapın; 22:15'te aktif masalar, QR ve mola süresi etkileniyor mu; 23:00 sonrası kapanış işliyor mu?
3. Kapanış isteğini iki kez çağırın: ikinci çağrı yeniden mola hakkı yazmamalı, eski audit kayıtlarını silmemeli.
4. Bir öğrencinin kısıt süresini ve nedenini değiştirin; diğer hesap/masa/QR korunuyor mu? Hata senaryosunda ekran sonsuza kadar beklemiyor mu?
5. Mola sayısını arttırıp azaltın; aktif molanın kalan süresi, daha önce kullanılan haklar ve geçmiş loglar korunuyor mu?
6. Manuel masa atamada arama yapın; aktif bir masayı yanlışlıkla başka öğrenciye atamıyor mu?
7. Geçmiş `ADMIN_SEKME` logları hâlâ var mı; yeni sekme geçişleri yeni log oluşturmuyor mu?
8. Android/iPhone push bildirimleri ve eski basılı QR ile masa alma/iade işlemleri eskisi gibi çalışıyor mu?

## Geri dönüş

Eski kaynak ZIP dosyasına dönülebilir. **Firestore belgelerini eski localStorage görüntülerinden toplu yazmayın**. Gerekirse önceden test edilmiş veritabanı yedeği ve uzman onaylı veri geri dönüşü uygulayın. Gün sonu işlemini canlıda test etmeden önce mevcut kullanıcıların ve aktif masaların ekran görüntüsünü/yedeğini alın.
