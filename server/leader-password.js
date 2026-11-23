import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
const fail = (message, status=400) => Object.assign(new Error(message), {status});
export const normalizeLeaderName = value => String(value || '').trim().toLocaleLowerCase('tr-TR');
export function validLeaderUsername(value) { return typeof value === 'string' && /^[a-z0-9._-]{3,48}$/.test(value); }
export function validLeaderPassword(value) { return typeof value === 'string' && value.length >= 12 && value.length <= 128; }
export function hashLeaderPassword(password, salt=randomBytes(16).toString('hex')) {
  if (!validLeaderPassword(password)) throw fail('Lider şifresi 12-128 karakter olmalı.');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}
export function verifyLeaderPassword(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !/^[a-f0-9]{32}$/.test(salt) || !/^[a-f0-9]{128}$/.test(hash || '')) return false;
  const actual = scryptSync(String(password || ''), salt, 64);
  return timingSafeEqual(actual, Buffer.from(hash, 'hex'));
}
