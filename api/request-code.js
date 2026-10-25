// AREA 51 — api/request-code.js
// PRUEBA CONTROLADA: solo area51.balcarce@gmail.com
import { randomInt, createHmac } from 'node:crypto';

const TEST_EMAIL = 'area51.balcarce@gmail.com';
const PURPOSE = 'checkout';
const MAX_PER_HOUR = 3;
const EXPIRY_MINUTES = 10;
const JSON_HEADERS = { 'Content-Type': 'application/json' };

function digest(email, code, secret) {
  return createHmac('sha256', secret).update(`${PURPOSE}:${email}:${code}`).digest('hex');
}
function config() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const resend = process.env.RESEND_API_KEY;
  const secret = process.env.AREA51_EMAIL_CODE_SECRET;
  if (!url || !key || !resend || !secret || secret.length < 32) return null;
  return { url, key, resend, secret };
}
function dbHeaders(key, extra = {}) {
  return { apikey: key, Authorization: `Bearer ${key}`, ...JSON_HEADERS, ...extra };
}
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Allow', 'POST');
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Método no permitido.' });
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (email !== TEST_EMAIL) return res.status(403).json({ ok: false, error: 'Etapa de pruebas: correo no autorizado.' });
  const c = config();
  if (!c) return res.status(503).json({ ok: false, error: 'Configuración de prueba incompleta.' });
  try {
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const query = new URL(`${c.url}/rest/v1/email_verifications`);
    query.searchParams.set('select', 'id,created_at');
    query.searchParams.set('email', `eq.${email}`);
    query.searchParams.set('purpose', `eq.${PURPOSE}`);
    query.searchParams.set('created_at', `gte.${since}`);
    query.searchParams.set('order', 'created_at.desc');
    query.searchParams.set('limit', String(MAX_PER_HOUR));
    const history = await fetch(query, { headers: dbHeaders(c.key), signal: AbortSignal.timeout(10000) });
    if (!history.ok) throw new Error(`history ${history.status}`);
    const previous = await history.json();
    if (previous.length >= MAX_PER_HOUR) return res.status(429).json({ ok: false, error: 'Límite de pruebas alcanzado. Intentá dentro de una hora.' });

    const code = String(randomInt(0, 1000000)).padStart(6, '0');
    const expires = new Date(Date.now() + EXPIRY_MINUTES * 60000).toISOString();
    const insert = await fetch(`${c.url}/rest/v1/email_verifications`, {
      method: 'POST', headers: dbHeaders(c.key, { Prefer: 'return=representation' }),
      body: JSON.stringify({ email, purpose: PURPOSE, code_hash: digest(email, code, c.secret), attempts: 0, expires_at: expires }),
      signal: AbortSignal.timeout(10000)
    });
    if (!insert.ok) throw new Error(`insert ${insert.status}`);
    const records = await insert.json();
    const id = records?.[0]?.id;
    if (!id) throw new Error('Missing inserted id');

    const sent = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${c.resend}`, ...JSON_HEADERS },
      body: JSON.stringify({
        from: 'AREA 51 <onboarding@resend.dev>', to: [TEST_EMAIL],
        subject: 'AREA 51 - Código de verificación',
        text: `Tu código de verificación de AREA 51 es: ${code}\n\nVence en ${EXPIRY_MINUTES} minutos. Si no lo solicitaste, ignorá este correo.`
      }),
      signal: AbortSignal.timeout(12000)
    });
    if (!sent.ok) {
      // No dejar un código utilizable cuando el proveedor rechaza el envío.
      await fetch(`${c.url}/rest/v1/email_verifications?id=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH', headers: dbHeaders(c.key),
        body: JSON.stringify({ consumed_at: new Date().toISOString() }),
        signal: AbortSignal.timeout(5000)
      }).catch(() => {});
      throw new Error(`resend ${sent.status}`);
    }
    return res.status(200).json({ ok: true, message: 'Código enviado al correo de prueba.' });
  } catch (e) {
    console.error('AREA51 request-code:', e.message);
    return res.status(502).json({ ok: false, error: 'No se pudo enviar el código.' });
  }
}
