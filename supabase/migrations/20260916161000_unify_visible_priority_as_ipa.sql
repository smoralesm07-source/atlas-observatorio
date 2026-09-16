-- Atlas: unificación del indicador visible de prioridad.
-- La interfaz usa IPA como único score principal. Los nombres técnicos ipa3_*
-- se conservan internamente por compatibilidad e histórico. IPF permanece sólo
-- como benchmark interno y no se expone como score competidor en este contrato.

create or replace function public.obs_uaf_subject_directory_v4(
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
  rut text,
  entity_id text,
  name text,
  subject_nature text,
  uaf_sector text,
  sii_status text,
  sii_activity_start_date date,
  sii_termination_date date,
  activity_years integer,
  economic_sector text,
  main_activity text,
  sales_band text,
  workers bigint,
  region text,
  commune text,
  igr_score numeric,
  igr_level text,
  is_osfl boolean,
  is_state_supplier boolean,
  supplier_amount_12m numeric,
  sanction_count integer,
  sanction_evidence_count integer,
  sanction_last_date date,
  has_press boolean,
  press_evidence_count integer,
  press_match_confidence numeric,
  press_match_status text,
  press_match_date date,
  press_match_source text,
  alert_count integer,
  ipa_score numeric,
  ipa_band text,
  attention_motive text,
  evidence_count bigint,
  total_count bigint
)
language sql
stable
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
  with silenciosos as (
    select sector_canonical
    from public.obs_uaf_reporting_sector
    where silence_5y and sector_canonical is not null
  ), base as (
    select
      s.*,
      i.ipa3_score as _ipa_score,
      i.priority_band_shadow as _ipa_band,
      pc.confidence as _press_match_confidence,
      pc.event_at::date as _press_match_date,
      pc.latest_source as _press_match_source,
      pc.article_count as _press_match_articles
    from public.obs_uaf_subject s
    left join public.aml_ipa3_entity_score_snapshot_v0_4 i
      on i.entity_id = s.entity_id
    left join lateral (
      select
        greatest(coalesce(c.identity_confidence,0), coalesce(c.mention_confidence,0)) as confidence,
        c.event_at,
        c.latest_source,
        c.article_count
      from public.obs_uaf_press_match_90d_cache c
      where c.entity_id = s.entity_id
        and c.event_at >= current_date - 90
        and greatest(coalesce(c.identity_confidence,0), coalesce(c.mention_confidence,0)) >= 0.90
      order by greatest(coalesce(c.identity_confidence,0), coalesce(c.mention_confidence,0)) desc,
               c.event_at desc
      limit 1
    ) pc on true
  ), filtrado as (
    select b.*
    from base b
    where
      case upper(coalesce(p_cohort, 'TODOS'))
        when 'TERMINO_GIRO'          then b.sii_status = 'TERMINATED_AS_PUBLISHED'
        when 'ACTIVO'                then b.sii_status = 'ACTIVE_AS_PUBLISHED'
        when 'SIN_PERFIL_SII'        then b.sii_status = 'SIN_PERFIL_SII'
        when 'OSFL'                  then b.is_osfl
        when 'PROVEEDOR_ESTADO'      then b.is_state_supplier
        when 'SANCIONADO'            then b.sanction_evidence_count > 0 or b.sanction_count > 0
        when 'PRENSA'                then coalesce(b.press_evidence_count,0) > 0 or coalesce(b.has_press,false) or coalesce(b._press_match_confidence,0) >= 0.90
        when 'PRENSA_CONFIRMADA'     then coalesce(b.press_evidence_count,0) > 0 or coalesce(b.has_press,false)
        when 'PRENSA_ALTA_CONFIANZA' then coalesce(b._press_match_confidence,0) >= 0.90
        when 'CON_SENAL'             then b.alert_count > 0
        when 'IGR_ALTO'              then b.igr_level in ('Alto', 'Muy alto')
        when 'IGR_MUY_ALTO'          then b.igr_level = 'Muy alto'
        when 'REGION'                then b.region = p_value
        when 'SECTOR'                then b.uaf_sector = p_value
        when 'INDUSTRIA'             then b.economic_sector = p_value
        when 'TERMINO_ANO'           then b.termination_year = nullif(p_value, '')::integer
        when 'ATENCION'              then b.attention_rank is not null
        when 'MOTIVO'                then b.attention_motive = p_value
        when 'IPA_ALTO'              then b._ipa_band in ('MUY_ALTA', 'ALTA')
        -- Alias heredado para no romper enlaces o filtros guardados.
        when 'IPF_ALTO'              then b._ipa_band in ('MUY_ALTA', 'ALTA')
        when 'GIRO_ATIPICO'          then b.activity_atypicality >= 0.90
        when 'CAMBIO_ACTIVIDAD'      then b.sii_activity_changed
        when 'SIN_TERRITORIO'        then b.region is null and b.sii_status <> 'SIN_PERFIL_SII'
        when 'SECTOR_SIN_ROS'        then b.uaf_sector in (select sector_canonical from silenciosos)
        when 'TODOS'                 then true
        else false
      end
      and (nullif(trim(p_sector), '') is null or b.uaf_sector = p_sector)
      and (nullif(trim(p_region), '') is null or b.region = p_region)
      and (nullif(trim(p_industry), '') is null or b.economic_sector = p_industry)
      and (
        nullif(trim(p_q), '') is null
        or b.name ilike '%' || trim(p_q) || '%'
        or coalesce(b.uaf_sector, '') ilike '%' || trim(p_q) || '%'
        or coalesce(b.region, '') ilike '%' || trim(p_q) || '%'
        or coalesce(b.commune, '') ilike '%' || trim(p_q) || '%'
        or coalesce(b.main_activity, '') ilike '%' || trim(p_q) || '%'
        or coalesce(b.economic_sector, '') ilike '%' || trim(p_q) || '%'
        or (
          nullif(regexp_replace(trim(p_q), '[^0-9kK]', '', 'g'), '') is not null
          and regexp_replace(coalesce(b.rut, ''), '[^0-9kK]', '', 'g') ilike '%' || regexp_replace(trim(p_q), '[^0-9kK]', '', 'g') || '%'
        )
      )
  ), contado as (
    select count(*) over () as _total_count, f.* from filtrado f
  )
  select
    c.rut, c.entity_id, c.name, c.subject_nature, c.uaf_sector,
    c.sii_status, c.sii_activity_start_date, c.sii_termination_date,
    c.activity_years, c.economic_sector, c.main_activity,
    c.sales_band, c.workers, c.region, c.commune,
    c.igr_score, c.igr_level, c.is_osfl, c.is_state_supplier,
    c.supplier_amount_12m, c.sanction_count, c.sanction_evidence_count,
    c.sanction_last_date,
    (coalesce(c.has_press,false) or coalesce(c._press_match_confidence,0) >= 0.90) as has_press,
    greatest(coalesce(c.press_evidence_count,0), coalesce(c._press_match_articles,0))::integer as press_evidence_count,
    case when c._press_match_confidence is null then null else round(c._press_match_confidence * 100, 0) end::numeric as press_match_confidence,
    case
      when (coalesce(c.press_evidence_count,0) > 0 or coalesce(c.has_press,false)) and c._press_match_confidence >= 0.90 then 'CONFIRMADA_Y_ALTA_CONFIANZA'
      when coalesce(c.press_evidence_count,0) > 0 or coalesce(c.has_press,false) then 'CONFIRMADA'
      when c._press_match_confidence >= 0.90 then 'ALTA_CONFIANZA'
      else null
    end as press_match_status,
    c._press_match_date as press_match_date,
    c._press_match_source as press_match_source,
    c.alert_count,
    c._ipa_score as ipa_score,
    c._ipa_band as ipa_band,
    c.attention_motive,
    (select count(*) from public.obs_uaf_evidence ev where ev.rut = c.rut) as evidence_count,
    c._total_count as total_count
  from contado c
  order by
    case when upper(coalesce(p_cohort,'')) in ('PRENSA','PRENSA_ALTA_CONFIANZA') then c._press_match_confidence end desc nulls last,
    case when lower(coalesce(p_order, '')) = 'nombre' then c.name end asc nulls last,
    case when lower(coalesce(p_order, '')) in ('ipa','ipf') then c._ipa_score end desc nulls last,
    case when lower(coalesce(p_order, '')) = 'senales' then
      coalesce(c.sanction_evidence_count, 0) + greatest(coalesce(c.press_evidence_count,0),coalesce(c._press_match_articles,0)) + coalesce(c.alert_count, 0)
      + case when c._press_match_confidence >= 0.90 then 1 else 0 end
      + case when c.is_osfl then 1 else 0 end
      + case when c.attention_motive is not null then 1 else 0 end
    end desc nulls last,
    case when lower(coalesce(p_order, 'relevancia')) = 'relevancia' then c.attention_rank end asc nulls last,
    case when lower(coalesce(p_order, 'relevancia')) = 'relevancia' then (c.sanction_evidence_count > 0 or c.sanction_count > 0)::int end desc nulls last,
    case when lower(coalesce(p_order, 'relevancia')) = 'relevancia' then c._ipa_score end desc nulls last,
    c.name asc
  limit greatest(1, least(coalesce(p_limit, 80), 200))
  offset greatest(0, coalesce(p_offset, 0));
$function$;

comment on function public.obs_uaf_subject_directory_v4(text,text,text,text,text,text,text,integer,integer)
is 'Directorio UAF para Atlas. Expone IPA como único indicador principal; IPF queda fuera de la interfaz y se conserva sólo como benchmark interno.';
