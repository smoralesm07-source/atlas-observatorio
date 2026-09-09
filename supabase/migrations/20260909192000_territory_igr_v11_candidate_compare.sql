-- ATLAS Observatorio · IGR v1.1 candidato en paralelo
--
-- Este read model NO reemplaza obs_territory ni el IGR v1.0 vigente. Publica
-- una comparación experimental y corrige la semántica del 86% actual: ese
-- valor es cobertura metodológica del catálogo CEAD materializado, no una
-- confianza comunal estadística.

create table if not exists public.obs_territory_igr_candidate (
  territory_id                    text primary key,
  region_code                     text,
  region_name                     text not null,
  commune_code                    text,
  commune_name                    text not null,
  year                            integer,
  period                          text,
  candidate_score                 numeric,
  candidate_level                 text,
  confidence                      numeric,
  confidence_level                text,
  methodological_coverage         numeric,
  population                      bigint,
  population_coverage             numeric,
  confidence_components           jsonb not null default '{}'::jsonb,
  layer_weights                   jsonb not null default '{}'::jsonb,
  layers                          jsonb not null default '{}'::jsonb,
  stability_sd                    numeric,
  score_version                   text,
  base_score_version              text,
  interpretation                  text,
  refreshed_at                    timestamptz not null default now()
);

comment on table public.obs_territory_igr_candidate is
  'IGR v1.1 experimental en paralelo. Nunca sustituye obs_territory ni se usa para atribuir riesgo a entidades.';
comment on column public.obs_territory_igr_candidate.methodological_coverage is
  'Cobertura de componentes materializados comparable con el antiguo campo confidence de v1.0.';
comment on column public.obs_territory_igr_candidate.confidence is
  'Confianza experimental separada del score: cobertura temática y temporal, calidad de fuente, estabilidad y confiabilidad del denominador.';

create index if not exists obs_territory_igr_candidate_score_idx
  on public.obs_territory_igr_candidate (candidate_score desc nulls last);
create index if not exists obs_territory_igr_candidate_confidence_idx
  on public.obs_territory_igr_candidate (confidence desc nulls last);

alter table public.obs_territory_igr_candidate enable row level security;
drop policy if exists obs_territory_igr_candidate_allowed_read on public.obs_territory_igr_candidate;
create policy obs_territory_igr_candidate_allowed_read
  on public.obs_territory_igr_candidate
  for select to authenticated
  using (exists (
    select 1 from public.aml_allowed_users au
    where au.user_id = (select auth.uid()) and au.enabled
  ));

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

  -- Sólo se reemplaza el corte anterior después de validar forma y cobertura.
  delete from public.obs_territory_igr_candidate;

  insert into public.obs_territory_igr_candidate (
    territory_id, region_code, region_name, commune_code, commune_name,
    year, period, candidate_score, candidate_level, confidence, confidence_level,
    methodological_coverage, population, population_coverage,
    confidence_components, layer_weights, layers, stability_sd,
    score_version, base_score_version, interpretation, refreshed_at)
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

-- Comparador completo para la vista Territorio. El nivel candidato conserva
-- temporalmente los cortes de v1 sólo para comparación y nunca se publica como
-- nueva clasificación oficial.
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
    'semantics', 'El IGR v1.1 es experimental. La cobertura metodológica mide disponibilidad del catálogo; la confianza candidata mide solidez de la estimación y no modifica el score ni atribuye riesgo a entidades.'
  );
$$;

grant execute on function public.obs_territory_igr_comparison() to authenticated;

-- Corrige la semántica del contrato vigente sin tocar sus puntajes. El antiguo
-- `igr_confidence` se mantiene por compatibilidad, pero se expone además como
-- cobertura metodológica y el agregado regional deja de usarlo como peso.
create or replace function public.obs_territory_map()
returns jsonb
language sql
stable
security invoker
set search_path = public, extensions, pg_temp
as $$
  with base as (select * from public.obs_territory),
  regiones as (
    select region_name,
           count(*) comunas,
           round(avg(igr_score), 1) as igr_ponderado,
           round(avg(igr_score), 1) as igr_medio,
           round(avg(igr_confidence), 1) as confianza_media,
           round(avg(igr_confidence), 1) as cobertura_metodologica_media,
           round(max(igr_score), 1) as igr_max,
           sum(ctx_entities) ctx_entities,
           sum(ctx_uaf_observed) ctx_uaf,
           sum(ctx_sanctioned) ctx_sancionadas,
           sum(ctx_alerted) ctx_con_senal
    from base where igr_score is not null
    group by 1
  ),
  niveles as (
    select igr_level,
           count(*) as comunas,
           case igr_level
             when 'Muy alto' then 0 when 'Alto' then 1 when 'Medio' then 2
             when 'Moderado' then 3 when 'Bajo' then 4 when 'Muy bajo' then 5
             else 6 end as orden
    from base where igr_level is not null group by 1
  ),
  top as (
    select territory_id, region_name, commune_name, commune_code,
           igr_score, igr_level, igr_confidence,
           ctx_entities, ctx_uaf_observed, ctx_sanctioned
    from base order by igr_score desc nulls last limit 25
  ),
  choropleth as (
    select commune_code, territory_id, region_code, region_name, commune_name,
           igr_score, igr_level, igr_confidence,
           ctx_entities, ctx_uaf_observed, ctx_sanctioned, ctx_alerted
    from base
  ),
  cobertura as (
    select count(*) comunas,
           count(*) filter (where ctx_entities > 0) con_universo,
           round(avg(igr_confidence), 1) confianza_media,
           count(*) filter (where igr_confidence < 70) baja_confianza,
           round(avg(igr_confidence), 1) cobertura_metodologica_media,
           count(*) filter (where igr_confidence < 100)::int cobertura_incompleta,
           min(year) anio
    from base
  )
  select jsonb_build_object(
    'contract', 'ATLAS_OBS_TERRITORY_V1',
    'metodologia', jsonb_build_object(
      'indicador', 'IGR',
      'version', 'IGR-2A-1.0.0',
      'vigente_desde', '2026-08-26',
      'formula', 'IGR v2A = 100% amenaza territorial CEAD-LA',
      'capas', jsonb_build_object(
        'amenazas_precedentes_la', 0.55,
        'economia_criminal_facilitadores', 0.35,
        'contexto_criminogeno', 0.10),
      'caracterizacion', jsonb_build_object(
        'intensidad', 0.40, 'persistencia', 0.25, 'tendencia', 0.20, 'anomalia', 0.15),
      'unidad_base', 'comuna',
      'agregacion_regional', 'media comunal simple; cobertura metodológica se publica aparte',
      'quality_note', 'El 86% del IGR v1.0 es cobertura metodológica del catálogo materializado, no confianza estadística comunal.',
      'cobertura_delitos_base', jsonb_build_object(
        'estado', 'DRUG_FAMILY_FALLBACK',
        'materializadas', jsonb_build_array(
          'familia agregada Delitos asociados a drogas (fallback)',
          'receptación', 'robo de vehículo motorizado', 'robo violento de vehículo motorizado',
          'homicidios/femicidios', 'robos con violencia o intimidación',
          'lesiones graves o gravísimas', 'amenazas', 'desórdenes públicos'),
        'no_materializadas', jsonb_build_array(
          'desagregación tráfico / microtráfico / elaboración-producción',
          'comercio ilegal', 'abigeato', 'porte/posesión de armas o explosivos',
          'fraude y estafa', 'corrupción', 'delitos económicos y financieros',
          'contrabando', 'crimen organizado')),
      'excluido_del_indice', jsonb_build_array(
        'vulnerabilidad sectorial', 'materialidad económica SII',
        'densidad de sujetos obligados', 'brecha de cobertura regulatoria',
        'ICR', 'IRAR', 'IPA', 'IVO', 'sanciones de entidad', 'reportabilidad')),
    'cobertura',  (select to_jsonb(c) from cobertura c),
    'regiones',   (select coalesce(jsonb_agg(to_jsonb(r) order by r.igr_medio desc nulls last), '[]') from regiones r),
    'niveles',    (select coalesce(jsonb_agg(jsonb_build_object(
                     'igr_level', nv.igr_level, 'comunas', nv.comunas)
                     order by nv.orden), '[]') from niveles nv),
    'comunas_top',(select coalesce(jsonb_agg(to_jsonb(t)), '[]') from top t),
    'comunas',    (select coalesce(jsonb_agg(to_jsonb(x) order by x.commune_code), '[]') from choropleth x),
    'semantics',  'El IGR describe amenaza territorial, no conducta de entidades. El 86% vigente es cobertura metodológica y se publica separado del score; menor cobertura no es menor amenaza.'
  );
$$;

grant execute on function public.obs_territory_map() to authenticated;

-- Incorporación sidecar al corte programado: si el candidato no responde se
-- conserva el último candidato válido y el IGR de producción sigue operando.
create or replace function public.obs_refresh_full(p_snapshot_id text default null)
returns public.obs_snapshot
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.obs_snapshot;
  v_territory integer;
  v_sector integer;
  v_candidate integer;
begin
  v_row := public.obs_refresh_all(p_snapshot_id);
  v_territory := public.obs_refresh_territory(v_row.snapshot_id);
  v_sector := public.obs_refresh_sector(v_row.snapshot_id);
  v_candidate := public.obs_refresh_territory_igr_candidate();

  update public.obs_snapshot
     set row_counts = row_counts || jsonb_build_object(
           'obs_territory', case when v_territory >= 0 then v_territory
                                 else (select count(*) from public.obs_territory) end,
           'obs_sector', v_sector,
           'obs_territory_igr_candidate', case when v_candidate >= 0 then v_candidate
                                                else (select count(*) from public.obs_territory_igr_candidate) end,
           'territorio_actualizado', v_territory >= 0,
           'igr_candidate_actualizado', v_candidate >= 0)
   where snapshot_id = v_row.snapshot_id
  returning * into v_row;

  return v_row;
end
$$;

revoke all on function public.obs_refresh_full(text) from public, anon, authenticated;
grant execute on function public.obs_refresh_full(text) to service_role;
