// Leave is an idempotent server transaction. A second request is safe when
// mobile data drops after the first write but before the HTTP response.
export async function requestStudentDesk({ action, input = {}, getToken, fetcher = fetch, timeoutMs = 12000 }) {
  const maxAttempts = action === 'leave' ? 2 : 1;
  let refreshToken = false;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const token = await getToken(refreshToken);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let retry = false;
    try {
      const response = await fetcher('/api/student-desk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action, ...input }),
        signal: controller.signal,
        cache: 'no-store'
      });
      const payload = await response.json().catch(() => null);
      if (response.ok && payload?.ok === true) return payload.result === null ? null : payload;
      retry = action === 'leave' && attempt < maxAttempts - 1 && (response.status === 401 || response.status >= 500);
      refreshToken = response.status === 401;
      if (!retry) {
        const fallback = response.status === 401
          ? 'Öğrenci oturumu doğrulanamadı. Tekrar giriş yapıp deneyin.'
          : `Masa servisi HTTP ${response.status} döndürdü.`;
        throw new Error(payload?.message || fallback);
      }
    } catch (error) {
      if (!retry && (error?.name === 'AbortError' || error instanceof TypeError)) {
        retry = action === 'leave' && attempt < maxAttempts - 1;
        if (!retry) throw new Error('Masa bırakma isteği sunucuda doğrulanamadı. Mobil internet bağlantısını kontrol edip tekrar deneyin. Masa henüz boş kabul edilmiyor.');
      } else if (!retry) throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error('Masa bırakma isteği sunucudan doğrulanamadı. Tekrar deneyin.');
}
