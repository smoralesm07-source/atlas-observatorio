-- Promoción del IGR validado a la lectura territorial principal de Atlas.
-- La versión técnica se conserva para trazabilidad, pero el contrato público sigue llamándolo IGR.

alter table public.obs_territory
  add column if not exists igr_percentile numeric,
  add column if not exists igr_methodological_coverage numeric,
  add column if not exists igr_confidence_level text,
  add column if not exists igr_boundary_status text,
  add column if not exists igr_boundary_distance numeric;

comment on column public.obs_territory.igr_percentile is
  'Posición relativa nacional del score IGR, 0-100. No es probabilidad ni una segunda fórmula de amenaza.';
comment on column public.obs_territory.igr_confidence is
  'Robustez de la estimación IGR. Se publica separada del score y no lo modifica.';
comment on column public.obs_territory.igr_level is
  'Banda secundaria de lectura del IGR. El score continuo y el percentil nacional son las salidas primarias.';
comment on column public.obs_territory.igr_methodological_coverage is
  'Cobertura metodológica del catálogo materializado. No equivale a confianza estadística ni a menor amenaza.';

create or replace function public.obs_refresh_territory(p_snapshot_id text)
returns integer
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_url text := 'https://raw.githubusercontent.com/smoralesm07-source/Radar_delictual/'
             || 'radar-data/data/processed/cead_geographic_score.json';
  v_resp extensions.http_response;
  v_rows jsonb;
  v_n integer;
begin
  select * into v_resp from extensions.http_get(v_url);

  if v_resp.status <> 200 then
    raise warning 'obs_refresh_territory: la fuente IGR respondio HTTP %', v_resp.status;
    return -1;
  end if;

  v_rows := v_resp.content::jsonb;
  if jsonb_typeof(v_rows) <> 'array' or jsonb_array_length(v_rows) < 300 then
    raise warning 'obs_refresh_territory: la fuente IGR no devolvio un corte comunal completo';
    return -1;
  end if;

  create temp table _obs_ctx on commit drop as
  select public.obs_normalize_text(e.commune)                        as commune_search,
         count(*)::int                                               as entities,
         count(*) filter (where e.is_uaf_observed)::int              as uaf_observed,
         count(*) filter (where e.is_sanctioned)::int                as sanctioned,
         count(*) filter (where e.alert_count > 0)::int              as alerted,
         coalesce(sum(e.finding_count), 0)::int                      as findings
  from public.obs_entity e
  where e.commune is not null
  group by 1;

  create unique index on _obs_ctx (commune_search);

  -- Solo se reemplaza el corte después de validar que la fuente está disponible.
  delete from public.obs_territory;

  insert into public.obs_territory (
    territory_id, region_code, region_name, commune_code, commune_name, commune_search,
    year, period, igr_score, igr_percentile, igr_level, igr_confidence,
    igr_methodological_coverage, igr_confidence_level,
    igr_boundary_status, igr_boundary_distance,
    layer_weights, layers, interpretation, score_version,
    ctx_entities, ctx_uaf_observed, ctx_sanctioned, ctx_alerted, ctx_findings,
    snapshot_id, refreshed_at)
  select
    r->>'territory_id',
    r->>'region_code',
    r->>'region_name',
    r->>'commune_code',
    r->>'commune_name',
    public.obs_normalize_text(r->>'commune_name'),
    nullif(r->>'year','')::int,
    r->>'period',
    nullif(r->>'score','')::numeric,
    nullif(r->>'national_percentile','')::numeric,
    coalesce(nullif(r->>'provisional_level',''), nullif(r->>'level','')),
    nullif(r->>'confidence','')::numeric,
    nullif(r->>'methodological_coverage','')::numeric,
    r->>'confidence_level',
    r->>'provisional_boundary_status',
    nullif(r->>'provisional_boundary_distance','')::numeric,
    coalesce(r->'layer_weights','{}'::jsonb),
    coalesce(r->'layers','{}'::jsonb),
    r->>'interpretation',
    r->>'score_version',
    coalesce(c.entities, 0),
    coalesce(c.uaf_observed, 0),
    coalesce(c.sanctioned, 0),
    coalesce(c.alerted, 0),
    coalesce(c.findings, 0),
    p_snapshot_id,
    now()
  from jsonb_array_elements(v_rows) r
  left join _obs_ctx c
    on c.commune_search = public.obs_normalize_text(r->>'commune_name')
  where nullif(r->>'territory_id','') is not null;

  get diagnostics v_n = row_count;
  return v_n;
end
$function$;

create or replace function public.obs_territory_map()
returns jsonb
language sql
stable
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
  with base as (select * from public.obs_territory),
  regiones as (
    select region_name, count(*) comunas,
      round(avg(igr_score),1) as igr_ponderado,
      round(avg(igr_score),1) as igr_medio,
      round(avg(igr_confidence),1) as confianza_media,
      round(avg(igr_methodological_coverage),1) as cobertura_metodologica_media,
      round(max(igr_score),1) as igr_max,
      sum(ctx_entities) ctx_entities, sum(ctx_uaf_observed) ctx_uaf,
      sum(ctx_sanctioned) ctx_sancionadas, sum(ctx_alerted) ctx_con_senal
    from base where igr_score is not null group by 1
  ),
  niveles as (
    select igr_level,count(*) as comunas,
      case igr_level when 'Muy alto' then 0 when 'Alto' then 1 when 'Medio' then 2
        when 'Moderado' then 3 when 'Bajo' then 4 when 'Muy bajo' then 5 else 6 end as orden
    from base where igr_level is not null group by 1
  ),
  top as (
    select territory_id,region_name,commune_name,commune_code,
      igr_score,igr_percentile,igr_level,igr_confidence,igr_methodological_coverage,
      igr_confidence_level,igr_boundary_status,igr_boundary_distance,
      ctx_entities,ctx_uaf_observed,ctx_sanctioned
    from base order by igr_score desc nulls last limit 25
  ),
  choropleth as (
    select commune_code,territory_id,region_code,region_name,commune_name,
      igr_score,igr_percentile,igr_level,igr_confidence,igr_methodological_coverage,
      igr_confidence_level,igr_boundary_status,igr_boundary_distance,
      ctx_entities,ctx_uaf_observed,ctx_sanctioned,ctx_alerted
    from base
  ),
  cobertura as (
    select count(*) comunas,count(*) filter (where ctx_entities>0) con_universo,
      round(avg(igr_confidence),1) confianza_media,
      count(*) filter (where igr_confidence<86) baja_confianza,
      round(avg(igr_methodological_coverage),1) cobertura_metodologica_media,
      count(*) filter (where igr_methodological_coverage<100)::int cobertura_incompleta,
      min(year) anio
    from base
  )
  select jsonb_build_object(
    'contract','ATLAS_OBS_TERRITORY_V1',
    'metodologia',jsonb_build_object(
      'indicador','IGR','version','1.1.0','vigente_desde','2026-09-09',
      'formula','IGR = suma ponderada de capas; lectura primaria = score 0-100 + percentil nacional',
      'capas',jsonb_build_object('amenazas_precedentes_la',0.55,'economia_criminal_facilitadores',0.35,'contexto_criminogeno',0.10),
      'caracterizacion',jsonb_build_object('intensidad',0.40,'persistencia',0.25,'tendencia',0.20,'anomalia',0.15),
      'unidad_base','comuna',
      'agregacion_regional','media comunal simple; confianza y cobertura metodologica se publican por separado',
      'quality_note','La confianza mide robustez de la estimación y no modifica el score. La cobertura metodológica describe disponibilidad del catálogo y tampoco modifica el score.',
      'cobertura_delitos_base',jsonb_build_object(
        'estado','DRUG_FAMILY_FALLBACK',
        'materializadas',jsonb_build_array('familia agregada Delitos asociados a drogas (fallback)','receptación','robo de vehículo motorizado','robo violento de vehículo motorizado','homicidios/femicidios','robos con violencia o intimidación','lesiones graves o gravísimas','amenazas','desórdenes públicos'),
        'no_materializadas',jsonb_build_array('desagregación tráfico / microtráfico / elaboración-producción','comercio ilegal','abigeato','porte/posesión de armas o explosivos','fraude y estafa','corrupción','delitos económicos y financieros','contrabando','crimen organizado')),
      'excluido_del_indice',jsonb_build_array('vulnerabilidad sectorial','materialidad económica SII','densidad de sujetos obligados','brecha de cobertura regulatoria','ICR','IRAR','IPA','IVO','sanciones de entidad','reportabilidad')),
    'cobertura',(select to_jsonb(c) from cobertura c),
    'regiones',(select coalesce(jsonb_agg(to_jsonb(r) order by r.igr_medio desc nulls last),'[]') from regiones r),
    'niveles',(select coalesce(jsonb_agg(jsonb_build_object('igr_level',nv.igr_level,'comunas',nv.comunas) order by nv.orden),'[]') from niveles nv),
    'comunas_top',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from top t),
    'comunas',(select coalesce(jsonb_agg(to_jsonb(x) order by x.commune_code),'[]') from choropleth x),
    'semantics','El IGR describe amenaza territorial comunal, no conducta de entidades ni probabilidad de LA/FT. Score y percentil nacional son la lectura principal; confianza expresa robustez y la banda es contexto secundario.'
  );
$function$;
