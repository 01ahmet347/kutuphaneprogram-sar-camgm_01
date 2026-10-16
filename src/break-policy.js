// Mola hakları günlük olarak Türkiye yerel gününe göre değerlendirilir.
// Eski short/long alanları korunur; hourly alanı geriye uyumlu eklenmiştir.
export function istanbulDayKey(at = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date(at));
  const part = key => parts.find(p => p.type === key)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function isHourlyBreakAvailable(config = {}, at = Date.now()) {
  return config.hourlyBreakEnabled !== false &&
    new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Istanbul', weekday: 'short' })
      .format(new Date(at)) === 'Fri';
}

export function allowedBreakCount(config = {}, type, at = Date.now()) {
  const key = ({ short: 'shortBreakCount', long: 'longBreakCount', hourly: 'hourlyBreakCount' })[type];
  if (!key || type === 'hourly' && !isHourlyBreakAvailable(config, at)) return 0;
  const fallback = { short: 5, long: 2, hourly: 1 }[type];
  const value = config[key] == null ? fallback : Number(config[key]);
  return Number.isSafeInteger(value) && value >= 0 && value <= 50 ? value : 0;
}

export function allowedBreakDuration(config = {}, type) {
  const key = ({ short: 'shortBreakDuration', long: 'longBreakDuration', hourly: 'hourlyBreakDuration' })[type];
  if (!key) return null;
  const fallback = { short: 15, long: 30, hourly: 60 }[type];
  const duration = config[key] == null ? fallback : Number(config[key]);
  return Number.isSafeInteger(duration) && duration >= 1 && duration <= 240 ? duration : null;
}

export function dailyBreakState(user, config = {}, at = Date.now(), date = istanbulDayKey(at)) {
  if (user.breaksResetDate !== date) return {
    breaks: Object.fromEntries(['short', 'long', 'hourly'].map(type => [type, allowedBreakCount(config, type, at)])),
    breaksResetDate: date
  };
  const breaks = { ...user.breaks };
  // Eski şemada hourly bulunmuyordu; cuma günü ilk kez yalnızca bir kez ekle.
  if (breaks.hourly == null || !Number.isFinite(Number(breaks.hourly))) breaks.hourly = allowedBreakCount(config, 'hourly', at);
  return { breaks, breaksResetDate: date };
}
