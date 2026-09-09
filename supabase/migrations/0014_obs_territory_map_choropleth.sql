-- ATLAS Observatorio · el contrato territorial publica el corte comunal completo.
--
-- Hasta 0006 el contrato entregaba agregados regionales y las 25 comunas de
-- mayor amenaza. Eso alcanzaba para barras y tabla, pero no para un mapa: un
-- coropleta necesita las 345 comunas evaluadas o pinta huecos donde sí hay
-- dato. Se agrega la clave `comunas` con el corte completo en forma compacta.
--
-- Sigue siendo el mismo indicador y la misma agregacion: no se recalcula nada
-- aqui. Las columnas ctx_* viajan como contexto descriptivo, fuera del indice,
-- igual que en el resto del contrato.

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
           round(sum(igr_score * coalesce(igr_confidence, 0))
                 / nullif(sum(coalesce(igr_confidence, 0)), 0), 1) as igr_ponderado,
           round(avg(igr_confidence), 1) as confianza_media,
           round(max(igr_score), 1) as igr_max,
           sum(ctx_entities) ctx_entities,
           sum(ctx_uaf_observed) ctx_uaf,
           sum(ctx_sanctioned) ctx_sancionadas,
           sum(ctx_alerted) ctx_con_senal
    from base where igr_score is not null
    group by 1
  ),
  -- El nivel es una escala ordenada y sale en su orden, no alfabetico.
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
  -- Corte comunal completo para el mapa. Se une por CUT con la geometria
  -- estatica del cliente; la geometria no trae puntajes y este contrato no
  -- trae formas.
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
      'agregacion_regional', 'media comunal ponderada por confianza CEAD',
      'cobertura_delitos_base', jsonb_build_object(
        'estado', 'DRUG_DOMINANT',
        'materializadas', jsonb_build_array(
          'tráfico de sustancias', 'microtráfico', 'elaboración o producción'),
        'no_materializadas', jsonb_build_array(
          'fraude y estafa', 'corrupción', 'delitos económicos y financieros',
          'contrabando', 'crimen organizado')),
      'excluido_del_indice', jsonb_build_array(
        'vulnerabilidad sectorial', 'materialidad económica SII',
        'densidad de sujetos obligados', 'brecha de cobertura regulatoria',
        'ICR', 'IRAR', 'IPA', 'IVO', 'sanciones de entidad', 'reportabilidad')),
    'cobertura',  (select to_jsonb(c) from cobertura c),
    'regiones',   (select coalesce(jsonb_agg(to_jsonb(r) order by r.igr_ponderado desc nulls last), '[]') from regiones r),
    'niveles',    (select coalesce(jsonb_agg(jsonb_build_object(
                     'igr_level', nv.igr_level, 'comunas', nv.comunas)
                     order by nv.orden), '[]') from niveles nv),
    'comunas_top',(select coalesce(jsonb_agg(to_jsonb(t)), '[]') from top t),
    'comunas',    (select coalesce(jsonb_agg(to_jsonb(x) order by x.commune_code), '[]') from choropleth x),
    'semantics',  'El IGR describe amenaza territorial, no la conducta de las entidades domiciliadas ahí. No es probabilidad de LA/FT y no se transfiere a ninguna entidad. La confianza se publica aparte: menor cobertura no es menor riesgo.'
  );
$$;

comment on function public.obs_territory_map() is
  'Contrato territorial: metodologia IGR v2A, cobertura, agregado regional, distribucion por nivel, top 25 y el corte comunal completo para el mapa.';
