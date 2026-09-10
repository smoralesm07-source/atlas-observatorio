-- Corrige el buscador de los directorios de Universo SO.
--
-- El filtro de RUT convertía cualquier consulta puramente alfabética (p. ej.
-- "sartor") en una cadena vacía. El patrón resultante era %% y hacía verdadera
-- toda la condición OR, por lo que el directorio devolvía la cohorte completa.
-- El filtro de RUT sólo participa ahora cuando la consulta contiene caracteres
-- válidos de RUT y compara ambos lados normalizados (sin puntos ni guion).

create or replace function public.obs_uaf_subject_directory_v2(
  p_cohort text default 'TODOS'::text,
  p_value text default null::text,
  p_q text default null::text,
  p_sector text default null::text,
  p_region text default null::text,
  p_industry text default null::text,
  p_order text default 'relevancia'::text,
  p_limit integer default 80,
  p_offset integer default 0
)
returns table(
  rut text, entity_id text, name text, subject_nature text, uaf_sector text,
  sii_status text, sii_activity_start_date date, sii_termination_date date,
  activity_years integer, economic_sector text, main_activity text,
  sales_band text, workers bigint, region text, commune text,
  igr_score numeric, igr_level text, is_osfl boolean, is_state_supplier boolean,
  supplier_amount_12m numeric, sanction_count integer, sanction_evidence_count integer,
  sanction_last_date date, has_press boolean, press_evidence_count integer,
  alert_count integer, ipf_score numeric, ipf_band text, attention_motive text,
  ipf_percentile numeric, evidence_count bigint, total_count bigint
)
language sql
stable
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
  with silenciosos as (
    select sector_canonical
    from public.obs_uaf_reporting_sector
    where silence_5y and sector_canonical is not null
  ), filtrado as (
    select s.*
    from public.obs_uaf_subject s
    where
      case upper(coalesce(p_cohort, 'TODOS'))
        when 'TERMINO_GIRO'     then s.sii_status = 'TERMINATED_AS_PUBLISHED'
        when 'ACTIVO'           then s.sii_status = 'ACTIVE_AS_PUBLISHED'
        when 'SIN_PERFIL_SII'   then s.sii_status = 'SIN_PERFIL_SII'
        when 'OSFL'             then s.is_osfl
        when 'PROVEEDOR_ESTADO' then s.is_state_supplier
        when 'SANCIONADO'       then s.sanction_evidence_count > 0 or s.sanction_count > 0
        when 'PRENSA'           then s.press_evidence_count > 0 or s.has_press
        when 'CON_SENAL'        then s.alert_count > 0
        when 'IGR_ALTO'         then s.igr_level in ('Alto', 'Muy alto')
        when 'IGR_MUY_ALTO'     then s.igr_level = 'Muy alto'
        when 'REGION'           then s.region = p_value
        when 'SECTOR'           then s.uaf_sector = p_value
        when 'INDUSTRIA'        then s.economic_sector = p_value
        when 'TERMINO_ANO'      then s.termination_year = nullif(p_value, '')::integer
        when 'ATENCION'         then s.attention_rank is not null
        when 'MOTIVO'           then s.attention_motive = p_value
        when 'IPF_ALTO'         then s.ipf_band in ('MUY_ALTA', 'ALTA')
        when 'GIRO_ATIPICO'     then s.activity_atypicality >= 0.90
        when 'CAMBIO_ACTIVIDAD' then s.sii_activity_changed
        when 'SIN_TERRITORIO'   then s.region is null and s.sii_status <> 'SIN_PERFIL_SII'
        when 'SECTOR_SIN_ROS'   then s.uaf_sector in (select sector_canonical from silenciosos)
        when 'TODOS'            then true
        else false
      end
      and (nullif(trim(p_sector), '') is null or s.uaf_sector = p_sector)
      and (nullif(trim(p_region), '') is null or s.region = p_region)
      and (nullif(trim(p_industry), '') is null or s.economic_sector = p_industry)
      and (
        nullif(trim(p_q), '') is null
        or s.name ilike '%' || trim(p_q) || '%'
        or coalesce(s.uaf_sector, '') ilike '%' || trim(p_q) || '%'
        or coalesce(s.region, '') ilike '%' || trim(p_q) || '%'
        or coalesce(s.commune, '') ilike '%' || trim(p_q) || '%'
        or coalesce(s.main_activity, '') ilike '%' || trim(p_q) || '%'
        or coalesce(s.economic_sector, '') ilike '%' || trim(p_q) || '%'
        or (
          nullif(regexp_replace(trim(p_q), '[^0-9kK]', '', 'g'), '') is not null
          and regexp_replace(coalesce(s.rut, ''), '[^0-9kK]', '', 'g') ilike '%' || regexp_replace(trim(p_q), '[^0-9kK]', '', 'g') || '%'
        )
      )
  ), contado as (
    select count(*) over () as total_count, f.*
    from filtrado f
  )
  select
    c.rut, c.entity_id, c.name, c.subject_nature, c.uaf_sector,
    c.sii_status, c.sii_activity_start_date, c.sii_termination_date,
    c.activity_years, c.economic_sector, c.main_activity,
    c.sales_band, c.workers, c.region, c.commune,
    c.igr_score, c.igr_level, c.is_osfl, c.is_state_supplier,
    c.supplier_amount_12m, c.sanction_count, c.sanction_evidence_count,
    c.sanction_last_date, c.has_press, c.press_evidence_count,
    c.alert_count, c.ipf_score, c.ipf_band, c.attention_motive,
    c.ipf_percentile,
    (select count(*) from public.obs_uaf_evidence ev where ev.rut = c.rut) as evidence_count,
    c.total_count
  from contado c
  order by
    case when lower(coalesce(p_order, '')) = 'nombre' then c.name end asc nulls last,
    case when lower(coalesce(p_order, '')) = 'ipf' then c.ipf_score end desc nulls last,
    case when lower(coalesce(p_order, '')) = 'senales' then
      coalesce(c.sanction_evidence_count, 0) + coalesce(c.press_evidence_count, 0) + coalesce(c.alert_count, 0)
      + case when c.is_osfl then 1 else 0 end
      + case when c.attention_motive is not null then 1 else 0 end
    end desc nulls last,
    case when lower(coalesce(p_order, 'relevancia')) = 'relevancia' then c.attention_rank end asc nulls last,
    case when lower(coalesce(p_order, 'relevancia')) = 'relevancia' then (c.sanction_evidence_count > 0 or c.sanction_count > 0)::int end desc nulls last,
    case when lower(coalesce(p_order, 'relevancia')) = 'relevancia' then c.ipf_score end desc nulls last,
    c.name asc
  limit greatest(1, least(coalesce(p_limit, 80), 200))
  offset greatest(0, coalesce(p_offset, 0));
$function$;

create or replace function public.obs_uaf_potential_directory_v2(
  p_q text default null::text,
  p_sector text default null::text,
  p_region text default null::text,
  p_activity text default null::text,
  p_industry text default null::text,
  p_order text default 'relevancia'::text,
  p_limit integer default 80,
  p_offset integer default 0
)
returns table(
  rut text, entity_id text, name text, implied_sector text, matched_activity text,
  economic_sector text, region text, commune text, sales_band_size text,
  sales_band_uf text, detection_tier text, evidence_class text, ivo_score numeric,
  ivo_band text, res_available boolean, uaf_sanction_events integer,
  flags text[], total_count bigint
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
        or coalesce(p.implied_sector, '') ilike '%' || trim(p_q) || '%'
        or coalesce(p.matched_activity, '') ilike '%' || trim(p_q) || '%'
        or coalesce(t.economic_sector, '') ilike '%' || trim(p_q) || '%'
        or coalesce(p.region, '') ilike '%' || trim(p_q) || '%'
        or coalesce(p.commune, '') ilike '%' || trim(p_q) || '%'
        or (
          nullif(regexp_replace(trim(p_q), '[^0-9kK]', '', 'g'), '') is not null
          and regexp_replace(coalesce(p.rut, ''), '[^0-9kK]', '', 'g') ilike '%' || regexp_replace(trim(p_q), '[^0-9kK]', '', 'g') || '%'
        )
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
