AREA 51 — ETAPA 5 — IDENTIDAD DEL VENDEDOR (SOLO LECTURA)
Archivo: api/mis-compras.js

LEY AREA 51: agregar únicamente estos dos fragmentos. NO modificar sandbox, verified, descargas, pedidos ni credenciales.

1) BUSCAR ESTA LÍNEA EXACTA:

    // ETAPA 3: comparación detallada sin exponer datos personales del comprador.

INMEDIATAMENTE ANTES, PEGAR:

    // ETAPA 5 — Identidad del vendedor: diagnóstico de solo lectura.
    // No se exponen IDs ni tokens; únicamente el resultado de la comparación.
    let sellerIdentity = { checked: false, matches_payment: false, error: null };
    try {
      const seller = await getJSON('https://api.mercadopago.com/users/me',
        { Authorization: 'Bearer ' + mpToken, Accept: 'application/json' }, 15000);
      const sellerId = String(seller?.id ?? '');
      const paymentSellerId = String(payment?.collector_id ?? '');
      sellerIdentity = {
        checked: Boolean(sellerId && paymentSellerId),
        matches_payment: Boolean(sellerId && paymentSellerId && sellerId === paymentSellerId),
        error: null
      };
    } catch (_sellerError) {
      sellerIdentity = { checked: false, matches_payment: false, error: 'No se pudo comprobar la identidad del vendedor.' };
    }

2) BUSCAR ESTA LÍNEA EXACTA:

      payment_status: typeof payment.status === 'string' ? payment.status : 'unknown',

INMEDIATAMENTE DESPUÉS, PEGAR:

      seller_identity: sellerIdentity,

3) Guardar commit en GitHub. Vercel despliega automáticamente.

4) En Mis Compras, con sesión vigente, ejecutar:

(async () => {
  const r = await fetch('/api/mis-compras?action=verificar-pago', {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      order_id: 'bba221ac-370e-4906-a93f-456352d263e1',
      payment_id: '186617430982'
    })
  });
  const d = await r.json();
  console.log('HTTP:', r.status, 'ERROR:', d.error || 'Ninguno');
  console.table(d.seller_identity || {});
  console.log('PAGO VERIFICADO:', d.verified);
  console.log('MODIFICACIONES:', d.writesPerformed);
  console.log('DESCARGAS:', d.downloadsEnabled);
})();

NOTA: la coincidencia del vendedor no demuestra por sí sola que sea sandbox. No se habilita ninguna compra con este cambio.
