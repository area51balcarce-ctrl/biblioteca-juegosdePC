// AREA 51 — Consulta segura de sesión. No devuelve compras ni descargas.
import { readSession } from './_lib/a51-session.js';
export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, private');
  res.setHeader('Allow', 'GET');
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Método no permitido.' });
  const session = readSession(req);
  if (!session) return res.status(401).json({ ok: false, authenticated: false });
  return res.status(200).json({ ok: true, authenticated: true, email: session.email, expiresAt: session.expiresAt, testMode: true });
}
