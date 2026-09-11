-- ATLAS Observatorio · Radar prioritario de Pulso.
-- Ventana móvil de 90 días para prensa, nuevas coincidencias y sanciones SO.
-- Las señales de prensa priorizan revisión y no acreditan responsabilidad.

create or replace function public.obs_uaf_priority_radar()
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
with allowed as (
  select exists (
    select 1 from public.aml_allowed_users au
    where au.user_id = auth.uid() and au.enabled
  ) as ok
),
critical_press as (
  select
    c.alert_id as id,
    'PRENSA'::text as kind,
    'NUEVA_COINCIDENCIA'::text as subtype,
    c.severity,
    c.urgency_score,
    c.event_at::timestamptz as event_at,
    c.entity_id,
    c.rut,
    c.entity_name,
    c.uaf_sector,
    c.sii_status,
    c.latest_source as source_label,
    c.latest_url as source_url,
    c.latest_title as headline,
    coalesce(c.alert_reason, c.latest_summary, c.signal_label) as detail,
    round(c.identity_confidence * 100, 0)::integer as identity_confidence,
    round(c.mention_confidence * 100, 0)::integer as mention_confidence,
    c.signal_label,
    c.article_count::integer,
    c.source_count::integer,
    c.ipa_gap,
    c.match_basis,
    null::numeric as amount_uf,
    true as is_new_match
  from public.obs_uaf_external_alert_candidate c, allowed a
  where a.ok
    and c.event_at >= current_date - 90
),
press_regular as (
  select distinct on (s.entity_id)
    'press:' || e.evidence_id as id,
    'PRENSA'::text as kind,
    'PRENSA'::text as subtype,
    'NORMAL'::text as severity,
    45::integer as urgency_score,
    e.event_date::timestamptz as event_at,
    s.entity_id,
    s.rut,
    s.name as entity_name,
    s.uaf_sector,
    s.sii_status,
    e.source_label,
    case when e.has_link then e.document_url else null end as source_url,
    e.headline,
    coalesce(e.summary, s.uaf_sector) as detail,
    null::integer as identity_confidence,
    null::integer as mention_confidence,
    null::text as signal_label,
    1::integer as article_count,
    1::integer as source_count,
    case
      when coalesce(s.ipa3_score,0) <= 0 or coalesce(s.ipa3_band,'') like 'SIN_%' then 'SIN_IPA_VIGENTE'
      else null
    end as ipa_gap,
    'RUT_EVIDENCE'::text as match_basis,
    null::numeric as amount_uf,
    false as is_new_match
  from public.obs_uaf_evidence e
  join public.obs_uaf_subject s using (rut)
  cross join allowed a
  where a.ok
    and e.kind = 'PRENSA'
    and e.event_date >= current_date - 90
    and s.uaf_sector is distinct from 'Organismos públicos'
    and not exists (
      select 1 from public.obs_uaf_external_alert_candidate c
      where c.entity_id = s.entity_id and c.event_at >= current_date - 90
    )
  order by s.entity_id, e.event_date desc, e.refreshed_at desc
),
sanctions as (
  select distinct on (s.entity_id)
    'sanction:' || e.evidence_id as id,
    'SANCION'::text as kind,
    'SANCION'::text as subtype,
    case when e.amount_uf is not null and e.amount_uf >= 100 then 'HIGH' else 'NORMAL' end::text as severity,
    case when e.amount_uf is not null and e.amount_uf >= 100 then 70 else 55 end::integer as urgency_score,
    e.event_date::timestamptz as event_at,
    s.entity_id,
    s.rut,
    s.name as entity_name,
    s.uaf_sector,
    s.sii_status,
    e.source_label,
    case when e.has_link then e.document_url else null end as source_url,
    e.headline,
    coalesce(e.summary, s.uaf_sector) as detail,
    null::integer as identity_confidence,
    null::integer as mention_confidence,
    'Sanción reciente'::text as signal_label,
    null::integer as article_count,
    null::integer as source_count,
    case
      when coalesce(s.ipa3_score,0) <= 0 or coalesce(s.ipa3_band,'') like 'SIN_%' then 'SIN_IPA_VIGENTE'
      else null
    end as ipa_gap,
    'RUT_EVIDENCE'::text as match_basis,
    e.amount_uf,
    false as is_new_match
  from public.obs_uaf_evidence e
  join public.obs_uaf_subject s using (rut)
  cross join allowed a
  where a.ok
    and e.kind = 'SANCION'
    and e.event_date >= current_date - 90
    and s.uaf_sector is distinct from 'Organismos públicos'
  order by s.entity_id, e.event_date desc, e.refreshed_at desc
),
all_items as (
  select * from critical_press
  union all
  select * from press_regular
  union all
  select * from sanctions
),
ranked as (
  select * from all_items
  order by
    case when severity = 'CRITICAL' then 0 when is_new_match then 1 when kind = 'SANCION' then 2 else 3 end,
    urgency_score desc,
    event_at desc,
    entity_name
  limit 30
),
counts as (
  select
    (select count(distinct entity_id) from all_items where kind='PRENSA')::integer as press_count,
    (select count(distinct entity_id) from all_items where is_new_match)::integer as new_match_count,
    (select count(distinct entity_id) from all_items where kind='SANCION')::integer as sanction_count,
    (select count(*) from all_items where severity='CRITICAL')::integer as critical_count,
    (select count(*) from all_items)::integer as total_count
)
select case when a.ok then jsonb_build_object(
  'contract','ATLAS_OBS_PRIORITY_RADAR_V1',
  'generated_at',now(),
  'window_days',90,
  'counts',jsonb_build_object(
    'total',c.total_count,
    'press',c.press_count,
    'new_matches',c.new_match_count,
    'sanctions',c.sanction_count,
    'critical',c.critical_count
  ),
  'items',coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',r.id,
      'kind',r.kind,
      'subtype',r.subtype,
      'severity',r.severity,
      'urgency_score',r.urgency_score,
      'event_at',r.event_at,
      'entity_id',r.entity_id,
      'rut',r.rut,
      'entity_name',r.entity_name,
      'uaf_sector',r.uaf_sector,
      'sii_status',r.sii_status,
      'source_label',r.source_label,
      'source_url',r.source_url,
      'headline',left(coalesce(r.headline,''),420),
      'detail',left(coalesce(r.detail,''),520),
      'identity_confidence',r.identity_confidence,
      'mention_confidence',r.mention_confidence,
      'signal_label',r.signal_label,
      'article_count',r.article_count,
      'source_count',r.source_count,
      'ipa_gap',r.ipa_gap,
      'match_basis',r.match_basis,
      'amount_uf',r.amount_uf,
      'is_new_match',r.is_new_match
    ) order by
      case when r.severity='CRITICAL' then 0 when r.is_new_match then 1 when r.kind='SANCION' then 2 else 3 end,
      r.urgency_score desc,
      r.event_at desc,
      r.entity_name)
    from ranked r
  ),'[]'::jsonb),
  'semantics','Radar de novedades de 90 días. Prioriza nuevas coincidencias de prensa de alta confianza, alertas críticas y sanciones recientes de sujetos obligados. Las señales de prensa requieren validación analítica y no acreditan responsabilidad.'
) else jsonb_build_object(
  'contract','ATLAS_OBS_PRIORITY_RADAR_V1','generated_at',now(),'window_days',90,
  'counts',jsonb_build_object('total',0,'press',0,'new_matches',0,'sanctions',0,'critical',0),
  'items','[]'::jsonb,'semantics','Acceso no habilitado.'
) end
from allowed a cross join counts c;
$$;

revoke all on function public.obs_uaf_priority_radar() from public, anon;
grant execute on function public.obs_uaf_priority_radar() to authenticated;
