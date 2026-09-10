-- Pulso · novedades operativas priorizadas
-- P1: hechos sobre sujetos obligados inscritos (prensa y sanciones).
-- P2: potenciales SO (nuevo giro, empresa nueva y screening Radar).
-- P3: términos de giro incorporados en el último lote para revisar cancelación.
-- P4: salud, actualización e incidencias de fuentes y radares.

create or replace function public.obs_uaf_updates()
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
with so_evidence_ranked as (
  select
    case when e.kind = 'SANCION'
      then 'sancion:' || md5(coalesce(e.rut, '') || ':' || coalesce(e.event_date::text, '') || ':' || coalesce(e.headline, ''))
      else 'prensa:' || e.evidence_id
    end as id,
    e.kind::text as kind,
    coalesce(e.event_date::timestamptz, e.refreshed_at) as sort_at,
    coalesce(e.event_date::text, e.refreshed_at::date::text) as event_at,
    case
      when e.kind = 'SANCION' then coalesce(nullif(e.headline, ''), s.name || ' · antecedente sancionatorio')
      else coalesce(nullif(e.headline, ''), s.name || ' · mención en prensa')
    end as title,
    case
      when nullif(e.summary, '') is not null and nullif(e.summary, '') is distinct from nullif(e.headline, '')
        then coalesce(s.uaf_sector || ' · ', '') || e.summary
      else s.uaf_sector
    end as detail,
    e.source_label,
    case when e.has_link then e.document_url else null end as source_url,
    s.entity_id,
    s.name as entity_name,
    case when e.kind = 'SANCION' then 'SO inscrito · sanción' else 'SO inscrito · prensa' end as meta,
    1 as priority_group,
    'Padrón SO'::text as priority_label,
    case when e.kind = 'SANCION' then 10 else 20 end as priority_order,
    null::text as action_hash,
    'Abrir ficha'::text as action_label,
    row_number() over (
      partition by e.kind
      order by coalesce(e.event_date::timestamptz, e.refreshed_at) desc nulls last, e.evidence_id
    ) as kind_rn
  from public.obs_uaf_evidence e
  join public.obs_uaf_subject s on s.rut = e.rut
  where e.kind in ('SANCION', 'PRENSA')
), so_items as (
  select id, kind, sort_at, event_at, title, detail, source_label, source_url,
         entity_id, entity_name, meta, priority_group, priority_label,
         priority_order, action_hash, action_label
  from so_evidence_ranked
  where kind_rn = 1
), potential_base as (
  select
    c.*,
    a.matched_activity_registered,
    case
      when a.matched_activity_registered is not null
       and c.sii_activity_start_date is not null
       and a.matched_activity_registered > c.sii_activity_start_date + 30
        then 'GIRO_NUEVO'
      when c.sii_activity_start_date >= current_date - 365
        then 'EMPRESA_NUEVA'
      else 'RADAR'
    end as signal_type,
    case
      when a.matched_activity_registered is not null
       and c.sii_activity_start_date is not null
       and a.matched_activity_registered > c.sii_activity_start_date + 30
        then a.matched_activity_registered::timestamptz
      when c.sii_activity_start_date >= current_date - 365
        then c.sii_activity_start_date::timestamptz
      else c.refreshed_at
    end as signal_at
  from public.obs_uaf_potential_candidate c
  left join lateral (
    select max(ar.activity_registration_date) as matched_activity_registered
    from public.aml_sii_registry_activity ar
    where ar.rut = c.rut
      and (
        ar.activity_name = c.matched_activity
        or ar.activity_code = any(coalesce(c.activity_codes, '{}'::text[]))
      )
  ) a on true
), potential_ranked as (
  select
    p.*,
    row_number() over (
      partition by p.signal_type
      order by p.signal_at desc nulls last, p.ivo_score desc nulls last, p.name
    ) as signal_rn
  from potential_base p
), potential_items as (
  select
    'potencial:' || p.rut || ':' || lower(p.signal_type) as id,
    'POTENCIAL'::text as kind,
    p.signal_at as sort_at,
    p.signal_at::text as event_at,
    case p.signal_type
      when 'GIRO_NUEVO' then p.name || ' · incorporó actividad relacionada'
      when 'EMPRESA_NUEVA' then p.name || ' · empresa nueva con giro relacionado'
      else p.name || ' · potencial SO observado en Radar'
    end as title,
    concat_ws(' · ', p.implied_sector, p.matched_activity,
      case when p.ivo_score is not null then 'IVO ' || to_char(p.ivo_score, 'FM990D0') end) as detail,
    'Radar SII · screening potenciales'::text as source_label,
    null::text as source_url,
    p.entity_id,
    p.name as entity_name,
    case p.signal_type
      when 'GIRO_NUEVO' then 'Cambio de actividad · hipótesis de registro'
      when 'EMPRESA_NUEVA' then 'Empresa nueva · hipótesis de registro'
      else 'Screening · hipótesis de registro'
    end as meta,
    2 as priority_group,
    'Potenciales SO'::text as priority_label,
    case p.signal_type when 'GIRO_NUEVO' then 10 when 'EMPRESA_NUEVA' then 20 else 30 end as priority_order,
    '#/universo-so?vista=casos&cola=potenciales'::text as action_hash,
    'Revisar potencial'::text as action_label
  from potential_ranked p
  where p.signal_rn = 1
), term_base as (
  select
    l.entity_id,
    l.event_date,
    l.refreshed_at,
    s.name,
    s.uaf_sector,
    max(l.refreshed_at) over () as batch_max
  from public.aml_entity_lifecycle_v0680 l
  join public.obs_uaf_subject s on s.entity_id = l.entity_id
  where l.event_type = 'SII_TERMINO_GIRO'
), term_latest as (
  select *
  from term_base
  where refreshed_at >= batch_max - interval '24 hours'
), term_item as (
  select
    'baja-so:' || max(batch_max)::text as id,
    'BAJA_SO'::text as kind,
    max(refreshed_at) as sort_at,
    max(refreshed_at)::text as event_at,
    count(*)::text || ' SO con término de giro en la última actualización' as title,
    'Términos registrados hasta ' || coalesce(max(event_date)::text, 'fecha no informada') || ' · revisar cancelación o desvinculación del padrón.' as detail,
    'Radar SII × padrón UAF'::text as source_label,
    null::text as source_url,
    null::text as entity_id,
    null::text as entity_name,
    'Acción de gestión · revisar cancelación'::text as meta,
    3 as priority_group,
    'Bajas SO'::text as priority_label,
    10 as priority_order,
    '#/universo-so?vista=casos&cola=termino'::text as action_hash,
    'Revisar bajas'::text as action_label
  from term_latest
  having count(*) > 0
), source_issues as (
  select
    sh.*,
    case
      when lower(coalesce(sh.software_status, '')) in ('error','blocked','down','failed')
        or lower(coalesce(sh.data_status, '')) in ('error','blocked','stale','failed') then 1
      when lower(coalesce(sh.software_status, '')) = 'watch'
        or lower(coalesce(sh.data_status, '')) = 'silent' then 2
      else 9
    end as severity
  from public.obs_source_health sh
), source_issue_names as (
  select string_agg(source_name, ' · ' order by severity, source_name) as names
  from (
    select source_name, severity
    from source_issues
    where severity < 9
    order by severity, source_name
    limit 3
  ) x
), source_stats as (
  select
    count(*) filter (where severity = 1) as critical_n,
    count(*) filter (where severity = 2) as watch_n,
    count(*) filter (where source_code like 'RADAR_%' and lower(coalesce(data_status, '')) = 'fresh') as fresh_radar_n,
    coalesce(sum(coalesce(records_24h, 0)) filter (where source_code like 'RADAR_%'), 0) as radar_records_24h,
    max(refreshed_at) as latest_refresh
  from source_issues
), source_item as (
  select
    'fuentes:' || coalesce(s.latest_refresh::text, 'sin-corte') as id,
    'FUENTE'::text as kind,
    s.latest_refresh as sort_at,
    coalesce(s.latest_refresh, now())::text as event_at,
    case
      when s.critical_n > 0 then s.critical_n::text || ' fuente(s) con bloqueo o error'
      when s.watch_n > 0 then s.watch_n::text || ' fuente(s) requieren vigilancia'
      else s.fresh_radar_n::text || ' radares actualizados sin incidencias declaradas'
    end as title,
    concat_ws(' · ',
      case when s.critical_n + s.watch_n > 0 then n.names end,
      s.fresh_radar_n::text || ' radares fresh',
      to_char(s.radar_records_24h, 'FM999G999G999G999G990') || ' registros en 24 h'
    ) as detail,
    'Salud de fuentes'::text as source_label,
    null::text as source_url,
    null::text as entity_id,
    null::text as entity_name,
    case
      when s.critical_n > 0 then 'INCIDENCIA'
      when s.watch_n > 0 then 'VIGILAR'
      else 'OPERATIVO'
    end as meta,
    4 as priority_group,
    'Fuentes y radares'::text as priority_label,
    case when s.critical_n > 0 then 10 when s.watch_n > 0 then 20 else 30 end as priority_order,
    '#/fuentes'::text as action_hash,
    'Ver fuentes'::text as action_label
  from source_stats s
  cross join source_issue_names n
), combined as (
  select * from so_items
  union all
  select * from potential_items
  union all
  select * from term_item
  union all
  select * from source_item
), ranked as (
  select *
  from combined
  where sort_at is not null
  order by priority_group, priority_order, sort_at desc, id
  limit 8
)
select jsonb_build_object(
  'contract', 'ATLAS_OBS_UAF_UPDATES_V2',
  'generated_at', now(),
  'items', coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', id,
        'kind', kind,
        'event_at', event_at,
        'title', title,
        'detail', case when detail is null then null else left(detail, 240) end,
        'source_label', source_label,
        'source_url', source_url,
        'entity_id', entity_id,
        'entity_name', entity_name,
        'meta', meta,
        'priority_group', priority_group,
        'priority_label', priority_label,
        'action_hash', action_hash,
        'action_label', action_label
      )
      order by priority_group, priority_order, sort_at desc, id
    ),
    '[]'::jsonb
  ),
  'semantics', 'Novedades operativas priorizadas: 1) hechos sobre sujetos obligados inscritos, balanceando prensa y sanciones; 2) potenciales SO, balanceando cambios de actividad, empresas nuevas y screening Radar; 3) términos de giro incorporados en la última sincronización para revisión de cancelación; 4) salud, actualización e incidencias de radares y fuentes. Las señales de potenciales son hipótesis de registro y no acreditan incumplimiento.'
)
from ranked;
$$;

revoke all on function public.obs_uaf_updates() from public;
revoke all on function public.obs_uaf_updates() from anon;
grant execute on function public.obs_uaf_updates() to authenticated;

comment on function public.obs_uaf_updates() is
'Feed operativo priorizado del Pulso. P1 padrón SO; P2 potenciales SO y cambios/altas de actividad; P3 términos de giro del último lote; P4 salud de fuentes. Sólo lectura para usuarios autenticados.';
