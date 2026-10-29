// AREA 51 — Biblioteca PC — api/crear-preferencia.js
// ETAPA 1: Checkout Pro EXCLUSIVAMENTE DE PRUEBA.
// Archivo NUEVO. No confirma pagos, no concede accesos y no habilita descargas.
// Requiere: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MERCADOPAGO_ACCESS_TOKEN_TEST.
// La credencial debe provenir de la sección "Credenciales de prueba" de la aplicación de Mercado Pago.
// El prefijo del token NO permite distinguir de forma confiable prueba de producción.

import { randomUUID } from 'node:crypto';

const TEST_EMAIL = 'area51.balcarce@gmail.com';
const SITE_ORIGIN = 'https://biblioteca-juegosde-pc.vercel.app';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function dbHeaders(key, extra = {}) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...extra
  };
}

async function supabase(base, key, table, { method = 'GET', params = {}, body } = {}) {
  const url = new URL(`${base}/rest/v1/${table}`);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, String(value));
  const response = await fetch(url, {
    method,
    headers: dbHeaders(key, method === 'POST' ? { Prefer: 'return=representation' } : {}),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) throw new Error(`Supabase ${table}: HTTP ${response.status}`);
  return response.status === 204 ? [] : response.json();
}

async function cancelPending(base, key, orderId) {
  if (!orderId) return;
  try {
    await supabase(base, key, 'orders', {
      method: 'PATCH',
      params: { id: `eq.${orderId}`, status: 'eq.pending' },
      body: { status: 'cancelled', updated_at: new Date().toISOString() }
    });
  } catch (error) {
    console.error('AREA51: no se pudo cancelar el pedido pendiente', error.message);
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Allow', 'POST');
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Método no permitido.' });

  // Prueba cerrada: no aceptar solicitudes desde otro origen.
  const origin = req.headers.origin;
  if (origin !== SITE_ORIGIN) return res.status(403).json({ ok: false, error: 'Origen no autorizado.' });

  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const productId = typeof req.body?.product_id === 'string' ? req.body.product_id.trim() : '';
  if (email !== TEST_EMAIL) return res.status(403).json({ ok: false, error: 'Solo disponible para el correo de prueba.' });
  if (!UUID.test(productId)) return res.status(400).json({ ok: false, error: 'Producto inválido.' });

  const base = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const mpToken = process.env.MERCADOPAGO_ACCESS_TOKEN_TEST?.trim();
  if (!base || !key || !mpToken) return res.status(503).json({ ok: false, error: 'Configuración de pruebas incompleta.' });
  // La procedencia del token fue verificada manualmente en Mercado Pago Developers.
  // No se valida por prefijo: puede variar según la aplicación y la credencial.

  let orderId = null;
  try {
    // Precio y nombre SOLO desde Supabase: nunca confiar en el precio enviado por el navegador.
    const products = await supabase(base, key, 'products', {
      params: {
        select: 'id,name,category_id,status,categories(price_ars)',
        id: `eq.${productId}`,
        status: 'eq.ok',
        limit: '1'
      }
    });
    const product = products?.[0];
    if (!product) return res.status(404).json({ ok: false, error: 'Producto no disponible.' });
    const price = product.categories?.price_ars;
    if (!Number.isSafeInteger(price) || price <= 0) {
      return res.status(409).json({ ok: false, error: 'La categoría no tiene un precio válido configurado.' });
    }

    orderId = randomUUID();
    await supabase(base, key, 'orders', {
      method: 'POST',
      body: {
        id: orderId,
        customer_email: email,
        status: 'pending',
        currency: 'ARS',
        total_ars: price,
        payment_provider: 'mercadopago'
      }
    });
    await supabase(base, key, 'order_items', {
      method: 'POST',
      body: {
        order_id: orderId,
        product_id: product.id,
        product_name: product.name,
        unit_price_ars: price,
        quantity: 1
      }
    });

    const mpResponse = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${mpToken}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': orderId
      },
      body: JSON.stringify({
        items: [{ id: product.id, title: product.name, quantity: 1, currency_id: 'ARS', unit_price: price }],
        payer: { email },
        external_reference: orderId,
        back_urls: {
          success: SITE_ORIGIN,
          failure: SITE_ORIGIN,
          pending: SITE_ORIGIN
        },
        metadata: { area51_test: true, order_id: orderId },
        notification_url: SITE_ORIGIN + '/api/mis-compras?action=mp-webhook'
      }),
      signal: AbortSignal.timeout(15000)
    });
    if (!mpResponse.ok) {
      console.error('AREA51 MP preferencia HTTP', mpResponse.status);
      throw new Error('No se pudo crear la preferencia de prueba.');
    }
    const preference = await mpResponse.json();
    // En esta etapa no se permite retornar el enlace de producción.
    if (!preference?.id || typeof preference.sandbox_init_point !== 'string' ||
        !preference.sandbox_init_point.startsWith('https://')) {
      throw new Error('Mercado Pago no devolvió un enlace sandbox válido.');
    }

    return res.status(200).json({
      ok: true,
      testMode: true,
      order_id: orderId,
      preference_id: preference.id,
      sandbox_url: preference.sandbox_init_point,
      amount_ars: price,
      message: 'Preferencia de prueba creada. El pedido sigue pendiente; no se habilitan descargas.'
    });
  } catch (error) {
    console.error('AREA51 crear-preferencia:', error.message);
    await cancelPending(base, key, orderId);
    return res.status(502).json({ ok: false, error: 'No se pudo preparar el pago de prueba. No se confirmó ninguna compra.' });
  }
}
