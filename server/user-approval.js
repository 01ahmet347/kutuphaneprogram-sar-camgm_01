// Kısıt ve onay alanlarının tek yetkili kaynağı sunucu transaction'larıdır.
// Öğrencinin masa oturumu, kimlik bilgileri ve ihlal arşivi onay sırasında değişmez.
export const approvedAccountFields = Object.freeze({
  blocked: false,
  pendingApproval: false,
  restrictedUntil: 0,
  restrictionReason: '',
  canReport: true,
  reportPermissionPolicyVersion: 1,
  reportPermissionRestrictionUntil: 0
});

const permissionFields = Object.freeze([
  'blocked', 'pendingApproval', 'restrictedUntil', 'restrictionReason', 'canReport',
  'reportPermissionPolicyVersion', 'reportPermissionRestrictionUntil'
]);
const editFields = new Set([
  ...permissionFields, 'name', 'specialCode', 'pin', 'strikes'
]);

const failed = (message, status = 400) => Object.assign(new Error(message), { status });
const validId = id => typeof id === 'string' && id.length > 0 && id.length <= 180 && !id.includes('/');
const isRestricted = (user, at) => user.blocked === true || user.pendingApproval === true || Number(user.restrictedUntil || 0) > at;

function comparable(user, field) {
  if (['blocked','pendingApproval'].includes(field)) return user?.[field] === true;
  if (field === 'canReport') return user?.canReport !== false;
  if (['restrictedUntil','reportPermissionRestrictionUntil','reportPermissionPolicyVersion'].includes(field)) return Number(user?.[field] || 0);
  return String(user?.[field] || '');
}

export function validApprovalIds(ids) {
  return Array.isArray(ids) && ids.length >= 1 && ids.length <= 200 &&
    new Set(ids).size === ids.length && ids.every(validId);
}

export async function approveAccounts({ ids, collection, runTransaction, now = Date.now }) {
  if (!validApprovalIds(ids)) throw failed('Geçersiz hesap seçimi.');
  const users = collection('sgmUsers');
  const deleted = collection('sgmDeletedUsers');
  return runTransaction(async tx => {
    const results = await Promise.all(ids.map(async id => {
      const [user, tombstone] = await Promise.all([tx.get(users.doc(id)), tx.get(deleted.doc(id))]);
      return { id, user, tombstone };
    }));
    for (const { id, user, tombstone } of results) {
      if (!user.exists || tombstone.exists) throw failed(`Hesap bulunamadı veya silinmiş: ${id}`, 409);
    }
    const approvedAt = now();
    const patches = results.map(({ id, user }) => ({
      id,
      ...approvedAccountFields,
      // Tekrar onaylandığında da geçmiş cezalar yeni ceza hesabına katılmaz.
      restrictionClearedAt: Math.max(Number(user.data()?.restrictionClearedAt || 0), approvedAt)
    }));
    for (const { user, id } of results) {
      const { id: _id, ...patch } = patches.find(row => row.id === id);
      tx.set(user.ref, patch, { merge: true });
    }
    return patches;
  });
}

// Kullanıcı düzenleme arka plandaki senkronizasyondan ayrı yürütülür.
// Eski yönetici formu, daha yeni bir onayı/cezayı geri çeviremez.
export async function updateAdminAccount({ id, patch, expectedPermission, collection, runTransaction, now = Date.now }) {
  if (!validId(id) || !patch || typeof patch !== 'object' || Array.isArray(patch) ||
      Object.keys(patch).length === 0 || Object.keys(patch).some(key => !editFields.has(key))) {
    throw failed('Geçersiz kullanıcı değişikliği.');
  }
  for (const key of ['blocked', 'pendingApproval', 'canReport']) {
    if (key in patch && typeof patch[key] !== 'boolean') throw failed('Geçersiz hesap yetkisi.');
  }
  if ('restrictedUntil' in patch && (!Number.isSafeInteger(patch.restrictedUntil) || patch.restrictedUntil < 0)) throw failed('Geçersiz kısıt süresi.');
  if ('strikes' in patch && (!Number.isSafeInteger(patch.strikes) || patch.strikes < 0)) throw failed('Geçersiz ihlal sayısı.');
  if ('pin' in patch && !/^\d{8}$/.test(patch.pin)) throw failed('Şifre 8 rakam olmalı.');
  if ('specialCode' in patch && !/^\d{8}$/.test(patch.specialCode)) throw failed('GM özel kod 8 rakam olmalı.');
  if ('name' in patch && (typeof patch.name !== 'string' || !patch.name.trim() || patch.name.length > 180)) throw failed('Geçersiz ad soyad.');
  if (['restrictionReason','reportPermissionPolicyVersion','reportPermissionRestrictionUntil'].some(key => key in patch && (
    key === 'restrictionReason' ? typeof patch[key] !== 'string' || patch[key].length > 300 : !Number.isSafeInteger(patch[key]) || patch[key] < 0
  ))) throw failed('Geçersiz yetki bilgisi.');

  const modifiesPermissions = permissionFields.some(key => key in patch);
  if (modifiesPermissions && (!expectedPermission || typeof expectedPermission !== 'object')) throw failed('Hesap durumunu yenileyin.');
  const ref = collection('sgmUsers').doc(id);
  const tombstoneRef = collection('sgmDeletedUsers').doc(id);
  return runTransaction(async tx => {
    const [snapshot, tombstone] = await Promise.all([tx.get(ref), tx.get(tombstoneRef)]);
    if (!snapshot.exists || tombstone.exists) throw failed('Hesap silinmiş veya bulunamadı.', 409);
    const remote = snapshot.data();
    if (modifiesPermissions && permissionFields.some(key => comparable(remote, key) !== comparable(expectedPermission, key))) {
      throw failed('Bu hesabın kısıtı başka bir işlemle değişmiş. Güncel listeyi yenileyip tekrar deneyin.', 409);
    }
    const at = now();
    const next = { ...remote, ...patch };
    const applied = { ...patch };
    if (modifiesPermissions && isRestricted(remote, at) && !isRestricted(next, at)) {
      applied.restrictionClearedAt = Math.max(Number(remote.restrictionClearedAt || 0), at);
    }
    if (Object.keys(applied).length) tx.set(ref, applied, { merge: true });
    return { ...remote, ...applied, id };
  });
}

export async function restoreReportPermission({ id, collection, runTransaction, now = Date.now }) {
  if (!validId(id)) throw failed('Geçersiz hesap.');
  const ref = collection('sgmUsers').doc(id);
  return runTransaction(async tx => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) return null;
    const user = snapshot.data();
    const at = now();
    if (isRestricted(user, at) || user.canReport !== false) return null;
    const patch = {
      canReport: true,
      reportPermissionPolicyVersion: 1,
      reportPermissionRestrictionUntil: Number(user.restrictedUntil || 0),
      reportPermissionRestoredAt: at
    };
    tx.set(ref, patch, { merge: true });
    return { ...user, ...patch, id };
  });
}
