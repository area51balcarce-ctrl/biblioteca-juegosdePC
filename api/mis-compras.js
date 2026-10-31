// AREA 51 — API unificada MIS COMPRAS para Vercel Hobby.
// Sesión, cierre y lectura de productos adquiridos. Sin pagos ni descargas.
import customerLibraryHandler from '../lib/pc/customer-library-handler.js';
import { readSession, clearSessionCookie, sameOrigin } from './_lib/a51-session.js';
import customerAuthHandler from '../lib/pc/customer-auth-handler.js';
import { readCustomerSession } from '../lib/pc/a51-customer-session-store.js';
import testCheckoutHandler from './crear-preferencia.js';

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

  // AREA 51 — Biblioteca privada con nueva sesión.
  // Checkout de prueba con identidad obtenida SOLO de la sesion OTP.
  // Reutiliza el handler existente; no modifica su ruta ni habilita cobros reales.
  if (action === 'customer-test-checkout') {
    res.setHeader('Allow', 'POST');
    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Metodo no permitido.' });
    if (!sameOrigin(req)) return res.status(403).json({ ok: false, error: 'Origen no autorizado.' });
    if (process.env.AREA51_CUSTOMER_AUTH_ENABLED !== 'true')
      return res.status(403).json({ ok: false, error: 'Prueba no habilitada.' });
    try {
      const session = await readCustomerSession(req);
      if (session?.email !== 'area51.balcarce@gmail.com')
        return res.status(401).json({ ok: false, error: 'Sesion de prueba requerida.' });
      req.body = { product_id: req.body?.product_id, email: session.email };
      return testCheckoutHandler(req, res);
    } catch (error) {
      console.error('AREA51 customer-test-checkout:', error.message);
      return res.status(502).json({ ok: false, error: 'No se pudo verificar la sesion.' });
    }
  }
  if (action === 'customer-library') {
    return customerLibraryHandler(req, res);
  }


  // AREA51: production customer access, gated and isolated from test actions.
  // Vercel Hobby reuses this existing function; no extra function deployed.
  if (['customer-session','customer-request','customer-verify','customer-logout'].includes(action)) {
    req.query.action = action.slice('customer-'.length);
    return customerAuthHandler(req,res);
  }

  // AREA 51 — Webhook Mercado Pago: confirmación automática sin sesión.
  // La notificación es solo una pista: la fuente de verdad es la API de MP.
  // Restricción temporal: vendedor de prueba verificado, no ventas reales.
  if (action === 'mp-webhook') {
    res.setHeader('Allow', 'POST');
    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Método no permitido.' });
    const kind = String(req.body?.type || req.body?.topic || req.query?.type || req.query?.topic || '');
    const paymentId = String(req.body?.data?.id || req.query?.['data.id'] || req.body?.id || '');
    if (kind !== 'payment' || !/^[0-9]{1,24}$/.test(paymentId))
      return res.status(200).json({ ok: true, ignored: true });
    const base = process.env.SUPABASE_URL?.replace(/\/$/, '');
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const token = process.env.MERCADOPAGO_ACCESS_TOKEN_TEST?.trim();
    if (!base || !key || !token) return res.status(503).json({ ok: false });
    try {
      const auth = { Authorization: 'Bearer ' + token, Accept: 'application/json' };
      const [pr, sr] = await Promise.all([
        fetch('https://api.mercadopago.com/v1/payments/' + paymentId,
          { headers: auth, signal: AbortSignal.timeout(12000) }),
        fetch('https://api.mercadopago.com/users/me',
          { headers: auth, signal: AbortSignal.timeout(12000) })
      ]);
      if (!pr.ok || !sr.ok) throw new Error('No se pudo validar MP');
      const [payment, seller] = await Promise.all([pr.json(), sr.json()]);
      const orderId = String(payment?.external_reference || '');
      const metadata = payment?.metadata || {};
      if (!UUID.test(orderId) || String(payment?.id ?? '') !== paymentId ||
          String(seller?.id ?? '') !== '3544226015' ||
          String(payment?.collector_id ?? '') !== '3544226015' ||
          !Array.isArray(seller?.tags) ||
          !seller.tags.some(t => typeof t === 'string' && /test/i.test(t)) ||
          metadata.area51_test !== true || String(metadata.order_id ?? '') !== orderId ||
          payment?.status !== 'approved' || payment?.status_detail !== 'accredited') {
        return res.status(200).json({ ok: true, ignored: true });
      }
      const orders = await rows(base, 'orders', {
        select: 'id,status,total_ars,currency,customer_email,payment_provider,payment_reference',
        id: 'eq.' + orderId, customer_email: 'eq.area51.balcarce@gmail.com', limit: '1'
      }, key);
      const order = orders[0];
      if (!order || order.payment_provider !== 'mercadopago' || order.currency !== 'ARS' ||
          payment.currency_id !== 'ARS' ||
          !Number.isSafeInteger(payment.transaction_amount) ||
          payment.transaction_amount !== order.total_ars ||
          (order.payment_reference && order.payment_reference !== paymentId)) {
        return res.status(200).json({ ok: true, ignored: true });
      }
      const used = await rows(base, 'orders', {
        select: 'id', payment_reference: 'eq.' + paymentId,
        id: 'neq.' + order.id, limit: '1'
      }, key);
      if (used.length) return res.status(200).json({ ok: true, ignored: true });
      const rpc = await fetch(base + '/rest/v1/rpc/a51_confirm_paid_order', {
        method: 'POST', headers: { ...headers(key), 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_order_id: order.id, p_payment_reference: paymentId }),
        signal: AbortSignal.timeout(12000)
      });
      if (!rpc.ok) throw new Error('RPC de acreditación HTTP ' + rpc.status);
      return res.status(200).json({ ok: true });
    } catch (error) {
      console.error('AREA51 mp-webhook:', error.message);
      return res.status(502).json({ ok: false, error: 'Reintentar notificación.' });
    }
  }

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
    // AREA 51 ETAPA 5: identidad del vendedor, solo lectura.
    let sellerIdentity = { checked: false, matches_payment: false, error: null };
    try {
      const seller = await getJSON('https://api.mercadopago.com/users/me',
        { Authorization: 'Bearer ' + mpToken, Accept: 'application/json' }, 15000);
      const sellerId = String(seller?.id ?? '');
      const collectorId = String(payment?.collector_id ?? '');
      sellerIdentity = {
        checked: Boolean(sellerId && collectorId),
        matches_payment: Boolean(sellerId && collectorId && sellerId === collectorId),
        matches_registered_test_seller: sellerId === '3544226015',
        payment_matches_registered_test_seller: collectorId === '3544226015',
        account_test_tag_present: Array.isArray(seller?.tags) && seller.tags.some(tag => typeof tag === 'string' && /test/i.test(tag)),
        error: null
      };
    } catch (_) {
      sellerIdentity = { checked: false, matches_payment: false, error: 'Consulta de vendedor no disponible.' };
    }
    // ETAPA 3: comparación detallada sin exponer datos personales del comprador.
    // En sandbox, el correo del comprador de prueba puede ser distinto al del
    // propietario del pedido. No se omiten controles de referencia, monto ni moneda.
    const checks = {
      approved: payment?.status === 'approved',
      payment_id: String(payment?.id ?? '') === paymentId,
      order_reference: payment?.external_reference === order.id,
      currency: order.currency === 'ARS' && payment?.currency_id === order.currency,
      amount: Number.isSafeInteger(payment?.transaction_amount) &&
        payment.transaction_amount === order.total_ars,
      order_payment_reference: !order.payment_reference || order.payment_reference === paymentId,
      sandbox: payment?.live_mode === false,
      payer_email_matches_session:
        String(payment?.payer?.email || '').trim().toLowerCase() === session.email
    };
    // Esta API utiliza EXCLUSIVAMENTE el token de prueba y la sesión de prueba.
    // La coincidencia del email se informa, pero no bloquea pagos sandbox.
    // Un pago real (live_mode=true) jamás puede verificarse por esta ruta.
    const verified = checks.approved && checks.payment_id &&
      checks.order_reference && checks.currency && checks.amount &&
      checks.order_payment_reference && checks.sandbox;

    // ETAPA 6 — Separar integridad del pago de la clasificación del entorno.
    // SOLO diagnóstico: NO cambia la condición verified ni concede productos.
    const paymentIntegrity = checks.approved && checks.payment_id &&
      checks.order_reference && checks.currency && checks.amount &&
      checks.order_payment_reference && sellerIdentity.matches_payment &&
      sellerIdentity.matches_registered_test_seller &&
      sellerIdentity.payment_matches_registered_test_seller;
    const environmentClassification = payment?.live_mode === false
      ? 'reported_test'
      : payment?.live_mode === true
        ? 'reported_live_requires_review'
        : 'unknown_requires_review';

    // ETAPA 7: evidencia del Checkout Pro de prueba, solo lectura.
    // metadata.area51_test se define al crear la preferencia; es una señal
    // informativa, NO una prueba suficiente para acreditar ni dar descargas.
    const paymentMetadata = payment?.metadata && typeof payment.metadata === 'object'
      ? payment.metadata : {};
    const checkoutTestEvidence = {
      marker_present: paymentMetadata.area51_test === true,
      marker_order_matches: String(paymentMetadata.order_id ?? '') === order.id,
      payment_reports_live: payment?.live_mode === true,
      integrity_passed: paymentIntegrity,
      requires_manual_environment_review: payment?.live_mode !== false
    };

    // ETAPA 9: preflight de entrega, estrictamente SOLO LECTURA.
    // Inspecciona los items y accesos actuales; no acredita ni entrega.
    let fulfillmentReadiness = { checked: false, item_count: 0,
      existing_entitlements: 0, eligible_for_write: false, error: null };
    try {
      const items = await rows(base, 'order_items', {
        select: 'product_id,quantity,unit_price_ars', order_id: 'eq.' + order.id
      }, key);
      const entitlements = await rows(base, 'customer_entitlements', {
        select: 'product_id', order_id: 'eq.' + order.id
      }, key);
      // ETAPA 11: detectar accesos del mismo cliente y producto, incluso
      // si fueron concedidos por otro pedido. Solo lectura.
      const itemIds = [...new Set(items.map(i => i.product_id).filter(id => UUID.test(id || '')))];
      const previousAccess = itemIds.length
        ? await rows(base, 'customer_entitlements', {
            select: 'product_id,revoked_at',
            customer_email: 'eq.' + session.email,
            product_id: 'in.(' + itemIds.join(',') + ')'
          }, key)
        : [];
      const total = items.reduce((sum, item) => sum + Number(item.quantity) * Number(item.unit_price_ars), 0);
      fulfillmentReadiness = {
        checked: true,
        item_count: items.length,
        existing_entitlements: entitlements.length,
        existing_active_for_products: previousAccess.filter(a => a.revoked_at === null).length,
        existing_revoked_for_products: previousAccess.filter(a => a.revoked_at !== null).length,
        items_total_matches: Number.isSafeInteger(total) && total === order.total_ars,
        eligible_for_write: false,
        error: null
      };
    } catch (_) {
      fulfillmentReadiness.error = 'No se pudo completar la inspección de entrega.';
    }

    return res.status(200).json({
      ok: true, testMode: true, verified, checks,
      payment_status: typeof payment.status === 'string' ? payment.status : 'unknown',
      seller_identity: sellerIdentity,
      payment_integrity: { passed: paymentIntegrity, seller_checked: sellerIdentity.checked },
      environment_classification: environmentClassification,
      checkout_test_evidence: checkoutTestEvidence,
      fulfillment_readiness: fulfillmentReadiness,
      // Solo diagnóstico de tipo y valor: sin emails, tokens ni datos personales.
      payment_environment: {
        live_mode_type: typeof payment?.live_mode,
        live_mode_value: typeof payment?.live_mode === 'boolean' ? payment.live_mode : null,
         live_mode_present: Object.prototype.hasOwnProperty.call(payment || {}, 'live_mode'),
        payment_method: typeof payment?.payment_method_id === 'string' ? payment.payment_method_id : null,
        payment_type: typeof payment?.payment_type_id === 'string' ? payment.payment_type_id : null,
        status_detail: typeof payment?.status_detail === 'string' ? payment.status_detail : null,
        processing_mode: typeof payment?.processing_mode === 'string' ? payment.processing_mode : null,
        payment_created_at: typeof payment?.date_created === 'string' ? payment.date_created : null
      },

      order_status: order.status, order_id: order.id,
      writesPerformed: false, downloadsEnabled: false,
      message: verified
        ? 'Pago sandbox verificado en modo lectura. El pedido permanece pendiente y sin descargas.'
        : 'Una o más comprobaciones no coinciden. El pedido permanece pendiente.'
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

  // AREA 51 — Confirmación atómica de pago de PRUEBA, exclusivamente del vendedor
  // TESTUSER verificado en Mercado Pago Developers. No usa live_mode como único
  // indicador: Checkout Pro puede registrar pagos de cuentas test en entorno live.
  if (action === 'confirmar-pago') {
    res.setHeader('Allow', 'POST');
    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Método no permitido.' });
    if (!sameOrigin(req)) return res.status(403).json({ ok: false, error: 'Origen no autorizado.' });
    const session = readSession(req);
    if (!session || session.email !== 'area51.balcarce@gmail.com')
      return res.status(401).json({ ok: false, error: 'Sesión de pruebas requerida.' });
    const orderId = typeof req.body?.order_id === 'string' ? req.body.order_id.trim() : '';
    const paymentId = typeof req.body?.payment_id === 'string' ? req.body.payment_id.trim() : '';
    if (!UUID.test(orderId) || !/^[0-9]{1,24}$/.test(paymentId))
      return res.status(400).json({ ok: false, error: 'Identificadores inválidos.' });
    const base = process.env.SUPABASE_URL?.replace(/\/$/, '');
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const token = process.env.MERCADOPAGO_ACCESS_TOKEN_TEST?.trim();
    if (!base || !key || !token) return res.status(503).json({ ok: false, error: 'Servicio no configurado.' });
    try {
      const orders = await rows(base, 'orders', {
        select: 'id,status,total_ars,currency,customer_email,payment_provider,payment_reference',
        id: 'eq.' + orderId, customer_email: 'eq.' + session.email, limit: '1'
      }, key);
      const order = orders[0];
      if (!order || order.payment_provider !== 'mercadopago')
        return res.status(404).json({ ok: false, error: 'Pedido no encontrado.' });
      if (order.status !== 'pending' && !(order.status === 'paid' && order.payment_reference === paymentId))
        return res.status(409).json({ ok: false, error: 'Estado del pedido incompatible.' });
      const mh = { Authorization: 'Bearer ' + token, Accept: 'application/json' };
      const [pr, sr] = await Promise.all([
        fetch('https://api.mercadopago.com/v1/payments/' + paymentId, { headers: mh, signal: AbortSignal.timeout(15000) }),
        fetch('https://api.mercadopago.com/users/me', { headers: mh, signal: AbortSignal.timeout(15000) })
      ]);
      if (!pr.ok || !sr.ok) throw new Error('Verificación de Mercado Pago fallida');
      const [payment, seller] = await Promise.all([pr.json(), sr.json()]);
      const metadata = payment?.metadata || {};
      const verified = String(seller?.id ?? '') === '3544226015' &&
        String(payment?.collector_id ?? '') === '3544226015' &&
        Array.isArray(seller?.tags) && seller.tags.some(t => typeof t === 'string' && /test/i.test(t)) &&
        payment?.status === 'approved' && payment?.status_detail === 'accredited' &&
        String(payment?.id ?? '') === paymentId &&
        payment?.external_reference === order.id &&
        metadata.area51_test === true && String(metadata.order_id ?? '') === order.id &&
        payment?.currency_id === 'ARS' && order.currency === 'ARS' &&
        Number.isSafeInteger(payment?.transaction_amount) &&
        payment.transaction_amount === order.total_ars &&
        (!order.payment_reference || order.payment_reference === paymentId);
      if (!verified) return res.status(403).json({
        ok: false, verified: false, error: 'Pago de prueba no validado; no se acreditó el pedido.'
      });
      const alreadyUsed = await rows(base, 'orders', {
        select: 'id', payment_reference: 'eq.' + paymentId, id: 'neq.' + order.id, limit: '1'
      }, key);
      if (alreadyUsed.length) return res.status(409).json({ ok: false, error: 'Pago vinculado a otro pedido.' });
      const rpc = await fetch(base + '/rest/v1/rpc/a51_confirm_paid_order', {
        method: 'POST', headers: { ...headers(key), 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_order_id: order.id, p_payment_reference: paymentId }),
        signal: AbortSignal.timeout(12000)
      });
      if (!rpc.ok) throw new Error('Acreditación transaccional HTTP ' + rpc.status);
      const result = await rpc.json();
      return res.status(200).json({
        ok: result?.ok === true, verified: true, order_id: order.id,
        already_paid: result?.already_paid === true, downloadsEnabled: result?.ok === true
      });
    } catch (error) {
      console.error('AREA51 confirmar-pago:', error.message);
      return res.status(502).json({ ok: false, error: 'No se pudo acreditar el pago de prueba.' });
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

  // AREA 51 — entrega segura de enlaces configurados en el ADMIN.
  // El servidor consulta Mercado Pago en CADA solicitud; no confía solo en Supabase.
  if (action === 'enlaces-comprados' || action === 'customer-test-links') {
    res.setHeader('Allow', 'GET');
    if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Método no permitido.' });
    // Nueva sesion OTP solo en ruta aislada; la ruta anterior queda intacta.
    // Se mantiene restringido al correo autorizado y vendedor TEST de Mercado Pago.
    const session = action === 'customer-test-links'
      ? (process.env.AREA51_CUSTOMER_AUTH_ENABLED === 'true' ? await readCustomerSession(req) : null)
      : readSession(req);
    if (action === 'customer-test-links' && session?.email !== 'area51.balcarce@gmail.com')
      return res.status(401).json({ ok: false, error: 'Acceso de prueba no autorizado.' });
    if (!session) return res.status(401).json({ ok: false, error: 'Sesión no válida.' });
    const productId = typeof req.query?.product_id === 'string' ? req.query.product_id : '';
    if (!UUID.test(productId)) return res.status(400).json({ ok: false, error: 'Producto inválido.' });
    const base = process.env.SUPABASE_URL?.replace(/\/$/, '');
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const mpToken = process.env.MERCADOPAGO_ACCESS_TOKEN_TEST?.trim();
    if (!base || !key || !mpToken) return res.status(503).json({ ok: false, error: 'Servicio no configurado.' });
    try {
      const entitlements = await rows(base, 'customer_entitlements', {
        select: 'order_id', customer_email: 'eq.' + session.email,
        product_id: 'eq.' + productId, revoked_at: 'is.null', limit: '2'
      }, key);
      if (entitlements.length !== 1 || !UUID.test(entitlements[0].order_id || '')) {
        return res.status(403).json({ ok: false, error: 'No tenés acceso a este producto.' });
      }
      const orders = await rows(base, 'orders', {
        select: 'id,payment_reference,payment_provider,total_ars,currency',
        id: 'eq.' + entitlements[0].order_id, customer_email: 'eq.' + session.email,
        status: 'eq.paid', limit: '1'
      }, key);
      const order = orders[0];
      if (!order || order.payment_provider !== 'mercadopago' ||
          !/^[0-9]{1,24}$/.test(order.payment_reference || '')) {
        return res.status(403).json({ ok: false, error: 'Compra no acreditada.' });
      }
      // El producto solicitado también debe figurar en los ítems de ESE pedido.
      // Un acceso aislado nunca debe permitir descargar otro juego.
      const purchasedItems = await rows(base, 'order_items', {
        select: 'product_id', order_id: 'eq.' + order.id,
        product_id: 'eq.' + productId, limit: '1'
      }, key);
      if (purchasedItems.length !== 1) {
        return res.status(403).json({ ok: false, error: 'Producto no incluido en el pedido acreditado.' });
      }
      const response = await fetch('https://api.mercadopago.com/v1/payments/' + order.payment_reference, {
        headers: { Authorization: 'Bearer ' + mpToken, Accept: 'application/json' },
        signal: AbortSignal.timeout(15000)
      });
      if (!response.ok) throw new Error('Mercado Pago HTTP ' + response.status);
      const payment = await response.json();
      const sellerResponse = await fetch('https://api.mercadopago.com/users/me', {
        headers: { Authorization: 'Bearer ' + mpToken, Accept: 'application/json' },
        signal: AbortSignal.timeout(15000)
      });
      if (!sellerResponse.ok) throw new Error('Identidad de vendedor HTTP ' + sellerResponse.status);
      const seller = await sellerResponse.json();
      const sellerMatches = String(seller?.id ?? '') === '3544226015' &&
        String(payment?.collector_id ?? '') === '3544226015' &&
        Array.isArray(seller?.tags) && seller.tags.some(t => typeof t === 'string' && /test/i.test(t));
      // Checkout Pro puede reportar live_mode=true con vendedor TESTUSER.
      // Validar siempre identidad test y metadata de la preferencia original.
      const meta = payment?.metadata || {};
      const valid = sellerMatches && payment?.status === 'approved' &&
        payment?.status_detail === 'accredited' &&
        meta.area51_test === true && String(meta.order_id ?? '') === order.id &&
        String(payment?.id ?? '') === order.payment_reference &&
        payment?.external_reference === order.id && payment?.currency_id === order.currency &&
        order.currency === 'ARS' && Number.isSafeInteger(payment?.transaction_amount) &&
        payment.transaction_amount === order.total_ars;
      if (!valid) return res.status(403).json({
        ok: false, downloadsEnabled: false, error: 'El pago todavía no supera la verificación de entrega.'
      });
      const links = await rows(base, 'product_downloads', {
        select: 'id,type,url,group_name,label,position',
        product_id: 'eq.' + productId, status: 'eq.active', order: 'position.asc', limit: '100'
      }, key);
      // No permitir esquemas javascript:, data:, file: u otros destinos inseguros.
      const safeLinks = links.filter(link => {
        try { const u = new URL(link.url); return u.protocol === 'https:' || u.protocol === 'magnet:'; }
        catch (_) { return false; }
      });
      // Archivo principal opcional en bucket PRIVADO, nunca enlace publico.
      // Solo se firma despues de verificar sesion, derecho, pedido y pago TEST.
      const productFiles = await rows(base, 'products', {
        select: 'id,file_main_path,file_main_name',
        id: 'eq.' + productId, limit: '1'
      }, key);
      const file = productFiles[0];
      let torrent = null;
      if (file && typeof file.file_main_path === 'string' &&
          typeof file.file_main_name === 'string' &&
          file.file_main_name.toLowerCase().endsWith('.torrent') &&
          file.file_main_path.startsWith(productId + '/') &&
          !file.file_main_path.split('/').some(part => part === '..' || !part)) {
        const signed = await fetch(base + '/storage/v1/object/sign/product-files/' +
          file.file_main_path.split('/').map(encodeURIComponent).join('/'), {
          method: 'POST',
          headers: { ...headers(key), 'Content-Type': 'application/json' },
          body: JSON.stringify({ expiresIn: 120 }),
          signal: AbortSignal.timeout(10000)
        });
        if (signed.ok) {
          const data = await signed.json();
          if (typeof data.signedURL === 'string' && data.signedURL.startsWith('/object/sign/')) {
            torrent = { name: file.file_main_name,
              url: base + '/storage/v1' + data.signedURL, expiresIn: 120 };
          }
        }
      }
      return res.status(200).json({ ok: true, downloadsEnabled: true,
        product_id: productId, links: safeLinks, torrent });
    } catch (error) {
      console.error('AREA51 enlaces-comprados:', error.message);
      return res.status(502).json({ ok: false, error: 'No se pudo validar la entrega.' });
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
