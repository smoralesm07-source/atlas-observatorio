-- ATLAS Core · universo territorial amplio v1
-- Esta migración refleja la fundación aplicada en Supabase. El refresco monolítico
-- original se conserva por trazabilidad; la migración siguiente introduce el
-- cargador operacional por lotes para evitar transacciones largas.

create schema if not exists atlas_core;
revoke all on schema atlas_core from public;
grant usage on schema atlas_core to authenticated, service_role;

create table if not exists atlas_core.territory_entity (
  rut text primary key,
  name text not null,
  name_search text not null,
  entity_type text not null default 'EMPRESA',
  territory_id text,
  commune_key text,
  commune_name text,
  region_name text,
  geo_source text not null,
  in_res boolean not null default false,
  in_sii boolean not null default false,
  in_atlas boolean not null default false,
  in_uaf boolean not null default false,
  in_osfl boolean not null default false,
  in_potential boolean not null default false,
  in_fintech boolean not null default false,
  sii_status text,
  sii_activity_start_date date,
  sii_termination_date date,
  res_constitution_date date,
  atlas_entity_id text,
  source_count smallint not null default 0,
  refreshed_at timestamptz not null default now()
);

create index if not exists atlas_core_territory_entity_territory_idx
  on atlas_core.territory_entity (territory_id);
create index if not exists atlas_core_territory_entity_status_idx
  on atlas_core.territory_entity (territory_id, sii_status);
create index if not exists atlas_core_territory_entity_name_prefix_idx
  on atlas_core.territory_entity (territory_id, name_search text_pattern_ops);
create index if not exists atlas_core_territory_entity_atlas_idx
  on atlas_core.territory_entity (atlas_entity_id)
  where atlas_entity_id is not null;

alter table atlas_core.territory_entity enable row level security;
drop policy if exists atlas_core_territory_entity_read on atlas_core.territory_entity;
create policy atlas_core_territory_entity_read
  on atlas_core.territory_entity for select
  to authenticated
  using (true);
revoke all on atlas_core.territory_entity from public, anon;
grant select on atlas_core.territory_entity to authenticated, service_role;

create table if not exists atlas_core.territory_snapshot (
  territory_id text primary key,
  commune_name text not null,
  region_name text not null,
  universe_total bigint not null default 0,
  sii_total bigint not null default 0,
  sii_active bigint not null default 0,
  sii_terminated bigint not null default 0,
  res_total bigint not null default 0,
  atlas_observed bigint not null default 0,
  uaf_observed bigint not null default 0,
  osfl_observed bigint not null default 0,
  potential_observed bigint not null default 0,
  fintech_observed bigint not null default 0,
  atlas_coverage_pct numeric(8,4),
  refreshed_at timestamptz not null default now()
);

alter table atlas_core.territory_snapshot enable row level security;
drop policy if exists atlas_core_territory_snapshot_read on atlas_core.territory_snapshot;
create policy atlas_core_territory_snapshot_read
  on atlas_core.territory_snapshot for select
  to authenticated
  using (true);
revoke all on atlas_core.territory_snapshot from public, anon;
grant select on atlas_core.territory_snapshot to authenticated, service_role;

create or replace function atlas_core.refresh_territory_universe()
returns jsonb
language plpgsql
security definer
set search_path = public, atlas_core, pg_temp
as $$
declare
  v_refresh timestamptz := clock_timestamp();
  v_entities bigint;
  v_mapped bigint;
begin
  create temp table _atlas_geo_map on commit drop as
  select g.raw_commune,
         t.territory_id,
         t.commune_search as commune_key,
         t.commune_name,
         t.region_name
  from (
    select distinct coalesce(nullif(btrim(tax_commune), ''), nullif(btrim(social_commune), '')) as raw_commune
    from public.aml_res_company
    where coalesce(nullif(btrim(tax_commune), ''), nullif(btrim(social_commune), '')) is not null
  ) g
  left join public.obs_territory t
    on t.commune_search = public.obs_commune_key(g.raw_commune);
  create index on _atlas_geo_map(raw_commune);

  insert into atlas_core.territory_entity (
    rut, name, name_search, entity_type, territory_id, commune_key, commune_name, region_name, geo_source,
    in_res, in_sii, in_atlas, in_uaf, in_osfl, in_potential, in_fintech,
    sii_status, sii_activity_start_date, sii_termination_date, res_constitution_date,
    atlas_entity_id, source_count, refreshed_at
  )
  select
    r.rut,
    coalesce(nullif(s.legal_name, ''), nullif(r.legal_name, ''), r.rut),
    public.obs_normalize_text(coalesce(nullif(s.legal_name, ''), nullif(r.legal_name, ''), r.rut)),
    'EMPRESA',
    gm.territory_id, gm.commune_key, gm.commune_name, gm.region_name,
    case when nullif(btrim(r.tax_commune), '') is not null then 'RES_TAX' else 'RES_SOCIAL' end,
    true, s.rut is not null, false, false, false, false, false,
    s.current_status, s.activity_start_date, s.termination_date, r.constitution_date,
    null, (1 + case when s.rut is not null then 1 else 0 end)::smallint, v_refresh
  from public.aml_res_company r
  left join public.aml_sii_registry_company s on s.rut = r.rut
  left join _atlas_geo_map gm
    on gm.raw_commune = coalesce(nullif(btrim(r.tax_commune), ''), nullif(btrim(r.social_commune), ''))
  on conflict (rut) do update set
    name = excluded.name,
    name_search = excluded.name_search,
    entity_type = excluded.entity_type,
    territory_id = excluded.territory_id,
    commune_key = excluded.commune_key,
    commune_name = excluded.commune_name,
    region_name = excluded.region_name,
    geo_source = excluded.geo_source,
    in_res = true,
    in_sii = excluded.in_sii,
    sii_status = excluded.sii_status,
    sii_activity_start_date = excluded.sii_activity_start_date,
    sii_termination_date = excluded.sii_termination_date,
    res_constitution_date = excluded.res_constitution_date,
    refreshed_at = v_refresh;

  insert into atlas_core.territory_entity (
    rut, name, name_search, entity_type, territory_id, commune_key, commune_name, region_name, geo_source,
    in_res, in_sii, in_atlas, in_uaf, in_osfl, in_potential, in_fintech,
    sii_status, sii_activity_start_date, sii_termination_date, atlas_entity_id, source_count, refreshed_at
  )
  select distinct on (e.rut)
    e.rut, e.name, public.obs_normalize_text(e.name), coalesce(e.entity_type, 'ENTIDAD'),
    t.territory_id, t.commune_search, t.commune_name, t.region_name, 'ATLAS_OBSERVED',
    false, s.rut is not null, true, coalesce(e.is_uaf_observed,false),
    coalesce('RADAR_OSFL'=any(e.sources),false), false, false,
    s.current_status, s.activity_start_date, s.termination_date, e.entity_id, 1, v_refresh
  from public.obs_entity e
  left join public.aml_sii_registry_company s on s.rut=e.rut
  left join public.obs_territory t on t.commune_search=public.obs_commune_key(e.commune)
  where e.rut is not null and btrim(e.rut)<>'' and e.commune is not null and btrim(e.commune)<>''
  order by e.rut, e.source_count desc nulls last, e.refreshed_at desc nulls last
  on conflict (rut) do update set
    in_atlas = true,
    in_uaf = atlas_core.territory_entity.in_uaf or excluded.in_uaf,
    in_osfl = atlas_core.territory_entity.in_osfl or excluded.in_osfl,
    atlas_entity_id = excluded.atlas_entity_id,
    entity_type = case when atlas_core.territory_entity.in_res then atlas_core.territory_entity.entity_type else excluded.entity_type end,
    territory_id = case when atlas_core.territory_entity.in_res then atlas_core.territory_entity.territory_id else excluded.territory_id end,
    commune_key = case when atlas_core.territory_entity.in_res then atlas_core.territory_entity.commune_key else excluded.commune_key end,
    commune_name = case when atlas_core.territory_entity.in_res then atlas_core.territory_entity.commune_name else excluded.commune_name end,
    region_name = case when atlas_core.territory_entity.in_res then atlas_core.territory_entity.region_name else excluded.region_name end,
    geo_source = case when atlas_core.territory_entity.in_res then atlas_core.territory_entity.geo_source else excluded.geo_source end,
    refreshed_at = v_refresh;

  insert into atlas_core.territory_entity (
    rut, name, name_search, entity_type, territory_id, commune_key, commune_name, region_name, geo_source,
    in_res, in_sii, in_atlas, in_uaf, in_osfl, in_potential, in_fintech,
    sii_status, sii_activity_start_date, sii_termination_date, atlas_entity_id, source_count, refreshed_at
  )
  select
    u.rut, u.name, public.obs_normalize_text(u.name), coalesce(u.entity_type,'ENTIDAD'),
    t.territory_id, t.commune_search, t.commune_name, t.region_name, 'UAF',
    false, s.rut is not null, false, true, coalesce(u.is_osfl,false), false, false,
    coalesce(u.sii_status,s.current_status), coalesce(u.sii_activity_start_date,s.activity_start_date), coalesce(u.sii_termination_date,s.termination_date), u.entity_id, 1, v_refresh
  from public.obs_uaf_subject u
  left join public.aml_sii_registry_company s on s.rut=u.rut
  left join public.obs_territory t on t.commune_search=public.obs_commune_key(u.commune)
  where u.rut is not null and u.commune is not null and btrim(u.commune)<>''
  on conflict (rut) do update set
    in_uaf = true,
    in_osfl = atlas_core.territory_entity.in_osfl or excluded.in_osfl,
    refreshed_at = v_refresh;

  insert into atlas_core.territory_entity (
    rut, name, name_search, entity_type, territory_id, commune_key, commune_name, region_name, geo_source,
    in_res, in_sii, in_atlas, in_uaf, in_osfl, in_potential, in_fintech,
    sii_status, sii_activity_start_date, atlas_entity_id, source_count, refreshed_at
  )
  select
    p.rut, p.name, public.obs_normalize_text(p.name), 'EMPRESA',
    t.territory_id, t.commune_search, t.commune_name, t.region_name, 'POTENTIAL_UAF',
    false, s.rut is not null, false, false, false, true, false,
    coalesce(p.sii_status,s.current_status), coalesce(p.sii_activity_start_date,s.activity_start_date), p.entity_id, 1, v_refresh
  from public.obs_uaf_potential_candidate p
  left join public.aml_sii_registry_company s on s.rut=p.rut
  left join public.obs_territory t on t.commune_search=public.obs_commune_key(p.commune)
  where p.rut is not null and p.commune is not null and btrim(p.commune)<>''
  on conflict (rut) do update set
    in_potential = true,
    refreshed_at = v_refresh;

  insert into atlas_core.territory_entity (
    rut, name, name_search, entity_type, territory_id, commune_key, commune_name, region_name, geo_source,
    in_res, in_sii, in_atlas, in_uaf, in_osfl, in_potential, in_fintech,
    sii_status, sii_activity_start_date, sii_termination_date, atlas_entity_id, source_count, refreshed_at
  )
  select distinct on (o.rut)
    o.rut, o.name, public.obs_normalize_text(o.name), 'OSFL',
    t.territory_id, t.commune_search, t.commune_name, t.region_name, 'OSFL',
    false, s.rut is not null, false, coalesce(o.has_uaf_direct,false), true, coalesce(o.has_uaf_potential,false), false,
    coalesce(o.current_status,s.current_status), coalesce(o.activity_start_date,s.activity_start_date), coalesce(o.termination_date,s.termination_date), o.entity_id, 1, v_refresh
  from public.obs_osfl_entity o
  left join public.aml_sii_registry_company s on s.rut=o.rut
  left join public.obs_territory t on t.commune_search=public.obs_commune_key(o.commune)
  where o.rut is not null and o.commune is not null and btrim(o.commune)<>''
  order by o.rut, o.refreshed_at desc nulls last
  on conflict (rut) do update set
    in_osfl = true,
    in_uaf = atlas_core.territory_entity.in_uaf or excluded.in_uaf,
    in_potential = atlas_core.territory_entity.in_potential or excluded.in_potential,
    refreshed_at = v_refresh;

  insert into atlas_core.territory_entity (
    rut, name, name_search, entity_type, territory_id, commune_key, commune_name, region_name, geo_source,
    in_res, in_sii, in_atlas, in_uaf, in_osfl, in_potential, in_fintech,
    sii_status, sii_activity_start_date, atlas_entity_id, source_count, refreshed_at
  )
  select distinct on (f.rut)
    f.rut, coalesce(nullif(f.legal_name,''),nullif(f.brand,''),f.rut), public.obs_normalize_text(coalesce(nullif(f.legal_name,''),nullif(f.brand,''),f.rut)), 'FINTECH',
    t.territory_id, t.commune_search, t.commune_name, t.region_name, 'FINTECH',
    false, s.rut is not null, f.atlas_entity_id is not null, coalesce(f.has_uaf_public,false), false, false, true,
    s.current_status, coalesce(f.sii_activity_start_date,s.activity_start_date), f.atlas_entity_id, 1, v_refresh
  from public.aml_v_fintech_entity_current f
  left join public.aml_sii_registry_company s on s.rut=f.rut
  left join public.obs_territory t on t.commune_search=public.obs_commune_key(f.commune)
  where f.rut is not null and f.commune is not null and btrim(f.commune)<>'' and coalesce(f.entity_status,'ACTIVE')<>'EXCLUDED'
  order by f.rut, f.confidence desc nulls last, f.refreshed_at desc nulls last
  on conflict (rut) do update set
    in_fintech = true,
    in_atlas = atlas_core.territory_entity.in_atlas or excluded.in_atlas,
    in_uaf = atlas_core.territory_entity.in_uaf or excluded.in_uaf,
    atlas_entity_id = coalesce(atlas_core.territory_entity.atlas_entity_id, excluded.atlas_entity_id),
    refreshed_at = v_refresh;

  delete from atlas_core.territory_entity where refreshed_at < v_refresh;

  update atlas_core.territory_entity
  set source_count = (
    (case when in_res then 1 else 0 end) +
    (case when in_sii then 1 else 0 end) +
    (case when in_atlas then 1 else 0 end) +
    (case when in_uaf then 1 else 0 end) +
    (case when in_osfl then 1 else 0 end) +
    (case when in_potential then 1 else 0 end) +
    (case when in_fintech then 1 else 0 end)
  )::smallint;

  insert into atlas_core.territory_snapshot (
    territory_id, commune_name, region_name, universe_total, sii_total, sii_active, sii_terminated,
    res_total, atlas_observed, uaf_observed, osfl_observed, potential_observed, fintech_observed,
    atlas_coverage_pct, refreshed_at
  )
  select
    t.territory_id, t.commune_name, t.region_name,
    count(e.rut)::bigint,
    count(e.rut) filter (where e.in_sii)::bigint,
    count(e.rut) filter (where e.sii_status='ACTIVE_AS_PUBLISHED')::bigint,
    count(e.rut) filter (where e.sii_status='TERMINATED_AS_PUBLISHED')::bigint,
    count(e.rut) filter (where e.in_res)::bigint,
    count(e.rut) filter (where e.in_atlas)::bigint,
    count(e.rut) filter (where e.in_uaf)::bigint,
    count(e.rut) filter (where e.in_osfl)::bigint,
    count(e.rut) filter (where e.in_potential)::bigint,
    count(e.rut) filter (where e.in_fintech)::bigint,
    case when count(e.rut)=0 then null else round(100.0 * count(e.rut) filter (where e.in_atlas) / count(e.rut),4) end,
    v_refresh
  from public.obs_territory t
  left join atlas_core.territory_entity e on e.territory_id=t.territory_id
  group by t.territory_id, t.commune_name, t.region_name
  on conflict (territory_id) do update set
    commune_name=excluded.commune_name,
    region_name=excluded.region_name,
    universe_total=excluded.universe_total,
    sii_total=excluded.sii_total,
    sii_active=excluded.sii_active,
    sii_terminated=excluded.sii_terminated,
    res_total=excluded.res_total,
    atlas_observed=excluded.atlas_observed,
    uaf_observed=excluded.uaf_observed,
    osfl_observed=excluded.osfl_observed,
    potential_observed=excluded.potential_observed,
    fintech_observed=excluded.fintech_observed,
    atlas_coverage_pct=excluded.atlas_coverage_pct,
    refreshed_at=excluded.refreshed_at;

  select count(*), count(*) filter (where territory_id is not null)
  into v_entities, v_mapped
  from atlas_core.territory_entity;

  return jsonb_build_object(
    'contract','ATLAS_CORE_TERRITORY_UNIVERSE_REFRESH_V1',
    'entities',v_entities,
    'territorialized',v_mapped,
    'unmapped',v_entities-v_mapped,
    'territories',(select count(*) from atlas_core.territory_snapshot),
    'refreshed_at',v_refresh
  );
end;
$$;

revoke all on function atlas_core.refresh_territory_universe() from public, anon, authenticated;
grant execute on function atlas_core.refresh_territory_universe() to service_role;

create or replace function public.obs_territory_universe_summary(p_territory_id text)
returns jsonb
language sql
stable
security invoker
set search_path = public, atlas_core, pg_temp
as $$
  select case when s.territory_id is null then null else jsonb_build_object(
    'contract','ATLAS_OBS_TERRITORY_UNIVERSE_V1',
    'territory_id',s.territory_id,
    'commune_name',s.commune_name,
    'region_name',s.region_name,
    'metrics',jsonb_build_object(
      'universe_total',s.universe_total,
      'sii_total',s.sii_total,
      'sii_active',s.sii_active,
      'sii_terminated',s.sii_terminated,
      'res_total',s.res_total,
      'atlas_observed',s.atlas_observed,
      'uaf_observed',s.uaf_observed,
      'osfl_observed',s.osfl_observed,
      'potential_observed',s.potential_observed,
      'fintech_observed',s.fintech_observed,
      'atlas_coverage_pct',s.atlas_coverage_pct
    ),
    'semantics','Universo territorial amplio por RUT con geografia disponible. RES aporta la cobertura geografica masiva; SII aporta vigencia cuando existe coincidencia. Las capas UAF, OSFL, potenciales, fintech y Atlas son marcas analiticas superpuestas.',
    'refreshed_at',s.refreshed_at
  ) end
  from atlas_core.territory_snapshot s
  where s.territory_id=p_territory_id;
$$;
revoke all on function public.obs_territory_universe_summary(text) from public, anon;
grant execute on function public.obs_territory_universe_summary(text) to authenticated, service_role;

create or replace function public.obs_territory_universe_directory(
  p_territory_id text,
  p_q text default null,
  p_status text default 'ALL',
  p_order text default 'coverage',
  p_limit integer default 80,
  p_offset integer default 0
)
returns table(
  rut text,
  name text,
  entity_type text,
  region text,
  commune text,
  geo_source text,
  sii_status text,
  in_res boolean,
  in_sii boolean,
  in_atlas boolean,
  in_uaf boolean,
  in_osfl boolean,
  in_potential boolean,
  in_fintech boolean,
  atlas_entity_id text,
  source_count integer,
  total_count bigint
)
language sql
stable
security invoker
set search_path = public, atlas_core, pg_temp
as $$
with q as (
  select public.obs_normalize_text(coalesce(trim(p_q),'')) as name_q,
         regexp_replace(upper(coalesce(trim(p_q),'')), '[^0-9K]', '', 'g') as rut_q
), filtered as (
  select e.*
  from atlas_core.territory_entity e, q
  where e.territory_id=p_territory_id
    and case upper(coalesce(p_status,'ALL'))
      when 'ACTIVE' then e.sii_status='ACTIVE_AS_PUBLISHED'
      when 'TERMINATED' then e.sii_status='TERMINATED_AS_PUBLISHED'
      when 'ATLAS' then e.in_atlas
      else true
    end
    and (
      nullif(trim(p_q),'') is null
      or e.name_search like q.name_q || '%'
      or regexp_replace(upper(e.rut), '[^0-9K]', '', 'g') like q.rut_q || '%'
    )
), counted as (
  select f.*, count(*) over() as total_count from filtered f
)
select
  c.rut,c.name,c.entity_type,c.region_name,c.commune_name,c.geo_source,c.sii_status,
  c.in_res,c.in_sii,c.in_atlas,c.in_uaf,c.in_osfl,c.in_potential,c.in_fintech,
  c.atlas_entity_id,c.source_count::integer,c.total_count
from counted c
order by
  case when lower(coalesce(p_order,'coverage'))='name' then c.name end asc nulls last,
  case when lower(coalesce(p_order,'coverage'))='coverage' then c.source_count end desc nulls last,
  case when lower(coalesce(p_order,'coverage'))='coverage' then c.in_atlas::integer end desc nulls last,
  c.name asc
limit greatest(1,least(coalesce(p_limit,80),200))
offset greatest(0,coalesce(p_offset,0));
$$;
revoke all on function public.obs_territory_universe_directory(text,text,text,text,integer,integer) from public, anon;
grant execute on function public.obs_territory_universe_directory(text,text,text,text,integer,integer) to authenticated, service_role;
