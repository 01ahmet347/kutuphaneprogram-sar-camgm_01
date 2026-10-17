// A single, server-authorized permission patch; never rewrites credentials,
// current desk sessions, violation history, or deleted user documents.
export const approvedAccountFields = Object.freeze({
  blocked: false,
  pendingApproval: false,
  restrictedUntil: 0,
  restrictionReason: '',
  canReport: true,
  reportPermissionPolicyVersion: 1,
  reportPermissionRestrictionUntil: 0
});

export function validApprovalIds(ids) {
  return Array.isArray(ids) && ids.length >= 1 && ids.length <= 200 &&
    new Set(ids).size === ids.length && ids.every(id =>
      typeof id === 'string' && id.length > 0 && id.length <= 180 && !id.includes('/'));
}

export async function approveAccounts({ ids, collection, runTransaction }) {
  if (!validApprovalIds(ids)) throw Object.assign(new Error('Geçersiz hesap seçimi.'), { status: 400 });
  const users = collection('sgmUsers');
  const deleted = collection('sgmDeletedUsers');
  return runTransaction(async tx => {
    // All reads before writes: safe against concurrently deleted accounts.
    const results = await Promise.all(ids.map(async id => {
      const [user, tombstone] = await Promise.all([
        tx.get(users.doc(id)), tx.get(deleted.doc(id))
      ]);
      return { id, user, tombstone };
    }));
    for (const { id, user, tombstone } of results) {
      if (!user.exists || tombstone.exists) {
        throw Object.assign(new Error(`Hesap bulunamadı veya silinmiş: ${id}`), { status: 409 });
      }
    }
    for (const { user } of results) tx.set(user.ref, approvedAccountFields, { merge: true });
    return results.map(({ id }) => ({ id, ...approvedAccountFields }));
  });
}
