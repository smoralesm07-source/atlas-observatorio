alter table public.atlas_user_presence
  add column if not exists is_online boolean not null default true,
  add column if not exists signed_out_at timestamptz;

comment on column public.atlas_user_presence.is_online is
  'Indica cierre explícito de sesión; el estado efectivo también exige heartbeat reciente.';

comment on column public.atlas_user_presence.signed_out_at is
  'Momento de cierre explícito de sesión. Puede ser nulo si la desconexión se infiere por heartbeat vencido.';
