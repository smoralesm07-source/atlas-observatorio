-- ATLAS Observatorio · alertas externas críticas para Pulso.
-- Detecta SO del padrón actual con identidad robusta en prensa, contexto
-- LA/FT o delitos base y una brecha del IPA. La señal ordena revisión y no
-- acredita responsabilidad.

create or replace view public.obs_uaf_external_alert_candidate
with (security_invoker = true)
as
with resolved_matches as (
  select
    l.press_entity_id,
    s.entity_id,
    s.rut,
    s.name as entity_name,
    s.uaf_sector,
    s.sii_status,
    s.ipa3_score,
    s.ipa3_band,
    greatest(
      coalesce(h.source_identity_confidence, 0),
      least(1::numeric, coalesce(l.score, 0) / 100.0)
    )::numeric as identity_confidence,
    case
      when l.match_method = 'RUT_EXACT' then 'RUT_EXACT'
      when l.is_manual then 'CURATED'
      else 'RESOLVED_STRICT'
    end as match_basis,
    coalesce(h.normalized_name, public.obs_normalize_text(h.name)) as observed_name_norm
  from public.atlas_press_entity_link l
  join public.atlas_press_entity_history h using (press_entity_id)
  join public.obs_uaf_subject s on s.entity_id = l.canonical_entity_id
  where l.link_status = 'RESOLVED'
    and coalesce(l.ambiguous, false) = false
    and coalesce(l.requires_review, false) = false
    and (l.match_method = 'RUT_EXACT' or l.is_manual or coalesce(l.score, 0) >= 95)
    and s.uaf_sector is distinct from 'Organismos públicos'
),
exact_name_matches as (
  -- Fallback conservador para una entidad aún no promovida por reconciliación:
  -- razón social exacta, única, específica y confianza de fuente >=95%.
  select
    h.press_entity_id,
    s.entity_id,
    s.rut,
    s.name as entity_name,
    s.uaf_sector,
    s.sii_status,
    s.ipa3_score,
    s.ipa3_band,
    h.source_identity_confidence::numeric as identity_confidence,
    'LEGAL_NAME_EXACT'::text as match_basis,
    coalesce(h.normalized_name, public.obs_normalize_text(h.name)) as observed_name_norm
  from public.atlas_press_entity_history h
  join public.obs_uaf_subject s
    on s.name_search = coalesce(h.normalized_name, public.obs_normalize_text(h.name))
  where coalesce(h.source_identity_confidence, 0) >= 0.95
    and coalesce(h.requires_validation, false) = false
    and s.uaf_sector is distinct from 'Organismos públicos'
    and (
      select count(*)
      from public.obs_uaf_subject s2
      where s2.name_search = s.name_search
    ) = 1
    and array_length(regexp_split_to_array(s.name_search, '\s+'), 1) >= 3
),
all_matches as (
  select * from resolved_matches
  union all
  select e.*
  from exact_name_matches e
  where not exists (
    select 1
    from resolved_matches r
    where r.press_entity_id = e.press_entity_id
      and r.entity_id = e.entity_id
  )
),
dedup as (
  select distinct on (press_entity_id, entity_id)
    a.*,
    regexp_replace(
      regexp_replace(a.observed_name_norm, ' (spa|s a|sa|ltda|limitada|eirl)$', '', 'g'),
      '^[a-z] ',
      ''
    ) as core_name
  from all_matches a
  order by press_entity_id, entity_id, identity_confidence desc
),
mention_evidence as (
  select
    d.*,
    m.mention_id,
    m.article_id,
    m.confidence as mention_confidence,
    a.article_date,
    a.media,
    a.title,
    a.summary,
    a.url,
    public.obs_normalize_text(concat_ws(
      ' ', a.title, a.summary, m.role, array_to_string(m.roles, ' '),
      coalesce(m.raw ->> 'precedents', ''), coalesce(m.raw ->> 'phenomena', '')
    )) as norm_text,
    public.obs_normalize_text(concat_ws(' ', m.role, array_to_string(m.roles, ' '))) as role_text
  from dedup d
  join public.atlas_press_mention_history m using (press_entity_id)
  join public.atlas_press_article_history a using (article_id)
  where coalesce(m.requires_validation, false) = false
    and coalesce(m.confidence, 0) >= 0.90
    and a.article_date >= current_date - 90
),
classified as (
  select
    m.*,
    m.norm_text ~ '(lavado de activ|lavado de dinero|lavar dinero|blanqueo de capital|financiamiento del terrorismo)' as has_laft,
    m.norm_text ~ '(narcotraf|trafico de drogas|crimen organizado|organizacion criminal|asociacion criminal|asociacion ilicita|cohecho|soborno|corrupcion|fraude|estafa|secuestro extorsivo|extorsion|contrabando|malversacion|receptacion|trata de personas|trafico de armas|delito tributario)' as has_predicate,
    (length(m.core_name) >= 6 and position(m.core_name in m.norm_text) > 0) as direct_context,
    m.role_text ~ '(investigad|imputad|formalizad|detenid|condenad|acusad|querellad|vinculad|ligad|involucrad|sociedad investigada|empresa investigada)' as adverse_role
  from mention_evidence m
),
aggregated as (
  select
    entity_id, rut, entity_name, uaf_sector, sii_status, ipa3_score, ipa3_band,
    max(identity_confidence) as identity_confidence,
    max(mention_confidence) as mention_confidence,
    bool_or(has_laft) as has_laft,
    bool_or(has_predicate) as has_predicate,
    count(distinct article_id) filter (where has_laft or has_predicate) as article_count,
    count(distinct media) filter (where has_laft or has_predicate) as source_count,
    count(distinct article_id) filter (where (has_laft or has_predicate) and direct_context) as direct_article_count,
    count(distinct article_id) filter (where (has_laft or has_predicate) and adverse_role) as adverse_role_count,
    max(article_date) filter (where has_laft or has_predicate) as event_at,
    (array_agg(title order by ((has_laft or has_predicate) and direct_context) desc, has_laft desc, article_date desc, title)
      filter (where has_laft or has_predicate))[1] as latest_title,
    (array_agg(summary order by ((has_laft or has_predicate) and direct_context) desc, has_laft desc, article_date desc, title)
      filter (where has_laft or has_predicate))[1] as latest_summary,
    (array_agg(media order by ((has_laft or has_predicate) and direct_context) desc, has_laft desc, article_date desc, title)
      filter (where has_laft or has_predicate))[1] as latest_source,
    (array_agg(url order by ((has_laft or has_predicate) and direct_context) desc, has_laft desc, article_date desc, title)
      filter (where has_laft or has_predicate))[1] as latest_url,
    string_agg(distinct match_basis, ', ') as match_basis
  from classified
  where has_laft or has_predicate
  group by entity_id, rut, entity_name, uaf_sector, sii_status, ipa3_score, ipa3_band
),
scored as (
  select
    a.*,
    (coalesce(a.ipa3_score, 0) <= 0 or coalesce(a.ipa3_band, '') like 'SIN_%') as no_ipa,
    case
      when a.identity_confidence >= 0.95
        and (coalesce(a.ipa3_score, 0) <= 0 or coalesce(a.ipa3_band, '') like 'SIN_%')
        and (
          (a.has_laft and (a.source_count >= 2 or a.direct_article_count >= 1 or a.adverse_role_count >= 1))
          or
          (a.has_predicate and a.source_count >= 2 and (a.direct_article_count >= 1 or a.adverse_role_count >= 1))
        ) then 'CRITICAL'
      when a.identity_confidence >= 0.92
        and coalesce(a.ipa3_score, 0) < 40
        and (a.direct_article_count >= 1 or a.adverse_role_count >= 1) then 'HIGH'
      else null
    end as severity
  from aggregated a
)
select
  'external:' || entity_id || ':' || event_at::text as alert_id,
  severity,
  least(
    100,
    50
      + case when has_laft then 20 else 0 end
      + case when has_predicate then 10 else 0 end
      + case when no_ipa then 10 else 0 end
      + case when source_count >= 2 then 5 else 0 end
      + case when direct_article_count >= 1 or adverse_role_count >= 1 then 5 else 0 end
  )::integer as urgency_score,
  event_at,
  entity_id,
  rut,
  entity_name,
  uaf_sector,
  sii_status,
  identity_confidence,
  mention_confidence,
  has_laft,
  has_predicate,
  case
    when has_laft and has_predicate then 'LA/FT y delitos base'
    when has_laft then 'LA/FT'
    else 'Delitos base / crimen organizado'
  end as signal_label,
  article_count,
  source_count,
  direct_article_count,
  adverse_role_count,
  latest_title,
  latest_summary,
  latest_source,
  latest_url,
  ipa3_score,
  ipa3_band,
  case when no_ipa then 'SIN_IPA_VIGENTE' else 'IPA_BAJO' end as ipa_gap,
  match_basis,
  case
    when no_ipa then 'Señal externa de alta relevancia no reflejada en IPA vigente'
    else 'Señal externa relevante con IPA bajo'
  end as alert_reason
from scored
where severity is not null;

grant select on public.obs_uaf_external_alert_candidate to authenticated;

create or replace function public.obs_uaf_external_alerts()
returns jsonb
language sql
stable
set search_path to 'public', 'pg_temp'
as $$
with counts as (
  select
    count(*) filter (where severity = 'CRITICAL')::integer as critical_count,
    count(*) filter (where severity = 'HIGH')::integer as high_count
  from public.obs_uaf_external_alert_candidate
),
ranked as (
  select *
  from public.obs_uaf_external_alert_candidate
  order by
    case severity when 'CRITICAL' then 0 else 1 end,
    urgency_score desc,
    event_at desc,
    identity_confidence desc,
    entity_name
  limit 8
)
select jsonb_build_object(
  'contract', 'ATLAS_OBS_CRITICAL_ALERTS_V1',
  'generated_at', now(),
  'critical_count', c.critical_count,
  'high_count', c.high_count,
  'items', coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', r.alert_id,
        'kind', 'ALERTA_CRITICA',
        'event_at', r.event_at::text,
        'title', r.entity_name || case when r.severity = 'CRITICAL' then ' · señal externa crítica' else ' · señal externa prioritaria' end,
        'detail', concat_ws(' · ', r.alert_reason, r.signal_label),
        'source_label', r.latest_source,
        'source_url', r.latest_url,
        'entity_id', r.entity_id,
        'entity_name', r.entity_name,
        'meta', concat_ws(' · ', 'SO inscrito', r.ipa_gap, r.uaf_sector),
        'priority_group', 1,
        'priority_label', case when r.severity = 'CRITICAL' then 'Atención crítica' else 'Atención alta' end,
        'action_hash', null,
        'action_label', 'Revisar entidad',
        'severity', r.severity,
        'urgency_score', r.urgency_score,
        'identity_confidence', round(r.identity_confidence * 100, 0),
        'mention_confidence', round(r.mention_confidence * 100, 0),
        'signal_label', r.signal_label,
        'article_count', r.article_count,
        'source_count', r.source_count,
        'ipa3_score', r.ipa3_score,
        'ipa3_band', r.ipa3_band,
        'ipa_gap', r.ipa_gap,
        'match_basis', r.match_basis,
        'alert_reason', r.alert_reason,
        'latest_title', left(coalesce(r.latest_title, ''), 420)
      )
      order by case r.severity when 'CRITICAL' then 0 else 1 end, r.urgency_score desc, r.event_at desc, r.entity_name
    )
    from ranked r
  ), '[]'::jsonb),
  'semantics', 'Alerta de revisión analítica: combina coincidencia de identidad de alta confianza, prensa reciente asociada a LA/FT o delitos base y una brecha del IPA. No acredita responsabilidad ni sustituye la validación de fuentes.'
)
from counts c;
$$;

revoke all on function public.obs_uaf_external_alerts() from public, anon;
grant execute on function public.obs_uaf_external_alerts() to authenticated;
