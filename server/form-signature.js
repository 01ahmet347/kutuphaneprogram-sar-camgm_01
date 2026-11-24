import { createHmac, timingSafeEqual } from 'node:crypto';
export const validGMCode = code => typeof code === 'string' && /^\d{8}$/.test(code);

// Apps Script signs the timestamp + code + submission ID; requests expire after 5 minutes.
export function verifyFormSignature({secret,timestamp,code,submissionId,email,signature,now=Date.now()}) {
  if (!secret || secret.length < 32 || !validGMCode(code) || typeof submissionId !== 'string' ||
      !/^[\w-]{8,160}$/.test(submissionId) || !Number.isSafeInteger(timestamp) ||
      Math.abs(now-timestamp)>5*60*1000 || !/^[a-f0-9]{64}$/i.test(String(signature||''))) return false;
  const expected=createHmac('sha256',secret).update(`${timestamp}:${code}:${submissionId}${email ? `:${String(email).trim().toLowerCase()}` : ''}`).digest();
  return timingSafeEqual(expected,Buffer.from(signature,'hex'));
}
