// İstanbul saatini ve yönetici panelinde belirlenen dinamik kapanış saatini esas al.
export function isIstanbulAfterClose(at = Date.now(), closeTime = '22:00') {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date(at));
  const n = kind => Number(parts.find(part => part.type === kind)?.value || 0);
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(closeTime));
  const closing = match ? Number(match[1]) * 60 + Number(match[2]) : 22 * 60;
  return n('hour') * 60 + n('minute') >= closing;
}
