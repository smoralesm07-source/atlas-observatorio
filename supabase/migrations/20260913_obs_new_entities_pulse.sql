-- Pulso: altas recientes observadas en RES y SII.
-- RES acredita constitución; SII acredita inicio de actividades y no implica
-- necesariamente creación jurídica. Las fechas futuras se excluyen del corte.

create index if not exists aml_sii_registry_company_activity_start_idx
  on public.aml_sii_registry_company (activity_start_date desc)
  where activity_start_date is not null;

create or replace function public.obs_new_entities_digest()
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
with source_bounds as (
  select
    (select max(r.constitution_date)
       from public.aml_res_company r
      where r.constitution_date is not null
        and r.constitution_date <= current_date) as res_latest_date,
    (select max(s.activity_start_date)
       from public.aml_sii_registry_company s
      where s.activity_start_date is not null
        and s.activity_start_date <= current_date) as sii_latest_date
), bounds as (
  select
    greatest(res_latest_date, sii_latest_date) as reference_date,
    res_latest_date,
    sii_latest_date
  from source_bounds
), res_recent as (
  select
    r.rut,
    r.legal_name as name,
    r.constitution_date as event_date,
    'RES'::text as source
  from public.aml_res_company r
  cross join bounds b
  where b.reference_date is not null
    and r.constitution_date between (b.reference_date - 29) and b.reference_date
), sii_recent as (
  select
    s.rut,
    s.legal_name as name,
    s.activity_start_date as event_date,
    'SII'::text as source
  from public.aml_sii_registry_company s
  cross join bounds b
  where b.reference_date is not null
    and s.activity_start_date between (b.reference_date - 29) and b.reference_date
), recent_raw as (
  select * from res_recent
  union all
  select * from sii_recent
), recent as (
  select
    rr.rut,
    (array_agg(rr.name order by rr.event_date desc, case when rr.source = 'RES' then 0 else 1 end))[1] as name,
    max(rr.event_date) as event_date,
    array_agg(distinct rr.source order by rr.source) as sources
  from recent_raw rr
  where rr.rut is not null
  group by rr.rut
), recent_joined as (
  select
    r.*,
    o.entity_id,
    (o.entity_id is not null) as visible_in_atlas
  from recent r
  left join public.obs_entity o on o.rut = r.rut
), counts as (
  select
    count(*)::bigint as detected_total,
    count(*) filter (where 'RES' = any(sources))::bigint as res_constitutions,
    count(*) filter (where 'SII' = any(sources))::bigint as sii_activity_starts,
    count(*) filter (where 'RES' = any(sources) and 'SII' = any(sources))::bigint as source_overlap,
    count(*) filter (where visible_in_atlas)::bigint as visible_in_atlas,
    count(*) filter (where not visible_in_atlas)::bigint as outside_visible
  from recent_joined
), latest_rows as (
  select coalesce(jsonb_agg(jsonb_build_object(
      'rut', x.rut,
      'name', x.name,
      'event_date', x.event_date,
      'sources', x.sources,
      'entity_id', x.entity_id,
      'visible_in_atlas', x.visible_in_atlas
    ) order by x.event_date desc, x.rut), '[]'::jsonb) as payload
  from (
    select *
    from recent_joined
    order by event_date desc, rut
    limit 5
  ) x
), res_source as (
  select jsonb_build_object(
    'latest_event_date', b.res_latest_date,
    'cutoff_date', s.cutoff_date,
    'source_updated_at', s.source_updated_at,
    'refreshed_at', s.refreshed_at,
    'resource_name', s.resource_name
  ) as payload
  from bounds b
  left join lateral (
    select rs.cutoff_date, rs.source_updated_at, rs.refreshed_at, rs.resource_name
    from public.aml_res_source_snapshot rs
    where rs.status = 'NORMALIZED'
    order by rs.cutoff_date desc nulls last, rs.refreshed_at desc
    limit 1
  ) s on true
), sii_source as (
  select jsonb_build_object(
    'latest_event_date', b.sii_latest_date,
    'snapshot_refreshed_at', s.refreshed_at,
    'official_last_modified', s.metadata ->> 'last_modified',
    'snapshot_id', s.snapshot_id
  ) as payload
  from bounds b
  left join lateral (
    select ss.snapshot_id, ss.refreshed_at, ss.metadata
    from public.aml_sii_registry_snapshot ss
    where ss.status = 'NORMALIZED'
      and ss.source_kind = 'NAMES'
    order by ss.refreshed_at desc
    limit 1
  ) s on true
)
select jsonb_build_object(
  'contract', 'ATLAS_OBS_NEW_ENTITIES_V1',
  'generated_at', now(),
  'window_days', 30,
  'reference_date', b.reference_date,
  'staleness_days', case when b.reference_date is null then null else (current_date - b.reference_date) end,
  'counts', jsonb_build_object(
    'detected_total', c.detected_total,
    'res_constitutions', c.res_constitutions,
    'sii_activity_starts', c.sii_activity_starts,
    'source_overlap', c.source_overlap,
    'visible_in_atlas', c.visible_in_atlas,
    'outside_visible', c.outside_visible
  ),
  'sources', jsonb_build_object(
    'res', rs.payload,
    'sii', ss.payload
  ),
  'latest', lr.payload,
  'semantics', 'Altas observadas en los 30 días más recientes cubiertos por las fuentes. RES representa constituciones; SII representa inicios de actividades y no implica necesariamente creación jurídica. Se excluyen fechas futuras.'
)
from bounds b
cross join counts c
cross join latest_rows lr
cross join res_source rs
cross join sii_source ss;
$$;

revoke all on function public.obs_new_entities_digest() from public;
grant execute on function public.obs_new_entities_digest() to authenticated;
