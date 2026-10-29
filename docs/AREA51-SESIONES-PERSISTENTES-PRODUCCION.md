# AREA 51 — Biblioteca PC: sesiones persistentes de clientes (decisión aprobada)

Estado: **diseño aprobado; implementación pendiente de auditoría e integración**. No habilita ventas ni cambia las sesiones de prueba.

## Decisión comercial (29/10/2026)
- Inicio de sesión sin contraseña, por código de un solo uso enviado al correo.
- El cliente no debe repetir el código en cada visita: conservar la sesión entre cierres del navegador.
- Mis Compras muestra **solo derechos de compra pagados, vigentes y pertenecientes al correo autenticado**. No se entregan enlaces por el mero hecho de iniciar sesión.
- La web oficial `area51balcarce.com` no interviene. Único dominio: `biblioteca-juegosde-pc.vercel.app`.

## Diseño de seguridad para implementación
1. Tras verificar el código por el backend, emitir cookie `HttpOnly; Secure; SameSite=Lax; Path=/` (o Strict si las redirecciones de Checkout Pro lo permiten). Evitar guardar credenciales en localStorage.
2. Mantener un identificador aleatorio de sesión de al menos 256 bits, guardar **solo su hash** en el servidor y asociarlo al correo verificado, fecha de creación, último uso, vencimiento y revocación.
3. Sesión persistente de 30 días de inactividad con renovación deslizante; tope absoluto recomendado de 180 días. Estos valores son propuesta técnica, sujetos a pruebas. No existe sesión segura literalmente infinita.
4. Rotar el identificador de sesión de manera controlada y atómica; prevenir carreras entre pestañas. Revocar en cierre de sesión y permitir invalidación por incidente.
5. Validar la sesión y la autorización de cada pedido/descarga **en el servidor**; nunca confiar en correo, producto o precio enviados por el navegador.
6. Limitar por IP/correo los intentos y reenvíos de códigos, usar expiración corta y consumo único del OTP, y evitar enumeración de cuentas.
7. No enviar OTP nuevo mientras exista una sesión válida. Un nuevo dispositivo/navegador sin cookie requiere código.
8. Exigir identidad verificada **antes** de crear una preferencia real; asociar el pedido al correo de la sesión. La acreditación de pago debe verificarse de manera independiente con MP, con controles de importe, vendedor, referencia, idempotencia y estado.
9. Probar en navegadores reales: cerrar pestaña/navegador, expiración, logout, dos pestañas, cookies bloqueadas, dispositivo nuevo, compra sin acreditar, compra acreditada, webhook duplicado y pago rechazado.

## Ley AREA 51
No modificar componentes que funcionan en pruebas. Implementar producción en rutas/funciones aisladas tras auditar el límite de funciones Vercel Hobby y el esquema Supabase. No habilitar botón público hasta validación integral y autorización del propietario.
