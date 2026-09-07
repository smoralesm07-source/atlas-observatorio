-- ATLAS Observatorio · contratos de territorio y sector. SECURITY INVOKER.

------------------------------------------------------------ obs_territory_map
-- La agregacion regional del contrato es media comunal ponderada por confianza:
-- una comuna con confianza baja no arrastra la region.
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
    'semantics',  'El IGR describe amenaza territorial, no la conducta de las entidades domiciliadas ahí. No es probabilidad de LA/FT y no se transfiere a ninguna entidad. La confianza se publica aparte: menor cobertura no es menor riesgo.'
  );
$$;

--------------------------------------------------------- obs_territory_detail
create or replace function public.obs_territory_detail(p_territory_id text)
returns jsonb
language sql
stable
security invoker
set search_path = public, extensions, pg_temp
as $$
  with t as (select * from public.obs_territory where territory_id = p_territory_id),
  pares as (
    select round(avg(o.igr_score), 1) igr_region,
           count(*) comunas_region,
           (select count(*) + 1 from public.obs_territory x
             where x.region_name = (select region_name from t)
               and x.igr_score > (select igr_score from t)) posicion_en_region
    from public.obs_territory o
    where o.region_name = (select region_name from t)
  ),
  nacional as (
    select (select count(*) + 1 from public.obs_territory x
             where x.igr_score > (select igr_score from t)) posicion_nacional,
           count(*) comunas_pais
    from public.obs_territory
  ),
  entidades as (
    select e.entity_id, e.rut, e.name, e.entity_type, e.uaf_sector,
           e.is_uaf_observed, e.is_sanctioned, e.ipa3_score, e.source_count,
           e.alert_count, e.finding_count
    from public.obs_entity e
    where e.commune is not null
      and public.obs_normalize_text(e.commune) = (select commune_search from t)
    order by e.ipa3_score desc nulls last, e.source_count desc
    limit 40
  ),
  sectores as (
    select e.uaf_sector, count(*) n
    from public.obs_entity e
    where e.uaf_sector is not null
      and e.commune is not null
      and public.obs_normalize_text(e.commune) = (select commune_search from t)
    group by 1 order by 2 desc limit 10
  )
  select case when (select count(*) from t) = 0 then null else jsonb_build_object(
    'contract', 'ATLAS_OBS_TERRITORY_DETAIL_V1',
    'territorio', (select to_jsonb(x) from t x),
    'posicion',   (select to_jsonb(p) from pares p) || (select to_jsonb(n) from nacional n),
    'entidades',  (select coalesce(jsonb_agg(to_jsonb(e)), '[]') from entidades e),
    'sectores',   (select coalesce(jsonb_agg(to_jsonb(s)), '[]') from sectores s),
    'semantics',  'Las entidades listadas están domiciliadas en esta comuna. El IGR describe la amenaza del territorio y no se atribuye a ninguna de ellas: estar aquí no es un indicio sobre la entidad.'
  ) end;
$$;

------------------------------------------------------------ obs_sector_overview
create or replace function public.obs_sector_overview()
returns jsonb
language sql
stable
security invoker
set search_path = public, extensions, pg_temp
as $$
  with s as (select * from public.obs_sector),
  totales as (
    select count(*) sectores,
           sum(subject_count) inscritos,
           sum(sanctioned_subjects) sancionados,
           sum(sanction_events) eventos,
           round(avg(vulnerability_index), 1) vulnerabilidad_media,
           round(avg(sii_coverage_pct), 1) cobertura_sii_media
    from s
  ),
  ranking as (
    select uaf_sector_canonical, uaf_sector_id, subject_count,
           vulnerability_index, risk_inherent_1_5, key_role,
           ipf_mean, ipf_p90, sanctioned_subjects, sanction_events,
           sanction_rate_per_100, sii_coverage_pct, top_region,
           top_region_share_pct, natural_person_subjects,
           band_muy_alta, band_alta, band_media, band_baja, band_minima,
           atypical_activity_subjects
    from s
  )
  select jsonb_build_object(
    'contract', 'ATLAS_OBS_SECTOR_V1',
    'metodologia', jsonb_build_object(
      'vulnerabilidad', 'Vulnerabilidad estructural del sector: media simple de seis dimensiones (efectivo, opacidad, internacionalidad, velocidad, terceros, complejidad jurídica), escala 1-5 adaptada a 0-100. Describe el sector, nunca la conducta de una entidad inscrita.',
      'ipf', 'Índice de Priorización Fiscalizadora. Ordena esfuerzo de fiscalización sobre inscritos. No es probabilidad de LA/FT ni imputación de incumplimiento.',
      'tasa_sancionatoria', 'Describe lo que la UAF ha publicado, no la conducta agregada del sector.',
      'irar_e', jsonb_build_object(
        'estado', 'FORMULA_GOBERNADA_SIN_MATERIALIZAR',
        'formula', 'IRAR-E = 0,40 vulnerabilidad estructural + 0,30 materialidad + 0,30 amenaza',
        'nota', 'ATLAS declara la fórmula pero sus insumos aún no están materializados. El Observatorio no la presenta como si existiera.')),
    'totales',  (select to_jsonb(t) from totales t),
    'sectores', (select coalesce(jsonb_agg(to_jsonb(r) order by r.subject_count desc), '[]') from ranking r),
    'semantics','Un sector con vulnerabilidad estructural alta no contiene entidades más culpables: contiene un modelo de negocio más expuesto. El indicador ordena dónde mirar, no a quién imputar.'
  );
$$;

-------------------------------------------------------------- obs_sector_detail
create or replace function public.obs_sector_detail(p_sector text)
returns jsonb
language sql
stable
security invoker
set search_path = public, extensions, pg_temp
as $$
  with s as (
    select * from public.obs_sector
    where uaf_sector_canonical = p_sector
       or sector_search = public.obs_normalize_text(p_sector)
    limit 1
  ),
  territorio as (
    select e.region, count(*) n,
           count(*) filter (where e.is_sanctioned) sancionadas
    from public.obs_entity e
    where e.uaf_sector = (select uaf_sector_canonical from s)
      and e.region is not null
    group by 1 order by 2 desc limit 16
  ),
  entidades as (
    select e.entity_id, e.rut, e.name, e.region, e.commune,
           e.is_sanctioned, e.ipa3_score, e.ipa3_band, e.source_count,
           e.alert_count, e.finding_count
    from public.obs_entity e
    where e.uaf_sector = (select uaf_sector_canonical from s)
    order by e.ipa3_score desc nulls last, e.source_count desc
    limit 40
  ),
  pares as (
    select round(avg(vulnerability_index), 1) vulnerabilidad_media,
           round(avg(ipf_mean), 1) ipf_medio,
           round(avg(sanction_rate_per_100), 2) tasa_media,
           count(*) sectores
    from public.obs_sector
  )
  select case when (select count(*) from s) = 0 then null else jsonb_build_object(
    'contract', 'ATLAS_OBS_SECTOR_DETAIL_V1',
    'sector',     (select to_jsonb(x) from s x),
    'comparacion',(select to_jsonb(p) from pares p),
    'territorio', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from territorio t),
    'entidades',  (select coalesce(jsonb_agg(to_jsonb(e)), '[]') from entidades e),
    'semantics',  'Los giros característicos miden el padrón vigente, no son una tabla normativa de correspondencias. Una entidad puede declarar un giro atípico para su sector sin que eso constituya incumplimiento.'
  ) end;
$$;

do $$
declare sig text;
begin
  foreach sig in array array[
    'public.obs_territory_map()',
    'public.obs_territory_detail(text)',
    'public.obs_sector_overview()',
    'public.obs_sector_detail(text)'
  ] loop
    execute format('revoke all on function %s from public, anon', sig);
    execute format('grant execute on function %s to authenticated, service_role', sig);
  end loop;
end
$$;
