-- ATLAS Observatorio · Territorio comuna · propuesta narrativa v3.
-- Agrega una matriz navegable por sector Ley 19.913 y cohorte sin alterar el IGR.

create or replace function public.obs_territory_commune_context_v2(p_territory_id text)
returns jsonb
language sql
stable
security invoker
set search_path = public, extensions, pg_temp
as $$
with t as (
  select territory_id, commune_name, commune_search, region_name
  from public.obs_territory
  where territory_id = p_territory_id
), entities as (
  select e.*
  from public.obs_entity e
  where e.commune is not null
    and public.obs_normalize_text(e.commune) = (select commune_search from t)
), uaf as (
  select s.*
  from public.obs_uaf_subject s
  where s.commune is not null
    and public.obs_normalize_text(s.commune) = (select commune_search from t)
), potentials as (
  select p.*
  from public.obs_uaf_potential_candidate p
  where p.commune is not null
    and public.obs_normalize_text(p.commune) = (select commune_search from t)
), entity_classified as (
  select
    e.entity_id,
    coalesce(u.uaf_sector, p.implied_sector, e.uaf_sector) as sector,
    (coalesce(e.is_sanctioned, false) or coalesce(e.sanction_count, 0) > 0
      or coalesce(u.sanction_count, 0) > 0 or coalesce(u.sanction_evidence_count, 0) > 0) as sanctioned,
    exists (
      select 1 from public.atlas_press_entity_link l
      where l.link_status = 'RESOLVED'
        and (l.canonical_entity_id = e.entity_id
          or (e.rut_search is not null and public.obs_normalize_text(coalesce(l.canonical_rut, '')) = e.rut_search))
    ) as press,
    (coalesce(u.is_osfl, false) or exists (
      select 1 from public.obs_osfl_entity o
      where o.entity_id = e.entity_id
         or (e.rut_search is not null and o.rut_search = e.rut_search)
    )) as osfl,
    exists (
      select 1 from public.aml_v_fintech_entity_current f
      where coalesce(f.entity_status, 'ACTIVE') <> 'EXCLUDED'
        and (f.atlas_entity_id = e.entity_id
          or (e.rut_search is not null and public.obs_normalize_text(coalesce(f.rut, '')) = e.rut_search))
    ) as fintech
  from entities e
  left join lateral (
    select s.uaf_sector, s.sanction_count, s.sanction_evidence_count, s.is_osfl
    from uaf s
    where s.entity_id = e.entity_id
       or (e.rut_search is not null and s.rut_search = e.rut_search)
    order by (s.entity_id = e.entity_id) desc, s.refreshed_at desc nulls last
    limit 1
  ) u on true
  left join lateral (
    select x.implied_sector
    from potentials x
    where x.entity_id = e.entity_id
       or (e.rut_search is not null and x.rut_search = e.rut_search)
    order by (x.entity_id = e.entity_id) desc, x.ivo_score desc nulls last
    limit 1
  ) p on true
), sector_universe as (
  select uaf_sector as sector from uaf where nullif(trim(uaf_sector), '') is not null
  union
  select implied_sector from potentials where nullif(trim(implied_sector), '') is not null
  union
  select sector from entity_classified where nullif(trim(sector), '') is not null
), matrix as (
  select
    s.sector,
    (select count(*) from uaf u where u.uaf_sector = s.sector)::bigint as so_count,
    (select count(*) from potentials p where p.implied_sector = s.sector)::bigint as potential_count,
    (select count(*) from entity_classified e where e.sector = s.sector and e.sanctioned)::bigint as sanctioned_count,
    (select count(*) from entity_classified e where e.sector = s.sector and e.press)::bigint as press_count,
    (select count(*) from entity_classified e where e.sector = s.sector and e.osfl)::bigint as osfl_count,
    (select count(*) from entity_classified e where e.sector = s.sector and e.fintech)::bigint as fintech_count
  from sector_universe s
), matrix_ranked as (
  select *,
    (so_count + potential_count + sanctioned_count + press_count + osfl_count + fintech_count)::bigint as total_count
  from matrix
  order by (so_count + potential_count + sanctioned_count + press_count + osfl_count + fintech_count) desc, sector
), metrics as (
  select
    (select count(*) from entities)::bigint as entities,
    (select count(*) from uaf)::bigint as uaf,
    (select count(*) from potentials)::bigint as potential,
    (select count(*) from entity_classified where sanctioned)::bigint as sanctioned,
    (select count(*) from entity_classified where press)::bigint as press,
    (select count(*) from entity_classified where osfl)::bigint as osfl,
    (select count(*) from public.aml_v_fintech_entity_current f
      where f.commune is not null
        and public.obs_normalize_text(f.commune) = (select commune_search from t)
        and coalesce(f.entity_status, 'ACTIVE') <> 'EXCLUDED')::bigint as fintech
)
select case when not exists(select 1 from t) then null else jsonb_build_object(
  'contract', 'ATLAS_OBS_TERRITORY_COMMUNE_CONTEXT_V2',
  'territory_id', (select territory_id from t),
  'commune_name', (select commune_name from t),
  'region_name', (select region_name from t),
  'metrics', (select to_jsonb(m) from metrics m),
  'sectors', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'sector', x.sector,
      'so_count', x.so_count,
      'potential_count', x.potential_count,
      'total_count', x.so_count + x.potential_count
    ) order by x.so_count + x.potential_count desc, x.sector), '[]'::jsonb)
    from matrix_ranked x
  ),
  'matrix', (
    select coalesce(jsonb_agg(to_jsonb(x) order by x.total_count desc, x.sector), '[]'::jsonb)
    from matrix_ranked x
  ),
  'semantics', 'Los conteos de entidades, SO, potenciales, sanciones, prensa, OSFL y fintech describen universos observados en la comuna y no forman parte del IGR. Las marcas pertenecen a las entidades o a sus fuentes respectivas.'
) end;
$$;

revoke all on function public.obs_territory_commune_context_v2(text) from public, anon;
grant execute on function public.obs_territory_commune_context_v2(text) to authenticated, service_role;

comment on function public.obs_territory_commune_context_v2(text) is
  'Contexto comunal para Territorio. Incluye KPIs y matriz interactiva por sector Ley 19.913 y cohorte, separada semánticamente del IGR.';
