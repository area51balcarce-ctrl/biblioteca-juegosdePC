// AREA 51 PC — Validacion estricta para futuras acreditaciones REALES.
// Modulo aislado: NO activa pagos, NO cambia webhook TEST, NO concede accesos.
// El sellerId debe obtenerse de Mercado Pago /users/me con token PROD.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateProductionPayment({ payment, seller, order, items, usedByOtherOrder = false }) {
  if (!payment || !seller || !order || !Array.isArray(items)) return false;
  const orderId = String(order.id || '');
  const sellerId = String(seller.id ?? '');
  const paymentId = String(payment.id ?? '');
  if (!UUID.test(orderId) || !/^\d{1,24}$/.test(paymentId) || !/^\d+$/.test(sellerId)) return false;
  if (sellerId !== String(payment.collector_id ?? '') || usedByOtherOrder) return false;
  // Prohibido acreditar operaciones del vendedor TESTUSER.
  if (Array.isArray(seller.tags) && seller.tags.some(tag => /test/i.test(String(tag)))) return false;
  if (payment.status !== 'approved' || payment.status_detail !== 'accredited') return false;
  if (payment.external_reference !== orderId || payment.metadata?.area51_live !== true ||
      String(payment.metadata?.order_id ?? '') !== orderId) return false;
  if (order.payment_provider !== 'mercadopago' || order.currency !== 'ARS' ||
      payment.currency_id !== 'ARS' || order.status !== 'pending') return false;
  if (order.payment_reference && String(order.payment_reference) !== paymentId) return false;
  if (typeof order.customer_email !== 'string' ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(order.customer_email)) return false;
  if (!Number.isSafeInteger(order.total_ars) || order.total_ars <= 0 ||
      !Number.isSafeInteger(payment.transaction_amount) ||
      payment.transaction_amount !== order.total_ars) return false;
  if (items.length < 1 || items.length > 100) return false;
  let total = 0;
  for (const item of items) {
    if (item.order_id !== orderId || !UUID.test(String(item.product_id || '')) ||
        !Number.isSafeInteger(item.unit_price_ars) || item.unit_price_ars <= 0 ||
        !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 100) return false;
    total += item.unit_price_ars * item.quantity;
    if (!Number.isSafeInteger(total)) return false;
  }
  return total === order.total_ars;
}
