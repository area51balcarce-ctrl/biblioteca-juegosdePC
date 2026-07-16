# ÁREA 51 — Biblioteca digital privada

Panel de administración y ficha pública de producto para el catálogo digital
de ÁREA 51 ("Te abduce a la tecnología"). El backend es real: Postgres,
Auth y Storage en Supabase, con Row Level Security en todas las tablas.

## Estructura

```
area51-biblioteca/
├── public/
│   ├── index.html            # Landing con acceso al panel
│   ├── admin/
│   │   ├── index.html        # Login contra Supabase Auth
│   │   ├── dashboard.html    # Catálogo: buscador, filtros, copiar enlace, logout
│   │   └── editor.html       # Alta / edición de producto + carga de archivos a Storage
│   ├── producto/
│   │   └── index.html        # Ficha pública, se arma según ?slug=xxx
│   └── assets/
│       ├── style.css         # Sistema de diseño compartido
│       ├── store.js          # Capa de datos: habla con Supabase (Postgres + Auth + Storage)
│       ├── config.js         # Generado en cada build, no se commitea (ver scripts/build-config.js)
│       └── vendor/           # Cliente de Supabase vendorizado en el build, no se commitea
├── supabase/
│   ├── README.md              # Guía paso a paso para crear y configurar el proyecto en Supabase
│   └── migrations/            # Esquema SQL completo: products, categories, tags, admin_users, audit_log, RLS, Storage
├── scripts/
│   ├── build-config.js        # Vuelca SUPABASE_URL/SUPABASE_ANON_KEY a public/assets/config.js en el build
│   └── copy-vendor.js         # Copia el cliente de Supabase a public/assets/vendor/ en el build
├── middleware.mjs              # Vercel Routing Middleware: bloquea /admin/dashboard y /admin/editor sin sesión
├── package.json
├── .env.example
├── vercel.json
├── .gitignore
└── README.md
```

## Subir a GitHub

**Opción A — con Git instalado (recomendado):**

1. Abrí una terminal dentro de esta carpeta (`area51-biblioteca`).
2. Ejecutá:
   ```
   git init
   git add .
   git commit -m "Prototipo inicial ÁREA 51"
   ```
3. Creá un repositorio nuevo y **vacío** en GitHub (sin README, sin licencia) — por ejemplo `area51-biblioteca`. Marcalo como **privado**.
4. Conectalo y subilo:
   ```
   git branch -M main
   git remote add origin https://github.com/TU-USUARIO/area51-biblioteca.git
   git push -u origin main
   ```

**Opción B — sin Git, arrastrando archivos:**

1. Entrá a GitHub → **New repository** → nombralo (ej. `area51-biblioteca`) → marcalo **privado** → creá el repo vacío.
2. Adentro del repo, botón **"Add file" → "Upload files"**.
3. Arrastrá toda la carpeta `area51-biblioteca` (o su contenido) y confirmá el commit.

## Conectar a Vercel

1. Entrá a [vercel.com](https://vercel.com) e iniciá sesión con tu cuenta de GitHub.
2. **Add New → Project**.
3. Elegí el repositorio `area51-biblioteca`.
4. Antes de desplegar, configurá en **Project Settings → Environment
   Variables** las dos variables de `.env.example` (`SUPABASE_URL` y
   `SUPABASE_ANON_KEY`) con los valores de tu proyecto de Supabase (ver
   `supabase/README.md`, paso 5). Vercel corre `npm run build`
   automáticamente (definido en `vercel.json` y `package.json`), que genera
   `public/assets/config.js` con esos valores y copia el cliente de
   Supabase a `public/assets/vendor/` antes de servir el sitio.
5. **Deploy**. En un par de minutos te da una URL tipo `area51-biblioteca.vercel.app`.
6. Iniciá sesión en `/admin` con el usuario administrador que creaste en el
   paso 4 de `supabase/README.md`, y cargá el primer producto real desde
   "+ Nuevo producto".

## Cómo funciona la seguridad

- **Login real**: `admin/index.html` valida contra Supabase Auth. No hay
  registro público — los administradores se crean a mano (ver
  `supabase/README.md`).
- **Row Level Security**: cada tabla y cada bucket de Storage tiene
  políticas que solo permiten leer datos/archivos de productos publicados
  (o todo, si sos un admin autenticado) y solo permiten escribir a usuarios
  que estén en `admin_users`. Esta es la protección real del sistema.
- **Vercel Routing Middleware** (`middleware.mjs`): capa adicional que
  bloquea el acceso directo a `/admin/dashboard` y `/admin/editor` sin una
  sesión iniciada, redirigiendo al login.
- **Archivos**: las portadas son públicas (bucket `covers`); los archivos
  de descarga son privados (bucket `product-files`) y se sirven con URLs
  firmadas de 5 minutos, generadas solo si el producto está publicado.
- **Auditoría**: cada alta/edición/borrado de un producto queda registrado
  en `audit_log` automáticamente (vía trigger de base de datos).

## Próximos pasos posibles (no implementados todavía)

- Pantalla de gestión de categorías/etiquetas y de usuarios (hoy son links
  inertes en la barra lateral, marcados "Próximamente").
- Pantalla de auditoría dentro del panel (los datos ya se están
  registrando en `audit_log`, solo falta una vista para consultarlos).
