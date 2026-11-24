// Sadece yönetici arşivi için sürümlü, eklemeli JSON yedek biçimi.
export const ARCHIVE_BUCKETS = Object.freeze(['logs', 'violations', 'feedback']);
export function makeArchiveBackup(bucket, records) {
  if (!ARCHIVE_BUCKETS.includes(bucket)) throw new Error('Bilinmeyen arşiv türü.');
  return {format:'sgm-archive-backup', schemaVersion:1, bucket, exportedAt:new Date().toISOString(), records};
}
export function inspectArchiveBackup(data, expectedBucket) {
  if (!data || data.format !== 'sgm-archive-backup' || data.schemaVersion !== 1 || data.bucket !== expectedBucket || !ARCHIVE_BUCKETS.includes(data.bucket)) throw new Error('Yanlış sekmeye ait ya da desteklenmeyen JSON yedek dosyası.');
  if (!Array.isArray(data.records) || data.records.length > 20000) throw new Error('Geçersiz arşiv kaydı sayısı (en fazla 20.000).');
  const seen = new Set();
  for (const [index, r] of data.records.entries()) {
    if (!r || typeof r !== 'object' || Array.isArray(r) || typeof r.id !== 'string' || !r.id.trim() || r.id.length > 250 || r.id.includes('/') || Number.isNaN(Number(r.time)) || !Number.isFinite(Number(r.time))) throw new Error(`${index + 1}. arşiv kaydı geçersiz.`);
    if (seen.has(r.id)) throw new Error('Dosyada tekrarlanan kayıt kimliği var.');
    seen.add(r.id);
    if (JSON.stringify(r).length > 500000) throw new Error('Çok büyük kayıt bulundu.');
  }
  return {bucket:data.bucket, records:data.records};
}
