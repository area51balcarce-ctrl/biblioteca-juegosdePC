-- Vincula un usuario de Supabase Auth con un rol dentro del panel.
-- El primer administrador se crea manualmente (ver supabase/README.md,
-- paso 5); desde ahí se pueden agregar más filas para sumar administradores
-- o editores sin tocar código.
create table if not exists public.admin_users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  role text not null default 'editor'
    check (role in ('admin','editor')),
  created_at timestamptz not null default now()
);
