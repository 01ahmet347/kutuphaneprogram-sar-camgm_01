# Masa/öğrenci kaydı ve kapanış düzeltmesi — 15.10.2026

## Giderilen sorunlar

1. Yönetim ekranında Masa 9 gibi bir masa **boş** görünürken kullanıcı belgesinde `activeDeskId: 9` kalabiliyordu. Yönetici boş masaya **Boşalt** dese bile eski sunucu uygulaması işlemden erken çıkıyordu.
2. 22.00 kapanışında masa ile öğrenci belgelerinin birlikte temizlenmesi gerekiyordu. Günlük kapanış işareti varsa işlem yeniden kontrol yapılmadan çıkıyordu; sonradan ortaya çıkan eski bağlantılar kalabiliyordu.
3. Eski tarayıcı sürümünün kapalı saatlerde yaptığı gecikmiş masa/rezervasyon yazmaları, kapanıştan sonra dolu masa görünümünü geri getirebiliyordu.
4. Yönetici **Günü Kapat / Sıfırla** işleminde, kullanıcıya başarılı mesajı gösterilirken sunucu güncellemesi hâlâ bekliyor olabiliyordu.

## Düzeltmeler

- `api/admin-desk.js`: Boş masa için bile **tüm öğrenci kayıtları** incelenir; sadece o masaya işaret eden aktif/rezerve/istisna bağlantıları silinir. Sunucu işlemleri Firestore transaction ile yapılır, ihlal uygulanmaz.
- `api/admin-desk.js`: `repair` işlemi canlı kullanıcı ve masa koleksiyonlarını tek transaction içinde karşılaştırır. Gerçek ana masa sahibi, gerçek misafir ve süresi dolmamış geçerli rezervasyon korunur. Diğer kullanıcıların boşa düşmüş bağlantıları onarılır.
- `kutuphaneprogramıguncell.jsx`: Kayıtlı Kullanıcılar bölümüne **Masa-Hesap Uyuşmazlığını Onar** butonu ve ekranda görünen tutarsızlık sayısı eklenmiştir. İşlem sonucu kaç öğrencinin düzeltildiği görüntülenir.
- `server/daily-close.js`: 22.00 cron'u, masa boş bile olsa tüm öğrencilerin eski bağlantılarını kaldırır; günlük işaret bulunsa dahi tekrar taramaya izin verir. Cezasız masa boşaltmaları sunucu denetim günlüğüne de yazılır.
- `src/session-write-guard.js`: Kapanış sonrası/ertesi sabah açılış öncesi yerel tarayıcının eski oturumları tekrar yazmasına engel olur; temizleme yazıları ve masa QR alanları korunur.
- Yönetici **Günü Kapat / Sıfırla** işlemi önce sunucu transaction sonucunu bekler, hata varsa başarılı mesajı göstermez.

## Canlıya uygulama

1. **Önce canlı Firestore yedeği alın.** ZIP içinde canlı kullanıcı verileri yoktur. Bu dosyalar tek başına canlı hesapları değiştirmez.
2. Tüm kaynak kodu mevcut **aynı Vercel projesine** yükleyin. Mevcut Firebase projesini, `VITE_FIREBASE_APP_ID` / `FIREBASE_APP_ID` değerlerini ve Auth ayarlarını değiştirmeyin. `api`, `server`, `src` ve JSX dosyasının tamamı birlikte yüklenmelidir.
3. Vercel **Production** ortamında `CRON_SECRET`, `FIREBASE_ADMIN_PROJECT_ID`, `FIREBASE_ADMIN_CLIENT_EMAIL`, `FIREBASE_ADMIN_PRIVATE_KEY` ve `FIREBASE_APP_ID` ayarlarının doğruluğunu kontrol edin. `vercel.json` zamanlaması `0 19 * * *` UTC = Türkiye'de 22.00'dir. **Vercel Cron Jobs ve Function Logs** üzerinden isteğin başarıyla işlendiğini doğrulayın. Cron plan sınırları ve çalışma gecikmeleri koddan giderilemez.
4. Yayımlama sonrası yönetici paneli → **Kayıtlı Kullanıcılar** → **Masa-Hesap Uyuşmazlığını Onar** seçeneğine bir kez basın. Bu adım canlıda bulunan eski öğrenci bağlantılarını temizler; geçerli yeni oturumlara dokunmaz.
5. Yönetici paneli ve öğrenci ekranını yenileyin. Masa 9 ve diğer boş masalar için **Aktif Masa: Yok** görünmeli. 22.00 kapanışını ve loglarını canlı ortamda gözlemleyin.
6. Kodu canlıya yayımlamak eski uygulama sekmelerini kendiliğinden kapatmaz. Yönetici/öğrencilerin eski sekmeleri yenilemesi önerilir.

## Korunan veriler

PIN/8 haneli şifre, GM özel kodu, basılı QR kodları, kısıt/ihlal geçmişi, loglar, öğrencilerin hesapları ve doğrulanmış yeni masa oturumları silinmez. Sadece eski masa ve rezervasyon bağlantıları temizlenir. Manuel **Günü Kapat / Sıfırla** düğmesinin uygulamadaki **günlük ihlal sayaçlarını sıfırlama** davranışı aynen korunmuştur; bunu genel tutarsızlık onarma düğmesiyle karıştırmayın.

## Yerel doğrulama

`node --test tests/desk-reconciliation.test.js tests/sync.test.js tests/student-desk.test.js`: 54 test geçti. `api/admin-desk.js`, `server/daily-close.js`, `server/desk-integrity.js` ve `src/session-write-guard.js` sözdizimi; JSX dosyası TSX parse kontrolü başarılı. Bağımlılıkları internet olmadan kurmak mümkün olmadığı için `npm ci`, tam `npm test`, `npm run build`, gerçek Firebase Emulator/üretim Firestore veya Vercel cron testi burada tamamlanamadı. Yayımlamadan önce projenin kurulum/test/derlemesi canlı ortamdaki pipeline'da doğrulanmalıdır.
