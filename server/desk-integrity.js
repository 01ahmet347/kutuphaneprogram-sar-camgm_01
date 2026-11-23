// Masa belgeleri oturumun asıl kaynağıdır; yalnızca tutarsız bağlantılar onarılır.
const realDesk = id => id !== null && id !== undefined && id !== '' && Number.isInteger(Number(id)) && Number(id) > 0;
const same = (a, b) => String(a) === String(b);

export function userLinkPatch(user, userId, desksById, at = Date.now()) {
  const patch = {};
  const activeId = user.activeDeskId;
  const desk = realDesk(activeId) ? desksById.get(String(Number(activeId))) : null;
  const validActive = Boolean(desk &&
    (desk.occupant != null && same(desk.occupant, userId) ||
     desk.guestOccupant != null && same(desk.guestOccupant, userId)));
  if (realDesk(activeId) && !validActive) Object.assign(patch, {
    activeDeskId: null, activeDeskRole: null,
    adminDeskOverrideDeskId: null, adminDeskOverrideSessionStart: null
  });
  const pendingId = user.pendingDeskId;
  const pendingDesk = realDesk(pendingId) ? desksById.get(String(Number(pendingId))) : null;
  if (realDesk(pendingId) && !(pendingDesk && pendingDesk.pendingOccupant != null &&
      same(pendingDesk.pendingOccupant, userId) && Number(pendingDesk.pendingDeskDeadline || 0) > at)) {
    Object.assign(patch, { pendingDeskId: null, pendingDeskDeadline: null });
  }
  if (realDesk(user.adminDeskOverrideDeskId) &&
      (!validActive || !same(user.adminDeskOverrideDeskId, activeId))) {
    Object.assign(patch, { adminDeskOverrideDeskId: null, adminDeskOverrideSessionStart: null });
  }
  return patch;
}

export function releasedDeskUserPatch(user, deskId) {
  const patch = {};
  if (realDesk(user.activeDeskId) && Number(user.activeDeskId) === Number(deskId)) {
    Object.assign(patch, { activeDeskId: null, activeDeskRole: null,
      adminDeskOverrideDeskId: null, adminDeskOverrideSessionStart: null,
    ...(user.lastBreakSession?.status === 'active' && Number(user.lastBreakSession.deskId) === Number(deskId)
      ? { lastBreakSession: { ...user.lastBreakSession, status: 'admin_released' } } : {}) });
  }
  if (realDesk(user.pendingDeskId) && Number(user.pendingDeskId) === Number(deskId)) {
    Object.assign(patch, { pendingDeskId: null, pendingDeskDeadline: null });
  }
  if (realDesk(user.adminDeskOverrideDeskId) && Number(user.adminDeskOverrideDeskId) === Number(deskId)) {
    Object.assign(patch, { adminDeskOverrideDeskId: null, adminDeskOverrideSessionStart: null });
  }
  return patch;
}

export function deskNeedsClosing(desk) {
  return Boolean(desk.occupant || desk.pendingOccupant || desk.guestOccupant ||
    (desk.status !== 'available' && desk.status !== 'disabled') ||
    desk.ownerDeviceId || desk.pendingDeviceId || desk.sessionStartTime ||
    desk.guestSessionStartTime || desk.breakEndTime || desk.guestBreakEndTime ||
    desk.reportEndTime || desk.guestReportEndTime || desk.guestReported ||
    desk.reportIssuedAt || desk.guestReportIssuedAt || desk.reportVerifiedAt || desk.guestReportVerifiedAt ||
    desk.breakSessionId || desk.breakStartedAt || desk.breakOwnerId || desk.breakType || desk.breakDurationMinutes);
}

export function publicUser(user, id) {
  const { pin: _pin, pushTokens: _pushTokens, ...safe } = user;
  return { ...safe, id };
}
