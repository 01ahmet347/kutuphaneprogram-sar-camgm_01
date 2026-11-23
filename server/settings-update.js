// All settings and optional break balances are updated atomically on the server.
// No desk, QR, session, violation-history, credential, or message document is written.
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

const fields = new Set([
  'openTime','closeTime', 'shortBreakCount','longBreakCount','hourlyBreakEnabled',
  'hourlyBreakCount','shortBreakDuration','longBreakDuration','hourlyBreakDuration',
  'breakCooldown','reportWaitTime','strikeLimit','reportsEnabled','useCustomLayout'
]);
const limits = {
  shortBreakCount: [0, 50], longBreakCount: [0, 50], hourlyBreakCount: [0, 50],
  shortBreakDuration: [1, 240], longBreakDuration: [1, 240], hourlyBreakDuration: [1, 240],
  breakCooldown: [30, 240], reportWaitTime: [1, 240], strikeLimit: [1, 100]
};
const clock = value => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
const minutes = value => Number(value.slice(0,2))*60 + Number(value.slice(3,5));
const count = (config, type) => {
  if (type === 'hourly' && config.hourlyBreakEnabled === false) return 0;
  const field = `${type}BreakCount`;
  const fallback = {short:5,long:2,hourly:1}[type];
  const value = config[field] == null ? fallback : Number(config[field]);
  return Number.isSafeInteger(value) && value >= 0 && value <= 50 ? value : fallback;
};

export function validateSettingsPatch(patch, old = {}) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) ||
      !Object.keys(patch).length || Object.keys(patch).some(key => !fields.has(key))) {
    throw fail('Geçersiz sistem ayarları.');
  }
  for (const [field, [min, max]] of Object.entries(limits)) {
    if (field in patch && (!Number.isSafeInteger(patch[field]) || patch[field] < min || patch[field] > max)) {
      throw fail('Geçersiz sayı: ' + field);
    }
  }
  for (const field of ['hourlyBreakEnabled','reportsEnabled','useCustomLayout']) {
    if (field in patch && typeof patch[field] !== 'boolean') throw fail('Geçersiz ayar: ' + field);
  }
  const next = {...old, ...patch};
  const open = next.openTime ?? '07:00';
  const close = next.closeTime ?? '22:00';
  // Mevcut öğrenci arayüzü gece yarısını aşan saatleri de destekler.
  if (!clock(open) || !clock(close) || minutes(open) === minutes(close)) {
    throw fail('Açılış ve kapanış farklı, geçerli saatler olmalıdır.');
  }
  return next;
}

export function adjustedBalance(breaks, previous, next) {
  const result = {...(breaks || {})};
  for (const type of ['short','long','hourly']) {
    const before = count(previous, type);
    const after = count(next, type);
    const remaining = Number.isFinite(Number(result[type])) ? Number(result[type]) : before;
    result[type] = Math.max(0, Math.min(after, remaining + after - before));
  }
  return result;
}

export async function updateSystemSettings({ patch, collection, runTransaction }) {
  const settingsRef = collection('sgmConfig').doc('settings');
  const usersRef = collection('sgmUsers');
  return runTransaction(async tx => {
    const previousSnap = await tx.get(settingsRef);
    const previous = previousSnap.exists ? previousSnap.data() : {};
    const next = validateSettingsPatch(patch, previous);
    const limitsChanged = ['short','long','hourly'].some(type => count(previous,type) !== count(next,type));
    let userRows = [];
    if (limitsChanged) {
      const snapshot = await tx.get(usersRef);
      // A transaction uses at most 500 writes. Refuse rather than partially adjust any account.
      if (snapshot.size > 450) throw fail('Çok sayıda kullanıcı var. Mola güncellemesi için toplu geçiş gerekli; ayarlar değiştirilmedi.', 409);
      userRows = snapshot.docs;
    }
    const balances = [];
    for (const doc of userRows) {
      const user = doc.data();
      const breaks = adjustedBalance(user.breaks, previous, next);
      if (JSON.stringify(breaks) === JSON.stringify(user.breaks)) continue;
      tx.set(doc.ref, { breaks }, { merge: true });
      balances.push({ id: doc.id, breaks });
    }
    tx.set(settingsRef, patch, { merge: true });
    return { settings: next, updatedBalances: balances, usersAdjusted: balances.length };
  });
}
