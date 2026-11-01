-- AREA51: notificaciones internas. Solo nuevas tablas, sin alterar existentes.
create table if not exists public.pc_customer_notifications (
 id uuid primary key default gen_random_uuid(),
 customer_email text null,
 kind text not null check (kind in ('new_product','support_reply')),
 title text not null check (char_length(title) between 1 and 180),
 message text not null check (char_length(message) between 1 and 1000),
 product_id uuid null references public.products(id) on delete set null,
 source_event_id text null unique,
 created_at timestamptz not null default now(),
 constraint pc_notification_email_normalized check (
  customer_email is null or (customer_email = lower(btrim(customer_email)) and length(customer_email) between 3 and 254)
 )
);
create index if not exists pc_notifications_customer_time_idx
 on public.pc_customer_notifications(customer_email,created_at desc);
alter table public.pc_customer_notifications enable row level security;
revoke all on public.pc_customer_notifications from anon, authenticated;
create table if not exists public.pc_customer_notification_reads (
 customer_email text not null,
 notification_id uuid not null references public.pc_customer_notifications(id) on delete cascade,
 read_at timestamptz not null default now(),
 primary key (customer_email,notification_id),
 constraint pc_notification_read_email_normalized check (
  customer_email = lower(btrim(customer_email)) and length(customer_email) between 3 and 254
 )
);
alter table public.pc_customer_notification_reads enable row level security;
revoke all on public.pc_customer_notification_reads from anon, authenticated;
-- El acceso de clientes sera exclusivamente por API con sesion verificada.
