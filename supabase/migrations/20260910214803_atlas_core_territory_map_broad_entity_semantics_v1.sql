-- Territorio: ctx_entities pasa a representar el universo territorial amplio.
-- El subconjunto analítico permanece disponible como ctx_atlas_observed.

create or replace function public.obs_territory_map()
returns jsonb
language sql
stable
security invoker
set search_path = public, atlas_core, extensions, pg_temp
as $$
  with base as (
    select t.*,
      coalesce(s.universe_total,0)::bigint as ctx_universe,
      coalesce(s.sii_active,0)::bigint as ctx_sii_active,
      coalesce(s.sii_terminated,0)::bigint as ctx_sii_terminated,
      coalesce(s.res_total,0)::bigint as ctx_res_total,
      coalesce(s.atlas_observed,t.ctx_entities,0)::bigint as ctx_atlas_observed,
      s.atlas_coverage_pct as ctx_atlas_coverage_pct
    from public.obs_territory t
    left join atlas_core.territory_snapshot s using (territory_id)
  ),
  regiones as (
    select region_name, count(*) comunas,
      round(avg(igr_score),1) as igr_ponderado,
      round(avg(igr_score),1) as igr_medio,
      round(avg(igr_confidence),1) as confianza_media,
      round(avg(igr_methodological_coverage),1) as cobertura_metodologica_media,
      round(max(igr_score),1) as igr_max,
      sum(ctx_universe) ctx_entities,
      sum(ctx_universe) ctx_universe,
      sum(ctx_sii_active) ctx_sii_active,
      sum(ctx_sii_terminated) ctx_sii_terminated,
      sum(ctx_res_total) ctx_res_total,
      sum(ctx_atlas_observed) ctx_atlas_observed,
      sum(ctx_uaf_observed) ctx_uaf,
      sum(ctx_sanctioned) ctx_sancionadas,
      sum(ctx_alerted) ctx_con_senal
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
      ctx_universe as ctx_entities,ctx_universe,ctx_sii_active,ctx_sii_terminated,ctx_res_total,
      ctx_atlas_observed,ctx_atlas_coverage_pct,ctx_uaf_observed,ctx_sanctioned
    from base order by igr_score desc nulls last limit 25
  ),
  choropleth as (
    select commune_code,territory_id,region_code,region_name,commune_name,
      igr_score,igr_percentile,igr_level,igr_confidence,igr_methodological_coverage,
      igr_confidence_level,igr_boundary_status,igr_boundary_distance,
      ctx_universe as ctx_entities,ctx_universe,ctx_sii_active,ctx_sii_terminated,ctx_res_total,
      ctx_atlas_observed,ctx_atlas_coverage_pct,ctx_uaf_observed,ctx_sanctioned,ctx_alerted
    from base
  ),
  cobertura as (
    select count(*) comunas,
      count(*) filter (where ctx_universe>0) con_universo,
      count(*) filter (where ctx_universe>0) con_universo_amplio,
      sum(ctx_universe)::bigint universo_total,
      sum(ctx_sii_active)::bigint sii_active_total,
      sum(ctx_sii_terminated)::bigint sii_terminated_total,
      sum(ctx_res_total)::bigint res_total,
      sum(ctx_atlas_observed)::bigint atlas_observed_total,
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
    'semantics','El IGR describe amenaza territorial comunal, no conducta de entidades ni probabilidad de LA/FT. En este contrato, ctx_entities representa el universo territorial amplio con geografía resuelta; ctx_atlas_observed conserva el subconjunto analíticamente materializado por Atlas.'
  );
$$;
revoke all on function public.obs_territory_map() from public, anon;
grant execute on function public.obs_territory_map() to authenticated, service_role;
