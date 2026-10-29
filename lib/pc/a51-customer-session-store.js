// AREA51 PC - server-side persistent session lookup. Not connected to routes.
// Requires the service-role credential ONLY in the server runtime.
import { getCookieToken, tokenDigest, isValidSession, IDLE_SECONDS, ABSOLUTE_SECONDS } from './a51-customer-session.js';

function settings() {
  const base = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !/^https:\/\//.test(base) || !key) throw new Error('Session storage not configured');
  return { base, key };
}
async function request(url, key, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: { apikey: key, Authorization: 'Bearer ' + key, Accept: 'application/json',
      'Content-Type': 'application/json', ...init.headers },
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error('Session store HTTP ' + response.status);
  if (response.status === 204) return [];
  return response.json();
}
export async function readCustomerSession(req) {
  const token = getCookieToken(req.headers.cookie);
  const hash = token && tokenDigest(token);
  if (!hash) return null;
  const { base, key } = settings();
  const url = new URL(base + '/rest/v1/pc_customer_sessions');
  url.searchParams.set('select', 'id,customer_email,created_at,last_seen_at,expires_at,revoked_at');
  url.searchParams.set('token_hash', 'eq.' + hash);
  url.searchParams.set('limit', '1');
  const found = await request(url, key);
  const record = Array.isArray(found) ? found[0] : null;
  if (!isValidSession(record)) return null;
  return { id: record.id, email: record.customer_email, expiresAt: record.expires_at, lastSeenAt: record.last_seen_at };
}
// Refresh idle activity at most once per day. Never extend the absolute lifetime.
export async function touchCustomerSession(session) {
  if (!session?.id || !session?.email) return false;
  const { base, key } = settings();
  const url = new URL(base + '/rest/v1/pc_customer_sessions');
  url.searchParams.set('id', 'eq.' + session.id);
  url.searchParams.set('customer_email', 'eq.' + session.email);
  url.searchParams.set('revoked_at', 'is.null');
  const now = new Date().toISOString();
  await request(url, key, { method:'PATCH',
    body:JSON.stringify({ last_seen_at: now }) });
  return true;
}
// Called only after a successful, one-time verification of the email OTP.
export async function storeVerifiedCustomerSession(email, token) {
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      email !== email.trim().toLowerCase()) throw new Error('Invalid verified email');
  const hash = tokenDigest(token);
  if (!hash) throw new Error('Invalid session token');
  const { base, key } = settings();
  const now = Date.now();
  const expires = new Date(now + ABSOLUTE_SECONDS * 1000).toISOString();
  const rows = await request(base + '/rest/v1/pc_customer_sessions', key, {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ token_hash: hash, customer_email: email,
      last_seen_at: new Date(now).toISOString(), expires_at: expires })
  });
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error('Session insert not confirmed');
  return rows[0].id;
}
export async function revokeCustomerSession(req) {
  const token = getCookieToken(req.headers.cookie);
  const hash = token && tokenDigest(token);
  if (!hash) return;
  const { base, key } = settings();
  const url = new URL(base + '/rest/v1/pc_customer_sessions');
  url.searchParams.set('token_hash', 'eq.' + hash);
  url.searchParams.set('revoked_at', 'is.null');
  await request(url, key, { method: 'PATCH',
    body: JSON.stringify({ revoked_at: new Date().toISOString() }) });
}
// Future integration must refresh last_seen_at with throttling and ensure
// sliding idle expiration never exceeds the absolute expiration.
export { IDLE_SECONDS };
