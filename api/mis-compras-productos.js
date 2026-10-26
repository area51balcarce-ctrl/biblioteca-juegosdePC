// AREA 51 — Solo lectura de productos adquiridos.
// Etapa de prueba: no devuelve enlaces ni habilita descargas.
import { readSession } from './_lib/a51-session.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function headers(key) { return { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' }; }
async function rows(base, table, params, key) {
  const u = new URL(`${base}/rest/v1/${table}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const r = await fetch(u, { headers: headers(key), signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`Consulta ${table}: ${r.status}`);
  const result = await r.json();
  if (!Array.isArray(result)) throw new Error('Respuesta inesperada de Supabase');
  return result;
}
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Allow', 'GET');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Método no permitido.' });
  const session = readSession(req);
  if (!session) return res.status(401).json({ ok: false, error: 'Sesión no válida o vencida.' });
  const base = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) return res.status(503).json({ ok: false, error: 'Servicio no configurado.' });
  try {
    // La identidad proviene EXCLUSIVAMENTE de la cookie verificada, nunca del cliente.
    const entitlements = await rows(base, 'customer_entitlements', {
      select: 'product_id,order_id,granted_at',
      customer_email: `eq.${session.email}`,
      revoked_at: 'is.null',
      order: 'granted_at.desc',
      limit: '201'
    }, key);
    if (entitlements.length > 200) throw new Error('Límite de consulta alcanzado; se requiere paginación');
    const orderIds = [...new Set(entitlements.map(x => x.order_id).filter(x => UUID.test(x || '')))];
    if (!orderIds.length) return res.status(200).json({ ok: true, products: [], testMode: true });
    // Defensa adicional: solamente derechos vinculados a pedidos PAGADOS.
    const orders = await rows(base, 'orders', {
      select: 'id', id: `in.(${orderIds.join(',')})`, status: 'eq.paid',
      customer_email: `eq.${session.email}`, limit: '200'
    }, key);
    const paid = new Set(orders.map(x => x.id));
    const authorized = entitlements.filter(x => paid.has(x.order_id) && UUID.test(x.product_id || ''));
    const ids = [...new Set(authorized.map(x => x.product_id))];
    if (!ids.length) return res.status(200).json({ ok: true, products: [], testMode: true });
    const products = await rows(base, 'products', {
      select: 'id,name,slug,cover_path', id: `in.(${ids.join(',')})`, limit: '200'
    }, key);
    const byId = new Map(products.map(p => [p.id, p]));
    const unique = new Set();
    const safe = [];
    for (const item of authorized) {
      if (unique.has(item.product_id)) continue;
      const p = byId.get(item.product_id);
      if (!p) continue;
      unique.add(item.product_id);
      safe.push({ id: p.id, name: p.name, slug: p.slug, cover_path: p.cover_path, purchasedAt: item.granted_at });
    }
    return res.status(200).json({ ok: true, products: safe, testMode: true });
  } catch (error) {
    console.error('AREA51 mis-compras-productos:', error.message);
    return res.status(502).json({ ok: false, error: 'No se pudo consultar tu biblioteca. Intentá nuevamente.' });
  }
}
