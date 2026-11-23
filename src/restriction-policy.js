// Yönetici kısıtı kaldırdıktan önceki ihlaller arşivde kalır; yeni bir
// 7 günlük kısıt hesabına tekrar eklenmez.
export const RESTRICTION_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function countRecentUnpardonedViolations(user, at = Date.now()) {
  const clearedAt = Number(user?.restrictionClearedAt || 0);
  return (Array.isArray(user?.violationHistory) ? user.violationHistory : [])
    .filter(time => Number.isFinite(Number(time)) && Number(time) > Math.max(at - RESTRICTION_WEEK_MS, clearedAt) && Number(time) <= at).length;
}

export function violationPolicyPatch(user, deskId, at, dayKey) {
  const history = [...(Array.isArray(user.violationHistory) ? user.violationHistory : []), at];
  const recent = countRecentUnpardonedViolations({ ...user, violationHistory: history }, at);
  const date = dayKey(new Date(at));
  return {
    violationHistory: history,
    restrictedUntil: recent >= 2
      ? Math.max(Number(user.restrictedUntil || 0), at + RESTRICTION_WEEK_MS)
      : Number(user.restrictedUntil || 0),
    restrictionReason: recent >= 2
      ? 'Son 7 gün içinde iki ihlal: 7 gün kısıtlama'
      : user.restrictionReason || '',
    lostDeskDate: date,
    lostDeskIds: [...new Set([...(user.lostDeskDate === date ? user.lostDeskIds || [] : []), Number(deskId)])]
  };
}
