-- ATLAS Observatorio · Territorio · espacio analítico comunal v2
-- Separa el IGR territorial del universo de entidades y habilita navegación
-- paginada por SO, potenciales, sanciones, prensa, OSFL, fintech y sectores UAF.

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
), sector_rows as (
  select uaf_sector as sector, count(*)::bigint as so_count, 0::bigint as potential_count
  from uaf
  where uaf_sector is not null and trim(uaf_sector) <> ''
  group by uaf_sector
  union all
  select implied_sector as sector, 0::bigint, count(*)::bigint
  from potentials
  where implied_sector is not null and trim(implied_sector) <> ''
  group by implied_sector
), sectors as (
  select sector,
         sum(so_count)::bigint as so_count,
         sum(potential_count)::bigint as potential_count,
         sum(so_count + potential_count)::bigint as total_count
  from sector_rows
  group by sector
  order by sum(so_count + potential_count) desc, sector
), metrics as (
  select
    (select count(*) from entities)::bigint as entities,
    (select count(*) from uaf)::bigint as uaf,
    (select count(*) from potentials)::bigint as potential,
    (select count(*) from entities e where coalesce(e.is_sanctioned, false) or coalesce(e.sanction_count, 0) > 0)::bigint as sanctioned,
    (select count(*) from entities e where exists (
      select 1 from public.atlas_press_entity_link l
      where l.link_status = 'RESOLVED'
        and (l.canonical_entity_id = e.entity_id
          or (e.rut_search is not null and public.obs_normalize_text(coalesce(l.canonical_rut, '')) = e.rut_search))
    ))::bigint as press,
    (select count(*) from entities e where exists (
      select 1 from public.obs_osfl_entity o
      where o.entity_id = e.entity_id
        or (e.rut_search is not null and o.rut_search = e.rut_search)
    ))::bigint as osfl,
    (select count(*) from public.aml_v_fintech_entity_current f
      where f.commune is not null
        and public.obs_normalize_text(f.commune) = (select commune_search from t)
        and coalesce(f.entity_status, 'ACTIVE') <> 'EXCLUDED'
    )::bigint as fintech
)
select case when not exists(select 1 from t) then null else jsonb_build_object(
  'contract', 'ATLAS_OBS_TERRITORY_COMMUNE_CONTEXT_V2',
  'territory_id', (select territory_id from t),
  'commune_name', (select commune_name from t),
  'region_name', (select region_name from t),
  'metrics', (select to_jsonb(m) from metrics m),
  'sectors', (select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) from sectors s),
  'semantics', 'Los conteos de entidades, SO, potenciales, sanciones, prensa, OSFL y fintech describen universos observados en la comuna y no forman parte del IGR. Las marcas pertenecen a las entidades o a sus fuentes respectivas.'
) end;
$$;

revoke all on function public.obs_territory_commune_context_v2(text) from public, anon;
grant execute on function public.obs_territory_commune_context_v2(text) to authenticated, service_role;

create or replace function public.obs_territory_entity_directory_v2(
  p_territory_id text,
  p_segment text default 'ALL',
  p_q text default null,
  p_sector text default null,
  p_order text default 'relevance',
  p_limit integer default 80,
  p_offset integer default 0
)
returns table(
  entity_id text,
  rut text,
  name text,
  entity_type text,
  uaf_sector text,
  potential_sector text,
  economic_sector text,
  main_activity text,
  region text,
  commune text,
  sii_status text,
  sii_termination_date date,
  is_uaf_observed boolean,
  is_potential boolean,
  is_osfl boolean,
  is_fintech boolean,
  fintech_vertical text,
  is_state_supplier boolean,
  sanction_count integer,
  press_evidence_count integer,
  alert_count integer,
  finding_count integer,
  priority_score numeric,
  priority_band text,
  priority_metric text,
  attention_motive text,
  source_count integer,
  total_count bigint
)
language sql
stable
security invoker
set search_path = public, extensions, pg_temp
as $$
with t as (
  select commune_search
  from public.obs_territory
  where territory_id = p_territory_id
), enriched as (
  select
    e.entity_id, e.rut, e.name, e.entity_type,
    coalesce(u.uaf_sector, e.uaf_sector) as uaf_sector,
    pot.implied_sector as potential_sector,
    coalesce(u.economic_sector, tax.economic_sector) as economic_sector,
    coalesce(u.main_activity, tax.main_activity, osfl.main_activity) as main_activity,
    e.region, e.commune,
    coalesce(u.sii_status, tax.current_status) as sii_status,
    coalesce(u.sii_termination_date, tax.termination_date) as sii_termination_date,
    (coalesce(e.is_uaf_observed, false) or u.rut is not null) as is_uaf_observed,
    (pot.rut is not null) as is_potential,
    (coalesce(u.is_osfl, false) or osfl.entity_id is not null) as is_osfl,
    (fin.fintech_id is not null) as is_fintech,
    fin.primary_vertical as fintech_vertical,
    (coalesce(u.is_state_supplier, false) or exists (
      select 1 from public.obs_spend_actor sa
      where sa.entity_id = e.entity_id and sa.actor_role = 'SUPPLIER'
    )) as is_state_supplier,
    greatest(coalesce(e.sanction_count, 0), coalesce(u.sanction_count, 0), coalesce(u.sanction_evidence_count, 0))::integer as sanction_count,
    coalesce(press.press_evidence_count, u.press_evidence_count, 0)::integer as press_evidence_count,
    greatest(coalesce(e.alert_count, 0), coalesce(u.alert_count, 0))::integer as alert_count,
    coalesce(e.finding_count, 0)::integer as finding_count,
    case when u.rut is not null then u.ipf_score
         when pot.rut is not null then pot.ivo_score
         else e.ipa3_score end as priority_score,
    case when u.rut is not null then u.ipf_band
         when pot.rut is not null then pot.ivo_band
         else e.ipa3_band end as priority_band,
    case when u.rut is not null then 'IPF'
         when pot.rut is not null then 'IVO'
         else 'IPA' end as priority_metric,
    u.attention_motive,
    e.source_count
  from public.obs_entity e
  left join lateral (
    select s.*
    from public.obs_uaf_subject s
    where s.entity_id = e.entity_id
       or (e.rut_search is not null and s.rut_search = e.rut_search)
    order by (s.entity_id = e.entity_id) desc, s.refreshed_at desc nulls last
    limit 1
  ) u on true
  left join lateral (
    select p.*
    from public.obs_uaf_potential_candidate p
    where p.entity_id = e.entity_id
       or (e.rut_search is not null and p.rut_search = e.rut_search)
    order by (p.entity_id = e.entity_id) desc, p.ivo_score desc nulls last
    limit 1
  ) pot on true
  left join lateral (
    select p.current_status, p.termination_date, p.main_activity, p.economic_sector
    from public.aml_entity_tax_profile p
    where p.entity_id = e.entity_id
    order by p.commercial_year desc nulls last
    limit 1
  ) tax on true
  left join lateral (
    select o.entity_id, o.main_activity
    from public.obs_osfl_entity o
    where o.entity_id = e.entity_id
       or (e.rut_search is not null and o.rut_search = e.rut_search)
    order by o.refreshed_at desc nulls last
    limit 1
  ) osfl on true
  left join lateral (
    select f.fintech_id, f.primary_vertical
    from public.aml_v_fintech_entity_current f
    where f.atlas_entity_id = e.entity_id
       or (e.rut_search is not null and public.obs_normalize_text(coalesce(f.rut, '')) = e.rut_search)
    order by f.confidence desc nulls last, f.refreshed_at desc nulls last
    limit 1
  ) fin on true
  left join lateral (
    select count(distinct l.press_entity_id)::integer as press_evidence_count
    from public.atlas_press_entity_link l
    where l.link_status = 'RESOLVED'
      and (l.canonical_entity_id = e.entity_id
        or (e.rut_search is not null and public.obs_normalize_text(coalesce(l.canonical_rut, '')) = e.rut_search))
  ) press on true
  where e.commune is not null
    and public.obs_normalize_text(e.commune) = (select commune_search from t)
), filtered as (
  select x.*
  from enriched x
  where
    case upper(coalesce(p_segment, 'ALL'))
      when 'ALL' then true
      when 'SO' then x.is_uaf_observed
      when 'SANCTIONED' then x.sanction_count > 0
      when 'PRESS' then x.press_evidence_count > 0
      when 'OSFL' then x.is_osfl
      when 'FINTECH' then x.is_fintech
      else true
    end
    and (nullif(trim(p_sector), '') is null or coalesce(x.uaf_sector, x.potential_sector) = p_sector)
    and (
      nullif(trim(p_q), '') is null
      or x.name ilike '%' || trim(p_q) || '%'
      or coalesce(x.rut, '') ilike '%' || regexp_replace(trim(p_q), '[^0-9kK]', '', 'g') || '%'
      or coalesce(x.uaf_sector, '') ilike '%' || trim(p_q) || '%'
      or coalesce(x.potential_sector, '') ilike '%' || trim(p_q) || '%'
      or coalesce(x.economic_sector, '') ilike '%' || trim(p_q) || '%'
      or coalesce(x.main_activity, '') ilike '%' || trim(p_q) || '%'
      or coalesce(x.fintech_vertical, '') ilike '%' || trim(p_q) || '%'
    )
), counted as (
  select count(*) over () as total_count, f.*
  from filtered f
)
select
  c.entity_id, c.rut, c.name, c.entity_type, c.uaf_sector, c.potential_sector,
  c.economic_sector, c.main_activity, c.region, c.commune, c.sii_status,
  c.sii_termination_date, c.is_uaf_observed, c.is_potential, c.is_osfl,
  c.is_fintech, c.fintech_vertical, c.is_state_supplier, c.sanction_count,
  c.press_evidence_count, c.alert_count, c.finding_count, c.priority_score,
  c.priority_band, c.priority_metric, c.attention_motive, c.source_count,
  c.total_count
from counted c
order by
  case when lower(coalesce(p_order, '')) = 'name' then c.name end asc nulls last,
  case when lower(coalesce(p_order, '')) = 'score' then c.priority_score end desc nulls last,
  case when lower(coalesce(p_order, '')) = 'signals' then
    c.sanction_count + c.press_evidence_count + c.alert_count + c.finding_count
    + case when c.is_osfl then 1 else 0 end + case when c.is_fintech then 1 else 0 end
  end desc nulls last,
  case when lower(coalesce(p_order, 'relevance')) = 'relevance' then
    c.sanction_count + c.press_evidence_count + c.alert_count + c.finding_count
    + case when c.is_uaf_observed then 2 else 0 end + case when c.is_potential then 1 else 0 end
  end desc nulls last,
  case when lower(coalesce(p_order, 'relevance')) = 'relevance' then c.priority_score end desc nulls last,
  c.name asc
limit greatest(1, least(coalesce(p_limit, 80), 200))
offset greatest(0, coalesce(p_offset, 0));
$$;

revoke all on function public.obs_territory_entity_directory_v2(text,text,text,text,text,integer,integer) from public, anon;
grant execute on function public.obs_territory_entity_directory_v2(text,text,text,text,text,integer,integer) to authenticated, service_role;

create or replace function public.obs_territory_potential_directory_v2(
  p_territory_id text,
  p_q text default null,
  p_sector text default null,
  p_order text default 'relevance',
  p_limit integer default 80,
  p_offset integer default 0
)
returns table(
  rut text,
  entity_id text,
  name text,
  implied_sector text,
  matched_activity text,
  economic_sector text,
  region text,
  commune text,
  sales_band_size text,
  sales_band_uf text,
  detection_tier text,
  evidence_class text,
  ivo_score numeric,
  ivo_band text,
  res_available boolean,
  uaf_sanction_events integer,
  flags text[],
  total_count bigint
)
language sql
stable
security invoker
set search_path = public, extensions, pg_temp
as $$
with t as (
  select commune_search from public.obs_territory where territory_id = p_territory_id
), filtered as (
  select
    p.rut, p.entity_id, p.name, p.implied_sector, p.matched_activity,
    tax.economic_sector, p.region, p.commune, p.sales_band_size, p.sales_band_uf,
    p.detection_tier, p.evidence_class, p.ivo_score, p.ivo_band,
    p.res_available, p.uaf_sanction_events, p.flags
  from public.obs_uaf_potential_candidate p
  left join lateral (
    select x.economic_sector
    from public.aml_entity_tax_profile x
    where x.entity_id = p.entity_id
    order by x.commercial_year desc nulls last
    limit 1
  ) tax on true
  where p.commune is not null
    and public.obs_normalize_text(p.commune) = (select commune_search from t)
    and (nullif(trim(p_sector), '') is null or p.implied_sector = p_sector)
    and (
      nullif(trim(p_q), '') is null
      or p.name ilike '%' || trim(p_q) || '%'
      or p.rut ilike '%' || regexp_replace(trim(p_q), '[^0-9kK]', '', 'g') || '%'
      or coalesce(p.implied_sector, '') ilike '%' || trim(p_q) || '%'
      or coalesce(p.matched_activity, '') ilike '%' || trim(p_q) || '%'
      or coalesce(tax.economic_sector, '') ilike '%' || trim(p_q) || '%'
    )
), counted as (
  select count(*) over () as total_count, f.* from filtered f
)
select c.rut, c.entity_id, c.name, c.implied_sector, c.matched_activity,
       c.economic_sector, c.region, c.commune, c.sales_band_size, c.sales_band_uf,
       c.detection_tier, c.evidence_class, c.ivo_score, c.ivo_band,
       c.res_available, c.uaf_sanction_events, c.flags, c.total_count
from counted c
order by
  case when lower(coalesce(p_order, '')) = 'name' then c.name end asc nulls last,
  case when lower(coalesce(p_order, '')) = 'score' then c.ivo_score end desc nulls last,
  case when lower(coalesce(p_order, '')) = 'signals' then coalesce(c.uaf_sanction_events,0) + coalesce(cardinality(c.flags),0) + case when c.res_available then 1 else 0 end end desc nulls last,
  case when lower(coalesce(p_order, 'relevance')) = 'relevance' then c.ivo_score end desc nulls last,
  c.name asc
limit greatest(1, least(coalesce(p_limit,80),200))
offset greatest(0,coalesce(p_offset,0));
$$;

revoke all on function public.obs_territory_potential_directory_v2(text,text,text,text,integer,integer) from public, anon;
grant execute on function public.obs_territory_potential_directory_v2(text,text,text,text,integer,integer) to authenticated, service_role;

comment on function public.obs_territory_commune_context_v2(text) is 'Resumen navegable del ecosistema observado en una comuna, separado del IGR.';
comment on function public.obs_territory_entity_directory_v2(text,text,text,text,text,integer,integer) is 'Directorio comunal paginado de entidades con filtros SO, sanciones, prensa, OSFL y fintech.';
comment on function public.obs_territory_potential_directory_v2(text,text,text,text,integer,integer) is 'Directorio comunal paginado de potenciales SO.';
