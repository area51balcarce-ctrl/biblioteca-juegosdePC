// AREA 51 — Biblioteca privada PC (solo lectura).
// No habilita pagos, descargas ni enlaces privados.
import { readCustomerSession } from './a51-customer-session-store.js';
import { authorizedLibraryRows } from './customer-library-authorization.js';

const TEST_EMAIL = 'area51.balcarce@gmail.com';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function query(base, key, table, params) {
  const url = new URL(base + '/rest/v1/' + table);
  for (const [name, value] of Object.entries(params)) {
    url.searchParams.set(name, value);
  }
  const response = await fetch(url, {
    headers: {
      apikey: key,
      Authorization: 'Bearer ' + key,
      Accept: 'application/json'
    },
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error('Consulta de biblioteca fallida: ' + table);
  const data = await response.json();
  if (!Array.isArray(data)) throw new Error('Respuesta inesperada de biblioteca');
  return data;
}

export async function getCustomerLibrary(req) {
  if (process.env.AREA51_CUSTOMER_AUTH_ENABLED !== 'true') return null;

  // La identidad proviene exclusivamente de la cookie de sesión validada.
  const session = await readCustomerSession(req);
  if (!session || (process.env.AREA51_PUBLIC_CUSTOMER_REGISTRATION !== 'true' && session.email !== TEST_EMAIL)) return null;

  const base = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !/^https:\/\//.test(base) || !key) {
    throw new Error('Biblioteca no configurada');
  }

  const entitlements = await query(base, key, 'customer_entitlements', {
    select: 'customer_email,product_id,order_id,granted_at,revoked_at',
    customer_email: 'eq.' + session.email,
    revoked_at: 'is.null',
    limit: '201'
  });
  if (entitlements.length > 200) throw new Error('La biblioteca requiere paginación');

  const orderIds = [...new Set(entitlements
    .map(row => row.order_id)
    .filter(id => UUID.test(id || '')))];
  if (!orderIds.length) return { email: session.email, products: [] };

  const orders = await query(base, key, 'orders', {
    select: 'id,customer_email,status,payment_provider,payment_reference',
    id: 'in.(' + orderIds.join(',') + ')',
    customer_email: 'eq.' + session.email,
    status: 'eq.paid',
    limit: '201'
  });
  if (orders.length > 200) throw new Error('Los pedidos requieren paginación');

  const items = await query(base, key, 'order_items', {
    select: 'order_id,product_id,product_name,quantity',
    order_id: 'in.(' + orderIds.join(',') + ')',
    limit: '1001'
  });
  if (items.length > 1000) throw new Error('Los productos requieren paginación');

  const authorized = authorizedLibraryRows(session.email, entitlements, orders, items);
  // Solo metadatos publicos de portadas. Nunca URLs privadas ni descargas.
  const productIds = authorized.map(p => p.product_id).filter(id => UUID.test(id || ''));
  if (!productIds.length) return { email: session.email, products: [] };
  const catalog = await query(base, key, 'products', {
    select: 'id,cover_path',
    id: 'in.(' + productIds.join(',') + ')',
    limit: '201'
  });
  if (catalog.length > 200) throw new Error('Catalogo requiere paginacion');
  const covers = new Map(catalog.map(p => [p.id, p.cover_path]));
  return {
    email: session.email,
    products: authorized.map(p => ({
      ...p,
      cover_path: typeof covers.get(p.product_id) === 'string' ? covers.get(p.product_id) : null
    }))
  };
}
