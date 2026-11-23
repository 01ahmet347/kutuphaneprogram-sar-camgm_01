# 18 Ekim iPhone Push sürümüne eklenen mola 00:00 logu

- KAYNAK: 18 Ekim 2026 iPhone Push ZIP. **22 Ekim sabah eski masa güvenlik değişiklikleri bu pakette yoktur.**
- Öğrenci ekranında doğrulanmış saat ile mola 00:00 ise “Mola süreniz doldu, lütfen masanıza dönünüz!” uyarısı görünür.
- Öğrenci oturumu açık olduğunda mola süresi dolup QR dönüşü yapılmamışsa `/api/student-activity` üzerinde `break-expired` eylemi tetiklenir. Sunucu Firestore içindeki **güncel masa ve öğrenci oturumunu transaction içerisinde yeniden kontrol eder**; hâlâ moladaysa `sgmAudit` arşivine `MOLA_SURESI_DOLDU_DONUS_YAPILMADI` kaydını bir kez yazar. Güncel 22:00 kapanışından eski oturumlar loglanmaz.
- Bu kayıt **yalnızca sistemde QR ile dönüş olmadığına** işaret eder. Öğrencinin fiziksel olarak dönmediğinin ispatı değildir. Ekran kapalıysa/çevrimdışıysa otomatik sunucu taraması yoktur; log öğrenci ekranı yeniden etkin olup sunucuya ulaşabildiği anda oluşturulabilir, arada QR dönüşü olmuşsa log oluşmaz.
- **Ceza, masa boşaltma, 2 dakika ek süre, push gönderimi, ihlal geçmişi değişikliği YOKTUR.**
- Sadece JSX, `src/break-expiry-audit.js`, `server/student-activity.js`, `tests/break-expiry-audit.test.js` ve bu açıklama güncellendi. Kaynak ZIP’de bozuk biçimde yazılmış `kutuphaneprogram#U0131guncell.jsx` adı, `main.js` importunun gerektirdiği `kutuphaneprogramıguncell.jsx` adına dönüştürüldü.
- **YAYIN ÖNCESİ:** Firestore yedeği alın. Mevcut Vercel projesi, Firebase proje kimliği, Vercel environment değişkenleri, Firestore kuralları ve servis çalışanı aynı kalmalı. Sadece kod yayımlamak veritabanını silmez; fakat canlı erişim ve çalışan oturumlar için %100 garanti verilemez. İlk olarak bir test öğrencisinde mola bitişi ve admin logunu kontrol edin.
- Daha önce görülen HTTPS/SSL ağ hatalarını çözmez; bunlar ayrıca araştırılmalı.
