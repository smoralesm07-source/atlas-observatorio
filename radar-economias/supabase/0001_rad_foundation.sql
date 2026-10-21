-- Radar de economías criminales · modelo para su proyecto Supabase propio.
--
-- No se aplica todavía: el prototipo publica el corte como JSON. Esta migración
-- fija la forma que tendrá al pasar a base de datos, con las mismas reglas que
-- el Observatorio de ATLAS:
--   * un corte con identidad (snapshot_id) y estado por fuente;
--   * la ausencia de una fuente es ausencia: NOT_CONSULTED nunca se lee como cero;
--   * las pantallas y ATLAS consumen contratos, no tablas;
--   * contratos SECURITY INVOKER sobre RLS ligado a la lista de usuarios habilitados.
-- Sólo crea objetos con prefijo rad_. No toca nada existente.

create table if not exists public.rad_source (
  code        text primary key,
  name        text not null,
  economy     text not null,
  kind        text not null check (kind in ('api','feed','catalog','curated','pending')),
  url         text,
  authority   text,
  legal_tier  smallint not null check (legal_tier between 0 and 2),
  does_not    text
);

create table if not exists public.rad_snapshot (
  snapshot_id          text primary key,
  generated_at         timestamptz not null,
  previous_snapshot_id text references public.rad_snapshot(snapshot_id),
  status               text not null default 'READY' check (status in ('READY','FAILED')),
  indicators           jsonb not null default '{}'::jsonb
);

create table if not exists public.rad_snapshot_source (
  snapshot_id    text not null references public.rad_snapshot(snapshot_id) on delete cascade,
  source_code    text not null references public.rad_source(code),
  status         text not null check (status in ('FRESH','ARCHIVE','DEGRADED','UNREACHABLE','NOT_CONSULTED')),
  consulted_at   timestamptz not null,
  records_in     integer not null default 0,
  records_kept   integer not null default 0,
  error          text,
  note           text,
  content_sha256 text,
  primary key (snapshot_id, source_code)
);

-- Un hecho observado. Nunca el contenido de una filtración ni datos de
-- personas naturales: target guarda organización, dominio, marca o red.
create table if not exists public.rad_event (
  snapshot_id   text not null references public.rad_snapshot(snapshot_id) on delete cascade,
  event_id      text not null,
  economy       text not null,
  source_code   text not null references public.rad_source(code),
  event_type    text not null,
  title         text not null,
  scope         text not null check (scope in ('CL','LATAM','GLOBAL')),
  event_date    date,
  first_seen    timestamptz not null,
  actor         text,
  target        jsonb not null default '{}'::jsonb,
  chile_link    jsonb,
  evidence      jsonb not null default '{}'::jsonb,
  attributes    jsonb not null default '{}'::jsonb,
  carried_from  text,
  -- Llaves de cruce con ATLAS. Se llenan al reconciliar contra el universo de
  -- entidades y de proveedores de pago; mientras tanto quedan nulas.
  target_domain text generated always as (lower(target->>'domain')) stored,
  target_rut    text,
  primary key (snapshot_id, event_id)
);

create index if not exists rad_event_domain_idx on public.rad_event (target_domain) where target_domain is not null;
create index if not exists rad_event_rut_idx on public.rad_event (target_rut) where target_rut is not null;
create index if not exists rad_event_economy_idx on public.rad_event (snapshot_id, economy);

-- Corte vigente: el último READY.
create or replace view public.rad_current_snapshot as
  select snapshot_id from public.rad_snapshot
   where status = 'READY' order by generated_at desc limit 1;

alter table public.rad_source          enable row level security;
alter table public.rad_snapshot        enable row level security;
alter table public.rad_snapshot_source enable row level security;
alter table public.rad_event           enable row level security;

-- Misma autorización que ATLAS: la lista aml_allowed_users (user_id, enabled).
-- En un proyecto separado se replica esa lista con las mismas cuentas de Entra.
do $$
declare t text;
begin
  foreach t in array array['rad_source','rad_snapshot','rad_snapshot_source','rad_event'] loop
    execute format('drop policy if exists %1$s_read on public.%1$s', t);
    execute format($p$create policy %1$s_read on public.%1$s for select to authenticated
                     using (exists (select 1 from public.aml_allowed_users au
                                     where au.user_id = auth.uid() and au.enabled))$p$, t);
  end loop;
end $$;

-- Contrato para la ficha de entidad de ATLAS: hechos del corte vigente que
-- tocan un RUT o un dominio. Lo externo es candidato: no se persiste en ATLAS
-- ni modifica la prioridad analítica de la entidad.
create or replace function public.rad_entity_exposure(p_rut text default null, p_domain text default null)
returns jsonb
language sql stable security invoker set search_path = public as $$
  with cur as (select snapshot_id from public.rad_current_snapshot),
  d as (select lower(regexp_replace(coalesce(p_domain, ''), '^(https?://)?(www\.)?', '')) as dom,
               upper(regexp_replace(coalesce(p_rut, ''), '[^0-9kK]', '', 'g')) as rut)
  select jsonb_build_object(
    'snapshot_id', (select snapshot_id from cur),
    'sources', (select coalesce(jsonb_agg(jsonb_build_object('code', s.source_code, 'status', s.status)), '[]')
                  from public.rad_snapshot_source s where s.snapshot_id = (select snapshot_id from cur)),
    'events', (select coalesce(jsonb_agg(to_jsonb(e) - 'snapshot_id' order by e.event_date desc nulls last), '[]')
                 from public.rad_event e, d
                where e.snapshot_id = (select snapshot_id from cur)
                  and ((d.rut <> '' and e.target_rut = d.rut)
                    or (d.dom <> '' and (e.target_domain = d.dom or e.target_domain like '%.' || d.dom))))
  );
$$;

-- Contrato para el panel sectorial: indicadores del corte vigente y estado de
-- cada fuente, para que una economía sin lectura se muestre como tal.
create or replace function public.rad_economy_overview()
returns jsonb
language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'snapshot_id', s.snapshot_id,
    'generated_at', s.generated_at,
    'indicators', s.indicators,
    'sources', (select coalesce(jsonb_agg(to_jsonb(x) - 'snapshot_id'), '[]')
                  from public.rad_snapshot_source x where x.snapshot_id = s.snapshot_id)
  )
  from public.rad_snapshot s
  where s.snapshot_id = (select snapshot_id from public.rad_current_snapshot);
$$;

revoke all on function public.rad_entity_exposure(text, text) from public, anon;
revoke all on function public.rad_economy_overview() from public, anon;
grant execute on function public.rad_entity_exposure(text, text) to authenticated;
grant execute on function public.rad_economy_overview() to authenticated;
