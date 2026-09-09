-- ATLAS Observatorio · IGR v1.1 candidate.3
-- Mantiene intacto el IGR v1.0 productivo y añade una segunda banda
-- recalibrada exclusivamente para diagnóstico analítico.

alter table public.obs_territory_igr_candidate
  add column if not exists provisional_level text,
  add column if not exists provisional_level_status text,
  add column if not exists provisional_boundary_distance numeric,
  add column if not exists provisional_boundary_status text;

comment on column public.obs_territory_igr_candidate.provisional_level is
  'Banda candidate.3 recalibrada para diagnóstico. No reemplaza el nivel IGR v1.0 vigente.';
comment on column public.obs_territory_igr_candidate.provisional_boundary_distance is
  'Distancia del score continuo a la frontera provisional más cercana.';
comment on column public.obs_territory_igr_candidate.provisional_boundary_status is
  'Diagnóstico de estabilidad de banda: borderline, stable_relative_to_thresholds o unavailable.';

create index if not exists obs_territory_igr_candidate_provisional_level_idx
  on public.obs_territory_igr_candidate (provisional_level);

create or replace function public.obs_refresh_territory_igr_candidate()
returns integer
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_url text := 'https://raw.githubusercontent.com/smoralesm07-source/Radar_delictual/'
             || 'radar-data/data/processed/cead_geographic_score_v11_candidate.json';
  v_resp extensions.http_response;
  v_rows jsonb;
  v_n integer;
begin
  select * into v_resp from extensions.http_get(v_url);
  if v_resp.status <> 200 then
    raise warning 'obs_refresh_territory_igr_candidate: fuente HTTP %', v_resp.status;
    return -1;
  end if;

  v_rows := v_resp.content::jsonb;
  if jsonb_typeof(v_rows) <> 'array' or jsonb_array_length(v_rows) < 300 then
    raise warning 'obs_refresh_territory_igr_candidate: artefacto incompleto';
    return -1;
  end if;

  delete from public.obs_territory_igr_candidate;

  insert into public.obs_territory_igr_candidate (
    territory_id, region_code, region_name, commune_code, commune_name,
    year, period, candidate_score, candidate_level,
    provisional_level, provisional_level_status,
    provisional_boundary_distance, provisional_boundary_status,
    confidence, confidence_level, methodological_coverage, population,
    population_coverage, confidence_components, layer_weights, layers,
    stability_sd, score_version, base_score_version, interpretation, refreshed_at)
  select
    r->>'territory_id',
    r->>'region_code',
    r->>'region_name',
    r->>'commune_code',
    r->>'commune_name',
    nullif(r->>'year','')::int,
    r->>'period',
    nullif(r->>'score','')::numeric,
    r->>'level',
    r->>'provisional_level',
    coalesce(r->>'provisional_level_status','diagnostic_only'),
    nullif(r->>'provisional_boundary_distance','')::numeric,
    r->>'provisional_boundary_status',
    nullif(r->>'confidence','')::numeric,
    r->>'confidence_level',
    nullif(r->>'methodological_coverage','')::numeric,
    nullif(r->>'population','')::bigint,
    nullif(r->>'population_coverage','')::numeric,
    coalesce(r->'confidence_components', '{}'::jsonb),
    coalesce(r->'layer_weights', '{}'::jsonb),
    coalesce(r->'layers', '{}'::jsonb),
    nullif(r->>'stability_sd','')::numeric,
    r->>'score_version',
    r->>'base_score_version',
    r->>'interpretation',
    now()
  from jsonb_array_elements(v_rows) r
  where nullif(r->>'territory_id','') is not null;

  get diagnostics v_n = row_count;
  return v_n;
end
$$;

revoke all on function public.obs_refresh_territory_igr_candidate() from public, anon, authenticated;
grant execute on function public.obs_refresh_territory_igr_candidate() to service_role;

create or replace function public.obs_territory_igr_comparison()
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with joined as (
    select
      t.territory_id,
      t.region_code,
      t.region_name,
      t.commune_code,
      t.commune_name,
      t.igr_score as vigente_score,
      t.igr_level as vigente_level,
      t.igr_confidence as vigente_methodological_coverage,
      c.candidate_score,
      c.candidate_level,
      c.provisional_level,
      c.provisional_level_status,
      c.provisional_boundary_distance,
      c.provisional_boundary_status,
      c.confidence as candidate_confidence,
      c.confidence_level as candidate_confidence_level,
      c.methodological_coverage as candidate_methodological_coverage,
      c.confidence_components,
      c.stability_sd,
      c.population,
      c.population_coverage,
      c.score_version as candidate_version,
      c.base_score_version,
      c.refreshed_at as candidate_refreshed_at
    from public.obs_territory t
    join public.obs_territory_igr_candidate c using (territory_id)
    where t.igr_score is not null and c.candidate_score is not null
  ), ranked as (
    select j.*,
           rank() over (order by vigente_score desc nulls last) as vigente_rank,
           rank() over (order by candidate_score desc nulls last) as candidate_rank
    from joined j
  ), summary as (
    select
      count(*)::int as comunas,
      max(candidate_version) as candidate_version,
      max(base_score_version) as base_score_version,
      round(avg(vigente_methodological_coverage), 1) as cobertura_vigente_media,
      round(avg(candidate_methodological_coverage), 1) as cobertura_candidate_media,
      round(avg(candidate_confidence), 1) as confianza_candidate_media,
      round(min(candidate_confidence), 1) as confianza_candidate_min,
      round(max(candidate_confidence), 1) as confianza_candidate_max,
      count(*) filter (where candidate_confidence_level = 'Alta')::int as confianza_alta,
      count(*) filter (where candidate_confidence_level = 'Media')::int as confianza_media,
      count(*) filter (where candidate_confidence_level = 'Baja')::int as confianza_baja,
      count(*) filter (where vigente_level is distinct from candidate_level)::int as cambios_nivel_comparativo,
      count(*) filter (where provisional_level is not null and vigente_level is distinct from provisional_level)::int as cambios_nivel_provisional,
      count(*) filter (where provisional_boundary_status = 'borderline')::int as provisional_borderline,
      count(*) filter (where provisional_boundary_status = 'stable_relative_to_thresholds')::int as provisional_estables,
      round(corr(vigente_score::double precision, candidate_score::double precision)::numeric, 4) as correlacion_score,
      round(corr(vigente_rank::double precision, candidate_rank::double precision)::numeric, 4) as correlacion_ranking,
      round((corr(vigente_score::double precision, ln(population::double precision))
        filter (where population > 0))::numeric, 4) as sesgo_poblacion_vigente,
      round((corr(candidate_score::double precision, ln(population::double precision))
        filter (where population > 0))::numeric, 4) as sesgo_poblacion_candidate,
      max(candidate_refreshed_at) as refreshed_at
    from ranked
  )
  select jsonb_build_object(
    'contract', 'ATLAS_OBS_TERRITORY_IGR_COMPARE_V1',
    'status', 'EXPERIMENTAL',
    'production_replaced', false,
    'summary', (select to_jsonb(s) from summary s),
    'rows', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'territory_id', r.territory_id,
        'region_code', r.region_code,
        'region_name', r.region_name,
        'commune_code', r.commune_code,
        'commune_name', r.commune_name,
        'vigente_score', r.vigente_score,
        'candidate_score', r.candidate_score,
        'score_delta', round(r.candidate_score - r.vigente_score, 2),
        'vigente_level', r.vigente_level,
        'candidate_level', r.candidate_level,
        'candidate_level_status', 'comparison_only',
        'provisional_level', r.provisional_level,
        'provisional_level_status', r.provisional_level_status,
        'provisional_boundary_distance', r.provisional_boundary_distance,
        'provisional_boundary_status', r.provisional_boundary_status,
        'vigente_rank', r.vigente_rank,
        'candidate_rank', r.candidate_rank,
        'rank_delta', r.vigente_rank - r.candidate_rank,
        'vigente_methodological_coverage', r.vigente_methodological_coverage,
        'candidate_methodological_coverage', r.candidate_methodological_coverage,
        'candidate_confidence', r.candidate_confidence,
        'candidate_confidence_level', r.candidate_confidence_level,
        'confidence_components', r.confidence_components,
        'stability_sd', r.stability_sd,
        'population', r.population,
        'population_coverage', r.population_coverage
      ) order by r.candidate_rank), '[]'::jsonb)
      from ranked r
    ),
    'semantics', 'El IGR v1.1 candidate.3 es experimental. Su banda provisional está recalibrada sólo para diagnóstico; el score continuo es la salida primaria y el mapa oficial continúa usando IGR v1.0. La confianza candidata mide solidez de la estimación y no atribuye riesgo a entidades.'
  );
$$;

grant execute on function public.obs_territory_igr_comparison() to authenticated;
