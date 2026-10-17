// Istanbul's clock, rather than a phone's selected timezone, decides 22:00.
export function isIstanbulAfterClose(at = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date(at));
  const n = kind => Number(parts.find(part => part.type === kind)?.value || 0);
  return n('hour') * 60 + n('minute') >= 22 * 60;
}
