const STUDENT_EVENT_PREFIXES = [
  'SISTEM_GIRIS',
  'PIL_AYARI_BILGILENDIRME',
  'OGRENCI_CIKIS',
  'GERIBILDIRIM_ACILDI',
  'MASA_',
  'MOLA_',
  'BILDIRIM_IPTAL',
  'KISITLI_ISLEM_ENGELLENDI',
  'MASA_BEKLEME_ENGELLENDI',
  'AYNI_',
  'UYGULAMA_'
];

export function createStudentActivityHandler({ authenticateStudent, saveFeedback, savePushToken, saveAuditEvent }) {
  return async function studentActivityHandler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    }

    try {
      const uid = await authenticateStudent(req);
      if (!uid) return res.status(401).json({ ok: false, error: 'unauthenticated' });
      const body = req.body || {};
      let result;

      if (body.action === 'feedback') {
        const type = body.type;
        const message = typeof body.message === 'string' ? body.message.trim() : '';
        if (!['complaint', 'suggestion'].includes(type) || message.length < 3 || message.length > 2000 ||
            typeof body.id !== 'string' || body.id.length < 1 || body.id.length > 180 || body.id.includes('/')) {
          return res.status(400).json({ ok: false, error: 'invalid_feedback' });
        }
        result = await saveFeedback(uid, { id: body.id, type, message });
        if (result?.rateLimited) {
          return res.status(429).json({ ok: false, error: 'feedback_rate_limited', message: 'Çok sık geri bildirim gönderildi. Daha sonra tekrar deneyin.' });
        }
      } else if (body.action === 'register-push-token') {
        if (typeof body.token !== 'string' || body.token.length < 20 || body.token.length > 4096) {
          return res.status(400).json({ ok: false, error: 'invalid_push_token' });
        }
        result = await savePushToken(uid, body.token);
      } else if (body.action === 'audit-event') {
        const record = body.record;
        if (!record || typeof record !== 'object' || Array.isArray(record) ||
            typeof record.id !== 'string' || record.id.length < 1 || record.id.length > 180 ||
            record.id.includes('/') ||
            typeof record.type !== 'string' || !STUDENT_EVENT_PREFIXES.some(prefix => record.type.startsWith(prefix)) ||
            record.type.startsWith('IHLAL') || record.type.includes('ADMIN') ||
            typeof record.message !== 'string' || record.message.length > 500 ||
            record.deskId != null && (!Number.isInteger(Number(record.deskId)) || Number(record.deskId) < 1 || Number(record.deskId) > 35)) {
          return res.status(400).json({ ok: false, error: 'invalid_audit_event' });
        }
        result = await saveAuditEvent(uid, {
          id: record.id,
          type: record.type,
          message: record.message.trim(),
          deskId: record.deskId == null ? null : Number(record.deskId)
        });
      } else {
        return res.status(400).json({ ok: false, error: 'unsupported_action' });
      }

      return res.status(200).json({ ok: true, result });
    } catch (error) {
      if (error.status) return res.status(error.status).json({ ok: false, error: error.code, message: error.message });
      if (error.code?.startsWith('firestore/') || error.code?.startsWith('app/') || error.code?.startsWith('auth/')) {
        console.error('Student activity error:', error.code);
        return res.status(503).json({ ok: false, error: 'student_activity_unavailable', message: 'İşlem sunucuya kaydedilemedi. Bağlantıyı kontrol edip tekrar deneyin.' });
      }
      return res.status(409).json({ ok: false, error: 'student_activity_rejected', message: error.message || 'İşlem reddedildi.' });
    }
  };
}

export function createStudentProfileWriters({ dataCollection, now = Date.now }) {
  const requireStudent = async (tx, uid) => {
    const users = dataCollection('sgmUsers');
    const userRef = users.doc(uid);
    const deletedRef = dataCollection('sgmDeletedUsers').doc(uid);
    const [userSnapshot, deletedSnapshot] = await Promise.all([tx.get(userRef), tx.get(deletedRef)]);
    if (!userSnapshot.exists || deletedSnapshot.exists) {
      throw Object.assign(new Error('Öğrenci hesabı bulunamadı.'), { status: 410, code: 'student_deleted' });
    }
    return { userRef, user: userSnapshot.data() };
  };

  return {
    async saveFeedback(uid, { id, type, message }) {
      const ref = dataCollection('sgmFeedback').doc(id);
      const users = dataCollection('sgmUsers');
      const userRef = users.doc(uid);
      const deletedRef = dataCollection('sgmDeletedUsers').doc(uid);
      const settingsRef = dataCollection('sgmConfig').doc('settings');
      const limitRef = dataCollection('sgmStudentActivityLimits').doc(`${uid}-feedback`);
      const at = now();
      return ref.firestore.runTransaction(async tx => {
        const [userSnapshot, deletedSnapshot, settingsSnapshot, existing, limitSnapshot] = await Promise.all([
          tx.get(userRef), tx.get(deletedRef), tx.get(settingsRef), tx.get(ref), tx.get(limitRef)
        ]);
        if (!userSnapshot.exists || deletedSnapshot.exists) {
          throw Object.assign(new Error('Öğrenci hesabı bulunamadı.'), { status: 410, code: 'student_deleted' });
        }
        const user = userSnapshot.data();
        if (existing.exists) return { id: ref.id, time: existing.data().time, deduplicated: true };
        if (user.pendingApproval || user.blocked || Number(user.restrictedUntil || 0) > at) {
          throw Object.assign(new Error('Kısıtlı veya onay bekleyen hesap geri bildirim gönderemez.'), { status: 403, code: 'student_restricted' });
        }
        const config = settingsSnapshot.data() || {};
        const [openHour, openMinute] = String(config.openTime || '07:00').split(':').map(Number);
        const [closeHour, closeMinute] = String(config.closeTime || '22:00').split(':').map(Number);
        const localTime = new Intl.DateTimeFormat('en-GB', {
          timeZone: 'Europe/Istanbul',
          hour: '2-digit',
          minute: '2-digit',
          hourCycle: 'h23'
        }).formatToParts(new Date(at));
        const localValues = Object.fromEntries(localTime.map(part => [part.type, Number(part.value)]));
        const minuteOfDay = localValues.hour * 60 + localValues.minute;
        const openAt = openHour * 60 + openMinute;
        const closeAt = closeHour * 60 + closeMinute;
        const isOpen = openAt < closeAt
          ? minuteOfDay >= openAt && minuteOfDay < closeAt
          : minuteOfDay >= openAt || minuteOfDay < closeAt;
        if (!isOpen) throw Object.assign(new Error('Kütüphane kapalıyken geri bildirim gönderilemez.'), { status: 409, code: 'library_closed' });
        const previousLimit = limitSnapshot.data() || {};
        const withinWindow = Number(previousLimit.windowStart || 0) > at - 60 * 60 * 1000;
        const attempts = withinWindow ? Number(previousLimit.attempts || 0) + 1 : 1;
        if (attempts > 5) return { rateLimited: true };
        tx.set(limitRef, {
          attempts,
          windowStart: withinWindow ? Number(previousLimit.windowStart) : at,
          updatedAt: at
        });
        const record = {
          id,
          time: at,
          userId: uid,
          name: String(user.name || ''),
          identityNo: String(user.identityNo || user.specialCode || ''),
          specialCode: String(user.specialCode || ''),
          type,
          message
        };
        tx.create(ref, record);
        return { id: ref.id, time: at };
      });
    },

    async savePushToken(uid, token) {
      const users = dataCollection('sgmUsers');
      const userRef = users.doc(uid);
      const deletedRef = dataCollection('sgmDeletedUsers').doc(uid);
      const at = now();
      return users.firestore.runTransaction(async tx => {
        const [userSnapshot, deletedSnapshot] = await Promise.all([tx.get(userRef), tx.get(deletedRef)]);
        if (!userSnapshot.exists || deletedSnapshot.exists) {
          throw Object.assign(new Error('Öğrenci hesabı bulunamadı.'), { status: 410, code: 'student_deleted' });
        }
        const user = userSnapshot.data();
        const pushTokens = [token, ...(Array.isArray(user.pushTokens) ? user.pushTokens.filter(value => value && value !== token) : [])].slice(0, 5);
        tx.set(userRef, {
          pushTokens,
          pushEnabled: true,
          pushUpdatedAt: at,
          pushLastStage: '13_hazir',
          pushLastError: '',
          pushLastErrorCode: '',
          pushLastAttemptAt: at
        }, { merge: true });
        return { pushTokens, pushEnabled: true, pushUpdatedAt: at, pushLastStage: '13_hazir' };
      });
    },

    async saveAuditEvent(uid, event) {
      const auditRef = dataCollection('sgmAudit').doc(event.id);
      const at = now();
      return auditRef.firestore.runTransaction(async tx => {
        const [student, eventSnapshot, deletedEvent] = await Promise.all([
          requireStudent(tx, uid),
          tx.get(auditRef),
          tx.get(dataCollection('sgmDeletedRecords').doc(`logs-${event.id}`))
        ]);
        if (deletedEvent.exists) return { saved: false, deleted: true };
        if (eventSnapshot.exists) return { saved: true, deduplicated: true };
        const user = student.user;
        tx.create(auditRef, {
          ...event,
          time: at,
          userId: uid,
          userInfo: `${String(user.name || '')}${user.specialCode ? ` (GM: ${user.specialCode})` : ''}`,
          actorFirebaseUid: uid,
          actorId: uid,
          actorInfo: String(user.specialCode || 'Öğrenci'),
          deviceInfo: String(user.deviceId || '')
        });
        return { saved: true, deduplicated: false };
      });
    }
  };
}
