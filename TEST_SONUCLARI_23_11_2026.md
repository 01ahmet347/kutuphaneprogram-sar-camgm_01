# 23.11.2026 – Test raporu

- `node --check` ile değişen sunucu JS dosyaları kontrol edildi.
- `tsc --allowJs --checkJs false --noEmit --jsx preserve --noResolve` ile ana JSX, lider ve faaliyet bileşenlerinin sözdizimi kontrol edildi.
- `node --test` tam paket: **157 testin 148'i geçti, 9'u geçemedi**.
- Geçemeyen 6 test (`admin-login`, `admin-session-status`, `admin-session`, `admin-student-create`, `closing`, `ui`) bu çalışma ortamında Firebase Admin / sucrase paketleri bulunmadığı için yüklenemedi. `npm ci` denemesi ağ/ortam sınırlaması nedeniyle tamamlanamadı.
- Geçemeyen diğer 3 test `morning-safety.test.js` içinde **önceden var olan** 07:15 eski masa ihbarı / kapanış telafisi senaryolarıdır. Aynı 3 testin, yüklenen ZIP'in değiştirilmemiş kopyasında da başarısız olduğu doğrulandı. Bu eski sorunlar faaliyet güncellemesi kapsamında değiştirilmedi.
- Yeni faaliyet ve birleştirme modülü için eklenen 6 testin tamamı geçti: lider onayı, kapanış, QR korunması, reddedilen başvuru, 60+15 dk, günlük sınır, farklı lider yetkisi, form imzası.
- Seçili mevcut 64 regresyon testi ve 6 yeni test: **70/70 geçti**.
- Gerçek Firebase/Vercel/Google Forms ve tarayıcı uçtan uca testi yapılmadı; bu nedenle **canlıya doğrudan yayımlanması önerilmez**. Önce ayrı test ortamında çalıştırılmalı, Firestore yedeği alınmalı ve 3 mevcut `morning-safety` testi ayrıca çözülmelidir.
