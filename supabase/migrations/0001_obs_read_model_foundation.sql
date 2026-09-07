-- ATLAS Observatorio · read-model foundation
--
-- Additive only. No existing ATLAS object is modified, renamed or dropped.
-- Authorization reuses the aml_allowed_users allowlist that already governs
-- ATLAS reads, so the Observatorio inherits its accounts and its governance.

create table if not exists public.obs_snapshot (
  snapshot_id     text primary key,
  generated_at    timestamptz not null default now(),
  status          text not null default 'BUILDING' check (status in ('BUILDING','READY','FAILED')),
  source_versions jsonb not null default '{}'::jsonb,
  row_counts      jsonb not null default '{}'::jsonb,
  error_detail    text,
  published_at    timestamptz
);
comment on table public.obs_snapshot is
  'Una fila por corrida de materializacion. Los lectores siguen la fila READY mas reciente.';

create table if not exists public.obs_entity (
  entity_id         text primary key,
  rut               text,
  rut_search        text,
  name              text not null,
  name_search       text not null,
  entity_type       text,
  region            text,
  commune           text,
  source_count      integer not null default 0,
  sources           text[] not null default '{}'::text[],
  roles             text[] not null default '{}'::text[],
  is_uaf_observed   boolean not null default false,
  is_sanctioned     boolean not null default false,
  uaf_sector        text,
  ipa3_score        numeric,
  ipa3_band         text,
  event_count       integer not null default 0,
  finding_count     integer not null default 0,
  alert_count       integer not null default 0,
  sanction_count    integer not null default 0,
  max_finding_score numeric,
  snapshot_id       text not null,
  refreshed_at      timestamptz not null default now()
);
comment on column public.obs_entity.rut_search is
  'RUT reducido a digitos y DV. Permite buscar con puntos, con guion o sin formato usando un indice.';
comment on column public.obs_entity.source_count is
  'Cuantas fuentes gobernadas tienen registro de esta entidad. La ausencia de una fuente es ausencia, nunca cero.';
comment on column public.obs_entity.ipa3_score is
  'Prioridad analitica IPA3 (0-100). No es probabilidad de LA/FT ni imputacion de incumplimiento.';

-- PRESENT rows only. Absence is derived at read time against the catalog, so a
-- source that was never consulted is never rendered as one that found nothing.
create table if not exists public.obs_entity_source (
  entity_id     text not null references public.obs_entity(entity_id) on delete cascade,
  source_code   text not null,
  status        text not null check (status in ('PRESENT','ABSENT','NOT_CONSULTED','ERROR')),
  record_count  integer,
  last_event_at timestamptz,
  detail        jsonb not null default '{}'::jsonb,
  primary key (entity_id, source_code)
);

create table if not exists public.obs_alert (
  alert_id     text primary key,
  family       text not null,
  pattern_type text not null,
  scope_type   text not null,
  scope_id     text,
  scope_label  text,
  strength     numeric,
  priority     text,
  title        text,
  summary      text,
  payload      jsonb not null default '{}'::jsonb,
  snapshot_id  text not null,
  refreshed_at timestamptz not null default now()
);
comment on table public.obs_alert is
  'Alertas de patron: la superficie de anticipacion. strength y priority llegan precalculadas desde el productor.';

create table if not exists public.obs_finding (
  finding_key       text primary key,
  finding_id        text,
  finding_type      text not null,
  entity_id         text,
  title             text,
  region            text,
  commune           text,
  score_explore     numeric,
  score_supervise   numeric,
  score_investigate numeric,
  source_count      integer,
  evidence_count    integer,
  payload           jsonb not null default '{}'::jsonb,
  snapshot_id       text not null,
  refreshed_at      timestamptz not null default now()
);

create table if not exists public.obs_source_health (
  source_code               text primary key,
  source_name               text not null,
  source_class              text,
  integration_mode          text,
  authoritative_source      text,
  software_status           text,
  data_status               text,
  last_source_record_at     timestamptz,
  last_successful_ingest_at timestamptz,
  records_24h               bigint,
  error_rate_24h            numeric,
  notes                     text,
  snapshot_id               text not null,
  refreshed_at              timestamptz not null default now()
);
comment on table public.obs_source_health is
  'Las fuentes gobernadas con su estado declarado, para que la interfaz pueda explicar por que una fuente esta en silencio.';

-- Search: an accent-insensitive trigram index for names, a prefix index for RUT.
create index if not exists obs_entity_name_search_trgm
  on public.obs_entity using gin (name_search gin_trgm_ops);
create index if not exists obs_entity_rut_idx
  on public.obs_entity (rut) where rut is not null;
create index if not exists obs_entity_rut_search_idx
  on public.obs_entity (rut_search text_pattern_ops) where rut_search is not null;
create index if not exists obs_entity_priority_idx
  on public.obs_entity (ipa3_score desc nulls last);
create index if not exists obs_entity_region_idx on public.obs_entity (region);
create index if not exists obs_entity_flags_idx
  on public.obs_entity (is_sanctioned, is_uaf_observed);

create index if not exists obs_entity_source_source_idx
  on public.obs_entity_source (source_code, status);
create index if not exists obs_finding_entity_idx
  on public.obs_finding (entity_id) where entity_id is not null;
create index if not exists obs_finding_type_idx on public.obs_finding (finding_type);
create index if not exists obs_alert_family_idx on public.obs_alert (family, strength desc);
create index if not exists obs_alert_scope_idx on public.obs_alert (scope_type, scope_id);

-- Fail closed: an authenticated user outside the allowlist reads zero rows.
alter table public.obs_snapshot      enable row level security;
alter table public.obs_entity        enable row level security;
alter table public.obs_entity_source enable row level security;
alter table public.obs_alert         enable row level security;
alter table public.obs_finding       enable row level security;
alter table public.obs_source_health enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'obs_snapshot','obs_entity','obs_entity_source',
    'obs_alert','obs_finding','obs_source_health'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_allowed_read', t);
    execute format($p$
      create policy %I on public.%I
        for select to authenticated
        using (exists (
          select 1 from public.aml_allowed_users au
          where au.user_id = (select auth.uid()) and au.enabled))
    $p$, t || '_allowed_read', t);
  end loop;
end
$$;
