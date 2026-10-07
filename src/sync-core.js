// Pure synchronization helpers. Remote deletion always wins over an old local edit.
export const json = value => JSON.stringify(value ?? null);
export const rowMap = rows => new Map((rows || []).filter(r => r?.id != null).map(r => [String(r.id), r]));

export function changedFields(previous = {}, next = {}) {
  return Object.fromEntries(Object.entries(next).filter(([key, value]) => json(previous[key]) !== json(value)));
}

export function mergePendingRows(remoteRows, localRows, previousMap, { deleted = () => false, creates = new Set() } = {}) {
  const remote = rowMap((remoteRows || []).filter(r => !deleted(r.id)));
  for (const local of localRows || []) {
    const id = String(local.id);
    if (deleted(id)) continue;
    const previous = previousMap.get(id);
    const current = remote.get(id);
    if (!current) {
      // Only an explicitly created, unsent record may be absent on the server.
      if (!previous && creates.has(id)) remote.set(id, local);
      continue;
    }
    if (previous) remote.set(id, { ...current, ...nonConflictingPatch(current, previous, local) });
  }
  return Array.from(remote.values());
}

export function nonConflictingPatch(remote, previous, next) {
  const dirty = changedFields(previous, next);
  // A stale whole-row write must never overwrite another device's new fields.
  return Object.fromEntries(Object.entries(dirty).filter(([key, value]) =>
    json(remote[key]) === json(previous[key]) && json(remote[key]) !== json(value)
  ));
}

export function atomicFieldPatch(remote, previous, next, fields) {
  const dirty = changedFields(previous, next);
  const conflict = fields.some(key => json(remote[key]) !== json(previous[key]) && json(remote[key]) !== json(next[key]));
  const patch = nonConflictingPatch(remote, previous, next);
  if (conflict && fields.some(key => key in dirty)) fields.forEach(key => delete patch[key]);
  return patch;
}

export function releaseUserFromDesk(desk, userId) {
  const id = String(userId);
  const next = { ...desk };
  if (String(desk.occupant || '') === id) Object.assign(next, {
    status: desk.status === 'disabled' ? 'disabled' : 'available', occupant: null,
    ownerDeviceId: null, sessionStartTime: null, breakEndTime: null,
    reportEndTime: null, reportIssuedAt: null, reportVerifiedAt: null
  });
  if (String(desk.pendingOccupant || '') === id) Object.assign(next, {
    pendingOccupant: null, pendingDeskRole: null, pendingDeskDeadline: null
  });
  if (String(desk.guestOccupant || '') === id) Object.assign(next, {
    guestOccupant: null, guestSessionStartTime: null, guestBreakEndTime: null,
    guestReported: false, guestReportEndTime: null, guestReportIssuedAt: null, guestReportVerifiedAt: null
  });
  return next;
}

export async function mapLimited(values, task, concurrency = 4) {
  const results = new Array(values.length);
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (index < values.length) {
      const i = index++;
      try { results[i] = { status: 'fulfilled', value: await task(values[i]) }; }
      catch (reason) { results[i] = { status: 'rejected', reason }; }
    }
  }));
  return results;
}

export function sessionCanRestore(saved, user) {
  return Boolean(saved?.userId && user?.id === saved.userId);
}
