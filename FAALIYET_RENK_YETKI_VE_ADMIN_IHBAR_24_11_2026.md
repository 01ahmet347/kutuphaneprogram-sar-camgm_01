# Sarıçam GM — Faaliyet Rengi, Lider Yetkisi ve Yönetici İhbarı

**TEST PAKETİ — Canlıya otomatik yüklenmemiştir.**

## Değişiklikler
- Hareketsiz masalara veya normal molalara dokunulmaz. Faaliyet onaylandığında masa yine eski `on_break` altyapısını kullanır ancak ilk 60 dakikada herkese açık masa krokisinde mor `FAALİYETTE` etiketi görünür. Onaylı 60 dakikalık faaliyet bittikten sonra eklenen 15/30 dk süresince `MOLA` etiketi kullanılır. QR içeriği değişmez.
- Yönetici lider yönetiminde kişi bazında faaliyet kaldırma yetkisini açıp kapatabilir. Yeni liderler varsayılan olarak yetkisizdir. Yetkili lider yalnızca kendi faaliyeti için gerekçeli, arşiv niteliğinde kaldırma yapabilir. Yetkisiz liderin mevcut yönetici onayı akışı sürer. Bekleyen öğrenciler önce sonuçlandırılır. Onaylı aktif faaliyet süresi kesilmez.
- Yönetici Masa Yönetimi > dolu masa ayrıntısında **Masayı İhbar Et** seçeneği görür. Sadece `occupied` masa sunucu tarafında doğrulanır, molada/faaliyette olan masa reddedilir. İşlem 5 dakika QR doğrulama süresi başlatır; ihbar edenin kimliği denetim kaydında ADMIN olarak saklanır. Öğrenci bildiriminde yalnız `Masanız İhbar Edildi!` görünür, yönetici bilgisi görünmez.
- İhbarı başlatan yöneticiye bildirim gönderme sonucu ayrıca gösterilir; cihaz push kaydı yoksa sunucu kayıtlı ihbar yine geçerlidir.

## Korunan dosyalar ve veri yapıları
- `src/cloud-transactions.js`, `server/student-desk.js`, `server/student-registration.js`, `server/form-verification.js`, `firestore.rules`, `google-apps-script/gm-kod-aktarimi.gs`, `src/archive-backup.js` önceki ZIP ile byte-byte aynıdır.
- Öğrenci/masa kayıtlarını silen, topluca göç ettiren, QR değiştiren betik eklenmemiştir. Yeni işlemler yalnız kendi butonlarına basıldığında Firestore'da gerçekleşir.
- Mevcut şifreler, GM özel kodları ve kayıtlar yeniden üretilmez.

## Canlıya almadan önce
1. Tam Firebase/Firestore dışa aktarım yedeği alın ve yedeğin okunabilir olduğunu doğrulayın.
2. Ayrı Vercel/Firebase test ortamında, dolu masa, boş masa, faaliyette masa, ek mola ve ihbarı QR ile doğrulama senaryolarını test edin.
3. Aktif masa oturumlarını ve devam eden faaliyetleri canlıya almadan önce listeleyin; yayın sonrası aynı kayıtların durduğunu karşılaştırın.
4. Gerekirse önceki dağıtıma dönün. Kod geri alma, Firebase verisini otomatik geri almaz.

## Test sınırları
- İlgili Node testleri ve JSX sözdizimi kontrolleri başarılı. Tam test paketi önceki sürümden gelen 9 başarısız/çalıştırılamayan test içerir.
- Firebase Admin bağımlılığı ve gerçek push/Firestore ortamı olmadan canlı uçtan uca test yapılmamıştır. **Sıfır veri kaybı garantisi verilmez.**
