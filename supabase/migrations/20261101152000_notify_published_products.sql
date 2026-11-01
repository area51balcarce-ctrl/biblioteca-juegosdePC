-- AREA51: avisos globales al publicar un juego o software.
-- Solo añade un trigger. No altera las compras, descargas ni los productos existentes.
create or replace function public.a51_notify_published_product()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'ok' and
     (case when tg_op = 'INSERT' then true else old.status is distinct from 'ok' end) then
    insert into public.pc_customer_notifications
      (kind, title, message, product_id, source_event_id)
    values
      ('new_product', '🎮 Nuevo contenido en AREA 51',
       'Ya está disponible: ' || left(new.name, 160),
       new.id, 'new-product:' || new.id::text)
    on conflict (source_event_id) do nothing;
  end if;
  return new;
end;
$$;
drop trigger if exists a51_notify_published_product_trigger on public.products;
create trigger a51_notify_published_product_trigger
after insert or update of status on public.products
for each row execute function public.a51_notify_published_product();
