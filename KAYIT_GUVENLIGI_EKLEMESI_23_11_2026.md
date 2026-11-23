# Sarıçam GM – Kayıt güvenliği eklemesi (23.11.2026 / TEST)

Bu paket, kullanıcının gönderdiği `Saricam_GM_Kutuphane_Guncelleme_23_11_2026_TEST(1).zip` sürümü üzerine hazırlanmıştır. **Canlı Firebase'e, öğrenci hesaplarına, aktif masalara, QR kodlarına, ihbarlara, cezalara veya faaliyet kayıtlarına bağlanılmadı.** Eski verileri silen/topluca değiştiren bir betik eklenmedi. Yayın için önce yedek ve ayrı test ortamı zorunludur.

## Eklenen / düzeltilenler

1. **Google hesabı doğrulama hata açıklamaları:** `auth/unauthorized-domain`, `auth/operation-not-allowed`, ağ hatası, kullanıcı tarafından kapatılan pencere gibi durumlarda neden artık açıkça yazılır. Popup engellenirse Firebase yönlendirmesi denenir; geri dönünce öğrenci kuralları kabul edip kayıt işlemini yeniden başlatabilir. Google doğrulanmadan GM Özel Kod veya şifre oluşturulmaz.
2. **Doğrulanmış e-posta başına tek hesap:** Orijinal paketteki `sgmRegistrationEmails` sunucu transaction kontrolü korunmuştur. Aynı e-postaya ikinci kod/şifre verilmez. Aynı Google UID ile yinelenen kayıt mevcut kod/şifreyi döndürür; yeni hesap açmaz.
3. **Yeni kayıtlar için tarayıcı eşleştirmesi:** İstemcinin mevcut `sgm_device_id` değeri sunucuya gönderilir; sunucuda SHA-256 özeti `sgmRegistrationDevices` koleksiyonuna aynı Firestore transaction içinde bağlanır. Aynı tanımlayıcıyla ikinci yeni hesap engellenir. Önceden oluşturulmuş öğrenci hesaplarına geriye dönük zorunluluk getirilmez.
4. **Yeni hesapta başka cihazdan giriş:** Başka cihazla giriş denendiğinde mevcut GM Özel Kod ve şifre geçerliyse `sgmDeviceChangeRequests` içinde onay talebi oluşturulur; yeni giriş tokenı verilmez. Lider panelindeki **Cihaz Değişikliği Onayları** alanından onay veya ret verilebilir. Onay ancak öğrenciye ait aktif masa/rezervasyon yoksa gerçekleşir; QR ve ihbar verilerine dokunulmaz. Eski hesaplarda farklı cihazdan giriş davranışı korunur.
5. **Formun ikinci gönderimi:** `sgmFormSubmissions` için aynı yanıt kimliği idempotent kalır; yeni bir Google Form yanıtıyla önceden doğrulanmış yeni hesabın ikinci defa doğrulanması engellenir. Google Form'da doğrulanmış e-posta toplama + tek yanıt sınırı ayrıca açılmalıdır.
6. **Firestore kuralları:** Yeni `sgmRegistrationDevices` ve `sgmDeviceChangeRequests` koleksiyonlarına istemciden doğrudan okuma/yazma kapatıldı. Yönetici tarayıcısının gecikmiş verileri yeni eşleştirme alanlarını geri yazamaz.
7. **Sağ alt güncelleme tarihi:** Orijinal sürümde zaten bulunan `Son Güncelleme: 23.11.2026` yazısı değiştirilmeden korundu.

## Yayın öncesi ZORUNLU adımlar

1. **Firestore yedeği:** Yönetilen export/PITR veya mevcut `scripts/backup-firestore.mjs` ile güvenli, erişimi kısıtlı bir yedek alın. QR, masa, ihbar, ceza, öğrenci ve lider koleksiyonlarının dahil olduğunu doğrulayın. Form/Sheet yanıtlarını da ayrı yedekleyin. PIN ve GM kodu içeren yedeği GitHub'a yüklemeyin.
2. **Ayrı test Firebase / Vercel / Google Form / Google Sheets** kullanın. Test sürümünü canlı Firestore'a bağlamayın. Firebase Authentication > Sign-in method > Google **Enabled**; Firebase Authentication > Settings > Authorized domains içinde **tam uygulama alan adı** (Vercel önizleme adresi dahil) bulunmalı. Anonim girişi kapatmayın.
3. Google Form > Ayarlar > Yanıtlar > **E-posta adreslerini topla: Doğrulanmış** ve **1 yanıtla sınırla** ayarlarını açın. `google-apps-script/gm-kod-aktarimi.gs` dosyası ve tetikleyici `onMainFormSubmit` ile `SGM_FORM_WEBHOOK_SECRET`, `SGM_APP_URL`, `GM_CODES_SPREADSHEET_ID` ayarlarını orijinal kurulum belgesine göre yapılandırın. Bu betik dosyasında kod değişikliği yapılmadı.
4. Güncellenen `firestore.rules` dosyasını **ayrı test projesinde** yayımlayın. Mevcut Vercel Firebase Admin ortam değişkenleri korunmalı. Mevcut koleksiyonları silmeyin, toplu migrasyon çalıştırmayın.
5. Test: Google popup / redirect; aynı Google hesabıyla tekrar kayıt; aynı tarayıcıdan başka Google hesabıyla kayıt; farklı tarayıcıdan mevcut GM koduyla giriş ve lider onayı; aktif masa varken onay reddi; Google Form ilk ve ikinci yanıtı; eski öğrenci farklı cihazdan giriş; QR masa alma/dönüş, ihbar, ceza, faaliyet, otomatik kapanış. Test sonuçları uygun değilse canlıya çıkmayın.
6. Canlıya geçişi kütüphane kapalıyken, aktif masalar etkilenmeyecek şekilde planlayın. Sorun olursa Vercel sürümünü geri alın; Firestore koleksiyonlarını silmeyin.

## Gerçek güvenlik sınırları

- Web tarayıcısındaki `sgm_device_id` **fiziksel cihazın değişmez kimliği değildir**. Tarayıcı verileri silinirse veya başka tarayıcı/profil kullanılırsa yeni kimlik üretilebilir. Bu eşleştirme sıradan tekrar kayıtları azaltır; kötü niyetli kişinin farklı e-posta ve yeni tarayıcı kimliğiyle kayıt açmasını %100 engellemez. Bunun için liderin kimlik/form bilgisi kontrolü gerekir.
- Yeni cihaz onayı **yeni girişleri** kontrol eder. Önceden açılmış ve hâlâ geçerli bir öğrenci Firebase oturumunu anında uzaktan kapatma garantisi sağlamaz; fiziksel tek cihazı kesin olarak zorlamak için daha kapsamlı sunucu oturum denetimi gerekir. Mevcut QR/masa oturumuna dokunmamak için bu pakette bu alan değiştirilmedi.
- Eski kullanıcılar yeni e-posta/cihaz eşleştirmesine otomatik dahil edilmez; eski kayıtlar etkilenmesin diye geriye dönük migrasyon yoktur.
- Google doğrulaması hâlâ başarısızsa artık ekranda gösterilen **Firebase hata kodu** sorunun kaynağını bulmak için kullanılmalıdır. Sadece ZIP değiştirerek Firebase Authorized domains/Google sağlayıcı ayarları düzeltilemez.
- Gerçek Firebase/Vercel/Google Forms uçtan uca testi burada yapılmadı; sıfır veri kaybı garantisi verilemez.
