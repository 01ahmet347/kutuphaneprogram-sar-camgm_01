# SGM Kütüphane — Güvenli Arşiv Geri Yükleme (TEST)

## Temel prensip
Bu sürüm mevcut uygulamayı sıfırdan yeniden yazmaz. Güncel tek-form kayıt sürümünü olduğu gibi korur ve **İhlal Kayıtları**, **Dilek / Şikayet**, **Sistem Kayıtları** sekmelerine JSON yedeğini indirme/geri yükleme düğmeleri ekler. Öğrenci ve QR yedek geri yükleme düğmeleri eski sürümden korunmuştur.

## Kullanım
1. Ana yönetici hesabında ilgili arşiv sekmesine gidin.
2. **JSON Yedek İndir** ile geri yüklenebilir kayıt dosyasını alın. PDF/Word/CSV dosyaları raporlama içindir; geri yüklemek için JSON gereklidir.
3. **JSON Yedeği Geri Yükle** ile aynı sekmeye ait JSON'u seçin.
4. Önizlemede eksik ve atlanacak kayıt sayılarını kontrol edin; sonra **Eksik Kayıtları Geri Getir** düğmesine basın.
5. Sistem yalnızca Firestore'da bulunmayan ve silinmiş olarak işaretlenmemiş kimlikleri ekler. Aynı dosyayı bir daha yüklemek var olan belgelerin üzerine yazmaz.

## Güvenlik ve sınırlamalar
- Başka sekmeye ait JSON ve bozuk/tekrarlı kimlik içeren dosyalar kabul edilmez.
- Yalnızca ana yönetici ekranında çalışır; aktif Firestore bağlantısı gerekir.
- Mevcut öğrenciler, hesap şifreleri, masa oturumları, QR'lar ve cezalar bu işlemde yeniden yazılmaz.
- Eski bir belgede aynı kimlik varsa mevcut belge korunur. Bilerek silinen kayıtlar otomatik geri getirilmez.
- JSON dışa aktarma **ekranda/senkronizasyonda o anda yüklenmiş kayıtları** kapsar; sayfalanmış eski sistem kayıtları varsa önce **Eski Kayıtları Yükle** işlemini yapın. Tam Firestore yedeğinin yerine geçmez.
- Büyük arşivlerde işlem kayıt kayıt çalışır. Bağlantı kesilirse daha önce eklenen kayıtlar kalır; aynı dosya yeniden denenebilir.
- Herhangi bir canlı yayından önce Firebase/Firestore bağımsız tam yedeği alın, test Firebase projesi üzerinde doğrulayın.
- 23 Kasım paketindeki Google Form kurulumu / mevcut tek-form akışı değişmemiştir. Bu paket Google Apps Script yapılandırmasının çalıştığını ispatlamaz.

## Test özeti
- `archive-backup-restore.test.js`: 2 test geçti.
- Kaynak JSX sözdizimi kontrolü geçti.
- Mevcut test kümesinde 159 başarılı / 9 başarısız veya çalıştırılamayan test bulunuyor. Bu testlerden bir kısmı eksik node bağımlılıkları yüzünden çalıştırılamadı; ayrıca önceden bulunan sabah masa/ihbar senaryoları başarısız. Dolayısıyla canlı dağıtım henüz önerilmez.
- Bu ortamda `vite` bağımlılığı tam olmadığı için üretim derlemesi doğrulanamadı.
