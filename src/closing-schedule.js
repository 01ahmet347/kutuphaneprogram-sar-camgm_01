// Saf saat hesabı: İstanbul zamanına göre kapanış, masa oturumuna dokunmaz.
import { istanbulDayKey } from './break-policy.js';
export function istanbulClock(at = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date(at));
  const time = Object.fromEntries(parts.map(part => [part.type, Number(part.value)]));
  return { minute: time.hour * 60 + time.minute, dayKey: istanbulDayKey(at) };
}

export const parseMinutes = (value, fallback) => {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(value || ''));
  return match ? Number(match[1]) * 60 + Number(match[2]) : fallback;
};
export const nextDay = day => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};
export const previousDay = day => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};
// Day of the closing window. Outside this window (during library opening),
// never touch desks; even if a cron job runs late or is retried.
export function closingDay(at = Date.now(), config = {}) {
  const { minute, dayKey } = istanbulClock(at);
  const open = parseMinutes(config.openTime, 7 * 60);
  const close = parseMinutes(config.closeTime, 22 * 60);
  if (open < close) {
    if (minute >= close) return dayKey;
    if (minute < open) return previousDay(dayKey);
    return null;
  }
  // Overnight opening: e.g. 18:00-02:00. Closing takes place after 02:00.
  if (open > close && minute >= close && minute < open) return dayKey;
  return null;
}

export const afterClosing = (at = Date.now(), closeTime = '22:00', openTime = '07:00') =>
  closingDay(at, { closeTime, openTime }) !== null;
export function outsideLibraryHours(at = Date.now(), openTime = '07:00', closeTime = '22:00') {
  return closingDay(at, { openTime, closeTime }) !== null;
}

