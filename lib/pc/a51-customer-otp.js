// AREA51 Biblioteca PC - primitives for future production OTP flow.
// Not connected to public routes. Test OTP remains unchanged.
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
export const OTP_TTL_MS = 10 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_MAX_PER_HOUR = 3;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function normalizeCustomerEmail(value) {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && EMAIL.test(email) ? email : null;
}
export function generateLoginCode() {
  return String(randomInt(0, 1000000)).padStart(6, '0');
}
export function hashLoginCode(email, code) {
  const secret = process.env.AREA51_EMAIL_CODE_SECRET;
  if (typeof secret !== 'string' || secret.length < 32) throw new Error('OTP secret not configured');
  if (normalizeCustomerEmail(email) !== email || !/^\d{6}$/.test(code)) throw new Error('Invalid OTP input');
  return createHmac('sha256', secret).update('area51:pc:production-login:v1:' + email + ':' + code).digest('hex');
}
export function verifyLoginCodeHash(email, code, stored) {
  if (!/^\d{6}$/.test(String(code)) || !/^[a-f0-9]{64}$/.test(String(stored))) return false;
  const actual = Buffer.from(hashLoginCode(email, code), 'hex');
  const expected = Buffer.from(stored, 'hex');
  return timingSafeEqual(actual, expected);
}
export function isLoginCodeUsable(row, now = Date.now()) {
  if (!row || row.consumed_at || !Number.isInteger(row.attempts) ||
      row.attempts < 0 || row.attempts >= OTP_MAX_ATTEMPTS) return false;
  const expiry = Date.parse(row.expires_at);
  return Number.isFinite(expiry) && expiry > now;
}
// Integration MUST consume the OTP atomically (compare-and-set), enforce
// per-email/IP throttling and only issue session after successful consumption.
