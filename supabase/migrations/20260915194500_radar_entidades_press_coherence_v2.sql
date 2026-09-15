-- Radar Prensa Entidades · coherencia entre Entidad 360, Universo SO y Pulso.
-- El Monitor UAF permanece desacoplado: esta capa trabaja sólo con el histórico
-- de artículos ya archivado por ATLAS y con coincidencias de identidad conservadoras.

-- 1. Cache de vínculos recientes. Conserva las coincidencias críticas gobernadas
-- y agrega candidatos generales cuando nombre, título, término de búsqueda y
-- contexto corporativo sostienen la identidad con confianza >= 90%.
drop materialized view if exists public.obs_uaf_press_match_90d_cache;

create materialized view public.obs_uaf_press_match_90d_cache as
with external_matches as (
  select
    c.entity_id, c.rut, c.entity_name,
    c.identity_confidence, c.mention_confidence, c.event_at,
    c.latest_source, c.latest_url, c.latest_title, c.latest_summary,
    c.signal_label, c.severity, c.urgency_score, c.ipa_gap, c.match_basis,
    c.article_count, c.source_count
  from public.obs_uaf_external_alert_candidate c
  where c.event_at >= current_date - 90
    and greatest(coalesce(c.identity_confidence,0), coalesce(c.mention_confidence,0)) >= 0.90
),
subject_core as (
  select
    s.entity_id, s.rut, s.name as entity_name, s.uaf_sector, s.sii_status,
    s.ipa3_score, s.ipa3_band, s.name_search,
    trim(regexp_replace(s.name_search, '\s+(spa|s a|sa|ltda|limitada|eirl)$', '', 'i')) as core_name
  from public.obs_uaf_subject s
  where s.uaf_sector is distinct from 'Organismos públicos'
    and s.name_search ~ '(spa|s a|sa|ltda|limitada|eirl)$'
),
unique_core as (
  select core_name
  from subject_core
  where length(core_name) >= 6
  group by core_name
  having count(*) = 1
),
geography as (
  select distinct public.obs_normalize_text(commune) as place
  from public.aml_uaf_obligated_commune_sector_summary
  where commune is not null
  union
  select distinct public.obs_normalize_text(region)
  from public.obs_uaf_subject
  where region is not null
),
subjects as (
  select s.*, array_length(regexp_split_to_array(s.core_name, '\s+'),1) as core_tokens
  from subject_core s
  join unique_core u using (core_name)
  where not (
    array_length(regexp_split_to_array(s.core_name, '\s+'),1) = 1
    and exists (select 1 from geography g where g.place = s.core_name)
  )
),
article_terms as (
  select distinct
    a.article_id, a.article_date, a.media, a.title, a.summary, a.url,
    public.obs_normalize_text(a.title) as norm_title,
    public.obs_normalize_text(a.summary) as norm_summary,
    public.obs_normalize_text(t.term) as term_norm
  from public.atlas_press_article_history a
  cross join lateral unnest(coalesce(a.search_terms,'{}'::text[])) t(term)
  where a.article_date >= current_date - 90
),
article_candidates as (
  select distinct
    s.entity_id, s.rut, s.entity_name, s.sii_status, s.ipa3_score, s.ipa3_band,
    a.article_id, a.article_date, a.media, a.title, a.summary, a.url,
    case
      when a.term_norm = s.name_search then 0.99::numeric
      when position(s.core_name in a.norm_summary) > 0 then 0.96::numeric
      else 0.94::numeric
    end as identity_confidence
  from subjects s
  join article_terms a
    on a.term_norm = s.core_name or a.term_norm = s.name_search
  where position(s.core_name in a.norm_title) > 0
    and (
      s.core_tokens > 1
      or position(s.core_name in a.norm_summary) > 0
      or a.term_norm = s.name_search
    )
    and (
      a.term_norm = s.name_search
      or (a.norm_title || ' ' || a.norm_summary) ~
        '(empresa|sociedad|firma|startup|fintech|exchange|plataforma|clientes|fondos|operaciones|cofundador|cofundadores|fundador|fundadores|ceo|gerente|directorio|accionista|accionistas|caso|querella|denuncia|investiga|investigacion|fiscalia|cierra|cierre|quiebra|insolvencia|fraude)'
    )
),
article_agg as (
  select
    c.entity_id, c.rut, c.entity_name,
    max(c.identity_confidence) as identity_confidence,
    max(c.identity_confidence) as mention_confidence,
    max(c.article_date) as event_at,
    (array_agg(c.media order by c.identity_confidence desc, c.article_date desc, c.article_id))[1] as latest_source,
    (array_agg(c.url order by c.identity_confidence desc, c.article_date desc, c.article_id))[1] as latest_url,
    (array_agg(c.title order by c.identity_confidence desc, c.article_date desc, c.article_id))[1] as latest_title,
    (array_agg(c.summary order by c.identity_confidence desc, c.article_date desc, c.article_id))[1] as latest_summary,
    'Mención de prensa'::text as signal_label,
    'NORMAL'::text as severity,
    (40
      + case when coalesce(max(c.ipa3_score),0) <= 0 or coalesce(max(c.ipa3_band),'') like 'SIN_%' then 10 else 0 end
      + case when count(distinct c.article_id) >= 2 then 5 else 0 end
    )::integer as urgency_score,
    case
      when coalesce(max(c.ipa3_score),0) <= 0 or coalesce(max(c.ipa3_band),'') like 'SIN_%'
        then 'SIN_IPA_VIGENTE'::text
      else null::text
    end as ipa_gap,
    'RADAR_ENTIDADES_TITLE_BRAND'::text as match_basis,
    count(distinct c.article_id)::integer as article_count,
    count(distinct c.media)::integer as source_count
  from article_candidates c
  where c.identity_confidence >= 0.90
  group by c.entity_id, c.rut, c.entity_name
),
combined as (
  select 0 as precedence, e.* from external_matches e
  union all
  select 1 as precedence, a.*
  from article_agg a
  where not exists (select 1 from external_matches e where e.entity_id = a.entity_id)
)
select distinct on (entity_id)
  entity_id, rut, entity_name, identity_confidence, mention_confidence,
  event_at, latest_source, latest_url, latest_title, latest_summary,
  signal_label, severity, urgency_score, ipa_gap, match_basis,
  article_count, source_count
from combined
order by entity_id, precedence, identity_confidence desc, event_at desc
with data;

create unique index obs_uaf_press_match_90d_cache_entity_idx
  on public.obs_uaf_press_match_90d_cache(entity_id);
create index obs_uaf_press_match_90d_cache_event_idx
  on public.obs_uaf_press_match_90d_cache(event_at desc);

create or replace function public.obs_refresh_uaf_press_match_90d_cache()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  refresh materialized view concurrently public.obs_uaf_press_match_90d_cache;
end;
$$;

-- 2. Cohorte clásica PRENSA: mismo universo ampliado, manteniendo el contrato.
create or replace function public.obs_uaf_cohort(
  p_cohort text,
  p_value text default null,
  p_limit integer default 50,
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
set search_path = public, extensions, pg_temp
as $$
  with silenciosos as (
    select sector_canonical from public.obs_uaf_reporting_sector
    where silence_5y and sector_canonical is not null
  ), high_press as (
    select entity_id, article_count
    from public.obs_uaf_press_match_90d_cache
  ), filtrado as (
    select s.*
    from public.obs_uaf_subject s
    where case upper(coalesce(p_cohort,''))
      when 'TERMINO_GIRO'     then s.sii_status = 'TERMINATED_AS_PUBLISHED'
      when 'ACTIVO'           then s.sii_status = 'ACTIVE_AS_PUBLISHED'
      when 'SIN_PERFIL_SII'   then s.sii_status = 'SIN_PERFIL_SII'
      when 'OSFL'             then s.is_osfl
      when 'PROVEEDOR_ESTADO' then s.is_state_supplier
      when 'SANCIONADO'       then s.sanction_evidence_count > 0 or s.sanction_count > 0
      when 'PRENSA'           then coalesce(s.press_evidence_count,0) > 0 or coalesce(s.has_press,false) or s.entity_id in (select entity_id from high_press)
      when 'CON_SENAL'        then s.alert_count > 0
      when 'IGR_ALTO'         then s.igr_level in ('Alto','Muy alto')
      when 'IGR_MUY_ALTO'     then s.igr_level = 'Muy alto'
      when 'REGION'           then s.region = p_value
      when 'SECTOR'           then s.uaf_sector = p_value
      when 'INDUSTRIA'        then s.economic_sector = p_value
      when 'TERMINO_ANO'      then s.termination_year = nullif(p_value,'')::integer
      when 'ATENCION'         then s.attention_rank is not null
      when 'MOTIVO'           then s.attention_motive = p_value
      when 'IPF_ALTO'         then s.ipf_band in ('MUY_ALTA','ALTA')
      when 'GIRO_ATIPICO'     then s.activity_atypicality >= 0.90
      when 'CAMBIO_ACTIVIDAD' then s.sii_activity_changed
      when 'SIN_TERRITORIO'   then s.region is null and s.sii_status <> 'SIN_PERFIL_SII'
      when 'SECTOR_SIN_ROS'   then s.uaf_sector in (select sector_canonical from silenciosos)
      when 'TODOS'            then true
      else false
    end
  ), contado as (
    select count(*) over () total_count, f.* from filtrado f
  )
  select
    c.rut, c.entity_id, c.name, c.subject_nature, c.uaf_sector,
    c.sii_status, c.sii_activity_start_date, c.sii_termination_date,
    c.activity_years, c.economic_sector, c.main_activity,
    c.sales_band, c.workers, c.region, c.commune,
    c.igr_score, c.igr_level, c.is_osfl, c.is_state_supplier, c.supplier_amount_12m,
    c.sanction_count, c.sanction_evidence_count, c.sanction_last_date,
    (coalesce(c.has_press,false) or c.entity_id in (select entity_id from high_press)) as has_press,
    greatest(
      coalesce(c.press_evidence_count,0),
      coalesce((select h.article_count from high_press h where h.entity_id=c.entity_id),0)
    )::integer as press_evidence_count,
    c.alert_count, c.ipf_score, c.ipf_band, c.attention_motive, c.ipf_percentile,
    (select count(*) from public.obs_uaf_evidence ev where ev.rut = c.rut),
    c.total_count
  from contado c
  order by
    c.attention_rank asc nulls last,
    (c.sanction_evidence_count > 0 or c.sanction_count > 0) desc,
    c.ipf_score desc nulls last,
    c.alert_count desc,
    c.name
  limit greatest(1, least(coalesce(p_limit,50), 200))
  offset greatest(0, coalesce(p_offset,0));
$$;

-- 3. Directorio enriquecido: PRENSA, PRENSA_CONFIRMADA y PRENSA_ALTA_CONFIANZA
-- se resuelven sobre el mismo cache de Radar Entidades.
create or replace function public.obs_uaf_subject_directory_v3(
  p_cohort text default 'TODOS',
  p_value text default null,
  p_q text default null,
  p_sector text default null,
  p_region text default null,
  p_industry text default null,
  p_order text default 'relevancia',
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
  press_match_confidence numeric, press_match_status text, press_match_date date,
  press_match_source text, alert_count integer, ipf_score numeric, ipf_band text,
  attention_motive text, ipf_percentile numeric, evidence_count bigint, total_count bigint
)
language sql
stable
set search_path = public, extensions, pg_temp
as $$
  with silenciosos as (
    select sector_canonical
    from public.obs_uaf_reporting_sector
    where silence_5y and sector_canonical is not null
  ), base as (
    select
      s.*,
      pc.confidence as _press_match_confidence,
      pc.event_at::date as _press_match_date,
      pc.latest_source as _press_match_source,
      pc.article_count as _press_match_articles
    from public.obs_uaf_subject s
    left join lateral (
      select
        greatest(coalesce(c.identity_confidence,0), coalesce(c.mention_confidence,0)) as confidence,
        c.event_at, c.latest_source, c.article_count
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
    where case upper(coalesce(p_cohort, 'TODOS'))
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
      when 'IPF_ALTO'              then b.ipf_band in ('MUY_ALTA', 'ALTA')
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
    c.alert_count, c.ipf_score, c.ipf_band, c.attention_motive,
    c.ipf_percentile,
    (select count(*) from public.obs_uaf_evidence ev where ev.rut = c.rut) as evidence_count,
    c._total_count as total_count
  from contado c
  order by
    case when upper(coalesce(p_cohort,'')) in ('PRENSA','PRENSA_ALTA_CONFIANZA') then c._press_match_confidence end desc nulls last,
    case when lower(coalesce(p_order, '')) = 'nombre' then c.name end asc nulls last,
    case when lower(coalesce(p_order, '')) = 'ipf' then c.ipf_score end desc nulls last,
    case when lower(coalesce(p_order, '')) = 'senales' then
      coalesce(c.sanction_evidence_count, 0) + greatest(coalesce(c.press_evidence_count,0),coalesce(c._press_match_articles,0)) + coalesce(c.alert_count, 0)
      + case when c._press_match_confidence >= 0.90 then 1 else 0 end
      + case when c.is_osfl then 1 else 0 end
      + case when c.attention_motive is not null then 1 else 0 end
    end desc nulls last,
    case when lower(coalesce(p_order, 'relevancia')) = 'relevancia' then c.attention_rank end asc nulls last,
    case when lower(coalesce(p_order, 'relevancia')) = 'relevancia' then (c.sanction_evidence_count > 0 or c.sanction_count > 0)::int end desc nulls last,
    case when lower(coalesce(p_order, 'relevancia')) = 'relevancia' then c.ipf_score end desc nulls last,
    c.name asc
  limit greatest(1, least(coalesce(p_limit, 80), 200))
  offset greatest(0, coalesce(p_offset, 0));
$$;

-- 4. Novedades prioritarias. El radar original se conserva como función legacy
-- y el contrato público añade las nuevas coincidencias de prensa generales.
do $$
begin
  if to_regprocedure('public.obs_uaf_priority_radar_legacy_v1()') is null then
    alter function public.obs_uaf_priority_radar() rename to obs_uaf_priority_radar_legacy_v1;
  end if;
end $$;

create or replace function public.obs_uaf_priority_radar()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
with allowed as (
  select exists (
    select 1 from public.aml_allowed_users au
    where au.user_id = auth.uid() and au.enabled
  ) as ok
), legacy as (
  select public.obs_uaf_priority_radar_legacy_v1() as doc
), new_press_rows as (
  select jsonb_build_object(
    'id', 'press-radar-entidades:' || h.entity_id || ':' || h.event_at::text,
    'kind', 'PRENSA',
    'subtype', 'NUEVA_COINCIDENCIA',
    'severity', 'NORMAL',
    'urgency_score', h.urgency_score,
    'event_at', h.event_at,
    'entity_id', h.entity_id,
    'rut', h.rut,
    'entity_name', h.entity_name,
    'uaf_sector', s.uaf_sector,
    'sii_status', s.sii_status,
    'source_label', h.latest_source,
    'source_url', h.latest_url,
    'headline', left(coalesce(h.latest_title,''),420),
    'detail', left(coalesce(h.latest_summary,'Nueva coincidencia de prensa de alta confianza.'),520),
    'identity_confidence', round(h.identity_confidence * 100,0)::integer,
    'mention_confidence', round(h.mention_confidence * 100,0)::integer,
    'signal_label', 'Nueva coincidencia de prensa',
    'article_count', h.article_count,
    'source_count', h.source_count,
    'ipa_gap', h.ipa_gap,
    'match_basis', h.match_basis,
    'amount_uf', null,
    'is_new_match', true
  ) as item
  from public.obs_uaf_press_match_90d_cache h
  join public.obs_uaf_subject s using (entity_id)
  cross join allowed a
  where a.ok
    and h.event_at >= current_date - 90
    and h.identity_confidence >= 0.90
    and h.match_basis = 'RADAR_ENTIDADES_TITLE_BRAND'
    and not (coalesce(s.press_evidence_count,0) > 0 or coalesce(s.has_press,false))
    and not exists (
      select 1 from public.obs_uaf_external_alert_candidate c
      where c.entity_id = h.entity_id and c.event_at >= current_date - 90
    )
), extra as (
  select count(*)::integer as n, coalesce(jsonb_agg(item),'[]'::jsonb) as items
  from new_press_rows
)
select case when a.ok then
  l.doc || jsonb_build_object(
    'counts', coalesce(l.doc->'counts','{}'::jsonb) || jsonb_build_object(
      'total', coalesce((l.doc->'counts'->>'total')::integer,0) + x.n,
      'press', coalesce((l.doc->'counts'->>'press')::integer,0) + x.n,
      'new_matches', coalesce((l.doc->'counts'->>'new_matches')::integer,0) + x.n
    ),
    'items', coalesce(l.doc->'items','[]'::jsonb) || x.items,
    'semantics', 'Radar de novedades de 90 días. Integra sanciones, alertas críticas y nuevas coincidencias de prensa de alta confianza del Radar Prensa Entidades. Las coincidencias periodísticas requieren validación analítica y no acreditan responsabilidad.'
  )
else l.doc end
from allowed a cross join legacy l cross join extra x;
$$;

revoke all on function public.obs_uaf_priority_radar() from public, anon;
grant execute on function public.obs_uaf_priority_radar() to authenticated, service_role;
revoke all on function public.obs_uaf_priority_radar_legacy_v1() from public, anon, authenticated;
grant execute on function public.obs_uaf_priority_radar_legacy_v1() to service_role;

comment on materialized view public.obs_uaf_press_match_90d_cache is
  'Vínculos recientes de prensa >=90%: resolución gobernada más Radar Prensa Entidades con barreras conservadoras de identidad.';
