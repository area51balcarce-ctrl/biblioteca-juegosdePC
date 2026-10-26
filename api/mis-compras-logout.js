// AREA 51 — Cierra la sesión en este navegador. No autoriza descargas.
import { clearSessionCookie, sameOrigin } from './_lib/a51-session.js';
export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, private');
  res.setHeader('Allow', 'POST');
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Método no permitido.' });
  if (!sameOrigin(req)) return res.status(403).json({ ok: false, error: 'Origen no autorizado.' });
  res.setHeader('Set-Cookie', clearSessionCookie());
  return res.status(200).json({ ok: true });
}
