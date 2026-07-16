-- Tabla principal del catálogo (antes "games" en la propuesta inicial;
-- se renombra a "products" porque el catálogo es de contenido digital en
-- general, no solo juegos). Los nombres de columna reflejan los campos que
-- usa public/admin/editor.html (name, slug, description, reqMin, reqRec,
-- size, version, languages, install, notes, changelog, category, tags,
-- dlc, legalBasis, status, cover, archivo principal, archivo de notas,
-- otro archivo).
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text,
  req_min text,
  req_rec text,
  size text,
  version text,
  languages text,
  install text,
  notes text,
  changelog text,
  category_id uuid references public.categories(id) on delete set null,
  dlc text,
  legal_basis text not null
    check (legal_basis in ('freeware','shareware','dominio-publico','reventa','propio')),
  status text not null default 'draft'
    check (status in ('draft','ok')),
  cover_path text,
  cover_name text,
  file_main_path text,
  file_main_name text,
  file_notes_path text,
  file_notes_name text,
  file_other_path text,
  file_other_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id)
);

create index if not exists products_slug_idx on public.products (slug);
create index if not exists products_category_idx on public.products (category_id);
create index if not exists products_status_idx on public.products (status);

create table if not exists public.product_tags (
  product_id uuid not null references public.products(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  primary key (product_id, tag_id)
);

-- Mantiene updated_at al día en cada UPDATE (equivalente al
-- game.updated = new Date()... que hacía a51_upsertGame() en localStorage).
create or replace function public.a51_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_products_updated_at on public.products;
create trigger trg_products_updated_at
  before update on public.products
  for each row execute function public.a51_set_updated_at();

-- Completa created_by/updated_by automáticamente a partir de la sesión
-- autenticada, sin que el frontend tenga que enviarlos.
create or replace function public.a51_set_actor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.updated_by := auth.uid();
  elsif tg_op = 'UPDATE' then
    new.updated_by := auth.uid();
    new.created_by := old.created_by;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_products_actor on public.products;
create trigger trg_products_actor
  before insert or update on public.products
  for each row execute function public.a51_set_actor();
