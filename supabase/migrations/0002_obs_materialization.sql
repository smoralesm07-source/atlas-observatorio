-- ATLAS Observatorio · materialization
--
-- Reads the governed Fusion tables, writes the obs_* read models, and never
-- writes upstream. This function is the only writer of the read models.

create or replace function public.obs_normalize_text(p text)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog, pg_temp
as $$
  select regexp_replace(
           translate(lower(coalesce(p,'')),
             'áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ',
             'aaaaaeeeeiiiiooooouuuuncaaaaaeeeeiiiiooooouuuunc'),
           '[^a-z0-9 ]+', ' ', 'g')
$$;
comment on function public.obs_normalize_text(text) is
  'Normalizacion de busqueda: minusculas, sin acentos, sin puntuacion. El search_path esta fijado porque la funcion se usa dentro de una expresion de indice.';

create or replace function public.obs_refresh_all(p_snapshot_id text default null)
returns public.obs_snapshot
language plpgsql
security definer
set search_path = public, pg_temp
-- Esta funcion NO se puede invocar por PostgREST: el rol authenticator impone
-- statement_timeout de 8 s y la materializacion completa tarda unos 25 s. Fijar
-- el limite dentro de la funcion no sirve, porque el temporizador se arma al
-- comenzar la sentencia de nivel superior y no se re-arma al cambiar el ajuste
-- a mitad de ejecucion. La agenda vive en pg_cron (migracion 0004).
as $$
declare
  v_snapshot text := coalesce(p_snapshot_id,
                       'OBS-' || to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24MI"Z"'));
  v_row public.obs_snapshot;
  v_counts jsonb;
begin
  insert into public.obs_snapshot (snapshot_id, generated_at, status, source_versions)
  values (v_snapshot, now(), 'BUILDING',
          jsonb_build_object('origin', current_database(), 'builder', 'obs_refresh_all'))
  on conflict (snapshot_id) do update
    set status = 'BUILDING', generated_at = now(), error_detail = null, published_at = null;

  ---------------------------------------------------------------- entities
  create temp table _obs_ent on commit drop as
  select
    e.entity_id,
    nullif(e.rut,'')                                       as rut,
    e.name,
    public.obs_normalize_text(e.name)                      as name_search,
    e.entity_type,
    e.region,
    e.commune,
    coalesce(e.source_count,0)                             as source_count,
    coalesce((
      select array_agg(distinct f order by f)
      from jsonb_array_elements_text(coalesce(e.profile->'fuentes','[]'::jsonb)) f
    ), '{}'::text[])                                       as sources,
    coalesce((
      select array_agg(distinct r order by r)
      from jsonb_array_elements_text(coalesce(e.profile->'roles_es','[]'::jsonb)) r
    ), '{}'::text[])                                       as roles,
    coalesce(e.is_uaf_observed,false)                      as is_uaf_observed,
    coalesce(e.is_sanctioned,false)                        as is_sanctioned,
    coalesce((e.profile->>'event_count')::int,0)           as event_count
  from public.aml_entities e;

  create unique index on _obs_ent (entity_id);

  -- Eventos agregados por (entidad, productor) una sola vez. Calcularlos dentro
  -- de un lateral, por cada uno de los ~95 mil pares entidad-fuente, re-recorria
  -- el JSON del perfil una vez por par.
  create temp table _obs_ev on commit drop as
  select ae.entity_id,
         e->>'productor' as source_code,
         count(*) n,
         max((e->>'fecha')::timestamptz) last_at,
         (array_agg(distinct e->>'tipo_es')
            filter (where e->>'tipo_es' is not null))[1:4] titles
  from public.aml_entities ae,
       lateral jsonb_array_elements(coalesce(ae.profile->'eventos','[]'::jsonb)) e
  where e->>'productor' is not null
  group by 1, 2;

  create unique index on _obs_ev (entity_id, source_code);

  truncate public.obs_entity_source;
  delete from public.obs_entity;

  insert into public.obs_entity (
    entity_id, rut, rut_search, name, name_search, entity_type, region, commune,
    source_count, sources, roles, is_uaf_observed, is_sanctioned,
    uaf_sector, ipa3_score, ipa3_band, event_count,
    finding_count, alert_count, sanction_count, max_finding_score,
    snapshot_id, refreshed_at)
  select
    t.entity_id, t.rut,
    -- Written here, not in a follow-up backfill: a published snapshot whose RUT
    -- index is missing would silently break lookup by RUT.
    nullif(regexp_replace(upper(coalesce(t.rut,'')), '[^0-9K]', '', 'g'), ''),
    t.name, t.name_search, t.entity_type, t.region, t.commune,
    t.source_count, t.sources, t.roles, t.is_uaf_observed, t.is_sanctioned,
    uaf.uaf_sector_canonical,
    ipa.ipa3_score,
    ipa.priority_band_shadow,
    t.event_count,
    coalesce(fc.n,0),
    coalesce(ac.n,0),
    coalesce(sc.n,0),
    fc.max_score,
    v_snapshot, now()
  from _obs_ent t
  left join public.aml_ipa3_entity_score_snapshot_v0_4 ipa on ipa.entity_id = t.entity_id
  left join public.aml_uaf_obligated_subject_snapshot  uaf on uaf.entity_id = t.entity_id
  left join lateral (
    select count(*) n, max(greatest(coalesce(f.score_investigate,0),
                                    coalesce(f.score_supervise,0))) max_score
    from public.aml_findings f where f.entity_id = t.entity_id) fc on true
  left join lateral (
    select count(*) n from public.aml_pattern_alerts a
    where a.scope_type = 'ENTITY' and a.scope_id = t.entity_id) ac on true
  left join lateral (
    select count(*) n from public.aml_sanctions s
    where s.entity_id = t.entity_id) sc on true;

  ------------------------------------------------------- entity x source
  insert into public.obs_entity_source (
    entity_id, source_code, status, record_count, last_event_at, detail)
  select
    t.entity_id,
    src.source_code,
    'PRESENT',
    ev.n,
    ev.last_at,
    jsonb_strip_nulls(jsonb_build_object(
      'event_titles', ev.titles,
      'basis', case when ev.n > 0 then 'EVENTOS_FECHADOS' else 'PRESENCIA_DECLARADA' end))
  from _obs_ent t
  cross join lateral unnest(t.sources) as src(source_code)
  left join _obs_ev ev
    on ev.entity_id = t.entity_id and ev.source_code = src.source_code;

  ---------------------------------------------------------------- alerts
  delete from public.obs_alert;
  insert into public.obs_alert (
    alert_id, family, pattern_type, scope_type, scope_id, scope_label,
    strength, priority, title, summary, payload, snapshot_id, refreshed_at)
  select a.alert_id, a.family, a.pattern_type, a.scope_type, a.scope_id, a.scope_label,
         a.strength, a.priority, a.title, a.summary, coalesce(a.payload,'{}'::jsonb),
         v_snapshot, now()
  from public.aml_pattern_alerts a;

  -------------------------------------------------------------- findings
  delete from public.obs_finding;
  insert into public.obs_finding (
    finding_key, finding_id, finding_type, entity_id, title, region, commune,
    score_explore, score_supervise, score_investigate, source_count, evidence_count,
    payload, snapshot_id, refreshed_at)
  select f.finding_key, f.finding_id, f.finding_type, f.entity_id, f.title,
         f.region, f.commune, f.score_explore, f.score_supervise, f.score_investigate,
         f.source_count, f.evidence_count, coalesce(f.payload,'{}'::jsonb),
         v_snapshot, now()
  from public.aml_findings f;

  --------------------------------------------------------- source health
  delete from public.obs_source_health;

  -- Governed producers: the radars that populate the entity universe.
  insert into public.obs_source_health (
    source_code, source_name, source_class, integration_mode,
    authoritative_source, software_status, data_status,
    last_source_record_at, records_24h, notes, snapshot_id, refreshed_at)
  select p.code, p.label, 'producer', 'scheduled', p.authority,
         'healthy',
         case when cov.n > 0 then 'fresh' else 'silent' end,
         cov.last_at,
         cov.n,
         p.note,
         v_snapshot, now()
  from (values
    ('RADAR_UAF',       'Radar UAF · padron de sujetos obligados', 'UAF',
     'Padron publico de sujetos obligados y eventos sancionatorios.'),
    ('RADAR_SII',       'Radar SII · actividad economica',          'SII',
     'Actividad, giros, tramos de venta y dotacion declarada.'),
    ('RADAR_OSFL',      'Radar OSFL · organizaciones sin fines de lucro', 'Registro Civil / SII',
     'Universo de personas juridicas sin fines de lucro.'),
    ('RADAR_SANCIONES', 'Radar Sanciones · eventos regulatorios',   'CMF / UAF / SCJ / CGR',
     'Eventos sancionatorios con evidencia documental oficial.'),
    ('RADAR_PRENSA',    'Radar Prensa · menciones publicas',        'Prensa abierta',
     'Menciones en prensa con resolucion de identidad.'),
    ('RADAR_CGR',       'Radar CGR · auditorias y reparos',         'Contraloria General',
     'Auditorias, FAU y acciones de enforcement.'),
    ('RADAR_DELICTUAL', 'Radar Delictual · contexto territorial',   'CEAD / Subsecretaria',
     'Contexto delictual comunal. Describe territorio, no entidades.'),
    ('PRESUPUESTO_ABIERTO','Presupuesto Abierto · ejecucion fiscal','DIPRES',
     'Ejecucion presupuestaria. Universo distinto al de compras publicas.'),
    ('MERCADO_PUBLICO', 'Mercado Publico · compras del Estado',     'ChileCompra',
     'Ordenes de compra, compradores y proveedores.')
  ) as p(code, label, authority, note)
  left join lateral (
    select count(*) n, max(es.last_event_at) last_at
    from public.obs_entity_source es where es.source_code = p.code
  ) cov on true;

  -- External / on-demand sources: consulted per entity, not bulk-ingested.
  insert into public.obs_source_health (
    source_code, source_name, source_class, integration_mode,
    authoritative_source, software_status, data_status,
    last_source_record_at, last_successful_ingest_at, records_24h, error_rate_24h,
    notes, snapshot_id, refreshed_at)
  select h.source_code, h.source_name, h.source_class, h.integration_mode,
         h.authoritative_source, h.software_status, h.data_status,
         h.last_source_record_at, h.last_successful_ingest_at,
         h.records_24h, h.error_rate_24h, h.notes, v_snapshot, now()
  from public.aml_external_source_health h
  where coalesce(h.enabled,true)
    and h.source_code not in (select source_code from public.obs_source_health);

  ----------------------------------------------------------------- close
  select jsonb_build_object(
    'obs_entity',        (select count(*) from public.obs_entity),
    'obs_entity_source', (select count(*) from public.obs_entity_source),
    'obs_alert',         (select count(*) from public.obs_alert),
    'obs_finding',       (select count(*) from public.obs_finding),
    'obs_source_health', (select count(*) from public.obs_source_health))
  into v_counts;

  update public.obs_snapshot
     set status = 'READY', row_counts = v_counts, published_at = now()
   where snapshot_id = v_snapshot
  returning * into v_row;

  return v_row;
exception when others then
  update public.obs_snapshot
     set status = 'FAILED', error_detail = sqlerrm
   where snapshot_id = v_snapshot;
  raise;
end
$$;

-- Safety net for rows that predate the in-line rut_search write.
create or replace function public.obs_backfill_rut_search()
returns void language sql security definer set search_path = public, pg_temp as $$
  update public.obs_entity
     set rut_search = nullif(regexp_replace(upper(rut), '[^0-9K]', '', 'g'), '')
   where rut is not null and rut_search is null;
$$;

revoke all on function public.obs_refresh_all(text) from public, anon, authenticated;
revoke all on function public.obs_backfill_rut_search() from public, anon, authenticated;
revoke all on function public.obs_normalize_text(text) from public, anon;
grant execute on function public.obs_refresh_all(text) to service_role;
grant execute on function public.obs_backfill_rut_search() to service_role;
grant execute on function public.obs_normalize_text(text) to authenticated, service_role;
