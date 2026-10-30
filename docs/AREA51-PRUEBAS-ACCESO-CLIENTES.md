# AREA 51 — Biblioteca de PC: acceso por correo, estado de pruebas

## Comprobaciones realizadas con el propietario (29/10/2026, Argentina)
- Correo de prueba autorizado: `area51.balcarce@gmail.com`.
- Inicio de sesión con código recibido por correo: **aprobado**.
- Primera recarga F5: **falló** por discrepancia de milisegundos entre `created_at` y `last_seen_at`.
- Corrección: Supabase fija `created_at` y `last_seen_at` al crear la sesión; se corrigió el registro afectado.
- Segunda recarga F5: **aprobada**; sesión conservada sin solicitar código.
- Cierre de sesión + recarga F5: **aprobado**; vuelve a solicitar inicio de sesión.

## Restricciones que se deben conservar
- La autorización vigente es **solo para pruebas del correo de AREA 51**, no para activar registro abierto.
- No activar cobros reales, descargas reales ni acceso de otros clientes.
- Mantener `AREA51_CUSTOMER_AUTH_ENABLED` solo como habilitador de prueba, con restricción del correo en servidor.
- No modificar el circuito de compra TEST aprobado ni la web oficial de AREA 51.
- No almacenar códigos OTP, claves de servicio ni cookies en repositorios o registros públicos.

## Pendientes antes de acceso público
1. Verificar resultados de GitHub Actions y pruebas de regresión de sesión/cierre.
2. Validar límites de solicitudes bajo concurrencia y consumo atómico del OTP.
3. Revisar validación de origen, IP y entrega de correo; considerar antiautomatización.
4. Revisar vencimiento absoluto de 180 días y renovación por inactividad de 30 días.
5. Diseñar la biblioteca privada con controles por pedido pagado y por producto; no usar solo `customer_entitlements` como permiso de descarga.
6. Revisar devoluciones, revocaciones, pagos y conciliación con Mercado Pago PRODUCCIÓN en pruebas controladas.
7. Solicitar nueva autorización expresa antes de permitir correos de clientes reales o cobros reales.

## LEY AREA 51
**No modificar lo que funciona**. Hacer adiciones aisladas, mantener respaldo y probar antes de habilitar.
