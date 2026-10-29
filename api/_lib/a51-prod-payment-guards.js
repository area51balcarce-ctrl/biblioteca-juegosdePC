// AREA 51 — Biblioteca PC — Validaciones aisladas para pagos de PRODUCCIÓN.
// NO está conectado a rutas públicas. NO habilita cobros ni concede descargas.
// La acreditación definitiva debe usar RPC atómica e idempotente tras estas comprobaciones.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PAYMENT_ID = /^[0-9]{1,24}$/;
const TEST_SELLER_ID = '3544226015';

export function validateProductionPayment({ payment, seller, order, items, paymentId }) {
  if (!payment || !seller || !order || !Array.isArray(items))
    return { ok: false, reason: 'missing_data' };
  const sellerId = String(seller.id ?? '');
  if (!PAYMENT_ID.test(sellerId) || sellerId === TEST_SELLER_ID ||
      (Array.isArray(seller.tags) && seller.tags.some(tag => /test/i.test(String(tag)))))
    return { ok: false, reason: 'seller_not_production' };
  const id = String(payment.id ?? '');
  if (!PAYMENT_ID.test(id) || (paymentId !== undefined && id !== String(paymentId)))
    return { ok: false, reason: 'payment_id_mismatch' };
  if (String(payment.collector_id ?? '') !== sellerId)
    return { ok: false, reason: 'wrong_collector' };
  if (payment.status !== 'approved' || payment.status_detail !== 'accredited')
    return { ok: false, reason: 'payment_not_accredited' };
  if (!UUID.test(String(order.id ?? '')) ||
      payment.external_reference !== order.id ||
      payment.metadata?.area51_production !== true ||
      String(payment.metadata?.order_id ?? '') !== order.id)
    return { ok: false, reason: 'order_reference_mismatch' };
  if (order.payment_provider !== 'mercadopago' || order.currency !== 'ARS' ||
      payment.currency_id !== 'ARS')
    return { ok: false, reason: 'provider_or_currency_mismatch' };
  if (order.status !== 'pending' &&
      !(order.status === 'paid' && String(order.payment_reference) === id))
    return { ok: false, reason: 'order_status_mismatch' };
  if (order.payment_reference && String(order.payment_reference) !== id)
    return { ok: false, reason: 'payment_already_bound' };
  if (typeof order.customer_email !== 'string' ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(order.customer_email))
    return { ok: false, reason: 'customer_missing' };
  const amount = Number(payment.transaction_amount);
  if (!Number.isSafeInteger(order.total_ars) || order.total_ars <= 0 ||
      !Number.isFinite(amount) || amount !== order.total_ars)
    return { ok: false, reason: 'amount_mismatch' };
  if (items.length === 0 || items.some(item =>
      !UUID.test(String(item.product_id ?? '')) ||
      !Number.isSafeInteger(item.unit_price_ars) || item.unit_price_ars <= 0 ||
      !Number.isSafeInteger(item.quantity) || item.quantity <= 0))
    return { ok: false, reason: 'invalid_items' };
  const total = items.reduce((sum, item) => sum + item.unit_price_ars * item.quantity, 0);
  if (!Number.isSafeInteger(total) || total !== order.total_ars)
    return { ok: false, reason: 'items_total_mismatch' };
  return { ok: true, paymentId: id, sellerId, orderId: order.id };
}
