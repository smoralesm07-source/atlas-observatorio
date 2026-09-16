-- Versiona y asegura los RPC que producen el Informe Estratégico (#/reportes).
--
-- Contexto: las tres funciones que sostienen el informe existían únicamente en
-- la base de datos. No había migración, por lo tanto no había revisión, historia
-- ni forma de reconstruir el cálculo desde el repositorio. Un informe que se
-- presenta como "defendible cifra por cifra" no puede apoyarse en SQL que nadie
-- puede auditar. Esta migración las incorpora al control de versiones.
--
-- Además cierra un hallazgo de autorización: obs_uaf_strategic_report_payload y
-- obs_uaf_strategic_depth_payload son SECURITY DEFINER con EXECUTE concedido a
-- `authenticated`, y no consultaban membresía alguna. SECURITY DEFINER salta RLS
-- por diseño, de modo que cualquier cuenta autenticada del proyecto —estuviera o
-- no habilitada en Atlas— podía extraer el payload completo vía /rest/v1/rpc/.
-- El linter de Supabase lo reporta como
-- `authenticated_security_definer_function_executable`.
--
-- Los cuerpos de las tres funciones se conservan idénticos a producción salvo
-- por la llamada al gate. No se altera ninguna cifra, ranking ni contrato.

--------------------------------------------------------------------- gate

-- Replica la misma frontera que las políticas RLS de los read models obs_*:
--   exists (select 1 from aml_allowed_users where user_id = auth.uid() and enabled)
-- Es SECURITY DEFINER porque aml_allowed_users tiene RLS y el gate sólo responde
-- por el propio llamador: no devuelve datos, sólo deja pasar o aborta.
create or replace function public.atlas_require_allowed_user()
returns boolean
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $fn$
begin
  -- Los roles internos omiten RLS en el resto de Atlas; aquí la frontera la
  -- impone el GRANT, no este gate. `anon` no está en esta lista a propósito.
  if current_user in ('postgres', 'service_role', 'supabase_admin') then
    return true;
  end if;

  if auth.uid() is null
     or not exists (
       select 1 from public.aml_allowed_users au
       where au.user_id = (select auth.uid()) and au.enabled
     ) then
    raise exception 'atlas_forbidden'
      using errcode = '42501',
            detail  = 'La cuenta no está habilitada en Atlas Observatorio.',
            hint    = 'Solicite acceso al administrador del observatorio.';
  end if;

  return true;
end
$fn$;

comment on function public.atlas_require_allowed_user() is
  'Gate de membresía para RPC SECURITY DEFINER. Aborta si el llamador autenticado no está habilitado en aml_allowed_users.';

revoke all on function public.atlas_require_allowed_user() from public, anon;
grant execute on function public.atlas_require_allowed_user() to authenticated, service_role;

------------------------------------------------- serie base UAF 2020-2025

-- Sin cambios respecto de producción. Se versiona tal cual.
-- Es SECURITY INVOKER a propósito: lee obs_uaf_reporting_national y
-- obs_uaf_reporting_sector, ambos con RLS contra aml_allowed_users, de modo que
-- la autorización ya la impone la política de las tablas.
create or replace function public.obs_uaf_report_payload(p_from_year integer default 2020, p_to_year integer default 2025)
returns jsonb
language sql
stable
set search_path to 'public', 'extensions', 'pg_temp'
as $body$
  with bounds as (
    select greatest(2000, least(coalesce(p_from_year, 2020), coalesce(p_to_year, 2025))) as y0,
           least(2100, greatest(coalesce(p_from_year, 2020), coalesce(p_to_year, 2025))) as y1
  ),
  base as (
    select n.metric, n.period, n.value, n.unit, n.category,
           n.capture_method, n.source_url, n.as_of_date
    from public.obs_uaf_reporting_national n, bounds b
    where n.period ~ '^[0-9]{4}$'
      and n.period::integer between b.y0 and b.y1
  ),
  grouped as (
    select metric,
           jsonb_build_object(
             'unidad', max(unit),
             'categoria', max(category),
             'puntos', jsonb_agg(
               jsonb_build_object(
                 'periodo', period,
                 'valor', value,
                 'metodo_captura', capture_method,
                 'fuente', source_url,
                 'corte', as_of_date
               ) order by period
             )
           ) as serie
    from base
    group by metric
  ),
  sector as (
    select jsonb_agg(
      jsonb_build_object(
        'sector', sector_official,
        'sector_canonico', sector_canonical,
        'inscritos_2025', registered_so_2025,
        'ros_2025', ros_2025,
        'ros_2021_2025', ros_total_2021_2025,
        'ros_por_100_so_2025', ros_per_100_so_2025,
        'variacion_ros_2025_2024_pct', delta_ros_2025_vs_2024_pct,
        'silencio_5y', silence_5y,
        'indicios_2021_2025', indicios_total_2021_2025,
        'fuente', source_url,
        'corte', as_of_date
      ) order by coalesce(ros_2025,0) desc, sector_official
    ) payload
    from public.obs_uaf_reporting_sector
  )
  select jsonb_build_object(
    'contract', 'ATLAS_OBS_UAF_REPORT_V1',
    'periodo', jsonb_build_object('desde', b.y0, 'hasta', b.y1),
    'series', coalesce((select jsonb_object_agg(metric, serie) from grouped), '{}'::jsonb),
    'sectores', coalesce((select payload from sector), '[]'::jsonb),
    'metodologia', jsonb_build_object(
      'calculo', 'Deterministico: las cifras y derivados se calculan desde series trazadas; la IA no calcula ni modifica valores.',
      'nivel_reportabilidad', 'Sectorial y agregado. Atlas no atribuye ROS a sujetos individuales.',
      'comparabilidad', 'Los cortes estadisticos anuales se mantienen separados del padron operativo vigente.'
    )
  )
  from bounds b;
$body$;

revoke all on function public.obs_uaf_report_payload(integer, integer) from public, anon;
grant execute on function public.obs_uaf_report_payload(integer, integer) to authenticated, service_role;
