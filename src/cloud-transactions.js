import { releaseUserFromDesk, json } from './sync-core.js';

export function createCloudActions({ db, runTransaction, ref, settings, dayKey, isRestricted, lostDeskToday, applyViolationPolicy, now = Date.now }) {
  const userRef = id => ref('sgmUsers', id);
  const deskRef = id => ref('sgmDesks', id);
  const deletedRef = id => ref('sgmDeletedUsers', id);
  const requireUser = (snap, deleted) => {
    if (deleted.exists() || !snap.exists()) throw new Error('Bu kullanıcı hesabı silinmiş.');
    const user = snap.data();
    if (user.blocked || isRestricted(user, now())) throw new Error('Hesabınız kısıtlı.');
    return user;
  };
  const checkDeskAccess = (user, id) => {
    if (lostDeskToday(user, id)) throw new Error('İhlal nedeniyle kaybettiğiniz masayı bugün tekrar alamazsınız.');
    if (Number(user.deskReclaimAllowedAt || 0) > now()) throw new Error('Masa bırakma sonrası 30 dakikalık bekleme süreniz devam ediyor.');
    if (Number(user.strikes || 0) >= Number(settings().strikeLimit || 2)) throw new Error('Günlük ihlal limitiniz doldu.');
  };

  const reserveOrClaim = (mode, { userId, deskId, deviceId, qrCode }) => runTransaction(db, async tx => {
    const lockRef = ref('sgmDeviceLocks', deviceId);
    const [uSnap, dSnap, tombstone, lockSnap] = await Promise.all([
      tx.get(userRef(userId)), tx.get(deskRef(deskId)), tx.get(deletedRef(userId)), tx.get(lockRef)
    ]);
    const user = requireUser(uSnap, tombstone);
    checkDeskAccess(user, deskId);
    if (!dSnap.exists()) throw new Error('Masa bulunamadı.');
    const desk = dSnap.data();
    if (desk.status === 'disabled') throw new Error('Bu masa kullanıma kapalı.');
    if (mode === 'claim' && desk.qrCode !== qrCode) throw new Error('Bu masanın güncel QR kodunu okutmalısınız.');
    const lock = lockSnap.exists() ? lockSnap.data() : null;
    // Check the actual linked desk, rather than trusting a stale device lock.
    if (lock?.deskId && Number(lock.deskId) !== Number(deskId)) {
      const other = await tx.get(deskRef(lock.deskId));
      const value = other.exists() ? other.data() : null;
      if (value?.ownerDeviceId === deviceId && value?.occupant ||
          value?.pendingDeviceId === deviceId && value?.pendingOccupant && Number(value.pendingDeskDeadline) > now()) {
        throw new Error('Bu cihazda başka bir masa veya aktif rezervasyon var.');
      }
    }
    if (user.activeDeskId && Number(user.activeDeskId) !== Number(deskId)) throw new Error('Zaten aktif bir masanız var.');
    if (user.pendingDeskId && Number(user.pendingDeskId) !== Number(deskId) && Number(user.pendingDeskDeadline) > now()) {
      throw new Error('Önce mevcut rezervasyonunuzu tamamlayın veya iptal edin.');
    }
    if (mode === 'claim' && desk.occupant === userId && desk.ownerDeviceId === deviceId && Number(user.activeDeskId) === Number(deskId)) {
      return { desk, user, alreadyApplied: true };
    }
    if (desk.status !== 'available' || desk.occupant) throw new Error('Masa başka bir kullanıcı tarafından alındı.');
    if (desk.pendingOccupant && desk.pendingOccupant !== userId && Number(desk.pendingDeskDeadline) > now()) {
      throw new Error('Masa başka bir öğrenci için rezerve edildi.');
    }
    let deadline = Number(desk.pendingDeskDeadline || 0);
    let nextDesk, nextUser;
    if (mode === 'reserve') {
      if (desk.pendingOccupant !== userId || deadline <= now()) deadline = now() + 5 * 60 * 1000;
      nextDesk = { ...desk, pendingOccupant: userId, pendingDeskRole: 'owner', pendingDeskDeadline: deadline, pendingDeviceId: deviceId };
      nextUser = { ...user, pendingDeskId: Number(deskId), pendingDeskDeadline: deadline };
    } else {
      if (desk.pendingOccupant !== userId || deadline <= now() || Number(user.pendingDeskId) !== Number(deskId)) {
        throw new Error('Masa rezervasyonunuz sona ermiş. Masayı tekrar seçin.');
      }
      nextDesk = { ...desk, status: 'occupied', occupant: userId, ownerDeviceId: deviceId, sessionStartTime: now(),
        pendingOccupant: null, pendingDeskRole: null, pendingDeskDeadline: null, pendingDeviceId: null };
      nextUser = { ...user, activeDeskId: Number(deskId), activeDeskRole: 'owner', deviceId,
        lastActiveTime: now(), pendingDeskId: null, pendingDeskDeadline: null };
    }
    if (json(nextDesk) !== json(desk)) tx.set(deskRef(deskId), nextDesk);
    if (json(nextUser) !== json(user)) tx.set(userRef(userId), nextUser);
    tx.set(lockRef, { userId, deskId: Number(deskId), day: dayKey(), deadline: mode === 'reserve' ? deadline : null });
    return { desk: nextDesk, user: nextUser, deadline };
  });

  return {
    reserve: input => reserveOrClaim('reserve', input),
    claim: input => reserveOrClaim('claim', input),
    assign: ({ userId, deskId }) => runTransaction(db, async tx => {
      const [u, d, tombstone] = await Promise.all([tx.get(userRef(userId)), tx.get(deskRef(deskId)), tx.get(deletedRef(userId))]);
      const user = requireUser(u, tombstone);
      if (!d.exists()) throw new Error('Masa bulunamadı.');
      const desk = d.data(), at = now();
      if (desk.status !== 'available' || desk.occupant || desk.pendingOccupant && desk.pendingOccupant !== userId && Number(desk.pendingDeskDeadline) > at) throw new Error('Masa başka bir kullanıcı tarafından alındı veya rezerve edildi.');
      if (user.activeDeskId) throw new Error('Kullanıcının aktif masası var.');
      const oldPending = user.pendingDeskId && Number(user.pendingDeskId) !== Number(deskId) ? await tx.get(deskRef(user.pendingDeskId)) : null;
      const deviceLock = user.deviceId ? await tx.get(ref('sgmDeviceLocks', user.deviceId)) : null;
      if (deviceLock?.exists() && Number(deviceLock.data().deskId) !== Number(deskId)) {
        const other = await tx.get(deskRef(deviceLock.data().deskId));
        const value = other.data();
        if (other.exists() && (value.occupant && value.occupant !== userId && value.ownerDeviceId === user.deviceId || value.pendingOccupant && value.pendingOccupant !== userId && value.pendingDeviceId === user.deviceId && Number(value.pendingDeskDeadline) > at)) throw new Error('Bu cihazda başka bir masa var.');
      }
      const afterDesk = { ...desk, status: 'occupied', occupant: userId, ownerDeviceId: user.deviceId || null, sessionStartTime: at,
        pendingOccupant: null, pendingDeskRole: null, pendingDeskDeadline: null, pendingDeviceId: null,
        breakEndTime: null, reportEndTime: null, reportIssuedAt: null, reportVerifiedAt: null };
      const afterUser = { ...user, activeDeskId: Number(deskId), activeDeskRole: 'owner', pendingDeskId: null, pendingDeskDeadline: null,
        lastActiveTime: at, deskReclaimAllowedAt: 0, gmDeskAccessAt: Math.max(at, Number(user.gmDeskAccessAt || 0) + 1) };
      const changedDesks = [afterDesk];
      if (oldPending?.exists() && oldPending.data().pendingOccupant === userId) {
        const cleaned = { ...oldPending.data(), pendingOccupant: null, pendingDeskRole: null, pendingDeskDeadline: null, pendingDeviceId: null };
        tx.set(oldPending.ref, cleaned); changedDesks.push(cleaned);
      }
      tx.set(deskRef(deskId), afterDesk); tx.set(userRef(userId), afterUser);
      if (user.deviceId) tx.set(ref('sgmDeviceLocks', user.deviceId), { userId, deskId: Number(deskId), day: dayKey(), deadline: null });
      return { user: afterUser, desks: changedDesks };
    }),
    deleteUser: (userId, localDesks = []) => runTransaction(db, async tx => {
      const [u, marker] = await Promise.all([tx.get(userRef(userId)), tx.get(deletedRef(userId))]);
      const user = u.exists() ? u.data() : {};
      const ids = new Set(localDesks.filter(d => [d.occupant, d.pendingOccupant, d.guestOccupant].includes(userId)).map(d => d.id));
      [user.activeDeskId, user.pendingDeskId].filter(Boolean).forEach(id => ids.add(id));
      const snapshots = await Promise.all(Array.from(ids, id => tx.get(deskRef(id))));
      const desks = [];
      snapshots.forEach(snap => {
        if (!snap.exists()) return;
        const before = snap.data(), after = releaseUserFromDesk(before, userId);
        if (json(before) !== json(after)) { tx.set(snap.ref, after); desks.push(after); }
      });
      if (!marker.exists()) tx.set(deletedRef(userId), { id: userId, deletedAt: now() });
      if (u.exists()) tx.delete(userRef(userId));
      return { userId, desks };
    }),
    expireDesk: deskId => runTransaction(db, async tx => {
      const snap = await tx.get(deskRef(deskId));
      if (!snap.exists()) return null;
      const desk = snap.data();
      const at = now();
      let mode = null, deadline = 0, userId = null;
      if (desk.pendingOccupant && Number(desk.pendingDeskDeadline) > 0 && Number(desk.pendingDeskDeadline) <= at) {
        mode = 'reservation'; deadline = desk.pendingDeskDeadline; userId = desk.pendingOccupant;
      } else if (desk.status === 'on_break' && Number(desk.breakEndTime) > 0 && Number(desk.breakEndTime) <= at) {
        mode = 'break_timeout'; deadline = desk.breakEndTime; userId = desk.occupant;
      } else if (desk.status === 'reported' && Number(desk.reportEndTime) > 0 && Number(desk.reportEndTime) <= at) {
        if (desk.reportIssuedAt && Number(desk.reportVerifiedAt || 0) >= Number(desk.reportIssuedAt)) {
          const after = { ...desk, status: 'occupied', reportEndTime: null, reportIssuedAt: null };
          tx.set(deskRef(deskId), after);
          return { desk: after, verified: true };
        }
        mode = 'report_timeout'; deadline = desk.reportEndTime; userId = desk.occupant;
      }
      if (!mode || !userId) return null;
      const u = await tx.get(userRef(userId));
      let nextDesk = releaseUserFromDesk(desk, userId), nextUser = u.exists() ? u.data() : null;
      // Reservation expiry must not release a different active owner.
      if (mode === 'reservation') {
        nextDesk = { ...desk, pendingOccupant: null, pendingDeskRole: null, pendingDeskDeadline: null, pendingDeviceId: null };
        if (nextUser && Number(nextUser.pendingDeskId) === Number(deskId)) nextUser = { ...nextUser, pendingDeskId: null, pendingDeskDeadline: null };
      } else if (nextUser) {
        nextUser = { ...nextUser, activeDeskId: null, activeDeskRole: null, strikes: Number(nextUser.strikes || 0) + 1,
          ...applyViolationPolicy(nextUser, deskId, at) };
      }
      tx.set(deskRef(deskId), nextDesk);
      if (nextUser && json(nextUser) !== json(u.data())) tx.set(userRef(userId), nextUser);
      return { desk: nextDesk, user: nextUser, mode, eventId: `timeout-${deskId}-${mode}-${deadline}`, at };
    })
  };
}
