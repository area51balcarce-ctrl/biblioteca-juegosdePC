-- AREA 51 BIBLIOTECA - CONFIGURACION COMPLETA
-- Ejecutar UNA sola vez en Supabase > SQL Editor > New query > Run

create extension if not exists pgcrypto;

create table if not exists public.categories (id uuid primary key default gen_random_uuid(), name text not null unique, created_at timestamptz not null default now());
create table if not exists public.tags (id uuid primary key default gen_random_uuid(), name text not null unique, created_at timestamptz not null default now());
create table if not exists public.admin_users (id uuid primary key references auth.users(id) on delete cascade, email text not null, role text not null default 'admin' check(role in ('admin','editor')), created_at timestamptz not null default now());
create table if not exists public.products (
 id uuid primary key default gen_random_uuid(), slug text not null unique, name text not null, description text,
 req_min text, req_rec text, size text, version text, languages text, install text, notes text, changelog text,
 category_id uuid references public.categories(id) on delete set null, dlc text,
 legal_basis text not null check (legal_basis in ('freeware','shareware','dominio-publico','reventa','propio')),
 status text not null default 'draft' check(status in ('draft','ok')),
 cover_path text, cover_name text, file_main_path text, file_main_name text, file_notes_path text, file_notes_name text,
 file_other_path text, file_other_name text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 created_by uuid references auth.users(id), updated_by uuid references auth.users(id)
);
create table if not exists public.product_tags (product_id uuid not null references public.products(id) on delete cascade, tag_id uuid not null references public.tags(id) on delete cascade, primary key(product_id,tag_id));
create table if not exists public.audit_log (id bigint generated always as identity primary key, table_name text not null, record_id uuid, action text not null, old_data jsonb, new_data jsonb, actor_id uuid, created_at timestamptz not null default now());

create or replace function public.is_admin_user() returns boolean language sql security definer stable set search_path=public as $$ select exists(select 1 from public.admin_users where id=auth.uid()); $$;
create or replace function public.a51_set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at=now(); return new; end; $$;
drop trigger if exists trg_products_updated_at on public.products;
create trigger trg_products_updated_at before update on public.products for each row execute function public.a51_set_updated_at();
create or replace function public.a51_set_actor() returns trigger language plpgsql security definer set search_path=public as $$ begin if tg_op='INSERT' then new.created_by:=auth.uid(); new.updated_by:=auth.uid(); else new.updated_by:=auth.uid(); new.created_by:=old.created_by; end if; return new; end; $$;
drop trigger if exists trg_products_actor on public.products;
create trigger trg_products_actor before insert or update on public.products for each row execute function public.a51_set_actor();

alter table public.categories enable row level security; alter table public.tags enable row level security; alter table public.products enable row level security; alter table public.product_tags enable row level security; alter table public.admin_users enable row level security; alter table public.audit_log enable row level security;

do $$ declare r record; begin for r in select policyname,tablename from pg_policies where schemaname='public' and tablename in ('categories','tags','products','product_tags','admin_users','audit_log') loop execute format('drop policy if exists %I on public.%I',r.policyname,r.tablename); end loop; end $$;
create policy "categories public read" on public.categories for select using(true); create policy "categories admin write" on public.categories for all using(public.is_admin_user()) with check(public.is_admin_user());
create policy "tags public read" on public.tags for select using(true); create policy "tags admin write" on public.tags for all using(public.is_admin_user()) with check(public.is_admin_user());
create policy "products published or admin read" on public.products for select using(status='ok' or public.is_admin_user()); create policy "products admin write" on public.products for all using(public.is_admin_user()) with check(public.is_admin_user());
create policy "product tags public read" on public.product_tags for select using(true); create policy "product tags admin write" on public.product_tags for all using(public.is_admin_user()) with check(public.is_admin_user());
create policy "admin self read" on public.admin_users for select using(id=auth.uid() or public.is_admin_user());
create policy "audit admin read" on public.audit_log for select using(public.is_admin_user());

insert into storage.buckets(id,name,public) values('covers','covers',true) on conflict(id) do update set public=true;
insert into storage.buckets(id,name,public) values('product-files','product-files',false) on conflict(id) do update set public=false;
create or replace function public.is_public_product_file(object_name text) returns boolean language sql security definer stable set search_path=public as $$ select exists(select 1 from public.products p where p.id::text=(storage.foldername(object_name))[1] and p.status='ok'); $$;
do $$ declare r record; begin for r in select policyname from pg_policies where schemaname='storage' and tablename='objects' and (policyname like 'a51 %' or policyname like 'covers:%' or policyname like 'product-files:%') loop execute format('drop policy if exists %I on storage.objects',r.policyname); end loop; end $$;
create policy "a51 covers public read" on storage.objects for select using(bucket_id='covers');
create policy "a51 covers admin insert" on storage.objects for insert with check(bucket_id='covers' and public.is_admin_user());
create policy "a51 covers admin update" on storage.objects for update using(bucket_id='covers' and public.is_admin_user());
create policy "a51 covers admin delete" on storage.objects for delete using(bucket_id='covers' and public.is_admin_user());
create policy "a51 files conditional read" on storage.objects for select using(bucket_id='product-files' and (public.is_admin_user() or public.is_public_product_file(name)));
create policy "a51 files admin insert" on storage.objects for insert with check(bucket_id='product-files' and public.is_admin_user());
create policy "a51 files admin update" on storage.objects for update using(bucket_id='product-files' and public.is_admin_user());
create policy "a51 files admin delete" on storage.objects for delete using(bucket_id='product-files' and public.is_admin_user());
