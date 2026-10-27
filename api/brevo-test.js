// AREA 51 - api/brevo-test.js
// Prueba temporal independiente. Borrar despues de verificar el envio.
import { timingSafeEqual } from 'node:crypto';

const DESTINO = 'alexriccillo@gmail.com';
const REMITENTE = 'area51.balcarce@gmail.com';

function validSecret(received, expected) {
  if (typeof received !== 'string' || typeof expected !== 'string' || expected.length < 32) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Allow', 'POST');
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Metodo no permitido.' });
  if (!validSecret(req.headers['x-area51-test-secret'], process.env.AREA51_BREVO_TEST_SECRET)) {
    return res.status(403).json({ ok: false, error: 'Prueba no autorizada.' });
  }
  if (!process.env.BREVO_API_KEY) return res.status(503).json({ ok: false, error: 'Falta BREVO_API_KEY.' });

  try {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': process.env.BREVO_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        sender: { name: 'AREA 51 - Biblioteca PC', email: REMITENTE },
        to: [{ email: DESTINO }],
        subject: 'AREA 51 - Prueba de correo',
        textContent: 'Hola, marciano. Esta es una prueba de AREA 51 - Biblioteca PC. No es un codigo de acceso.'
      }),
      signal: AbortSignal.timeout(12000)
    });
    if (!response.ok) {
      console.error('AREA51 Brevo HTTP:', response.status);
      return res.status(502).json({ ok: false, error: 'Brevo rechazo el envio.', providerStatus: response.status });
    }
    return res.status(200).json({ ok: true, message: 'Brevo acepto el envio. Revisa entrada y spam.' });
  } catch (error) {
    console.error('AREA51 Brevo:', error?.message);
    return res.status(502).json({ ok: false, error: 'No se pudo contactar a Brevo.' });
  }
}
