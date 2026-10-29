# AREA 51 — Preparación para ventas reales (auditoría técnica)
Fecha: 2026-10-29
Estado: PLANIFICACIÓN; NO HABILITADO EN PRODUCCIÓN.

## Circuito aprobado (NO MODIFICAR)
- Checkout Pro con cuenta vendedora de prueba y comprador de prueba.
- Pago acreditado de Battlefield 4; acceso visible en Mis Compras sin confirmación manual.
- Descargas de Battlefield 4 y Barbie visibles para la sesión de prueba.
- api/crear-preferencia.js usa init_point (cambio validado).
- api/mis-compras.js usa validación server-side y RPC atómica.
- Botón comercial sigue bloqueado; botón de prueba aislado.

## Bloqueos comprobados en código
1. api/crear-preferencia.js restringe checkout a TEST_EMAIL y MERCADOPAGO_ACCESS_TOKEN_TEST.
2. api/mis-compras.js restringe verificación a vendedor test 3544226015 y metadata.area51_test.
3. api/mis-compras.js requiere MERCADOPAGO_ACCESS_TOKEN_TEST para obtener enlaces.
4. public/index.html conserva checkout comercial deshabilitado y botón de pruebas separado.
5. public/mis-compras/index.html conserva herramienta manual de Barbie para diagnóstico de pruebas.

## Preparación técnica antes de habilitar cobros reales
- Diseñar endpoints/acciones de producción separados de los de prueba, sin modificar sus validaciones.
- Definir autenticación del comprador y vinculación de cada pedido al correo verificado; NO confiar en email enviado por el navegador.
- Obtener y configurar credenciales de PRODUCCIÓN de Mercado Pago en Vercel, sin exponer valores en HTML, GitHub ni logs.
- Verificar identidad del vendedor real por API; nunca reutilizar el ID de test.
- Validar cada pago server-side: estado approved/accredited, collector_id, order_id, external_reference, monto, ARS, ítems, unicidad e idempotencia.
- Configurar y probar webhook de producción, su autenticidad y reintentos. No confiar en notificaciones como prueba de pago.
- Asegurar entrega de enlaces exclusivamente a sesión verificada con derecho activo y orden pagada.
- Probar escenarios: pago aprobado, pendiente, rechazado, duplicado, monto alterado, otro comprador, producto incorrecto, notificación repetida y fallo de red.
- Definir política de reembolsos y revocación de accesos, textos comerciales y atención al cliente.
- Habilitar botón comercial únicamente luego de las pruebas de seguridad y autorización explícita.

## Requiere intervención del propietario (más adelante)
- Confirmar que la cuenta de Mercado Pago que cobrará ventas reales esté habilitada y a nombre del comercio/titular correspondiente.
- Configurar credenciales reales en Vercel (no compartir secretos por chat).
- Aprobar prueba controlada de producción con importe y producto definidos.
- Autorizar explícitamente habilitación pública del checkout.

LEY AREA 51: conservar intacto todo circuito validado; únicamente agregar módulos independientes, con respaldo y revisión previa.
