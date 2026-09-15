create table if not exists public.atlas_user_presence (
  user_id uuid primary key,
  email text not null,
  current_route text not null,
  current_section text not null,
  last_seen_at timestamptz not null default now(),
  first_seen_at timestamptz not null default now()
);

create table if not exists public.atlas_user_activity (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  email text not null,
  route text not null,
  section text not null,
  operation text not null check (operation in ('session_start', 'page_view')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists atlas_user_presence_last_seen_idx
  on public.atlas_user_presence (last_seen_at desc);

create index if not exists atlas_user_activity_created_idx
  on public.atlas_user_activity (created_at desc);

create index if not exists atlas_user_activity_user_created_idx
  on public.atlas_user_activity (user_id, created_at desc);

alter table public.atlas_user_presence enable row level security;
alter table public.atlas_user_activity enable row level security;

revoke all on table public.atlas_user_presence from anon, authenticated;
revoke all on table public.atlas_user_activity from anon, authenticated;

grant select, insert, update on table public.atlas_user_presence to authenticated;
grant insert on table public.atlas_user_activity to authenticated;

drop policy if exists atlas_presence_select_own on public.atlas_user_presence;
create policy atlas_presence_select_own
  on public.atlas_user_presence
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists atlas_presence_insert_own on public.atlas_user_presence;
create policy atlas_presence_insert_own
  on public.atlas_user_presence
  for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.aml_allowed_users a
      where a.user_id = auth.uid()
        and a.enabled = true
    )
  );

drop policy if exists atlas_presence_update_own on public.atlas_user_presence;
create policy atlas_presence_update_own
  on public.atlas_user_presence
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.aml_allowed_users a
      where a.user_id = auth.uid()
        and a.enabled = true
    )
  );

drop policy if exists atlas_activity_insert_own on public.atlas_user_activity;
create policy atlas_activity_insert_own
  on public.atlas_user_activity
  for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.aml_allowed_users a
      where a.user_id = auth.uid()
        and a.enabled = true
    )
    and char_length(route) between 1 and 80
    and char_length(section) between 1 and 120
    and jsonb_typeof(metadata) = 'object'
  );

comment on table public.atlas_user_presence is
  'Estado liviano de presencia de usuarios habilitados de ATLAS. last_seen_at se usa como heartbeat; no contiene consultas ni contenido analítico.';

comment on table public.atlas_user_activity is
  'Historial de navegación de alto nivel de ATLAS. Registra secciones, no búsquedas ni identificadores de entidades.';
