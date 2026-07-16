-- =========================================================
-- RLS final (reemplaza las políticas "permisivas de prototipo" de la
-- propuesta anterior, ahora que hay Auth real en Etapa 3).
--
-- Regla general:
--   - categories / tags / product_tags: lectura pública (son solo
--     taxonomía, no hay nada sensible), escritura solo admin_users.
--   - products: lectura pública SOLO de status = 'ok'; un admin_users
--     autenticado ve y edita todo, incluidos los borradores.
--   - admin_users: cada usuario ve su propia fila (para que el frontend
--     pueda chequear su propio rol tras el login); nadie escribe desde
--     el cliente — sumar administradores se hace a mano desde el SQL
--     Editor de Supabase (ver supabase/README.md).
--   - audit_log: solo lectura para quienes están en admin_users; las
--     escrituras las hace el trigger de la migración anterior, que corre
--     como SECURITY DEFINER y no depende de estas políticas.
-- =========================================================

alter table public.categories enable row level security;
alter table public.tags enable row level security;
alter table public.products enable row level security;
alter table public.product_tags enable row level security;
alter table public.admin_users enable row level security;
alter table public.audit_log enable row level security;

-- Helper: ¿el usuario autenticado actual está en admin_users?
-- SECURITY DEFINER + dueño "postgres" => esta consulta no vuelve a pasar
-- por RLS sobre admin_users, así que no hay recursión ni bloqueo.
create or replace function public.is_admin_user()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.admin_users au where au.id = auth.uid()
  );
$$;

-- categories
drop policy if exists "prototipo: leer categorías" on public.categories;
drop policy if exists "prototipo: escribir categorías" on public.categories;
create policy "categorias: lectura pública" on public.categories
  for select using (true);
create policy "categorias: escritura solo admins" on public.categories
  for insert with check (public.is_admin_user());
create policy "categorias: edicion solo admins" on public.categories
  for update using (public.is_admin_user()) with check (public.is_admin_user());
create policy "categorias: borrado solo admins" on public.categories
  for delete using (public.is_admin_user());

-- tags
drop policy if exists "prototipo: leer tags" on public.tags;
drop policy if exists "prototipo: escribir tags" on public.tags;
create policy "tags: lectura pública" on public.tags
  for select using (true);
create policy "tags: escritura solo admins" on public.tags
  for insert with check (public.is_admin_user());
create policy "tags: edicion solo admins" on public.tags
  for update using (public.is_admin_user()) with check (public.is_admin_user());
create policy "tags: borrado solo admins" on public.tags
  for delete using (public.is_admin_user());

-- products
create policy "products: lectura publicados o admin" on public.products
  for select using (status = 'ok' or public.is_admin_user());
create policy "products: alta solo admins" on public.products
  for insert with check (public.is_admin_user());
create policy "products: edicion solo admins" on public.products
  for update using (public.is_admin_user()) with check (public.is_admin_user());
create policy "products: borrado solo admins" on public.products
  for delete using (public.is_admin_user());

-- product_tags (visibles siempre; solo importan combinados con products,
-- que ya tiene su propia restricción de lectura)
drop policy if exists "prototipo: leer game_tags" on public.product_tags;
drop policy if exists "prototipo: escribir game_tags" on public.product_tags;
create policy "product_tags: lectura pública" on public.product_tags
  for select using (true);
create policy "product_tags: escritura solo admins" on public.product_tags
  for insert with check (public.is_admin_user());
create policy "product_tags: borrado solo admins" on public.product_tags
  for delete using (public.is_admin_user());

-- admin_users: cada quien ve su propia fila (o cualquier admin ve todas,
-- útil para una futura pantalla de gestión de usuarios); sin escritura
-- desde el cliente.
create policy "admin_users: ver propia fila o si sos admin" on public.admin_users
  for select using (id = auth.uid() or public.is_admin_user());

-- audit_log: solo lectura, y solo para quienes están en admin_users.
create policy "audit_log: lectura solo admins" on public.audit_log
  for select using (public.is_admin_user());
