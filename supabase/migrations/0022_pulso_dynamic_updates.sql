-- Pulso · novedades dinámicas
-- Feed balanceado de hechos observados: cambios de estado de sujetos obligados,
-- antecedentes sancionatorios, Radar Prensa, actualizaciones de radares y corte.

create or replace function public.obs_uaf_updates()
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
with state_items as (
  select
    'estado:' || l.entity_id || ':' || l.event_type || ':' || coalesce(l.event_date::text, 'sin-fecha') as id,
    'ESTADO'::text as kind,
    coalesce(l.event_date::timestamptz, l.refreshed_at) as sort_at,
    coalesce(l.event_date::text, l.refreshed_at::date::text) as event_at,
    case l.event_type
      when 'SII_TERMINO_GIRO' then s.name || ' · término de giro'
      when 'SII_INICIO_ACTIVIDADES' then s.name || ' · inicio de actividades'
      else s.name || ' · cambio observado'
    end as title,
    coalesce(s.uaf_sector, l.event_label) as detail,
    coalesce(l.source_system, 'SII') as source_label,
    l.source_url,
    s.entity_id,
    s.name as entity_name,
    case l.event_type
      when 'SII_TERMINO_GIRO' then 'Estado tributario'
      else 'Ciclo de vida'
    end as meta,
    30 as priority,
    row_number() over (
      order by l.event_date desc nulls last, l.refreshed_at desc, l.entity_id
    ) as rn
  from public.aml_entity_lifecycle_v0680 l
  join public.obs_uaf_subject s on s.entity_id = l.entity_id
  where l.event_type in ('SII_TERMINO_GIRO', 'SII_INICIO_ACTIVIDADES')
), sanction_items as (
  select
    'sancion:' || md5(
      coalesce(e.rut, '') || ':' || coalesce(e.event_date::text, '') || ':' || coalesce(e.headline, '')
    ) as id,
    'SANCION'::text as kind,
    coalesce(e.event_date::timestamptz, e.refreshed_at) as sort_at,
    coalesce(e.event_date::text, e.refreshed_at::date::text) as event_at,
    coalesce(
      nullif(e.headline, ''),
      coalesce(s.name, e.rut, 'Entidad') || ' · nuevo antecedente sancionatorio'
    ) as title,
    case
      when nullif(e.summary, '') is distinct from nullif(e.headline, '') then e.summary
      else s.uaf_sector
    end as detail,
    e.source_label,
    case when e.has_link then e.document_url else null end as source_url,
    s.entity_id,
    s.name as entity_name,
    'Antecedente sancionatorio'::text as meta,
    20 as priority,
    row_number() over (
      order by e.event_date desc nulls last, e.refreshed_at desc, coalesce(e.rut, '')
    ) as rn
  from public.obs_uaf_evidence e
  left join public.obs_uaf_subject s on s.rut = e.rut
  where e.kind = 'SANCION'
    and e.event_date is not null
), press_item as (
  select
    'source:' || sh.source_code as id,
    'PRENSA'::text as kind,
    coalesce(sh.last_successful_ingest_at, sh.refreshed_at) as sort_at,
    coalesce(sh.last_successful_ingest_at, sh.refreshed_at)::text as event_at,
    'Radar Prensa · índice actualizado'::text as title,
    case
      when coalesce(sh.records_24h, 0) > 0
        then to_char(sh.records_24h, 'FM999G999G999G990') || ' registros observados en las últimas 24 h'
      else 'Fuente sincronizada en el último corte'
    end as detail,
    coalesce(sh.source_name, 'Radar Prensa') as source_label,
    null::text as source_url,
    null::text as entity_id,
    null::text as entity_name,
    upper(coalesce(sh.data_status, 'actualizada')) as meta,
    10 as priority,
    1::bigint as rn
  from public.obs_source_health sh
  where sh.source_code = 'RADAR_PRENSA'
), source_items as (
  select
    'source:' || sh.source_code as id,
    'FUENTE'::text as kind,
    coalesce(sh.last_successful_ingest_at, sh.refreshed_at) as sort_at,
    coalesce(sh.last_successful_ingest_at, sh.refreshed_at)::text as event_at,
    regexp_replace(coalesce(sh.source_name, sh.source_code), '\s*·.*$', '') || ' · fuente actualizada' as title,
    case
      when coalesce(sh.records_24h, 0) > 0
        then to_char(sh.records_24h, 'FM999G999G999G990') || ' registros observados en las últimas 24 h'
      else 'Fuente sincronizada en el último corte'
    end as detail,
    coalesce(sh.source_name, sh.source_code) as source_label,
    null::text as source_url,
    null::text as entity_id,
    null::text as entity_name,
    upper(coalesce(sh.data_status, 'actualizada')) as meta,
    11 as priority,
    row_number() over (
      order by coalesce(sh.last_successful_ingest_at, sh.refreshed_at) desc,
               coalesce(sh.records_24h, 0) desc,
               sh.source_code
    ) as rn
  from public.obs_source_health sh
  where sh.source_code like 'RADAR_%'
    and sh.source_code <> 'RADAR_PRENSA'
    and coalesce(sh.records_24h, 0) > 0
), snapshot_item as (
  select
    'corte:' || s.snapshot_id as id,
    'CORTE'::text as kind,
    coalesce(s.published_at, s.generated_at) as sort_at,
    coalesce(s.published_at, s.generated_at)::text as event_at,
    'Nuevo corte del Observatorio disponible'::text as title,
    'Snapshot ' || s.snapshot_id || ' · estado ' || lower(coalesce(s.status, 'publicado')) as detail,
    'Atlas Observatorio'::text as source_label,
    null::text as source_url,
    null::text as entity_id,
    null::text as entity_name,
    'Corte'::text as meta,
    5 as priority,
    row_number() over (
      order by coalesce(s.published_at, s.generated_at) desc
    ) as rn
  from public.obs_snapshot s
  where lower(coalesce(s.status, '')) in ('published', 'publicado', 'active', 'ready')
     or s.published_at is not null
), combined as (
  select * from state_items where rn <= 2
  union all
  select * from sanction_items where rn <= 2
  union all
  select * from press_item
  union all
  select * from source_items where rn <= 2
  union all
  select * from snapshot_item where rn <= 1
), ranked as (
  select *
  from combined
  where sort_at is not null
  order by sort_at desc, priority, id
  limit 8
)
select jsonb_build_object(
  'contract', 'ATLAS_OBS_UAF_UPDATES_V1',
  'generated_at', now(),
  'items', coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', id,
        'kind', kind,
        'event_at', event_at,
        'title', title,
        'detail', case when detail is null then null else left(detail, 220) end,
        'source_label', source_label,
        'source_url', source_url,
        'entity_id', entity_id,
        'entity_name', entity_name,
        'meta', meta
      )
      order by sort_at desc, priority, id
    ),
    '[]'::jsonb
  ),
  'semantics', 'Novedades observadas por Atlas. Combina cambios de ciclo de vida de sujetos obligados, antecedentes sancionatorios y actualizaciones de fuentes. Una actualización de fuente indica nueva sincronización o registros observados; no implica por sí sola un hallazgo de riesgo.'
)
from ranked;
$$;

revoke all on function public.obs_uaf_updates() from public;
revoke all on function public.obs_uaf_updates() from anon;
grant execute on function public.obs_uaf_updates() to authenticated;

comment on function public.obs_uaf_updates() is
'Feed balanceado de novedades del Pulso: ciclo de vida de SO, sanciones, prensa/radares y nuevo corte. Sólo lectura para usuarios autenticados.';
