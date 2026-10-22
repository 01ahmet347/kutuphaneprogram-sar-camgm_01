// Günlük masa güvenliği: Türkiye saati 22:00 kesiti esas alınır.
// Kullanıcı hesabı, QR kodu, ihlal veya mola geçmişi bu kontrollerle değiştirilmez.
export function lastIstanbulClosingAt(at = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date(at));
  const date = Object.fromEntries(parts.map(part => [part.type, Number(part.value)]));
  const todayClosingUtc = Date.UTC(date.year, date.month - 1, date.day, 19);
  return at >= todayClosingUtc ? todayClosingUtc : todayClosingUtc - 86400000;
}

const validTime = value => Number.isFinite(Number(value)) && Number(value) > 0;

// Yalnızca sunucudan doğrulanan ve son kapanıştan sonra BAŞLAMIŞ ana oturum ihbar edilebilir.
export function hasCurrentOwnerSession(desk, at = Date.now()) {
  const start = Number(desk?.sessionStartTime);
  return Boolean(desk?.occupant && validTime(start) &&
    start > lastIstanbulClosingAt(at) && start <= at);
}

// Bütün dolu/rezervasyon bağlantıları kesin olarak önceki kapanışa aitse
// cezasız temizlenebilir. Eksik/belirsiz zamanlı kayıtlar otomatik silinmez.
export function hasPreviousClosingSession(desk, at = Date.now()) {
  if (!desk) return false;
  const starts = [];
  if (desk.occupant) starts.push(desk.sessionStartTime);
  if (desk.guestOccupant) starts.push(desk.guestSessionStartTime);
  if (desk.pendingOccupant) starts.push(Number(desk.pendingDeskDeadline) - 5 * 60 * 1000);
  const cutoff = lastIstanbulClosingAt(at);
  return starts.length > 0 && starts.every(start => validTime(start) && Number(start) <= cutoff);
}

export function closingDesk(desk) {
  return {
    ...desk,
    status: desk.status === 'disabled' ? 'disabled' : 'available',
    occupant: null, ownerDeviceId: null, sessionStartTime: null,
    guestOccupant: null, guestSessionStartTime: null, guestBreakEndTime: null,
    guestReported: false, guestReportEndTime: null, guestReportIssuedAt: null,
    guestReportVerifiedAt: null,
    pendingOccupant: null, pendingDeskRole: null, pendingDeskDeadline: null,
    pendingDeviceId: null, breakEndTime: null, breakSessionId: null,
    breakStartedAt: null, breakType: null, breakOwnerId: null,
    breakDurationMinutes: null, reportIssuedAt: null,
    reportEndTime: null, reportVerifiedAt: null
  };
}
