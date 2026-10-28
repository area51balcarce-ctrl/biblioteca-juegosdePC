// AREA 51 — Biblioteca PC — ETAPA 2: verificación de pago SOLO LECTURA.
// Subir como api/verificar-pago.js en GitHub.
// No modifica pedidos, no otorga derechos y no habilita descargas.
import { readSession, sameOrigin, TEST_EMAIL } from './_lib/a51-session.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PAYMENT_ID = /^[0-9]{1,24}$/;

async function getJSON(url, headers, timeout = 12000) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(timeout) });
  if (!response.ok) throw new Error('Consulta remota HTTP ' + response.status);
  return response.json();
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Allow', 'POST');
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Método no permitido.' });
  if (!sameOrigin(req)) return res.status(403).json({ ok: false, error: 'Origen no autorizado.' });

  const session = readSession(req);
  if (!session || session.email !== TEST_EMAIL) {
    return res.status(401).json({ ok: false, error: 'Iniciá sesión en Mis Compras para probar la verificación.' });
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
