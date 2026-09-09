-- IGR v1.1 RC1: score + percentil nacional como lectura primaria de comparación.
-- Mantiene obs_territory (v1.0) como mapa/ranking oficial hasta promoción explícita.
create or replace function public.obs_territory_igr_comparison()
returns jsonb
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
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
           rank() over (order by candidate_score desc nulls last) as candidate_rank,
           rank() over (order by candidate_score asc nulls last) as candidate_rank_asc,
           count(*) over (partition by candidate_score) as candidate_ties,
           count(*) over () as candidate_n
    from joined j
  ), enriched as (
    select r.*,
      round((100.0 * (
        (candidate_rank_asc - 1)::numeric + ((candidate_ties - 1)::numeric / 2.0)
      ) / nullif((candidate_n - 1)::numeric, 0)), 1) as candidate_percentile
    from ranked r
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
    from enriched
  )
  select jsonb_build_object(
    'contract', 'ATLAS_OBS_TERRITORY_IGR_COMPARE_V1',
    'status', 'RC1',
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
        'candidate_percentile', r.candidate_percentile,
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
      from enriched r
    ),
    'semantics', 'IGR v1.1 RC1: score continuo y percentil nacional son la lectura primaria de comparación. El percentil expresa posición relativa entre comunas y no es probabilidad. La banda provisional queda como contexto secundario con alerta de frontera. El mapa oficial continúa usando IGR v1.0 hasta una promoción explícita.'
  );
$function$;
