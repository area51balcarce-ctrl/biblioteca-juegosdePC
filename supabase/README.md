# Supabase — ÁREA 51

Esta carpeta contiene el esquema de base de datos completo que reemplaza el
`localStorage` de `public/assets/store.js`. Está pensado para que lo apliques
vos mismo, paso a paso, sin depender de que Claude tenga acceso a tu cuenta
de Supabase (no lo tiene, y no debe tenerlo).

## Paso 1 — Crear el proyecto

1. Entrá a [supabase.com](https://supabase.com) y creá una cuenta o iniciá
   sesión.
2. **New Project** → elegí o creá una organización → nombre sugerido
   `area51-biblioteca` → generá una contraseña de base de datos fuerte y
   **guardala en un lugar seguro** (es para conexión directa a Postgres/CLI,
   no la vas a pegar en ningún lado del frontend) → elegí la región más
   cercana a tus clientes → **Create new project**. Tarda uno o dos minutos
   en aprovisionar.

## Paso 2 — Aplicar el esquema

En el dashboard del proyecto, abrí **SQL Editor** → **New query**, y pegá y
ejecutá el contenido de cada archivo de `supabase/migrations/`, **en este
orden exacto** (el nombre ya está numerado):

1. `20260713000100_categories_and_tags.sql`
2. `20260713000200_products.sql`
3. `20260713000300_admin_users.sql`
4. `20260713000400_audit_log.sql`
5. `20260713000500_rls_policies.sql`
6. `20260713000600_storage.sql`

Ejecutá uno, esperá el "Success", pasá al siguiente. Si alguno falla, no
sigas con el siguiente — copiame el error exacto.

Al terminar el paso 6 ya deberían existir automáticamente dos buckets en
**Storage**: `covers` (público) y `product-files` (privado). Podés
verificarlo entrando a la sección **Storage** del dashboard.

## Paso 3 — Configurar Auth (que nadie pueda registrarse solo)

El panel de administración es privado: los administradores los creás vos a
mano, no debe existir un formulario de "crear cuenta" público.

1. Andá a **Authentication → Providers** y confirmá que **Email** esté
   habilitado (viene así por defecto).
2. Andá a **Authentication → Settings** (o **Sign In / Providers** según la
   versión del dashboard) y **desactivá "Allow new users to sign up"** (o el
   equivalente "Enable email signups"). Así solo pueden iniciar sesión los
   usuarios que vos crees manualmente en el paso siguiente — nadie puede
   auto-registrarse escribiendo la URL correcta.

## Paso 4 — Crear el primer administrador

1. Andá a **Authentication → Users → Add user → Create new user**.
2. Cargá tu email y una contraseña fuerte. Marcá **Auto Confirm User** para
   no depender de un mail de verificación.
3. Copiá el **UID** que te muestra la tabla de usuarios para esa cuenta
   recién creada.
4. Volvé al **SQL Editor** y ejecutá (reemplazando los valores):
   ```sql
   insert into public.admin_users (id, email, role)
   values ('EL-UID-QUE-COPIASTE', 'tu-email@area51', 'admin');
   ```

Para sumar otro administrador o editor más adelante, repetís este mismo
paso 4 (crear el usuario en Authentication, después insertar la fila en
`admin_users` con `role = 'admin'` o `role = 'editor'`).

## Paso 5 — Obtener las credenciales para el sitio

1. Andá a **Project Settings → API**.
2. Copiá:
   - **Project URL**
   - **anon public key**
3. Guardalos: los vas a necesitar en Vercel (ver `.env.example` en la raíz
   del repo, y el paso siguiente de esta guía cuando conectemos
   `store.js`). Todavía no hace falta que me los pases a mí.

## Qué crea este esquema

- **`categories`**, **`tags`**, **`product_tags`** — catálogo de categorías
  y etiquetas relacional. Lectura pública, escritura solo para usuarios en
  `admin_users`.
- **`products`** — tabla principal, un campo por cada campo del formulario
  de `editor.html`. Los archivos (portada, archivo principal, archivo de
  notas, otro) se guardan como *path* a Supabase Storage, no como archivo
  entero. `created_by`/`updated_by` y `updated_at` se completan solos vía
  trigger a partir de la sesión autenticada.
- **`admin_users`** — vincula un usuario de Supabase Auth con un rol
  (`admin`/`editor`). Sin escritura desde el frontend: administradores
  nuevos se agregan a mano (paso 4), a propósito.
- **`audit_log`** — bitácora de alta/edición/borrado de `products`. Se
  llena sola vía trigger, sin que el frontend tenga que hacer nada extra.
- **Storage**: bucket `covers` (público, para portadas) y `product-files`
  (privado — un archivo solo es descargable si el producto asociado está
  publicado, o si quien pregunta es un admin/editor autenticado).

## Sobre RLS (Row-Level Security)

A diferencia de la primera propuesta (que dejaba `products`/`categories`/
`tags` abiertas "a propósito, de forma temporal" porque no existía Auth
todavía), este esquema ya trae las políticas finales: lectura pública solo
de lo publicado, escritura solo para quien esté en `admin_users`. Como acá
ya se crea el primer administrador en el paso 4, no hace falta una etapa
intermedia con políticas permisivas.
