-- =========================================================
-- Storage: portadas (públicas) y archivos de descarga (privados,
-- accesibles solo si el producto está publicado).
--
-- Convención de rutas dentro de cada bucket:
--   {product_id}/{nombre-de-archivo-original}
-- El product_id como primera carpeta es lo que permite validar el
-- acceso a "product-files" contra la tabla products sin exponer nada
-- por adivinanza de URL.
-- =========================================================

insert into storage.buckets (id, name, public)
values ('covers', 'covers', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('product-files', 'product-files', false)
on conflict (id) do nothing;

-- ¿El archivo (por su carpeta = product_id) pertenece a un producto publicado?
create or replace function public.is_public_product_file(object_name text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.products p
    where p.id::text = (storage.foldername(object_name))[1]
      and p.status = 'ok'
  );
$$;

-- covers: lectura pública, escritura solo admin_users
create policy "covers: lectura pública" on storage.objects
  for select using (bucket_id = 'covers');
create policy "covers: alta solo admins" on storage.objects
  for insert with check (bucket_id = 'covers' and public.is_admin_user());
create policy "covers: reemplazo solo admins" on storage.objects
  for update using (bucket_id = 'covers' and public.is_admin_user());
create policy "covers: borrado solo admins" on storage.objects
  for delete using (bucket_id = 'covers' and public.is_admin_user());

-- product-files: lectura condicionada a que el producto esté publicado
-- (o que quien pide sea admin_users, para poder previsualizar borradores);
-- escritura siempre restringida a admin_users.
create policy "product-files: lectura condicionada" on storage.objects
  for select using (
    bucket_id = 'product-files'
    and (public.is_admin_user() or public.is_public_product_file(name))
  );
create policy "product-files: alta solo admins" on storage.objects
  for insert with check (bucket_id = 'product-files' and public.is_admin_user());
create policy "product-files: reemplazo solo admins" on storage.objects
  for update using (bucket_id = 'product-files' and public.is_admin_user());
create policy "product-files: borrado solo admins" on storage.objects
  for delete using (bucket_id = 'product-files' and public.is_admin_user());
