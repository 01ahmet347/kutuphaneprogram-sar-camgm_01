// Yönetici tarayıcısındaki gecikmiş snapshot'lar API transaction'larının
// oluşturduğu masa sahipliğini veya mola hakkını asla geriye yazamaz.
export const DESK_SESSION_FIELDS = Object.freeze([
  'status', 'occupant', 'ownerDeviceId', 'sessionStartTime', 'guestOccupant',
  'guestSessionStartTime', 'guestBreakEndTime', 'guestReported',
  'guestReportEndTime', 'guestReportIssuedAt', 'guestReportVerifiedAt',
  'pendingOccupant', 'pendingDeskRole', 'pendingDeskDeadline', 'pendingDeviceId',
  'breakEndTime', 'breakStartedAt', 'breakSessionId', 'breakType',
  'breakOwnerId', 'breakDurationMinutes', 'reportEndTime', 'reportIssuedAt',
  'reportVerifiedAt'
]);
export const USER_SESSION_FIELDS = Object.freeze([
  'activeDeskId', 'activeDeskRole', 'pendingDeskId', 'pendingDeskDeadline',
  'adminDeskOverrideDeskId', 'adminDeskOverrideSessionStart', 'breaks',
  'breaksResetDate', 'lastBreakSession', 'lastActiveTime', 'gmDeskAccessAt',
  'deskReclaimDeskId', 'deskReclaimAllowedAt'
]);
export function withoutSessionWrites(patch, bucket) {
  const forbidden = bucket === 'desks' ? DESK_SESSION_FIELDS : bucket === 'users' ? USER_SESSION_FIELDS : [];
  const clean = { ...patch };
  forbidden.forEach(field => delete clean[field]);
  return clean;
}

export function isDeskOwnedByUser(desk, user) {
  return Boolean(desk && user && Number(user.activeDeskId) === Number(desk.id) &&
    (String(desk.occupant || '') === String(user.id) ||
     String(desk.guestOccupant || '') === String(user.id)));
}

export function safeBreakCountdown(desk, currentServerTime) {
  const end = Number(desk?.breakEndTime);
  if (!Number.isFinite(end) || end <= 0) return { kind: 'invalid', remaining: null };
  if (end <= currentServerTime) return { kind: 'expired', remaining: 0 };
  return { kind: 'running', remaining: end - currentServerTime };
}

// Server-authenticated approval must win over stale local administrator cache.
export const ACCOUNT_PERMISSION_FIELDS = Object.freeze([
  'blocked', 'pendingApproval', 'restrictedUntil', 'restrictionReason',
  'canReport', 'reportPermissionPolicyVersion', 'reportPermissionRestrictionUntil',
  'restrictionClearedAt'
]);
export function withoutAccountApprovalWrites(row) {
  const clean = { ...row };
  for (const field of ACCOUNT_PERMISSION_FIELDS) delete clean[field];
  return clean;
}
