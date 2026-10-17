// A partial authorization response must not pass through full-user normalization:
// that would fabricate identity codes and reset counters on the admin screen.
export function mergeAccountApproval(rows, patches) {
  const byId = new Map(patches.map(({ id, ...patch }) => [String(id), patch]));
  return rows.map(row => byId.has(String(row.id)) ? { ...row, ...byId.get(String(row.id)) } : row);
}
