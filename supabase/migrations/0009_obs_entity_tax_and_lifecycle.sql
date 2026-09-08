-- ATLAS Observatorio · perfil tributario y ciclo de vida de la entidad
--
-- La ficha describía a la entidad casi sólo por lo que otras fuentes decían de
-- ella. Faltaba lo primero que mira un analista: desde cuándo existe, a qué se
-- dedica, dónde tributa, de qué tamaño es y si sigue operando. Eso ya estaba en
-- la base — aml_entity_tax_profile cubre 45.433 de las 50.516 entidades — pero
-- ningún contrato lo publicaba.
--
-- La línea de tiempo, además, sólo mostraba eventos sueltos del perfil. Un
-- ciclo de vida se lee mejor cuando los hitos estructurales (constitución,
-- inicio de actividades, término de giro) enmarcan a los hechos puntuales
-- (sanciones, prensa).

------------------------------------------------------- tramo de ventas en UF

-- El SII publica el tramo como ordinal 1..13 y el analista necesita el rango en
-- UF. El mapeo no se inventa aquí: es el que ya usa el productor en
-- Radar_SII/src/radar_sii/analytics.py y features.py.
--
-- El tramo 1 NO es "cero ventas": es "sin información". Confundirlos convertiría
-- una ausencia de dato en una afirmación sobre el tamaño de la entidad, que es
-- justo el error que este observatorio no puede cometer.
create or replace function public.obs_sales_band_uf(p_rank integer)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog, pg_temp
as $$
  select case p_rank
    when 1  then 'Sin información de ventas'
    when 2  then '0,01 a 200 UF'
    when 3  then '200,01 a 600 UF'
    when 4  then '600,01 a 2.400 UF'
    when 5  then '2.400,01 a 5.000 UF'
    when 6  then '5.000,01 a 10.000 UF'
    when 7  then '10.000,01 a 25.000 UF'
    when 8  then '25.000,01 a 50.000 UF'
    when 9  then '50.000,01 a 100.000 UF'
    when 10 then '100.000,01 a 200.000 UF'
    when 11 then '200.000,01 a 600.000 UF'
    when 12 then '600.000,01 a 1.000.000 UF'
    when 13 then 'Más de 1.000.000 UF'
    else null
  end;
$$;
comment on function public.obs_sales_band_uf(integer) is
  'Tramo de ventas anuales en UF segun el ordinal 1..13 que publica el SII. El tramo 1 es ausencia de informacion, no ventas cero.';

-- El tamaño en una palabra, para rotular sin obligar a leer el rango completo.
create or replace function public.obs_sales_band_size(p_rank integer)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog, pg_temp
as $$
  select case
    when p_rank is null or p_rank = 1 then null
    when p_rank <= 4  then 'Micro'
    when p_rank <= 6  then 'Pequeña'
    when p_rank <= 9  then 'Mediana'
    else 'Grande'
  end;
$$;
comment on function public.obs_sales_band_size(integer) is
  'Etiqueta de tamano derivada del tramo SII. Descriptiva: no es una clasificacion oficial de la entidad.';

do $$
declare sig text;
begin
  foreach sig in array array[
    'public.obs_sales_band_uf(integer)',
    'public.obs_sales_band_size(integer)'
  ] loop
    execute format('revoke all on function %s from public, anon', sig);
    execute format('grant execute on function %s to authenticated, service_role', sig);
  end loop;
end
$$;

--------------------------------------------------- listado con caracterizacion

-- El listado devolvia identidad y recuentos, pero no decia nada de la entidad:
-- ni desde cuando existe, ni a que se dedica, ni de que tamano es. Se agregan
-- esas columnas. El tipo de retorno cambia, de modo que hay que recrear.
drop function if exists public.obs_search_entities(text,integer,integer,text,text,boolean,boolean,integer);

create or replace function public.obs_search_entities(
  p_q          text default null,
  p_limit      integer default 25,
  p_offset     integer default 0,
  p_region     text default null,
  p_source     text default null,
  p_only_uaf   boolean default false,
  p_only_sanctioned boolean default false,
  p_min_sources integer default null)
returns table (
  entity_id text, rut text, name text, entity_type text,
  region text, commune text, source_count integer, sources text[], roles text[],
  is_uaf_observed boolean, is_sanctioned boolean, uaf_sector text,
  ipa3_score numeric, ipa3_band text,
  event_count integer, finding_count integer, alert_count integer,
  sanction_count integer, match_kind text, match_rank real,
  tax_status text, tax_activity text, tax_region text,
  tax_activity_start date, tax_termination date,
  tax_sales_band_rank integer, tax_sales_band_uf text, tax_size text,
  tax_workers bigint, tax_economic_sector text,
  total_count bigint)
language plpgsql
stable
security invoker
set search_path = public, extensions, pg_temp
as $$
declare
  v_raw   text := nullif(btrim(coalesce(p_q,'')),'');
  v_norm  text := btrim(public.obs_normalize_text(coalesce(p_q,'')));
  v_rut   text := nullif(regexp_replace(upper(coalesce(p_q,'')), '[^0-9K]', '', 'g'), '');
  v_limit integer := greatest(1, least(coalesce(p_limit,25), 100));
  v_off   integer := greatest(0, coalesce(p_offset,0));
  v_is_rut boolean := v_rut is not null and length(v_rut) >= 4
                      and length(v_rut) >= (length(regexp_replace(coalesce(p_q,''),'[^A-Za-z0-9]','','g')) - 1);
begin
  return query
  with base as (
    select e.*,
      case
        when v_is_rut and e.rut_search = v_rut then 'RUT_EXACTO'
        when v_is_rut then 'RUT_PARCIAL'
        when v_norm = '' then 'SIN_CONSULTA'
        when e.name_search = v_norm then 'NOMBRE_EXACTO'
        when e.name_search like v_norm || '%' then 'NOMBRE_INICIO'
        when e.name_search like '%' || v_norm || '%' then 'NOMBRE_CONTIENE'
        else 'NOMBRE_APROXIMADO'
      end as match_kind,
      case when v_norm = '' or v_is_rut then 0::real
           else extensions.similarity(e.name_search, v_norm) end as sim
    from public.obs_entity e
    where
      case
        when v_raw is null then true
        when v_is_rut then e.rut_search like v_rut || '%'
        when v_norm = '' then true
        when length(v_norm) < 3 then e.name_search like v_norm || '%'
        else e.name_search operator(extensions.%) v_norm
          or e.name_search like '%' || v_norm || '%'
      end
      and (p_region is null or e.region = p_region)
      and (p_source is null or p_source = any(e.sources))
      and (not p_only_uaf or e.is_uaf_observed)
      and (not p_only_sanctioned or e.is_sanctioned)
      and (p_min_sources is null or e.source_count >= p_min_sources)
  ),
  counted as (select count(*) over () as total_count, b.* from base b),
  -- La pagina se resuelve antes de enriquecer: unir el perfil tributario sobre
  -- el universo entero pagaria 50 mil busquedas de indice para devolver 25.
  pagina as (
    select c.*, row_number() over () as rn
    from counted c
    order by
      case c.match_kind
        when 'RUT_EXACTO' then 0 when 'RUT_PARCIAL' then 1
        when 'NOMBRE_EXACTO' then 2 when 'NOMBRE_INICIO' then 3
        when 'NOMBRE_CONTIENE' then 4 when 'NOMBRE_APROXIMADO' then 5
        else 6 end,
      round(c.sim::numeric, 1) desc,
      (c.rut is not null) desc,
      c.source_count desc,
      c.sim desc,
      c.ipa3_score desc nulls last,
      c.name
    limit v_limit offset v_off
  )
  select p.entity_id, p.rut, p.name, p.entity_type, p.region, p.commune,
         p.source_count, p.sources, p.roles,
         p.is_uaf_observed, p.is_sanctioned, p.uaf_sector,
         p.ipa3_score, p.ipa3_band,
         p.event_count, p.finding_count, p.alert_count, p.sanction_count,
         p.match_kind, p.sim,
         t.current_status, t.main_activity, t.region,
         t.activity_start_date, t.termination_date,
         t.sales_band_rank, public.obs_sales_band_uf(t.sales_band_rank),
         public.obs_sales_band_size(t.sales_band_rank),
         t.workers_numeric, t.economic_sector,
         p.total_count
  from pagina p
  left join public.aml_entity_tax_profile t on t.entity_id = p.entity_id
  order by p.rn;
end
$$;

revoke all on function public.obs_search_entities(text,integer,integer,text,text,boolean,boolean,integer) from public, anon;
grant execute on function public.obs_search_entities(text,integer,integer,text,text,boolean,boolean,integer) to authenticated, service_role;

------------------------------------------ ficha con tributario y ciclo de vida

-- Reemplaza la definicion de 0003 agregando tres secciones: tax, res y
-- lifecycle. El resto del contrato se conserva tal cual.
create or replace function public.obs_entity_detail(p_entity_id text)
returns jsonb
language sql
stable
security invoker
set search_path = public, extensions, pg_temp
as $$
  with e as (select * from public.obs_entity where entity_id = p_entity_id),
  raw as (select profile from public.aml_entities where entity_id = p_entity_id),
  coverage as (
    select h.source_code, h.source_name, h.source_class, h.integration_mode,
           h.authoritative_source, h.data_status as source_data_status,
           coalesce(es.status,
             case when h.integration_mode = 'on_demand' or h.scope_partial
                  then 'NOT_CONSULTED' else 'ABSENT' end) as status,
           es.record_count, es.last_event_at, coalesce(es.detail,'{}'::jsonb) detail
    from public.obs_source_health h
    left join public.obs_entity_source es
      on es.source_code = h.source_code and es.entity_id = p_entity_id
  ),
  findings as (
    select finding_key, finding_id, finding_type, title, region, commune,
           score_explore, score_supervise, score_investigate,
           source_count, evidence_count, payload
    from public.obs_finding where entity_id = p_entity_id
    order by coalesce(score_investigate,0) desc limit 60
  ),
  alerts as (
    select alert_id, family, pattern_type, scope_type, scope_label,
           strength, priority, title, summary, payload
    from public.obs_alert where scope_type = 'ENTITY' and scope_id = p_entity_id
    order by strength desc nulls last
  ),
  -- La sancion sin su documento obliga al analista a buscarla a mano en el sitio
  -- del regulador. La radiografia resuelve identidad y conserva la URL de la
  -- resolucion: 984 de las 988 sanciones cruzan por event_id y todas traen
  -- enlace. document_quality viaja con el enlace porque no todos apuntan al
  -- acto exacto: PARTIAL puede ser un documento que cubre varios eventos.
  sanctions as (
    select s.sanction_id, s.event_date, s.regulator, s.subject, s.identity_status,
           s.laft_direct, s.amount_uf, s.payload,
           r.document_url, r.document_quality, r.document_excerpt,
           s.payload->'attributes'->>'resolution' as resolution_ref
    from public.aml_sanctions s
    left join public.aml_sanctions_radiography_runtime_snapshot_v0961 r
      on r.event_id = s.sanction_id
    where s.entity_id = p_entity_id
    order by s.event_date desc nulls last limit 40
  ),
  marks as (
    select mark_id, mark_name, semantic_class, primary_dimension, score_group,
           included_in_score, raw_intensity, contribution, confidence, readiness, evidence
    from public.aml_ipa3_mark_scores_snapshot_v0_4 where entity_id = p_entity_id
    order by contribution desc nulls last
  ),
  uaf as (
    select uaf_sector_canonical, subject_nature, registry_observed_at,
           sii_status, sii_main_activity, sii_sales_band, sii_workers,
           sii_activity_start_date, entity_age_years,
           ownership_edge_count, legal_entity_partner_count, societies_as_partner_count,
           sanction_event_count, sanction_event_count_5y, sanction_last_event_date,
           ipf_score, ipf_band, ipf_credibility_pct, ipf_percentile,
           ipf_sector_percentile, ipf_flags, sector_vulnerability, semantics
    from public.aml_uaf_obligated_subject_snapshot where entity_id = p_entity_id limit 1
  ),
  -- Perfil tributario. Cubre 45.433 de las 50.516 entidades observadas, de modo
  -- que es la caracterizacion mas amplia disponible: existe para muchas mas
  -- entidades que el padron UAF.
  tax as (
    select t.commercial_year, t.current_status,
           t.activity_start_date, t.termination_date, t.first_activity_registration_date,
           t.region, t.province, t.commune,
           t.main_activity, t.economic_sector, t.economic_subsector,
           t.activity_count, t.activity_codes, t.activity_names,
           t.latest_activity_registration_date,
           t.sales_band, t.sales_band_code, t.sales_band_rank,
           public.obs_sales_band_uf(t.sales_band_rank)   as sales_band_uf,
           public.obs_sales_band_size(t.sales_band_rank) as size_label,
           t.workers_numeric,
           t.taxpayer_type, t.taxpayer_subtype,
           t.positive_equity_band, t.negative_equity_band,
           t.society_type, t.society_subtype,
           t.ownership_edge_count, t.legal_entity_partner_count,
           t.societies_as_partner_count,
           t.address_count, t.current_address_count, t.communes as address_communes,
           t.signal_count, t.signal_types, t.updated_at
    from public.aml_entity_tax_profile t where t.entity_id = p_entity_id limit 1
  ),
  res as (
    select r.constitution_date, r.company_age_days, r.observed_lifecycle_state,
           r.actuation_count, r.constitution_count, r.modification_count,
           r.transformation_count, r.merger_count, r.division_count,
           r.dissolution_count, r.first_actuation_date, r.last_actuation_date,
           r.last_change_date, r.relationship_count,
           r.ownership_relationship_count, r.governance_relationship_count,
           r.coverage_note
    from public.aml_entity_res_lifecycle_v0556 r where r.entity_id = p_entity_id limit 1
  ),
  res_cap as (
    select c.capital, c.registry_date, c.sii_approval_date, c.tax_region, c.social_region
    from public.aml_res_company c join e on c.rut = e.rut limit 1
  ),
  -- Hitos estructurales del ciclo de vida, ordenados. Enmarcan a los hechos
  -- puntuales (sanciones, prensa) que la ficha ya trae por separado.
  lifecycle as (
    select kind, fecha, etiqueta, fuente, detalle
    from (
      select 'CONSTITUCION_RES' kind,
             (select constitution_date from res) fecha,
             'Constitución de la sociedad' etiqueta,
             'Registro de Empresas y Sociedades' fuente,
             (select nullif(concat_ws(' · ',
                nullif(observed_lifecycle_state,''),
                case when actuation_count > 0
                     then actuation_count || ' actuaciones registradas' end), '') from res) detalle
      union all
      select 'INICIO_ACTIVIDADES',
             (select activity_start_date from tax),
             'Inicio de actividades',
             'Servicio de Impuestos Internos',
             (select main_activity from tax)
      union all
      select 'TERMINO_GIRO',
             (select termination_date from tax),
             'Término de giro',
             'Servicio de Impuestos Internos',
             'La entidad cerró su giro tributario'
    ) m
    where m.fecha is not null
    order by 2
  )
  select case when (select count(*) from e) = 0 then null else jsonb_build_object(
    'contract', 'ATLAS_OBS_ENTITY_V1',
    'entity',   (select to_jsonb(x) from e x),
    'identity', jsonb_build_object(
        'method',     (select profile->>'identity_method_es' from raw),
        'confidence', (select (profile->>'identity_confidence')::numeric from raw),
        'territory',  (select profile->'ubicacion' from raw)),
    'events',   coalesce((select profile->'eventos' from raw), '[]'::jsonb),
    'context',  coalesce((select profile->'contexto' from raw), '{}'::jsonb),
    'coverage', (select coalesce(jsonb_agg(to_jsonb(c) order by
                          case c.status when 'PRESENT' then 0 when 'ABSENT' then 1 else 2 end,
                          c.source_class, c.source_code), '[]') from coverage c),
    'findings', (select coalesce(jsonb_agg(to_jsonb(f)), '[]') from findings f),
    'alerts',   (select coalesce(jsonb_agg(to_jsonb(a)), '[]') from alerts a),
    'sanctions',(select coalesce(jsonb_agg(to_jsonb(s)), '[]') from sanctions s),
    'marks',    (select coalesce(jsonb_agg(to_jsonb(m)), '[]') from marks m),
    'priority', (select to_jsonb(i) from (
        select ipa3_score, priority_band_shadow, score_confidence_pct, coverage_index_pct,
               dominant_mark_id, included_mark_count, independent_group_count,
               registry_group_score, economic_group_score, sanctions_group_score,
               registry_driver_mark, economic_driver_mark, sanctions_driver_mark,
               reconciliation_status, score_as_of, score_version, semantics
        from public.aml_ipa3_entity_score_snapshot_v0_4
        where entity_id = p_entity_id limit 1) i),
    'uaf',      (select to_jsonb(u) from uaf u),
    'tax',      (select to_jsonb(t) from tax t),
    'res',      (select (to_jsonb(r) || coalesce((select to_jsonb(rc) from res_cap rc), '{}'::jsonb)) from res r),
    'lifecycle',(select coalesce(jsonb_agg(to_jsonb(l) order by l.fecha), '[]') from lifecycle l),
    'lifecycle_notes', jsonb_build_object(
        'uaf_registration_date', false,
        'uaf_registration_note',
          'El registro de sujetos obligados no publica fecha de inscripción. Lo único fechado es cuándo el Observatorio observó a la entidad en el padrón.',
        'uaf_observed_at', (select registry_observed_at from uaf),
        'res_coverage_note',
          'El Registro de Empresas y Sociedades sólo cubre sociedades acogidas al régimen simplificado. Su ausencia no significa que la entidad no exista.',
        'sales_band_note',
          'El tramo de ventas es el ordinal que publica el SII, expresado en UF anuales. El tramo más bajo significa ausencia de información, no ventas cero.'),
    'osfl',     (select to_jsonb(o) from (
        select confirmation_level, profile_activity_group, main_activity, activity_names,
               law21440_active, registro19862, fatf_r8_candidate,
               sales_band, workers_numeric, current_status,
               activity_start_date, termination_date, first_year, latest_year,
               max_sales_band_increase, max_sales_band_decrease,
               sanction_count, regulator_count, latest_sanction_date
        from public.aml_osfl_entity_runtime_snapshot
        where entity_id = p_entity_id limit 1) o),
    'peers',    (select coalesce(jsonb_agg(to_jsonb(p)), '[]') from (
        select commercial_year, peer_level, peer_n, sales_peer_percentile,
               sales_band_code, sales_band_delta, workforce_ratio,
               economic_sector, main_activity_changed, region_changed
        from public.aml_entity_peer_position_snapshot where entity_id = p_entity_id
        order by commercial_year desc limit 8) p),
    'links',    (select coalesce(jsonb_agg(to_jsonb(l)), '[]') from (
        select relacion_id, entidad_origen_id, entidad_destino_id, tipo_relacion,
               estado_relacion, metodo_relacion, confianza,
               utilizable_en_analisis, requiere_revision
        from public.aml_entity_identity_link_snapshot
        where entidad_origen_id = p_entity_id or entidad_destino_id = p_entity_id
        limit 40) l),
    'semantics','Ficha de observación. Reúne lo que las fuentes abiertas gobernadas registran sobre la entidad. No es un expediente ni una decisión institucional.'
  ) end;
$$;
