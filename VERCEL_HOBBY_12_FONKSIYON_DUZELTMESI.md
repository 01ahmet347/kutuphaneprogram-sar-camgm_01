# Vercel Hobby 12 Function Sınırı — Düzeltme

**Görülen hata:** Hobby planında en fazla 12 Serverless Function.

Önceki pakette `api/` içinde 13 ayrı `.js` dosyası vardı. Bu pakette:

- `/api/version` ve `/api/server-time` tek bir fonksiyonda birleştirildi.
- `api/version.js` kaldırıldı; **özellik kaldırılmadı**. `/api/version`, `vercel.json` içindeki rewrite ile aynı JSON yanıtını üretmeye devam eder.
- `/api/server-time` yine `{ ok: true, at: <sunucu zamanı> }` üretir; sayaç için kullanılan yanıt değişmedi.
- Diğer API dosyaları, cron işi ve Firebase kuralları değişmedi.
- Sonuç: `api/` klasöründe **12 API fonksiyonu** var.

## Yayına alma

1. Önce canlı Firestore verilerinin yedeğini alın.
2. Bu klasörü proje kökü olacak şekilde Vercel'e yükleyin (ZIP içindeki `kutuphane-programi-2026-10-07` klasörü).
3. Vercel Build Logs bölümünden derlemenin tamamlandığını doğrulayın.
4. Yayımdan sonra `/api/server-time` ve `/api/version` uçlarını açıp JSON yanıtlarını doğrulayın.
5. Masa/mola güncellemesinin Firestore kuralları ayrı bir işlemde yayımlanır. Önce test ortamında ve kontrollü geçişle uygulayın.

**Not:** 12 sayısı sınırın tam üzerindedir; gelecekte yeni bir `api/*.js` dosyası daha eklenirse aynı Hobby sınırı yeniden aşılabilir. Gerekirse daha fazla fonksiyon birleştirilmelidir.
