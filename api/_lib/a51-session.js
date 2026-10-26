// AREA 51 — Sesión temporal de prueba para MIS COMPRAS.
// No autoriza pagos, compras ni descargas.
import { createHmac, timingSafeEqual } from 'node:crypto';

export const TEST_EMAIL = 'area51.balcarce@gmail.com';
const COOKIE = 'a51_mis_compras';
const TTL_SECONDS = 15 * 60;
function secret() {
  const value = process.env.AREA51_EMAIL_CODE_SECRET;
  return typeof value === 'string' && value.length >= 32 ? value : null;
}
function signature(payload, key) {
  return createHmac('sha256', key).update('area51:mis-compras:session:v1:' + payload).digest('base64url');
}
export function makeSessionCookie(email) {
  const key = secret();
  if (!key || email !== TEST_EMAIL) throw new Error('Sesión de prueba no disponible');
  const payload = Buffer.from(JSON.stringify({ email, exp: Math.floor(Date.now() / 1000) + TTL_SECONDS, scope: 'mis-compras-test' })).toString('base64url');
  const token = payload + '.' + signature(payload, key);
  return `${COOKIE}=${token}; Max-Age=${TTL_SECONDS}; Path=/; HttpOnly; Secure; SameSite=Strict`;
}
export function clearSessionCookie() {
  return `${COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict`;
}
export function readSession(req) {
  const key = secret();
  if (!key) return null;
  const cookies = String(req.headers.cookie || '').split(';');
  const raw = cookies.map(c => c.trim()).find(c => c.startsWith(COOKIE + '='));
  if (!raw) return null;
  const token = raw.slice(COOKIE.length + 1);
  if (token.length > 1024 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return null;
  const [payload, mac] = token.split('.');
  const expected = Buffer.from(signature(payload, key));
  const actual = Buffer.from(mac);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const now = Math.floor(Date.now() / 1000);
    if (data.email !== TEST_EMAIL || data.scope !== 'mis-compras-test' || !Number.isSafeInteger(data.exp) || data.exp <= now || data.exp > now + TTL_SECONDS) return null;
    return { email: data.email, expiresAt: new Date(data.exp * 1000).toISOString() };
  } catch { return null; }
}
export function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin || typeof origin !== 'string') return false;
  try {
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    return new URL(origin).protocol === 'https:' && new URL(origin).host === host;
  } catch { return false; }
}
