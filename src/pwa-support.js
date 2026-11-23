// Saf, test edilebilir iOS PWA tespiti. Masa/hesap durumuna erişmez.
export function isAppleMobileDevice({ userAgent = '', platform = '', maxTouchPoints = 0 } = {}) {
  return /iPhone|iPad|iPod/i.test(userAgent) ||
    (platform === 'MacIntel' && Number(maxTouchPoints) > 1);
}

export function isHomeScreenApp({ navigatorStandalone = false, displayModeStandalone = false } = {}) {
  return navigatorStandalone === true || displayModeStandalone === true;
}

export function applePushInstallGuidance(env = {}) {
  if (!isAppleMobileDevice(env) || isHomeScreenApp(env)) return '';
  return 'iPhone/iPad bildirimlerini açmak için siteyi Safari ile açın, Paylaş → Ana Ekrana Ekle adımlarını uygulayın. Ardından ana ekrandaki SGM Kütüphane simgesinden giriş yapın ve telefon simgesine dokunup bildirim izni verin. iOS 16.4 veya üzeri gerekir.';
}

export function currentApplePushInstallGuidance() {
  if (typeof navigator === 'undefined') return '';
  return applePushInstallGuidance({
    userAgent: navigator.userAgent || '',
    platform: navigator.platform || '',
    maxTouchPoints: navigator.maxTouchPoints || 0,
    navigatorStandalone: navigator.standalone === true,
    displayModeStandalone: typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(display-mode: standalone)').matches
  });
}
