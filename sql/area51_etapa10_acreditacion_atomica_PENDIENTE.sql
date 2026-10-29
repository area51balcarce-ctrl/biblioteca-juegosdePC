-- AREA 51 / ETAPA 10 — FUNCIÓN TRANSACCIONAL (instalar sin invocar)
-- Aplicar únicamente cuando el backend valide el pago y su entorno.
-- No llamar desde el navegador. La API debe usar exclusivamente service_role.
-- Operación atómica: todo se confirma o todo se revierte.
create or replace function public.a51_confirm_paid_order(
  p_order_id uuid,
  p_payment_reference text
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_item_count integer;
  v_items_total bigint;
  v_granted integer;
begin
  if p_payment_reference is null or p_payment_reference !~ '^[0-9]{1,24}$' then
    raise exception 'Referencia de pago inválida';
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Pedido inexistente';
  end if;
  if v_order.payment_provider is distinct from 'mercadopago' then
    raise exception 'Proveedor de pago inválido';
  end if;
  if v_order.status = 'paid' then
    if v_order.payment_reference = p_payment_reference then
      return jsonb_build_object('ok', true, 'already_paid', true, 'order_id', p_order_id);
    end if;
    raise exception 'Pedido acreditado con otra referencia';
  end if;
  if v_order.status <> 'pending' then
    raise exception 'Pedido no pendiente';
  end if;
  if v_order.payment_reference is not null and v_order.payment_reference <> p_payment_reference then
    raise exception 'Referencia del pedido no coincide';
  end if;

  select count(*)::integer, coalesce(sum(unit_price_ars * quantity),0)::bigint
  into v_item_count, v_items_total
  from public.order_items
  where order_id = p_order_id;

  if v_item_count < 1 or v_items_total <> v_order.total_ars then
    raise exception 'Productos e importe del pedido no coinciden';
  end if;

  -- Una compra nueva puede rehabilitar un acceso revocado de una prueba anterior.
  -- Se conserva el ID del acceso, se reasigna al pedido NUEVO verificado
  -- y se elimina la revocación. No se crean accesos duplicados.
  insert into public.customer_entitlements(customer_email,product_id,order_id)
  select v_order.customer_email,i.product_id,p_order_id
  from public.order_items i
  where i.order_id = p_order_id
  on conflict (customer_email,product_id) do update
    set order_id = excluded.order_id, revoked_at = null, granted_at = now()
    where public.customer_entitlements.revoked_at is not null;

  get diagnostics v_granted = row_count;

  update public.orders
  set status='paid',payment_reference=p_payment_reference,
      paid_at=now(),updated_at=now()
  where id=p_order_id and status='pending';

  if not found then
    raise exception 'No se pudo acreditar el pedido';
  end if;

  return jsonb_build_object(
    'ok',true,'already_paid',false,'order_id',p_order_id,
    'new_entitlements',v_granted
  );
end;
$$;

-- Nunca exponer esta operación a usuarios anónimos o autenticados.
revoke all on function public.a51_confirm_paid_order(uuid,text) from public;
revoke all on function public.a51_confirm_paid_order(uuid,text) from anon;
revoke all on function public.a51_confirm_paid_order(uuid,text) from authenticated;
grant execute on function public.a51_confirm_paid_order(uuid,text) to service_role;
