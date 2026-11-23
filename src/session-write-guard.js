// Gecikmiş yerel snapshot, kütüphane kapandıktan sonra oturum açamaz.
// Kapanışı yapmak için gelen null/available güncellemelerine izin verilir.
export function preventClosedHoursSessionWrites(patch, bucket, at = Date.now(), openTime = '07:00', closeTime = '22:00') {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date(at));
  const h = Number(parts.find(part => part.type === 'hour')?.value || 0);
  const m = Number(parts.find(part => part.type === 'minute')?.value || 0);
  const match = /^(\d{2}):(\d{2})$/.exec(String(openTime));
  const opening = match ? Number(match[1]) * 60 + Number(match[2]) : 7 * 60;
  const closingMatch = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(closeTime));
  const closing = closingMatch ? Number(closingMatch[1]) * 60 + Number(closingMatch[2]) : 22 * 60;
  const current = h * 60 + m;
  const isOpen = opening < closing ? current >= opening && current < closing : current >= opening || current < closing;
  if (isOpen) return patch;
  const filtered = { ...patch };
  if (bucket === 'desks' && (filtered.occupant || filtered.guestOccupant || filtered.pendingOccupant ||
      ['occupied', 'on_break', 'reported', 'reserved'].includes(filtered.status))) {
    for (const key of ['status', 'occupant', 'ownerDeviceId', 'sessionStartTime',
      'guestOccupant', 'guestSessionStartTime', 'guestBreakEndTime', 'guestReported',
      'guestReportEndTime', 'guestReportIssuedAt', 'guestReportVerifiedAt',
      'pendingOccupant', 'pendingDeskRole', 'pendingDeskDeadline', 'pendingDeviceId',
      'breakEndTime', 'reportEndTime', 'reportIssuedAt', 'reportVerifiedAt']) delete filtered[key];
  }
  if (bucket === 'users' && (filtered.activeDeskId || filtered.pendingDeskId)) {
    for (const key of ['activeDeskId', 'activeDeskRole', 'pendingDeskId', 'pendingDeskDeadline',
      'adminDeskOverrideDeskId', 'adminDeskOverrideSessionStart']) delete filtered[key];
  }
  return filtered;
}
