create or replace function public.obs_uaf_potential_directory_v2(
  p_q text default null,
  p_sector text default null,
  p_region text default null,
  p_activity text default null,
  p_industry text default null,
  p_order text default 'relevancia',
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
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
  with filtrado as (
    select
      p.rut, p.entity_id, p.name, p.implied_sector, p.matched_activity,
      t.economic_sector, p.region, p.commune, p.sales_band_size, p.sales_band_uf,
      p.detection_tier, p.evidence_class, p.ivo_score, p.ivo_band,
      p.res_available, p.uaf_sanction_events, p.flags
    from public.obs_uaf_potential_candidate p
    left join public.aml_entity_tax_profile t on t.entity_id = p.entity_id
    where
      (nullif(trim(p_sector), '') is null or p.implied_sector = p_sector)
      and (nullif(trim(p_region), '') is null or p.region = p_region)
      and (nullif(trim(p_activity), '') is null or p.matched_activity = p_activity)
      and (
        nullif(trim(p_industry), '') is null
        or (p_industry = 'SIN INDUSTRIA SII OBSERVADA' and t.economic_sector is null)
        or t.economic_sector = p_industry
      )
      and (
        nullif(trim(p_q), '') is null
        or p.name ilike '%' || trim(p_q) || '%'
        or p.rut ilike '%' || regexp_replace(trim(p_q), '[^0-9kK]', '', 'g') || '%'
        or coalesce(p.implied_sector, '') ilike '%' || trim(p_q) || '%'
        or coalesce(p.matched_activity, '') ilike '%' || trim(p_q) || '%'
        or coalesce(t.economic_sector, '') ilike '%' || trim(p_q) || '%'
        or coalesce(p.region, '') ilike '%' || trim(p_q) || '%'
        or coalesce(p.commune, '') ilike '%' || trim(p_q) || '%'
      )
  ), contado as (
    select count(*) over () as total_count, f.* from filtrado f
  )
  select
    c.rut, c.entity_id, c.name, c.implied_sector, c.matched_activity,
    c.economic_sector, c.region, c.commune, c.sales_band_size, c.sales_band_uf,
    c.detection_tier, c.evidence_class, c.ivo_score, c.ivo_band,
    c.res_available, c.uaf_sanction_events, c.flags, c.total_count
  from contado c
  order by
    case when lower(coalesce(p_order, '')) = 'nombre' then c.name end asc nulls last,
    case when lower(coalesce(p_order, '')) = 'ivo' then c.ivo_score end desc nulls last,
    case when lower(coalesce(p_order, '')) = 'senales' then
      coalesce(c.uaf_sanction_events, 0) + coalesce(cardinality(c.flags), 0) + case when c.res_available then 1 else 0 end
    end desc nulls last,
    case when lower(coalesce(p_order, 'relevancia')) = 'relevancia' then c.ivo_score end desc nulls last,
    c.name asc
  limit greatest(1, least(coalesce(p_limit, 80), 200))
  offset greatest(0, coalesce(p_offset, 0));
$function$;

grant execute on function public.obs_uaf_potential_directory_v2(text,text,text,text,text,text,integer,integer) to authenticated;
