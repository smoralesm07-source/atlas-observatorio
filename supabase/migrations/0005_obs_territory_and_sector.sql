-- ATLAS Observatorio · territorio y sector
--
-- TERRITORIO. La autoridad vigente es IGR v2A (IGR-2A-1.0.0, efectiva
-- 2026-08-26): 100% amenaza territorial CEAD-LA. La version v4 que vive en
-- aml_beta_territory_igr_snapshot_v4 esta RETIRADA y no se usa aqui.
--
-- En ATLAS el IGR v2A lo descarga el navegador desde un JSON crudo de GitHub y
-- se muestra dentro de un iframe: sin read model, sin identidad de corte y sin
-- RLS. El Observatorio lo trae desde la base y lo publica como contrato.
--
-- El contrato excluye explicitamente del indice la vulnerabilidad sectorial, la
-- densidad de sujetos obligados, la brecha de cobertura, ICR, IRAR, IPA, IVO y
-- las sanciones de entidad. Esas cifras se publican AL LADO del IGR, nunca
-- dentro, y las columnas ctx_* lo dicen.

create table if not exists public.obs_territory (
  territory_id      text primary key,
  region_code       text,
  region_name       text not null,
  commune_code      text,
  commune_name      text not null,
  commune_search    text not null,
  year              integer,
  period            text,
  igr_score         numeric,
  igr_level         text,
  igr_confidence    numeric,
  layer_weights     jsonb not null default '{}'::jsonb,
  layers            jsonb not null default '{}'::jsonb,
  interpretation    text,
  score_version     text,
  -- Contexto descriptivo, fuera del indice por contrato.
  ctx_entities      integer not null default 0,
  ctx_uaf_observed  integer not null default 0,
  ctx_sanctioned    integer not null default 0,
  ctx_alerted       integer not null default 0,
  ctx_findings      integer not null default 0,
  snapshot_id       text not null,
  refreshed_at      timestamptz not null default now()
);
comment on table public.obs_territory is
  'IGR v2A por comuna: 100% amenaza territorial CEAD-LA. Contexto territorial, no atribucion a entidades ni probabilidad de LA/FT.';
comment on column public.obs_territory.igr_confidence is
  'Confianza CEAD publicada por separado del score. Menor cobertura no es menor riesgo.';
comment on column public.obs_territory.ctx_entities is
  'Descriptivo. El contrato IGR v2A excluye la densidad de sujetos obligados del indice.';

create table if not exists public.obs_sector (
  uaf_sector_canonical     text primary key,
  uaf_sector_id            integer,
  sector_search            text not null,
  registry_labels          text[] not null default '{}'::text[],
  subject_count            integer not null default 0,
  natural_person_subjects  integer,
  vulnerability_index      numeric,
  risk_inherent_1_5        numeric,
  key_role                 text,
  ipf_mean                 numeric,
  ipf_p90                  numeric,
  band_muy_alta            integer,
  band_alta                integer,
  band_media               integer,
  band_baja                integer,
  band_minima              integer,
  sanctioned_subjects      integer,
  sanction_events          integer,
  sanction_rate_per_100    numeric,
  sii_active               integer,
  sii_terminated           integer,
  sii_absent               integer,
  sii_coverage_pct         numeric,
  atypical_activity_subjects integer,
  median_sales_band_rank   numeric,
  top_region               text,
  top_region_share_pct     numeric,
  activities               jsonb not null default '[]'::jsonb,
  snapshot_id              text not null,
  refreshed_at             timestamptz not null default now()
);
comment on table public.obs_sector is
  'Lectura del padron UAF por sector obligado. La tasa sancionatoria describe lo publicado por la UAF, no la conducta agregada del sector.';
comment on column public.obs_sector.vulnerability_index is
  'Vulnerabilidad estructural del sector (seis dimensiones, escala 1-5 adaptada a 0-100). Describe el sector, nunca la conducta de una entidad inscrita.';

create index if not exists obs_territory_region_idx on public.obs_territory (region_name);
create index if not exists obs_territory_score_idx  on public.obs_territory (igr_score desc nulls last);
create index if not exists obs_territory_search_idx on public.obs_territory (commune_search);
create index if not exists obs_sector_ipf_idx       on public.obs_sector (ipf_mean desc nulls last);
create index if not exists obs_sector_subjects_idx  on public.obs_sector (subject_count desc);

alter table public.obs_territory enable row level security;
alter table public.obs_sector    enable row level security;

do $$
declare t text;
begin
  foreach t in array array['obs_territory','obs_sector'] loop
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

------------------------------------------------------------ materializacion

create or replace function public.obs_refresh_territory(p_snapshot_id text)
returns integer
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_url text := 'https://raw.githubusercontent.com/smoralesm07-source/Radar_delictual/'
             || 'radar-data/data/processed/cead_geographic_score_v1.json';
  v_resp extensions.http_response;
  v_rows jsonb;
  v_n integer;
begin
  select * into v_resp from extensions.http_get(v_url);

  if v_resp.status <> 200 then
    raise warning 'obs_refresh_territory: la fuente CEAD respondio HTTP %', v_resp.status;
    return -1;
  end if;

  v_rows := v_resp.content::jsonb;
  if jsonb_typeof(v_rows) <> 'array' or jsonb_array_length(v_rows) = 0 then
    raise warning 'obs_refresh_territory: la fuente CEAD no devolvio un arreglo con filas';
    return -1;
  end if;

  -- El contexto por comuna se agrega una sola vez. Resolverlo dentro de un
  -- lateral normalizaba la comuna de las 44 mil entidades una vez por cada una
  -- de las 345 comunas CEAD, y la corrida no terminaba.
  create temp table _obs_ctx on commit drop as
  select public.obs_normalize_text(e.commune)                        as commune_search,
         count(*)::int                                               as entities,
         count(*) filter (where e.is_uaf_observed)::int              as uaf_observed,
         count(*) filter (where e.is_sanctioned)::int                as sanctioned,
         count(*) filter (where e.alert_count > 0)::int              as alerted,
         coalesce(sum(e.finding_count), 0)::int                      as findings
  from public.obs_entity e
  where e.commune is not null
  group by 1;

  create unique index on _obs_ctx (commune_search);

  -- Solo se reemplaza cuando la fuente respondio bien. Un territorio
  -- desactualizado pero honesto es preferible a uno vacio.
  delete from public.obs_territory;

  insert into public.obs_territory (
    territory_id, region_code, region_name, commune_code, commune_name, commune_search,
    year, period, igr_score, igr_level, igr_confidence,
    layer_weights, layers, interpretation, score_version,
    ctx_entities, ctx_uaf_observed, ctx_sanctioned, ctx_alerted, ctx_findings,
    snapshot_id, refreshed_at)
  select
    r->>'territory_id',
    r->>'region_code',
    r->>'region_name',
    r->>'commune_code',
    r->>'commune_name',
    public.obs_normalize_text(r->>'commune_name'),
    nullif(r->>'year','')::int,
    r->>'period',
    nullif(r->>'score','')::numeric,
    r->>'level',
    nullif(r->>'confidence','')::numeric,
    coalesce(r->'layer_weights','{}'::jsonb),
    coalesce(r->'layers','{}'::jsonb),
    r->>'interpretation',
    r->>'score_version',
    coalesce(c.entities, 0),
    coalesce(c.uaf_observed, 0),
    coalesce(c.sanctioned, 0),
    coalesce(c.alerted, 0),
    coalesce(c.findings, 0),
    p_snapshot_id, now()
  from jsonb_array_elements(v_rows) r
  left join _obs_ctx c
    on c.commune_search = public.obs_normalize_text(r->>'commune_name');

  get diagnostics v_n = row_count;
  return v_n;
end
$$;

create or replace function public.obs_refresh_sector(p_snapshot_id text)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_n integer;
begin
  delete from public.obs_sector;

  insert into public.obs_sector (
    uaf_sector_canonical, uaf_sector_id, sector_search, registry_labels,
    subject_count, natural_person_subjects, vulnerability_index,
    risk_inherent_1_5, key_role, ipf_mean, ipf_p90,
    band_muy_alta, band_alta, band_media, band_baja, band_minima,
    sanctioned_subjects, sanction_events, sanction_rate_per_100,
    sii_active, sii_terminated, sii_absent, sii_coverage_pct,
    atypical_activity_subjects, median_sales_band_rank,
    top_region, top_region_share_pct, activities,
    snapshot_id, refreshed_at)
  select
    s.uaf_sector_canonical,
    s.uaf_sector_id,
    public.obs_normalize_text(s.uaf_sector_canonical),
    coalesce(s.registry_labels, '{}'::text[]),
    coalesce(s.subject_count, 0),
    s.natural_person_subjects,
    coalesce(s.vulnerability_index, v.vulnerability_index),
    v.risk_inherent_1_5,
    v.key_role,
    s.ipf_mean, s.ipf_p90,
    s.band_muy_alta, s.band_alta, s.band_media, s.band_baja, s.band_minima,
    s.sanctioned_subjects, s.sanction_events, s.sanction_rate_per_100,
    s.sii_active, s.sii_terminated, s.sii_absent, s.sii_coverage_pct,
    s.atypical_activity_subjects, s.median_sales_band_rank,
    s.top_region, s.top_region_share_pct,
    coalesce(act.rows, '[]'::jsonb),
    p_snapshot_id, now()
  from public.aml_uaf_obligated_sector_snapshot s
  left join lateral (
    select * from public.aml_uaf_sector_vulnerability_ref v0
    where v0.uaf_sector_id = s.uaf_sector_id
       or public.obs_normalize_text(v0.sector_canonical_name)
          = public.obs_normalize_text(s.uaf_sector_canonical)
    order by (v0.uaf_sector_id = s.uaf_sector_id) desc
    limit 1
  ) v on true
  left join lateral (
    -- Giros caracteristicos: mide el padron vigente, no es una tabla normativa
    -- de correspondencias.
    select jsonb_agg(x order by x->>'concentration' desc) rows
    from (
      select jsonb_build_object(
               'activity_name', a.activity_name,
               'registered_count', a.registered_count,
               'universe_count', a.universe_count,
               'concentration', a.concentration,
               'sector_support', a.sector_support,
               'coherence', a.sector_activity_coherence) x
      from public.aml_uaf_sector_activity_profile a
      where public.obs_normalize_text(a.uaf_sector_canonical)
            = public.obs_normalize_text(s.uaf_sector_canonical)
      order by a.concentration desc nulls last
      limit 12
    ) y
  ) act on true;

  get diagnostics v_n = row_count;
  return v_n;
end
$$;

-- Un corte del Observatorio son tres materializaciones que deben compartir
-- identidad. Territorio depende de una fuente externa: si no responde, la
-- corrida NO falla, conserva lo publicado y el corte lo declara.
create or replace function public.obs_refresh_full(p_snapshot_id text default null)
returns public.obs_snapshot
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.obs_snapshot;
  v_territory integer;
  v_sector integer;
begin
  v_row := public.obs_refresh_all(p_snapshot_id);

  v_territory := public.obs_refresh_territory(v_row.snapshot_id);
  v_sector    := public.obs_refresh_sector(v_row.snapshot_id);

  update public.obs_snapshot
     set row_counts = row_counts || jsonb_build_object(
           'obs_territory', case when v_territory >= 0 then v_territory
                                 else (select count(*) from public.obs_territory) end,
           'obs_sector', v_sector,
           'territorio_actualizado', v_territory >= 0)
   where snapshot_id = v_row.snapshot_id
  returning * into v_row;

  return v_row;
end
$$;

do $$
declare sig text;
begin
  foreach sig in array array[
    'public.obs_refresh_territory(text)',
    'public.obs_refresh_sector(text)',
    'public.obs_refresh_full(text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', sig);
    execute format('grant execute on function %s to service_role', sig);
  end loop;
end
$$;

-- La agenda materializa las tres partes bajo un mismo corte.
select cron.alter_job(
  job_id  => (select jobid from cron.job where jobname = 'atlas-observatorio-refresh'),
  command => $job$set statement_timeout to '600s'; select public.obs_refresh_full();$job$
);
