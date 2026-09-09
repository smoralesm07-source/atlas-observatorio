create or replace view public.aml_v_fintech_uaf_relevant_perimeter as
with u as (
  select
    s.rut,
    min(s.entity_name) as entity_name,
    array_agg(distinct s.uaf_sector_canonical order by s.uaf_sector_canonical) as uaf_sectors,
    max(s.registry_observed_at) as registry_observed_at
  from public.aml_uaf_obligated_subject_snapshot s
  where s.rut is not null
    and (
      s.uaf_sector_canonical like 'Fintec:%'
      or s.uaf_sector_canonical = 'Otras Entidades Facultadas para Recibir Moneda Extranjera'
    )
  group by s.rut
)
select
  u.rut,
  u.entity_name,
  u.uaf_sectors,
  u.registry_observed_at,
  e.fintech_id,
  e.brand,
  e.legal_name,
  case when e.fintech_id is not null then 'CONFIRMED_FINTECH' else 'PENDING_CHARACTERIZATION' end as perimeter_status
from u
left join public.aml_fintech_entity e on e.rut = u.rut;

alter view public.aml_v_fintech_uaf_relevant_perimeter set (security_invoker = true);
revoke all on public.aml_v_fintech_uaf_relevant_perimeter from public, anon;
grant select on public.aml_v_fintech_uaf_relevant_perimeter to authenticated, service_role;

alter function public.obs_fintech_dashboard_v2() rename to obs_fintech_dashboard_v2_core;

create or replace function public.obs_fintech_dashboard_v2()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','extensions','pg_temp'
as $function$
declare
  payload jsonb;
  registry_total integer;
  confirmed_target integer;
  pending_target integer;
  all_confirmed_uaf integer;
  other_sector_confirmed integer;
  observed_at timestamptz;
  sector_breakdown jsonb;
begin
  payload := public.obs_fintech_dashboard_v2_core();
  if payload ? 'error' then return payload; end if;

  select
    count(*)::int,
    count(*) filter (where perimeter_status='CONFIRMED_FINTECH')::int,
    count(*) filter (where perimeter_status='PENDING_CHARACTERIZATION')::int,
    max(registry_observed_at)
  into registry_total, confirmed_target, pending_target, observed_at
  from public.aml_v_fintech_uaf_relevant_perimeter;

  select count(*)::int
  into all_confirmed_uaf
  from public.aml_v_fintech_entity_current
  where has_uaf_public;

  other_sector_confirmed := greatest(0, all_confirmed_uaf - confirmed_target);

  select coalesce(jsonb_agg(jsonb_build_object(
      'sector', x.uaf_sector_canonical,
      'count', x.n
    ) order by x.uaf_sector_canonical), '[]'::jsonb)
  into sector_breakdown
  from (
    select s.uaf_sector_canonical, count(distinct s.rut)::int as n
    from public.aml_uaf_obligated_subject_snapshot s
    where s.rut is not null
      and (
        s.uaf_sector_canonical like 'Fintec:%'
        or s.uaf_sector_canonical='Otras Entidades Facultadas para Recibir Moneda Extranjera'
      )
    group by s.uaf_sector_canonical
  ) x;

  payload := jsonb_set(
    payload,
    '{national}',
    coalesce(payload->'national','{}'::jsonb) || jsonb_build_object(
      'uaf_relevant_registry_total', registry_total,
      'uaf_relevant_confirmed', confirmed_target,
      'uaf_relevant_pending', pending_target,
      'uaf_public_all_confirmed', all_confirmed_uaf,
      'uaf_other_sector_confirmed', other_sector_confirmed,
      'uaf_registry_observed_at', observed_at
    ),
    true
  );

  payload := payload || jsonb_build_object(
    'uaf_perimeter', jsonb_build_object(
      'definition','RUT únicos publicados por UAF en actividades Fintec y Otras Entidades Facultadas para Recibir Moneda Extranjera.',
      'registry_total', registry_total,
      'confirmed_fintech', confirmed_target,
      'pending_characterization', pending_target,
      'confirmed_uaf_other_sectors', other_sector_confirmed,
      'source_observed_at', observed_at,
      'sector_breakdown', sector_breakdown,
      'method_note','El total del perímetro UAF es una fuente de descubrimiento. La inscripción UAF por sí sola no convierte automáticamente a una entidad de la categoría Otras Entidades Facultadas para Recibir Moneda Extranjera en fintech confirmada.'
    )
  );

  return payload;
end;
$function$;

revoke all on function public.obs_fintech_dashboard_v2() from public, anon;
grant execute on function public.obs_fintech_dashboard_v2() to authenticated, service_role;
