// AREA 51 — api/verify-code.js
// PRUEBA CONTROLADA: verifica el código sin habilitar compras ni emitir sesiones.
import { createHmac, timingSafeEqual } from 'node:crypto';

const TEST_EMAIL = 'area51.balcarce@gmail.com';
const PURPOSE = 'checkout';
function dbHeaders(key, extra = {}) {
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...extra };
}
function digest(email, code, secret) {
  return createHmac('sha256', secret).update(`${PURPOSE}:${email}:${code}`).digest('hex');
}
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Allow', 'POST');
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Método no permitido.' });
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
  if (email !== TEST_EMAIL) return res.status(403).json({ ok: false, error: 'Correo de prueba no autorizado.' });
  if (!/^\d{6}$/.test(code)) return res.status(400).json({ ok: false, error: 'Ingresá los 6 dígitos.' });
  const url = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const secret = process.env.AREA51_EMAIL_CODE_SECRET;
  if (!url || !key || !secret || secret.length < 32) return res.status(503).json({ ok: false, error: 'Configuración incompleta.' });
  try {
    const query = new URL(`${url}/rest/v1/email_verifications`);
    query.searchParams.set('select', 'id,code_hash,attempts,expires_at,verified_at,consumed_at');
    query.searchParams.set('email', `eq.${email}`);
    query.searchParams.set('purpose', `eq.${PURPOSE}`);
    query.searchParams.set('order', 'created_at.desc');
    query.searchParams.set('limit', '1');
    const response = await fetch(query, { headers: dbHeaders(key), signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`lookup ${response.status}`);
    const record = (await response.json())[0];
    if (!record || record.consumed_at || record.verified_at || record.attempts >= 5 || Date.parse(record.expires_at) <= Date.now()) {
      return res.status(400).json({ ok: false, error: 'Código inválido, vencido o ya utilizado.' });
    }
    const expected = Buffer.from(digest(email, code, secret), 'hex');
    const stored = /^[a-f0-9]{64}$/i.test(record.code_hash || '') ? Buffer.from(record.code_hash, 'hex') : Buffer.alloc(0);
    const match = stored.length === expected.length && timingSafeEqual(stored, expected);
    const filter = new URL(`${url}/rest/v1/email_verifications`);
    filter.searchParams.set('id', `eq.${record.id}`);
    filter.searchParams.set('attempts', `eq.${record.attempts}`);
    filter.searchParams.set('verified_at', 'is.null');
    filter.searchParams.set('consumed_at', 'is.null');
    const update = await fetch(filter, {
      method: 'PATCH', headers: dbHeaders(key, { Prefer: 'return=representation' }),
      body: JSON.stringify(match
        ? { verified_at: new Date().toISOString(), consumed_at: new Date().toISOString() }
        : { attempts: record.attempts + 1 }),
      signal: AbortSignal.timeout(10000)
    });
    if (!update.ok) throw new Error(`update ${update.status}`);
    const changed = await update.json();
    if (!changed.length) return res.status(409).json({ ok: false, error: 'La verificación cambió. Volvé a intentarlo.' });
    if (!match) return res.status(400).json({ ok: false, error: 'Código incorrecto.' });
    return res.status(200).json({ ok: true, message: 'Correo de prueba verificado correctamente.' });
  } catch (e) {
    console.error('AREA51 verify-code:', e.message);
    return res.status(502).json({ ok: false, error: 'No se pudo comprobar el código.' });
  }
}
