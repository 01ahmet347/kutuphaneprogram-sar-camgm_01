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
  const requireExistingUser = (snap, deleted) => {
    if (deleted.exists() || !snap.exists()) throw new Error('Bu kullanıcı hesabı silinmiş.');
    return snap.data();
  };
  const refreshDailyFields = user => {
    const today = dayKey();
    let next = user;
    if (user.breaksResetDate !== today) {
      next = {
        ...next,
        breaks: {
          short: Math.max(0, Number(settings().shortBreakCount) || 0),
          long: Math.max(0, Number(settings().longBreakCount) || 0)
        },
        breaksResetDate: today
      };
    }
    if (user.violationsResetDate !== today) {
      next = {
        ...next,
        strikes: 0,
        violationsResetDate: today,
        dailyAccessVerifiedDate: user.dailyAccessVerifiedDate === today ? today : ''
      };
    }
    return next;
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
    const user = refreshDailyFields(requireUser(uSnap, tombstone));
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
      if (json(user) !== json(uSnap.data())) tx.set(userRef(userId), user);
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
    startBreak: ({ userId, deskId, type }) => runTransaction(db, async tx => {
      const [uSnap, dSnap, tombstone] = await Promise.all([
        tx.get(userRef(userId)), tx.get(deskRef(deskId)), tx.get(deletedRef(userId))
      ]);
      const user = refreshDailyFields(requireUser(uSnap, tombstone));
      if (!dSnap.exists()) throw new Error('Masa bulunamadı.');
      const desk = dSnap.data(), at = now(), breakCount = Number(user.breaks?.[type] || 0);
      if (Number(user.activeDeskId) !== Number(deskId) || desk.occupant !== userId || desk.status !== 'occupied') {
        throw new Error('Mola başlatmak için masanızda aktif olmalısınız.');
      }
      if (!['short', 'long'].includes(type) || breakCount <= 0) throw new Error('Bu mola hakkınız tükenmiş.');
      const requiredWorkMs = Math.max(30, Number(settings().breakCooldown) || 30) * 60 * 1000;
      if (at - Number(user.lastActiveTime || 0) < requiredWorkMs) throw new Error('Mola kullanabilmek için gerekli aktif çalışma süresi dolmadı.');
      const duration = Number(type === 'short' ? settings().shortBreakDuration : settings().longBreakDuration);
      if (!Number.isFinite(duration) || duration < 1 || duration > 240) throw new Error('Mola süresi ayarı geçersiz.');
      const nextDesk = { ...desk, status: 'on_break', breakEndTime: at + duration * 60 * 1000 };
      const nextUser = { ...user, breaks: { ...user.breaks, [type]: breakCount - 1 } };
      tx.set(deskRef(deskId), nextDesk);
      tx.set(userRef(userId), nextUser);
      return { desk: nextDesk, user: nextUser, at };
    }),
    endBreak: ({ userId, deskId, qrCode }) => runTransaction(db, async tx => {
      const [uSnap, dSnap, tombstone] = await Promise.all([
        tx.get(userRef(userId)), tx.get(deskRef(deskId)), tx.get(deletedRef(userId))
      ]);
      const user = refreshDailyFields(requireExistingUser(uSnap, tombstone));
      if (!dSnap.exists()) throw new Error('Masa bulunamadı.');
      const desk = dSnap.data();
      if (Number(user.activeDeskId) !== Number(deskId) || desk.occupant !== userId ||
          desk.status !== 'on_break' || Number(desk.breakEndTime || 0) <= now() || desk.qrCode !== qrCode) {
        throw new Error('Moladan dönmek için kendi masanızın güncel QR kodunu okutmalısınız.');
      }
      const at = now();
      const nextDesk = { ...desk, status: 'occupied', breakEndTime: null };
      const nextUser = { ...user, lastActiveTime: at };
      tx.set(deskRef(deskId), nextDesk);
      tx.set(userRef(userId), nextUser);
      return { desk: nextDesk, user: nextUser, at };
    }),
    reportDesk: ({ userId, deskId, targetUserId }) => runTransaction(db, async tx => {
      const [reporterSnap, deskSnap, reporterDeleted, targetSnap, targetDeleted] = await Promise.all([
        tx.get(userRef(userId)), tx.get(deskRef(deskId)), tx.get(deletedRef(userId)),
        tx.get(userRef(targetUserId)), tx.get(deletedRef(targetUserId))
      ]);
      const reporter = requireUser(reporterSnap, reporterDeleted);
      if (!settings().reportsEnabled || reporter.canReport === false) throw new Error('İhbar etme yetkiniz kapalıdır.');
      if (!deskSnap.exists() || !targetSnap.exists() || targetDeleted.exists()) throw new Error('Masa veya hedef kullanıcı bulunamadı.');
      const desk = deskSnap.data(), target = targetSnap.data(), at = now();
      if (userId === targetUserId || desk.occupant !== targetUserId || desk.status !== 'occupied' ||
          Number(reporter.activeDeskId || 0) === Number(deskId) ||
          Number(target.activeDeskId || 0) !== Number(deskId)) {
        throw new Error('Masa durumu değişti veya bu kullanıcı için ihbar uygun değil.');
      }
      const waitMinutes = Math.max(1, Number(settings().reportWaitTime) || 5);
      const eventId = `report-${deskId}-${at}-${Math.random().toString(36).slice(2, 9)}`;
      const nextDesk = {
        ...desk,
        status: 'reported',
        reportIssuedAt: at,
        reportVerifiedAt: null,
        reportEndTime: at + waitMinutes * 60 * 1000
      };
      const event = {
        id: eventId,
        time: at,
        type: 'İHBAR',
        message: `Masa ${deskId} ana kullanıcısı masada bulunmadığı gerekçesiyle ihbar edildi. Bildiren: ${String(reporter.name || '')} (${String(reporter.specialCode || '')})`,
        deskId: Number(deskId),
        userId: targetUserId,
        userInfo: `${String(target.name || '')}${target.specialCode ? ` (GM: ${target.specialCode})` : ''}`,
        actorFirebaseUid: userId,
        actorId: userId,
        actorInfo: String(reporter.specialCode || 'Öğrenci'),
        deviceInfo: String(reporter.deviceId || '')
      };
      tx.set(deskRef(deskId), nextDesk);
      tx.create(ref('sgmAudit', eventId), event);
      return { desk: nextDesk, user: target, eventId, at, waitMinutes };
    }),
    verifyPresence: ({ userId, deskId, qrCode }) => runTransaction(db, async tx => {
      const [uSnap, dSnap, tombstone] = await Promise.all([
        tx.get(userRef(userId)), tx.get(deskRef(deskId)), tx.get(deletedRef(userId))
      ]);
      const user = refreshDailyFields(requireExistingUser(uSnap, tombstone));
      if (!dSnap.exists()) throw new Error('Masa bulunamadı.');
      const desk = dSnap.data();
      if (Number(user.activeDeskId) !== Number(deskId) || desk.occupant !== userId ||
          desk.status !== 'reported' || Number(desk.reportEndTime || 0) <= now() || desk.qrCode !== qrCode) {
        throw new Error('Yalnızca kendi ihbar edilmiş masanızı QR ile doğrulayabilirsiniz.');
      }
      const at = now();
      const nextDesk = { ...desk, status: 'occupied', reportEndTime: null, reportVerifiedAt: at };
      const nextUser = { ...user, lastActiveTime: at };
      tx.set(deskRef(deskId), nextDesk);
      tx.set(userRef(userId), nextUser);
      return { desk: nextDesk, user: nextUser, at };
    }),
    leaveDesk: ({ userId, deskId }) => runTransaction(db, async tx => {
      const [uSnap, dSnap, tombstone] = await Promise.all([
        tx.get(userRef(userId)), tx.get(deskRef(deskId)), tx.get(deletedRef(userId))
      ]);
      const user = refreshDailyFields(requireExistingUser(uSnap, tombstone));
      if (!dSnap.exists()) throw new Error('Masa bulunamadı.');
      const desk = dSnap.data(), at = now();
      if (Number(user.activeDeskId) !== Number(deskId) || desk.occupant !== userId) {
        throw new Error('Aktif masa oturumunuz bulunamadı.');
      }
      if ((desk.status === 'on_break' && Number(desk.breakEndTime || 0) <= at) ||
          (desk.status === 'reported' && Number(desk.reportEndTime || 0) <= at)) {
        throw new Error('Süreniz dolduğu için masa otomatik işlem bekliyor. Biraz sonra durumu yenileyin.');
      }
      const pendingSnap = user.pendingDeskId && Number(user.pendingDeskId) !== Number(deskId)
        ? await tx.get(deskRef(user.pendingDeskId))
        : null;
      let nextDesk, promotedUser = null;
      if (desk.guestOccupant) {
        const guestSnap = await tx.get(userRef(desk.guestOccupant));
        promotedUser = guestSnap.exists() ? guestSnap.data() : null;
        nextDesk = {
          ...desk,
          occupant: desk.guestOccupant,
          ownerDeviceId: promotedUser?.deviceId || null,
          sessionStartTime: desk.guestSessionStartTime || at,
          status: 'occupied',
          breakEndTime: null,
          reportEndTime: null,
          reportIssuedAt: null,
          reportVerifiedAt: null,
          guestOccupant: null,
          guestSessionStartTime: null,
          guestBreakEndTime: null,
          guestReported: false,
          guestReportEndTime: null,
          guestReportIssuedAt: null,
          guestReportVerifiedAt: null,
          pendingOccupant: null,
          pendingDeskRole: null,
          pendingDeskDeadline: null,
          pendingDeviceId: null
        };
      } else {
        nextDesk = {
          ...desk,
          status: desk.status === 'disabled' ? 'disabled' : 'available',
          occupant: null,
          ownerDeviceId: null,
          sessionStartTime: null,
          breakEndTime: null,
          reportEndTime: null,
          reportIssuedAt: null,
          reportVerifiedAt: null,
          pendingOccupant: null,
          pendingDeskRole: null,
          pendingDeskDeadline: null,
          pendingDeviceId: null
        };
      }
      const nextUser = {
        ...user,
        activeDeskId: null,
        activeDeskRole: null,
        pendingDeskId: null,
        pendingDeskDeadline: null,
        lastActiveTime: at,
        deskReleasedAt: at,
        deskReclaimAllowedAt: at + 30 * 60 * 1000,
        gmDeskAccessAt: at
      };
      tx.set(deskRef(deskId), nextDesk);
      tx.set(userRef(userId), nextUser);
      if (promotedUser) tx.set(userRef(desk.guestOccupant), {
        ...promotedUser, activeDeskId: Number(deskId), activeDeskRole: 'owner', lastActiveTime: at
      });
      const changedDesks = [nextDesk];
      if (pendingSnap?.exists() && pendingSnap.data().pendingOccupant === userId) {
        const cleanPending = { ...pendingSnap.data(), pendingOccupant: null, pendingDeskRole: null, pendingDeskDeadline: null, pendingDeviceId: null };
        tx.set(pendingSnap.ref, cleanPending);
        changedDesks.push(cleanPending);
      }
      return { desk: nextDesk, user: nextUser, desks: changedDesks, at, mode: promotedUser ? 'owner_promoted_guest' : 'desk_empty' };
    }),
    assign: ({ userId, deskId }) => runTransaction(db, async tx => {
      const [u, d, tombstone] = await Promise.all([tx.get(userRef(userId)), tx.get(deskRef(deskId)), tx.get(deletedRef(userId))]);
      const user = refreshDailyFields(requireUser(u, tombstone));
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
      let nextDesk = releaseUserFromDesk(desk, userId), nextUser = u.exists() ? refreshDailyFields(u.data()) : null;
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
      if (mode !== 'reservation') {
        const message = `Masa ${deskId} ${mode === 'break_timeout' ? 'mola süresi aşıldığı' : 'ihbar QR ile doğrulanmadığı'} için boşaltıldı. Toplam ihlal: ${nextUser?.strikes || 0}`;
        const userInfo = nextUser ? `${String(nextUser.name || '')}${nextUser.specialCode ? ` (GM: ${nextUser.specialCode})` : ''}` : 'Kullanıcı bulunamadı';
        const audit = {
          id: `timeout-${deskId}-${mode}-${deadline}`,
          time: at,
          type: 'IHLAL',
          message,
          deskId: Number(deskId),
          userId,
          userInfo,
          actorId: 'SYSTEM',
          actorInfo: 'Sistem / Anonim'
        };
        tx.set(ref('sgmAudit', audit.id), audit, { merge: true });
        tx.set(ref('sgmViolations', `VIOL-${audit.id}`), {
          id: `VIOL-${audit.id}`,
          sourceLogId: audit.id,
          time: at,
          type: audit.type,
          message: audit.message,
          deskId: audit.deskId,
          userId: audit.userId,
          userInfo: audit.userInfo
        }, { merge: true });
      }
      return { desk: nextDesk, user: nextUser, mode, eventId: `timeout-${deskId}-${mode}-${deadline}`, at };
    })
  };
}
