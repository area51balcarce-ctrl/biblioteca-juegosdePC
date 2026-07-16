# Prompt para continuar en Claude Code

Copiá y pegá esto como primer mensaje al abrir Claude Code en la carpeta `area51-biblioteca`.

---

Estoy trabajando en ÁREA 51, un subproyecto interno: una plataforma privada
de gestión y entrega de catálogo digital (panel de administración + ficha
pública por producto). Es un prototipo funcional, hoy sin backend real.

## Alcance y restricción de contenido (no negociable)

Este sistema es exclusivamente para catalogar y entregar contenido con base
legal clara: software freeware, shareware, contenido de dominio público /
licencias libres, o productos propios. No es, y no puede convertirse en, un
sistema de distribución de software comercial sin licencia (repacks,
cracks, torrents de juegos con copyright activo, etc.). Cada producto tiene
un campo obligatorio "Base de distribución" para dejar esto auditable. Si en
algún momento te pido cargar o conectar contenido que no cumpla esto, no lo
hagas y decime por qué.

## Estado actual

- `public/admin/index.html` — login (todavía no valida contra nada real, solo redirige).
- `public/admin/dashboard.html` — catálogo: buscador, filtros, tabla, botón "Copiar enlace", editar/eliminar.
- `public/admin/editor.html` — alta/edición de producto con carga de archivos (portada, torrent, txt, otro).
- `public/juego/index.html` — ficha pública, se arma dinámicamente según `?slug=`.
- `public/assets/style.css` — sistema de diseño ("terminal de archivo clasificado": fondo casi negro, acento verde fósforo `#39ff9d`, tipografías Chakra Petch + IBM Plex Mono/Sans).
- `public/assets/store.js` — capa de datos actual: todo vive en `localStorage` del navegador (funciones `a51_getGames`, `a51_getGameBySlug`, `a51_upsertGame`, `a51_deleteGame`, `a51_fileToDataURL`).
- `vercel.json` — sirve `public/` como raíz del sitio, sin build.

Limitación conocida: como todo es `localStorage`, el catálogo y los archivos
solo existen en el navegador donde se cargaron. No persisten entre
dispositivos ni sobreviven a un "borrar datos del sitio".

## Lo que sigue (en este orden)

1. **Crear el proyecto en Supabase** (Postgres + Storage + Auth) y modelar las tablas: `games`, `categories`, `tags`, `admin_users`, `audit_log`. Los campos de `games` tienen que reflejar los que ya usa `editor.html` (name, slug, description, reqMin, reqRec, size, version, languages, install, notes, changelog, category, tags, dlc, legalBasis, status, cover, files.torrent, files.txt, files.other, updated).

2. **Reemplazar `public/assets/store.js`** para que las mismas funciones (`a51_getGames`, `a51_getGameBySlug`, `a51_upsertGame`, `a51_deleteGame`) hablen con Supabase en vez de `localStorage`. Las tres pantallas (dashboard, editor, ficha pública) ya están armadas para consumir esas funciones, así que idealmente casi no hay que tocarlas.

3. **Subida de archivos real** — reemplazar `a51_fileToDataURL` (que hoy convierte el archivo a base64 para guardarlo en `localStorage`) por una subida real a Supabase Storage, guardando en la tabla solo la referencia (path/URL), no el archivo entero.

4. **Conectar el login** de `admin/index.html` a Supabase Auth, con roles (administrador / editor) y Row-Level Security en las tablas.

5. **Auditoría básica** — registrar en `audit_log` quién creó/editó/eliminó cada producto.

Trabajemos de a un paso genuino por vez, sin romper lo que ya funciona.
Antes de instalar dependencias o cambiar la estructura de carpetas, avisame
qué vas a hacer y por qué.
