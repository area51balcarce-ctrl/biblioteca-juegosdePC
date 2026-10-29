// AREA 51 - Biblioteca PC - Modulo aislado; no habilita acceso publico.
import { randomBytes, createHash } from 'node:crypto';
export const COOKIE_NAME = 'a51_pc_customer';
export const IDLE_SECONDS = 30 * 86400;
export const ABSOLUTE_SECONDS = 180 * 86400;
const TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/;
export function createToken() {
  return randomBytes(32).toString('base64url');
}
export function tokenDigest(token) {
  if (typeof token !== 'string' || !TOKEN_FORMAT.test(token)) return null;
  return createHash('sha256').update('area51:pc:session:v1:' + token).digest('hex');
}
export function getCookieToken(header) {
  if (typeof header !== 'string' || header.length > 8192) return null;
  const matches = header.split(';').map(part => part.trim()).filter(part => part.startsWith(COOKIE_NAME + '='));
  if (matches.length !== 1) return null;
  const token = matches[0].slice(COOKIE_NAME.length + 1);
  return TOKEN_FORMAT.test(token) ? token : null;
}
export function makeCookie(token) {
  if (!tokenDigest(token)) throw new Error('Invalid session token');
  return COOKIE_NAME + '=' + token + '; Max-Age=' + IDLE_SECONDS + '; Path=/; HttpOnly; Secure; SameSite=Lax';
}
export function clearCookie() {
  return COOKIE_NAME + '=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax';
}
export function isValidSession(row, now = Date.now()) {
  if (!row || row.revoked_at || !Number.isFinite(now)) return false;
  const created = Date.parse(row.created_at);
  const seen = Date.parse(row.last_seen_at);
  const expiry = Date.parse(row.expires_at);
  if (![created, seen, expiry].every(Number.isFinite)) return false;
  if (created > now || seen < created || seen > now || expiry <= now) return false;
  return now - created < ABSOLUTE_SECONDS * 1000 && now - seen < IDLE_SECONDS * 1000;
}
