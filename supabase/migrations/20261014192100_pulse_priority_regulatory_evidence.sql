-- Pulso: incluye únicamente resoluciones regulatorias oficiales con RUT coincidente
-- y documento de respaldo, sin ampliar los criterios de prensa ni implicar LA/FT.
-- Applied to Supabase 2026-10-14. Idempotent CREATE OR REPLACE for reproducibility.
CREATE OR REPLACE FUNCTION public.obs_uaf_priority_radar_live_v1()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

), recent_regulatory as (
  -- Only officially documented events with confirmed identity and a UAF RUT.
  -- This is a read-through overlay; it does not rewrite canonical evidence.
  select distinct on (s.entity_id)
    jsonb_build_object(
      'id','sanction-upstream:'||r.sanction_id,
      'kind','SANCION',
      'subtype','SANCION',
      'severity','NORMAL',
      'urgency_score',60,
      'event_at',r.event_date,
      'entity_id',s.entity_id,
      'rut',s.rut,
      'entity_name',s.name,
      'uaf_sector',s.uaf_sector,
      'sii_status',s.sii_status,
      'source_label',r.regulator,
      'source_url',e.source_url,
      'headline','Resolución '||r.regulator||' N°'||coalesce(nullif(r.payload->'attributes'->>'resolution',''),'s/n'),
      'detail','Antecedente regulatorio publicado con RUT identificado. Revisar el documento oficial; la extracción del contenido puede ser parcial.',
      'identity_confidence',100,
      'mention_confidence',null,
      'signal_label','Resolución oficial identificada por RUT',
      'article_count',null,
      'source_count',1,
      'ipa_gap',null,
      'match_basis','RUT_EXACT_OFFICIAL_DOCUMENT',
      'amount_uf',r.amount_uf,
      'is_new_match',false
    ) item
  from public.aml_sanctions r
  join public.obs_uaf_subject s on s.entity_id=r.entity_id
  join public.aml_sanction_evidence_v0960 e
    on e.evidence_id=any(select jsonb_array_elements_text(coalesce(r.payload->'evidence_ids','[]'::jsonb)))
  cross join allowed a
  where a.ok
    and r.identity_status='RESOLVED'
    and r.event_date between current_date-90 and current_date
    and r.payload->'attributes'->>'source_record_id' like '%'||s.rut
    and e.source_url like 'https://%'
    and e.ultimate_source_id=r.regulator
    and e.quality_status in ('PARTIAL','VALIDATED','COMPLETE','VERIFIED')
    and not exists(
      select 1 from public.obs_uaf_evidence v
      where v.rut=s.rut and v.kind='SANCION'
        and v.event_date=r.event_date and v.source_label=r.regulator
    )
  order by s.entity_id,r.event_date desc,r.sanction_id
), regulatory_extra as (
  select count(*)::integer n,coalesce(jsonb_agg(item),'[]'::jsonb) items
  from recent_regulatory
), extra as (
  select count(*)::integer as n, coalesce(jsonb_agg(item),'[]'::jsonb) as items
  from new_press_rows
)
select case when a.ok then
  l.doc || jsonb_build_object(
    'counts', coalesce(l.doc->'counts','{}'::jsonb) || jsonb_build_object(
      'total', coalesce((l.doc->'counts'->>'total')::integer,0) + x.n + y.n,
      'press', coalesce((l.doc->'counts'->>'press')::integer,0) + x.n,
      'new_matches', coalesce((l.doc->'counts'->>'new_matches')::integer,0) + x.n,
      'sanctions',coalesce((l.doc->'counts'->>'sanctions')::integer,0) + y.n
    ),
    'items', coalesce(l.doc->'items','[]'::jsonb) || x.items || y.items,
    'semantics', 'Radar de novedades de 90 días. Integra sanciones, alertas críticas y nuevas coincidencias de prensa de alta confianza del Radar Prensa Entidades. Las coincidencias periodísticas requieren validación analítica y no acreditan responsabilidad.'
  )
else l.doc end
from allowed a cross join legacy l cross join extra x cross join regulatory_extra y;
$function$
;
