// Mola bitişi için salt okunur doğrulama; öğrenci oturumunu ASLA değiştirmez.
// Türkiye saati UTC+3, 22:00 kapanış 19:00 UTC.
export function lastIstanbulClosingAt(at) {
  if (!Number.isFinite(at)) return NaN;
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul',
    year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(at));
  const p = Object.fromEntries(parts.map(x => [x.type, Number(x.value)]));
  const todayClose = Date.UTC(p.year, p.month - 1, p.day, 19, 0);
  return at >= todayClose ? todayClose : todayClose - 86400000;
}

// Olay sadece kontrol sırasında masanın MOLA durumunda kaldığını gösterir.
// Bu, öğrencinin fiziksel olarak masada bulunmadığının kanıtı değildir.
export function expiredBreakDetails({ desk, userId, activeDeskId, isGuest = false, at, clockVerified = true }) {
  if (!clockVerified || !desk || !userId || !Number.isFinite(at) ||
      !Number.isInteger(Number(desk.id)) || Number(desk.id) < 1 || Number(desk.id) > 35 ||
      Number(activeDeskId) !== Number(desk.id)) return null;
  if (String(isGuest ? desk.guestOccupant : desk.occupant) !== String(userId)) return null;
  if (!isGuest && desk.status !== 'on_break') return null;
  const sessionAt = Number(isGuest ? desk.guestSessionStartTime : desk.sessionStartTime);
  const endAt = Number(isGuest ? desk.guestBreakEndTime : desk.breakEndTime);
  if (!Number.isFinite(sessionAt) || !Number.isFinite(endAt) ||
      sessionAt <= lastIstanbulClosingAt(at) || sessionAt > at ||
      endAt < sessionAt || endAt > at || endAt <= 0) return null;
  return { deskId: Number(desk.id), userId: String(userId), endAt, isGuest };
}
