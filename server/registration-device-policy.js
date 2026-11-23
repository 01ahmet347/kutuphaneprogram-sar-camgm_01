import { createHash } from 'node:crypto';
// Tarayıcı tanımlayıcısı fiziksel donanım kimliği değildir; çerez/veri silinince değişebilir.
export const validRegistrationDevice = value => typeof value==='string' && /^DEV-[a-z0-9-]{6,100}$/i.test(value);
export const registrationDeviceHash = value => createHash('sha256').update(String(value)).digest('hex');
