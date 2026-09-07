-- ATLAS Observatorio · read contracts
--
-- Every function is SECURITY INVOKER, so the allowlist RLS on obs_* stays the
-- single authorization authority. A screen consumes a contract, not a table.

---------------------------------------------------------------- obs_pulse
create or replace function public.obs_pulse()
returns jsonb
language sql
stable
security invoker
set search_path = public, extensions, pg_temp
as $$
  with snap as (
    select * from public.obs_snapshot
    where status = 'READY' order by generated_at desc limit 1
  ),
  universe as (
    select count(*) entities,
           count(*) filter (where is_uaf_observed) uaf_observed,
           count(*) filter (where is_sanctioned) sanctioned,
           count(*) filter (where source_count >= 3) multi_source,
           count(*) filter (where alert_count > 0) with_alerts,
           count(distinct region) filter (where region is not null) regions
    from public.obs_entity
  ),
  alert_priority as (
    select coalesce(priority,'SIN PRIORIDAD') priority, count(*) n,
           round(avg(strength),1) avg_strength
    from public.obs_alert group by 1
  ),
  alert_family as (
    select family, count(*) n, round(max(strength),1) peak,
           count(*) filter (where priority in ('MUY ALTA','ALTA')) urgent
    from public.obs_alert group by 1
  ),
  finding_mix as (
    select finding_type, count(*) n,
           round(avg(coalesce(score_investigate,0)),1) avg_investigate
    from public.obs_finding group by 1
  ),
  sources as (
    select source_class,
           count(*) n,
           count(*) filter (where data_status = 'fresh') fresh,
           count(*) filter (where data_status = 'silent') silent,
           count(*) filter (where data_status not in ('fresh','silent')
                               or data_status is null) unknown
    from public.obs_source_health group by 1
  ),
  top_alerts as (
    select alert_id, family, pattern_type, scope_type, scope_id, scope_label,
           strength, priority, title, summary
    from public.obs_alert
    order by case priority when 'MUY ALTA' then 0 when 'ALTA' then 1
                           when 'MEDIA' then 2 else 3 end,
             strength desc nulls last
    limit 8
  ),
  territory as (
    select region, count(*) entities,
           count(*) filter (where is_sanctioned) sanctioned,
           count(*) filter (where alert_count > 0) alerted,
           round(avg(ipa3_score) filter (where ipa3_score is not null),1) avg_priority
    from public.obs_entity where region is not null
    group by 1 order by count(*) desc limit 16
  )
  select jsonb_build_object(
    'contract',  'ATLAS_OBS_PULSE_V1',
    'snapshot',  (select to_jsonb(s) from snap s),
    'universe',  (select to_jsonb(u) from universe u),
    'alerts', jsonb_build_object(
        'total',     (select count(*) from public.obs_alert),
        'by_priority',(select coalesce(jsonb_agg(to_jsonb(p) order by p.n desc),'[]') from alert_priority p),
        'by_family', (select coalesce(jsonb_agg(to_jsonb(f) order by f.n desc),'[]') from alert_family f),
        'top',       (select coalesce(jsonb_agg(to_jsonb(t)),'[]') from top_alerts t)),
    'findings', jsonb_build_object(
        'total',    (select count(*) from public.obs_finding),
        'by_type',  (select coalesce(jsonb_agg(to_jsonb(m) order by m.n desc),'[]') from finding_mix m)),
    'sources',   (select coalesce(jsonb_agg(to_jsonb(s) order by s.source_class),'[]') from sources s),
    'territory', (select coalesce(jsonb_agg(to_jsonb(t)),'[]') from territory t),
    'semantics', 'La prioridad analítica ordena el esfuerzo de análisis dentro de este corte. No es probabilidad de LA/FT ni imputación de incumplimiento.'
  );
$$;

------------------------------------------------------- obs_search_entities
-- Branches on the shape of the query so each path uses its own index: a single
-- OR over RUT and name forced a sequential scan with a regexp per row.
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
  sanction_count integer, match_kind text, match_rank real, total_count bigint)
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
  -- A query is read as a RUT when it is mostly digits: names never are.
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
  counted as (select count(*) over () as total_count, b.* from base b)
  select c.entity_id, c.rut, c.name, c.entity_type, c.region, c.commune,
         c.source_count, c.sources, c.roles,
         c.is_uaf_observed, c.is_sanctioned, c.uaf_sector,
         c.ipa3_score, c.ipa3_band,
         c.event_count, c.finding_count, c.alert_count, c.sanction_count,
         c.match_kind, c.sim, c.total_count
  from counted c
  order by
    case c.match_kind
      when 'RUT_EXACTO' then 0 when 'RUT_PARCIAL' then 1
      when 'NOMBRE_EXACTO' then 2 when 'NOMBRE_INICIO' then 3
      when 'NOMBRE_CONTIENE' then 4 when 'NOMBRE_APROXIMADO' then 5
      else 6 end,
    -- Trigram similarity alone rewarded short generic names: "banco" returned
    -- "Bancos", a press mention with no RUT and one source, above BANCO BICE,
    -- which has a RUT, four sources and a sanction. Bucketing the score and
    -- letting identity strength decide inside the bucket fixes the ordering
    -- without discarding fuzzy matching.
    round(c.sim::numeric, 1) desc,
    (c.rut is not null) desc,
    c.source_count desc,
    c.sim desc,
    c.ipa3_score desc nulls last,
    c.name
  limit v_limit offset v_off;
end
$$;

--------------------------------------------------------- obs_entity_detail
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
    -- Every governed source, with an explicit verdict. A source that was never
    -- consulted is never rendered as a source that found nothing.
    select h.source_code, h.source_name, h.source_class, h.integration_mode,
           h.authoritative_source, h.data_status as source_data_status,
           coalesce(es.status,
             case when h.integration_mode = 'on_demand' then 'NOT_CONSULTED'
                  else 'ABSENT' end) as status,
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
  sanctions as (
    select sanction_id, event_date, regulator, subject, identity_status,
           laft_direct, amount_uf, payload
    from public.aml_sanctions where entity_id = p_entity_id
    order by event_date desc nulls last limit 40
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
  osfl as (
    select confirmation_level, profile_activity_group, main_activity, activity_names,
           law21440_active, registro19862, fatf_r8_candidate,
           sales_band, workers_numeric, current_status,
           activity_start_date, termination_date, first_year, latest_year,
           max_sales_band_increase, max_sales_band_decrease,
           sanction_count, regulator_count, latest_sanction_date
    from public.aml_osfl_entity_runtime_snapshot where entity_id = p_entity_id limit 1
  ),
  peers as (
    select commercial_year, peer_level, peer_n, sales_peer_percentile,
           sales_band_code, sales_band_delta, workforce_ratio,
           economic_sector, main_activity_changed, region_changed
    from public.aml_entity_peer_position_snapshot where entity_id = p_entity_id
    order by commercial_year desc limit 8
  ),
  links as (
    select relacion_id, entidad_origen_id, entidad_destino_id, tipo_relacion,
           estado_relacion, metodo_relacion, confianza,
           utilizable_en_analisis, requiere_revision
    from public.aml_entity_identity_link_snapshot
    where entidad_origen_id = p_entity_id or entidad_destino_id = p_entity_id
    limit 40
  ),
  ipa as (
    select ipa3_score, priority_band_shadow, score_confidence_pct, coverage_index_pct,
           dominant_mark_id, included_mark_count, independent_group_count,
           registry_group_score, economic_group_score, sanctions_group_score,
           registry_driver_mark, economic_driver_mark, sanctions_driver_mark,
           reconciliation_status, score_as_of, score_version, semantics
    from public.aml_ipa3_entity_score_snapshot_v0_4 where entity_id = p_entity_id limit 1
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
    'priority', (select to_jsonb(i) from ipa i),
    'uaf',      (select to_jsonb(u) from uaf u),
    'osfl',     (select to_jsonb(o) from osfl o),
    'peers',    (select coalesce(jsonb_agg(to_jsonb(p)), '[]') from peers p),
    'links',    (select coalesce(jsonb_agg(to_jsonb(l)), '[]') from links l),
    'semantics','Ficha de observación. Reúne lo que las fuentes abiertas gobernadas registran sobre la entidad. No es un expediente ni una decisión institucional.'
  ) end;
$$;

------------------------------------------------------------ obs_alert_feed
create or replace function public.obs_alert_feed(
  p_family text default null,
  p_priority text default null,
  p_scope_type text default null,
  p_limit integer default 50,
  p_offset integer default 0)
returns table (
  alert_id text, family text, pattern_type text, scope_type text,
  scope_id text, scope_label text, strength numeric, priority text,
  title text, summary text, payload jsonb,
  entity_ref jsonb, total_count bigint)
language sql
stable
security invoker
set search_path = public, extensions, pg_temp
as $$
  with filtered as (
    select a.* from public.obs_alert a
    where (p_family is null or a.family = p_family)
      and (p_priority is null or a.priority = p_priority)
      and (p_scope_type is null or a.scope_type = p_scope_type)
  ),
  counted as (select count(*) over () total_count, f.* from filtered f)
  select c.alert_id, c.family, c.pattern_type, c.scope_type, c.scope_id, c.scope_label,
         c.strength, c.priority, c.title, c.summary, c.payload,
         case when c.scope_type = 'ENTITY' then (
           select jsonb_build_object('entity_id', e.entity_id, 'rut', e.rut,
                    'name', e.name, 'region', e.region,
                    'source_count', e.source_count, 'ipa3_score', e.ipa3_score)
           from public.obs_entity e where e.entity_id = c.scope_id) end,
         c.total_count
  from counted c
  order by case c.priority when 'MUY ALTA' then 0 when 'ALTA' then 1
                           when 'MEDIA' then 2 when 'OBSERVAR' then 3 else 4 end,
           c.strength desc nulls last, c.alert_id
  limit greatest(1, least(coalesce(p_limit,50), 200))
  offset greatest(0, coalesce(p_offset,0));
$$;

--------------------------------------------------------- obs_source_status
create or replace function public.obs_source_status()
returns table (
  source_code text, source_name text, source_class text, integration_mode text,
  authoritative_source text, software_status text, data_status text,
  last_source_record_at timestamptz, last_successful_ingest_at timestamptz,
  records_24h bigint, error_rate_24h numeric, notes text,
  entity_coverage bigint, coverage_share numeric)
language sql
stable
security invoker
set search_path = public, extensions, pg_temp
as $$
  select h.source_code, h.source_name, h.source_class, h.integration_mode,
         h.authoritative_source, h.software_status, h.data_status,
         h.last_source_record_at, h.last_successful_ingest_at,
         h.records_24h, h.error_rate_24h, h.notes,
         cov.n,
         case when tot.n > 0 then round(100.0 * cov.n / tot.n, 1) end
  from public.obs_source_health h
  cross join lateral (select count(*) n from public.obs_entity_source es
                      where es.source_code = h.source_code) cov
  cross join lateral (select count(*) n from public.obs_entity) tot
  order by case h.source_class when 'producer' then 0 else 1 end,
           cov.n desc, h.source_code;
$$;

-- The policies already scope reads to `authenticated`; revoking EXECUTE from
-- anon keeps the boundary explicit rather than relying on RLS alone to make an
-- anonymous call useless.
do $$
declare
  sig text;
begin
  foreach sig in array array[
    'public.obs_pulse()',
    'public.obs_search_entities(text,integer,integer,text,text,boolean,boolean,integer)',
    'public.obs_entity_detail(text)',
    'public.obs_alert_feed(text,text,text,integer,integer)',
    'public.obs_source_status()'
  ] loop
    execute format('revoke all on function %s from public, anon', sig);
    execute format('grant execute on function %s to authenticated, service_role', sig);
  end loop;
end
$$;
