// AREA 51 — Endpoint aislado de biblioteca privada PC.
// Solo lectura. No habilita pagos ni enlaces de descarga.
import { getCustomerLibrary } from './customer-library-read.js';

export default async function customerLibraryHandler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Allow', 'GET');

  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Método no permitido.' });
  }

  try {
    const library = await getCustomerLibrary(req);
    if (!library) {
      return res.status(401).json({ ok: false, error: 'Sesión de cliente no válida.' });
    }
    return res.status(200).json({
      ok: true,
      email: library.email,
      products: library.products,
      downloadsEnabled: false,
      testMode: true
    });
  } catch (error) {
    console.error('AREA51 biblioteca privada:', error.message);
    return res.status(502).json({
      ok: false,
      error: 'No se pudo consultar la biblioteca privada.'
    });
  }
}
