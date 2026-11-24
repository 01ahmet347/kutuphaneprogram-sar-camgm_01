// Presentation only: existing desk status and QR data are untouched.
export function isActivityPhase(desk, at=Date.now()) {
  return desk?.status === 'on_break' && desk.breakType === 'activity' &&
    Number(desk.breakStartedAt || 0) > 0 && at < Number(desk.breakStartedAt) + 60 * 60000;
}
export function deskDisplayStatus(desk, at=Date.now()) {
  if (isActivityPhase(desk, at)) return 'FAALİYETTE';
  if (desk?.status === 'on_break') return 'MOLADA';
  return desk?.status || 'available';
}
