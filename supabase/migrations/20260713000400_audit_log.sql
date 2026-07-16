-- Bitácora de alta/edición/borrado sobre "products". Se escribe sola vía
-- trigger (no depende de que el frontend recuerde llamar a nada), y la
-- función corre como SECURITY DEFINER para poder insertar en audit_log
-- aunque el usuario que hace la operación no tenga permiso de escritura
-- directo sobre esa tabla.
create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  table_name text not null,
  record_id uuid,
  action text not null check (action in ('insert','update','delete')),
  actor uuid references auth.users(id),
  actor_email text,
  diff jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_log_table_record_idx on public.audit_log (table_name, record_id);

create or replace function public.a51_log_product_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_email text := (auth.jwt() ->> 'email');
begin
  if (tg_op = 'INSERT') then
    insert into public.audit_log(table_name, record_id, action, actor, actor_email, diff)
      values ('products', new.id, 'insert', v_actor, v_actor_email, to_jsonb(new));
    return new;
  elsif (tg_op = 'UPDATE') then
    insert into public.audit_log(table_name, record_id, action, actor, actor_email, diff)
      values ('products', new.id, 'update', v_actor, v_actor_email,
        jsonb_build_object('antes', to_jsonb(old), 'despues', to_jsonb(new)));
    return new;
  elsif (tg_op = 'DELETE') then
    insert into public.audit_log(table_name, record_id, action, actor, actor_email, diff)
      values ('products', old.id, 'delete', v_actor, v_actor_email, to_jsonb(old));
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_products_audit on public.products;
create trigger trg_products_audit
  after insert or update or delete on public.products
  for each row execute function public.a51_log_product_change();
