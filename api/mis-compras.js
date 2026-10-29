// AREA 51 — API unificada MIS COMPRAS para Vercel Hobby.
// Sesión, cierre y lectura de productos adquiridos. Sin pagos ni descargas.
import { readSession, clearSessionCookie, sameOrigin } from './_lib/a51-session.js';

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
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const action = typeof req.query?.action === 'string' ? req.query.action : '';

  // AREA 51 — ETAPA 2: verificación de pago SOLO LECTURA.
  // Nueva acción dentro de la función existente para respetar Vercel Hobby.
  // No modifica pedidos ni habilita descargas.
  if (action === 'verificar-pago') {
    res.setHeader('Allow', 'POST');
    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Método no permitido.' });
    if (!sameOrigin(req)) return res.status(403).json({ ok: false, error: 'Origen no autorizado.' });
    const session = readSession(req);
    if (!session || session.email !== 'area51.balcarce@gmail.com') {
      return res.status(401).json({ ok: false, error: 'Iniciá sesión en Mis Compras para probar la verificación.' });
    }
    const PAYMENT_ID = /^[0-9]{1,24}$/;
    async function getJSON(url, headers, timeout = 12000) {
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(timeout) });
      if (!response.ok) throw new Error('Consulta remota HTTP ' + response.status);
      return response.json();
    }
  const orderId = typeof req.body?.order_id === 'string' ? req.body.order_id.trim() : '';
  const paymentId = typeof req.body?.payment_id === 'string' ? req.body.payment_id.trim() : '';
  if (!UUID.test(orderId) || !PAYMENT_ID.test(paymentId)) {
    return res.status(400).json({ ok: false, error: 'Identificadores inválidos.' });
  }

  const base = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const mpToken = process.env.MERCADOPAGO_ACCESS_TOKEN_TEST?.trim();
  if (!base || !key || !mpToken) return res.status(503).json({ ok: false, error: 'Configuración incompleta.' });

  try {
    const orderUrl = new URL(base + '/rest/v1/orders');
    orderUrl.searchParams.set('select', 'id,status,total_ars,currency,customer_email,payment_provider,payment_reference');
    orderUrl.searchParams.set('id', 'eq.' + orderId);
    orderUrl.searchParams.set('customer_email', 'eq.' + session.email);
    orderUrl.searchParams.set('limit', '1');
    const orders = await getJSON(orderUrl, { apikey: key, Authorization: 'Bearer ' + key, Accept: 'application/json' });
    const order = Array.isArray(orders) ? orders[0] : null;
    if (!order || order.payment_provider !== 'mercadopago') {
      return res.status(404).json({ ok: false, error: 'Pedido de prueba no encontrado.' });
    }
    if (order.status !== 'pending') {
      return res.status(409).json({ ok: false, error: 'El pedido no está pendiente.' });
    }

    const payment = await getJSON(
      'https://api.mercadopago.com/v1/payments/' + encodeURIComponent(paymentId),
      { Authorization: 'Bearer ' + mpToken, Accept: 'application/json' }, 15000
    );
    const verified = payment?.status === 'approved' &&
      String(payment.id) === paymentId &&
      payment.external_reference === order.id &&
      order.currency === 'ARS' && payment.currency_id === order.currency &&
      Number.isSafeInteger(payment.transaction_amount) &&
      payment.transaction_amount === order.total_ars &&
      String(payment.payer?.email || '').trim().toLowerCase() === session.email &&
      (!order.payment_reference || order.payment_reference === paymentId);

    return res.status(200).json({
      ok: true, testMode: true, verified,
      payment_status: typeof payment.status === 'string' ? payment.status : 'unknown',
      order_status: order.status, order_id: order.id,
      writesPerformed: false, downloadsEnabled: false,
      message: verified
        ? 'Pago verificado en modo lectura. El pedido permanece pendiente y sin descargas.'
        : 'Pago no aprobado o datos inconsistentes. El pedido permanece pendiente.'
    });
  } catch (error) {
    console.error('AREA51 verificar-pago:', error.message);
    return res.status(502).json({
      ok: false, verified: false,
      error: 'No se pudo verificar el pago. El pedido no fue modificado.'
    });
  }
  }

  // AREA 51 — DIAGNÓSTICO: buscar pagos del pedido (SOLO LECTURA).
  // No modifica Supabase, no confirma compras ni habilita descargas.
  if (action === 'diagnosticar-pago') {
    res.setHeader('Allow', 'POST');
    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Método no permitido.' });
    if (!sameOrigin(req)) return res.status(403).json({ ok: false, error: 'Origen no autorizado.' });
    const session = readSession(req);
    if (!session || session.email !== 'area51.balcarce@gmail.com') {
      return res.status(401).json({ ok: false, error: 'Iniciá sesión en Mis Compras.' });
    }
    const orderId = typeof req.body?.order_id === 'string' ? req.body.order_id.trim() : '';
    if (!UUID.test(orderId)) return res.status(400).json({ ok: false, error: 'Pedido inválido.' });

    const base = process.env.SUPABASE_URL?.replace(/\/$/, '');
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const mpToken = process.env.MERCADOPAGO_ACCESS_TOKEN_TEST?.trim();
    if (!base || !key || !mpToken) {
      return res.status(503).json({ ok: false, error: 'Configuración incompleta.' });
    }
    try {
      const orders = await rows(base, 'orders', {
        select: 'id,status,total_ars,currency,payment_provider',
        id: `eq.${orderId}`, customer_email: `eq.${session.email}`, limit: '1'
      }, key);
      const order = orders[0];
      if (!order || order.payment_provider !== 'mercadopago') {
        return res.status(404).json({ ok: false, error: 'Pedido de prueba no encontrado.' });
      }

      // Mercado Pago: buscar exclusivamente pagos asociados a external_reference.
      // Nunca se devuelve el token ni datos personales del comprador.
      const url = new URL('https://api.mercadopago.com/v1/payments/search');
      url.searchParams.set('external_reference', order.id);
      url.searchParams.set('limit', '20');
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${mpToken}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(15000)
      });
      if (!response.ok) {
        console.error('AREA51 diagnosticar-pago: Mercado Pago HTTP', response.status);
        return res.status(502).json({
          ok: false, error: 'Mercado Pago no respondió correctamente a la consulta.',
          provider_http_status: response.status,
          writesPerformed: false, downloadsEnabled: false
        });
      }
      const data = await response.json();
      if (!Array.isArray(data?.results)) throw new Error('Formato inesperado de respuesta de Mercado Pago');

      // Defensa adicional: nunca informar un pago de otro pedido.
      const payments = data.results
        .filter(p => p && p.external_reference === order.id)
        .slice(0, 20)
        .map(p => ({
          payment_id: String(p.id ?? ''),
          status: typeof p.status === 'string' ? p.status : 'unknown',
          status_detail: typeof p.status_detail === 'string' ? p.status_detail : null,
          amount_ars: typeof p.transaction_amount === 'number' ? p.transaction_amount : null,
          currency: typeof p.currency_id === 'string' ? p.currency_id : null,
          created_at: typeof p.date_created === 'string' ? p.date_created : null
        }));

      return res.status(200).json({
        ok: true, testMode: true,
        order_id: order.id, order_status: order.status,
        expected_amount_ars: order.total_ars, expected_currency: order.currency,
        payments_found: payments.length, payments,
        writesPerformed: false, downloadsEnabled: false,
        message: payments.length
          ? 'Se encontraron pagos asociados al pedido. Ningún estado fue modificado.'
          : 'No se encontraron pagos asociados al pedido en esta consulta.'
      });
    } catch (error) {
      console.error('AREA51 diagnosticar-pago:', error.message);
      return res.status(502).json({
        ok: false, error: 'No se pudo completar el diagnóstico.',
        writesPerformed: false, downloadsEnabled: false
      });
    }
  }

  if (action === 'session') {
    res.setHeader('Allow', 'GET');
    if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Método no permitido.' });
    const session = readSession(req);
    if (!session) return res.status(401).json({ ok: false, authenticated: false });
    return res.status(200).json({ ok: true, authenticated: true, email: session.email, expiresAt: session.expiresAt, testMode: true });
  }

  if (action === 'logout') {
    res.setHeader('Allow', 'POST');
    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Método no permitido.' });
    if (!sameOrigin(req)) return res.status(403).json({ ok: false, error: 'Origen no autorizado.' });
    res.setHeader('Set-Cookie', clearSessionCookie());
    return res.status(200).json({ ok: true });
  }

  // AREA 51 — Preparación de autorización de descargas (NO HABILITADA).
  // Acción incorporada a la API existente para respetar el límite de Vercel Hobby.
  // IMPORTANTE: no devolver URLs ni tokens de Storage desde esta acción.
  if (action === 'descargas') {
    res.setHeader('Allow', 'GET');
    if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Método no permitido.' });
    const session = readSession(req);
    if (!session) return res.status(401).json({ ok: false, error: 'Sesión no válida o vencida.' });
    const productId = typeof req.query?.product_id === 'string' ? req.query.product_id : '';
    if (!UUID.test(productId)) return res.status(400).json({ ok: false, error: 'Producto inválido.' });
    const base = process.env.SUPABASE_URL?.replace(/\/$/, '');
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!base || !key) return res.status(503).json({ ok: false, error: 'Servicio no configurado.' });
    try {
      const entitlements = await rows(base, 'customer_entitlements', {
        select: 'order_id', customer_email: `eq.${session.email}`,
        product_id: `eq.${productId}`, revoked_at: 'is.null', limit: '201'
      }, key);
      if (entitlements.length > 200) throw new Error('Demasiados accesos para la consulta');
      const orderIds = [...new Set(entitlements.map(x => x.order_id).filter(x => UUID.test(x || '')))];
      if (orderIds.length) {
        const orders = await rows(base, 'orders', {
          select: 'id,payment_reference,payment_provider',
          id: `in.(${orderIds.join(',')})`,
          customer_email: `eq.${session.email}`, status: 'eq.paid', limit: '200'
        }, key);
        // Este análisis no otorga permisos: status=paid NO prueba un pago real.
        // Las referencias AREA51-TEST-* nunca deben habilitar descargas.
        const candidates = orders.filter(o =>
          typeof o.payment_reference === 'string' &&
          !o.payment_reference.startsWith('AREA51-TEST-') &&
          typeof o.payment_provider === 'string' && o.payment_provider.length > 0
        );
        // Sin verificación independiente con el proveedor de pagos, denegar SIEMPRE.
        void candidates;
      }
      return res.status(403).json({ ok: false, downloadsEnabled: false,
        error: 'Descargas privadas todavía no habilitadas. No se realizó ninguna entrega.' });
    } catch (error) {
      console.error('AREA51 mis-compras-descargas:', error.message);
      return res.status(502).json({ ok: false, error: 'No se pudo verificar la autorización.' });
    }
  }

  if (action !== 'productos') return res.status(404).json({ ok: false, error: 'Acción no encontrada.' });
  res.setHeader('Allow', 'GET');
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
