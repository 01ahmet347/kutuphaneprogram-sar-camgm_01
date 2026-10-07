import { createCloudActions } from '../src/cloud-transactions.js';

const getIstanbulDayKey = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};

export function createStudentDeskHandler({ authenticateStudent, createActions }) {
  return async function studentDeskHandler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ ok: false });
    }

    try {
      const uid = await authenticateStudent(req);
      if (!uid) return res.status(401).json({ ok: false, error: 'unauthenticated' });

      const { action, deskId, deviceId, qrCode, type, targetUserId } = req.body || {};
      if (!['reserve', 'claim', 'cancel', 'expire', 'break-start', 'break-end', 'report', 'verify', 'leave'].includes(action) ||
          !Number.isInteger(Number(deskId)) || Number(deskId) < 1 || Number(deskId) > 35 ||
          ['reserve', 'claim'].includes(action) &&
            (typeof deviceId !== 'string' || deviceId.length < 1 || deviceId.length > 180) ||
          ['claim', 'break-end', 'verify'].includes(action) && (typeof qrCode !== 'string' || qrCode.length < 1 || qrCode.length > 500) ||
          action === 'break-start' && !['short', 'long'].includes(type) ||
          action === 'report' && (typeof targetUserId !== 'string' || !targetUserId || targetUserId.includes('/') || targetUserId.length > 180)) {
        return res.status(400).json({ ok: false, error: 'invalid_request' });
      }

      const actions = await createActions();
      const input = { userId: uid, deskId: Number(deskId) };
      const result = action === 'expire'
        ? await actions.expireDesk(Number(deskId))
        : await actions[{
            'break-start': 'startBreak',
            'break-end': 'endBreak',
            report: 'reportDesk',
            verify: 'verifyPresence',
            leave: 'leaveDesk'
          }[action] || action]({
            ...input,
            ...(action === 'reserve' || action === 'claim' ? { deviceId } : {}),
            ...(action === 'claim' || action === 'break-end' || action === 'verify' ? { qrCode } : {}),
            ...(action === 'break-start' ? { type } : {}),
            ...(action === 'report' ? { targetUserId } : {})
          });
      if (!result) return res.status(200).json({ ok: true, result: null });
      const sourceUser = result.user || null;
      const { pin: _pin, pushTokens: _pushTokens, ...user } = sourceUser || {};
      return res.status(200).json({
        ok: true,
        desk: result.desk,
        ...(sourceUser ? { user } : {}),
        deadline: result.deadline,
        at: result.at,
        waitMinutes: result.waitMinutes,
        leaveMode: result.mode,
        alreadyApplied: result.alreadyApplied === true,
        mode: result.mode,
        verified: result.verified === true,
        eventId: result.eventId
      });
    } catch (error) {
      if (error.code?.startsWith('firestore/') || error.code?.startsWith('app/') || error.code?.startsWith('auth/')) {
        console.error('Student desk action error:', error.code);
        return res.status(503).json({ ok: false, error: 'desk_action_unavailable', message: 'Masa işlemi sunucuya kaydedilemedi. Bağlantıyı kontrol edip tekrar deneyin.' });
      }
      return res.status(409).json({ ok: false, error: 'desk_action_rejected', message: error.message || 'Masa işlemi reddedildi.' });
    }
  };
}

export { getIstanbulDayKey };
