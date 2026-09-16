-- Versiona y asegura obs_uaf_strategic_report_payload, el RPC que produce el
-- Informe Estratégico de #/reportes.
--
-- Cuerpo idéntico a producción salvo por el `where public.atlas_require_allowed_user()`
-- en la CTE `cfg`. `cfg` es requerida por `base` y por todas las ventanas de
-- novedad, de modo que el gate se evalúa siempre antes de leer dato alguno.
-- No se altera ninguna cifra, ranking ni el contrato ATLAS_OBS_UAF_STRATEGIC_REPORT_V2.

create or replace function public.obs_uaf_strategic_report_payload(p_from_year integer default 2020, p_to_year integer default 2025, p_novelty_days integer default 30)
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $body$
with cfg as (
  select greatest(2000, least(coalesce(p_from_year, 2020), coalesce(p_to_year, 2025))) as y0,
         least(2100, greatest(coalesce(p_from_year, 2020), coalesce(p_to_year, 2025))) as y1,
         least(180, greatest(7, coalesce(p_novelty_days, 30))) as novelty_days,
         current_date - least(180, greatest(7, coalesce(p_novelty_days, 30))) as novelty_from
  where public.atlas_require_allowed_user()
),
base as (
  select public.obs_uaf_report_payload((select y0 from cfg), (select y1 from cfg)) as payload
),
press_rule as (
  select a.article_id, a.article_date, a.title, a.media, a.url, a.summary, a.region, a.commune,
         case
           when lower(coalesce(a.title,'') || ' ' || coalesce(a.summary,'')) ~ '(lavado de (activos|dinero)|blanqueo)' then 'Lavado de activos'
           when lower(coalesce(a.title,'') || ' ' || coalesce(a.summary,'')) ~ '(crimen organizado|organizaci[oó]n criminal|narcotr[aá]fico|tr[aá]fico de drogas)' then 'Crimen organizado / drogas'
           when lower(coalesce(a.title,'') || ' ' || coalesce(a.summary,'')) ~ '(corrupci[oó]n|cohecho|soborno)' then 'Corrupción / cohecho'
           when lower(coalesce(a.title,'') || ' ' || coalesce(a.summary,'')) ~ '(fraude|estafa|delitos econ[oó]micos)' then 'Fraude / delitos económicos'
           when lower(coalesce(a.title,'') || ' ' || coalesce(a.summary,'')) ~ '(contrabando|trata de personas|tr[aá]fico de migrantes)' then 'Contrabando / trata'
           else null
         end as theme,
         case
           when a.region is not null or lower(coalesce(a.title,'') || ' ' || coalesce(a.summary,'')) ~ '(^|[^a-záéíóúñ])(chile|chileno|chilena|fiscal[ií]a|pdi|carabineros|cmf|uaf)([^a-záéíóúñ]|$)' then 'NACIONAL'
           else 'INTERNACIONAL'
         end as scope
  from public.atlas_press_article_history a, cfg c
  where a.article_date >= c.novelty_from
),
press_strategic as (
  select * from press_rule where theme is not null
),
press_stats as (
  select count(*) as article_count,
         count(*) filter (where scope='NACIONAL') as national_count,
         count(*) filter (where scope='INTERNACIONAL') as international_count,
         count(distinct media) as media_count,
         max(article_date) as latest_date
  from press_strategic
),
press_themes as (
  select theme, count(*) as article_count, count(distinct media) as source_count, max(article_date) as latest_date
  from press_strategic
  group by theme
  order by article_count desc, theme
),
press_latest as (
  select article_id, article_date, title, media, url, summary, region, commune, theme, scope
  from press_strategic
  order by article_date desc, case when scope='NACIONAL' then 0 else 1 end, media, article_id
  limit 12
),
external_alerts as (
  select alert_id, severity, urgency_score, event_at, entity_id, rut, entity_name, uaf_sector,
         identity_confidence, mention_confidence, has_laft, has_predicate, signal_label,
         article_count, source_count, latest_title, latest_summary, latest_source, latest_url,
         ipa3_score, ipa3_band, ipa_gap, match_basis, alert_reason
  from public.obs_uaf_external_alert_candidate, cfg c
  where event_at >= c.novelty_from
  order by urgency_score desc, event_at desc, entity_name
  limit 10
),
sanction_recent as (
  select event_id, event_date, regulator, event_class, event_kind, entity_id, rut, canonical_name,
         region, commune, is_uaf_registered, uaf_sector, amount_uf, amount_clp,
         reason, resolution_ref, document_url, identity_confidence
  from public.aml_v_sanctions_cases_current_v1, cfg c
  where sanction_record = true
    and event_date >= c.novelty_from - 150
    and is_uaf_registered = true
    and canonical_name is not null
  order by event_date desc, regulator, canonical_name
  limit 12
),
sanction_stats as (
  select count(*) as recent_event_count,
         count(distinct canonical_name) as recent_entity_count,
         count(distinct regulator) as regulator_count,
         count(distinct region) filter (where region is not null) as region_count,
         max(event_date) as latest_date
  from public.aml_v_sanctions_cases_current_v1, cfg c
  where sanction_record = true
    and event_date >= c.novelty_from - 150
    and is_uaf_registered = true
),
sanction_overview as (
  select * from public.aml_v_sanctions_overview_current_v0960 limit 1
),
territory_year as (
  select max(year) as year from public.obs_territory
),
territory_region as (
  select t.region_code, t.region_name,
         count(*) as commune_count,
         round(avg(t.igr_score),2) as avg_igr,
         round(max(t.igr_score),2) as max_igr,
         round(avg(nullif(t.layers->'predicate_direct'->>'score','')::numeric),2) as avg_predicate_score,
         round(avg(nullif(t.layers->'criminal_economy'->>'score','')::numeric),2) as avg_criminal_economy_score,
         round(avg(nullif(t.layers->'criminogenic_context'->>'score','')::numeric),2) as avg_criminogenic_context_score,
         sum(coalesce(t.ctx_sanctioned,0)) as sanctioned_context,
         sum(coalesce(t.ctx_alerted,0)) as alerted_context,
         sum(coalesce(t.ctx_findings,0)) as findings_context,
         round(avg(t.igr_methodological_coverage),3) as methodological_coverage
  from public.obs_territory t, territory_year y
  where t.year = y.year
  group by t.region_code, t.region_name
),
territory_region_ranked as (
  select *,
         row_number() over(order by avg_predicate_score desc nulls last, avg_criminal_economy_score desc nulls last, max_igr desc nulls last) as strategic_rank
  from territory_region
),
territory_communes as (
  select region as region_name, commune as commune_name, commune_code,
         igr, threat, vulnerability, density, gap, potential_total, uaf_observed,
         cead_year, cead_confidence,
         nullif(cead_json->'layers'->'predicate_direct'->>'score','')::numeric as predicate_score,
         nullif(cead_json->'layers'->'criminal_economy'->>'score','')::numeric as criminal_economy_score,
         nullif(cead_json->'layers'->'criminogenic_context'->>'score','')::numeric as criminogenic_context_score,
         cead_json->>'interpretation' as interpretation
  from public.aml_beta_territory_igr_snapshot_v4
  where cead_json is not null
  order by igr desc nulls last, threat desc nulls last
  limit 15
),
cead_components as (
  select c.region, c.commune,
         component->>'id' as component_id,
         component->>'label' as component_label,
         nullif(component->>'score','')::numeric as score,
         nullif(component->>'trend','')::numeric as trend,
         nullif(component->>'value','')::numeric as value,
         nullif(component->>'years_observed','')::integer as years_observed
  from public.aml_beta_territory_igr_snapshot_v4 c
  cross join lateral jsonb_each(c.cead_json->'layers') l(layer_id, layer_data)
  cross join lateral jsonb_array_elements(coalesce(l.layer_data->'components','[]'::jsonb)) component
  where c.cead_json is not null
),
cead_component_summary as (
  select component_id, component_label,
         count(*) as commune_count,
         round(avg(score),2) as avg_score,
         round(avg(trend),2) as avg_trend,
         sum(value) as total_2025,
         max(years_observed) as max_years_observed
  from cead_components
  group by component_id, component_label
  order by avg_score desc nulls last, avg_trend desc nulls last
),
sector_movers as (
  select sector_official, sector_canonical, registered_so_2025, ros_2024, ros_2025,
         ros_total_2021_2025, ros_per_100_so_2025, delta_ros_2025_vs_2024_pct,
         silence_5y, indicios_2025, indicios_total_2021_2025, source_url, as_of_date
  from public.obs_uaf_reporting_sector
  where registered_so_2025 is not null
  order by abs(coalesce(delta_ros_2025_vs_2024_pct,0)) desc, ros_2025 desc nulls last
  limit 15
),
sector_concentration as (
  select sum(coalesce(ros_2025,0)) as ros_total,
         sum(coalesce(registered_so_2025,0)) as registered_total,
         count(*) filter(where silence_5y) as silent_sector_count
  from public.obs_uaf_reporting_sector
),
pressure as (
  select
    max(value) filter(where metric='entidades_reportantes_total' and period=(select y0::text from cfg)) as so_start,
    max(value) filter(where metric='entidades_reportantes_total' and period=(select y1::text from cfg)) as so_end,
    max(value) filter(where metric='ros_recibidos' and period=(select y0::text from cfg)) as ros_start,
    max(value) filter(where metric='ros_recibidos' and period=(select y1::text from cfg)) as ros_end,
    max(value) filter(where metric='actividades_economicas_obligadas' and period=(select y0::text from cfg)) as act_start,
    max(value) filter(where metric='actividades_economicas_obligadas' and period=(select y1::text from cfg)) as act_end,
    max(value) filter(where metric='dotacion_efectiva_total' and period=(select y0::text from cfg)) as staff_start,
    max(value) filter(where metric='dotacion_efectiva_total' and period=(select y1::text from cfg)) as staff_end
  from public.obs_uaf_reporting_national
),
pressure_calc as (
  select *,
    case when so_start>0 and ros_start>0 and act_start>0 then
      exp((ln(so_end/so_start*100.0)+ln(ros_end/ros_start*100.0)+ln(act_end/act_start*100.0))/3.0)
    end as pressure_index,
    case when staff_start>0 then staff_end/staff_start*100.0 end as staff_index
  from pressure
),
questions as (
  select jsonb_build_array(
    jsonb_build_object(
      'id','capacity_pressure',
      'question','¿La presión observable del sistema crece al mismo ritmo que la capacidad instalada?',
      'answer',case when pressure_index is null or staff_index is null then 'NO_CALCULABLE' when pressure_index > staff_index then 'PRESION_CRECE_MAS' when pressure_index < staff_index then 'CAPACIDAD_CRECE_MAS' else 'RITMO_SIMILAR' end,
      'pressure_index',round(pressure_index,1),
      'staff_index',round(staff_index,1),
      'gap_points',round(pressure_index-staff_index,1),
      'caveat','Indicador experimental: presión combina padrón, ROS y actividades obligadas; dotación corresponde al total institucional y no mide productividad individual.'
    ),
    jsonb_build_object(
      'id','territorial_focus',
      'question','¿En qué regiones se observan las señales territoriales más intensas?',
      'answer','TOP_REGIONS_BY_DETERMINISTIC_PROXY',
      'regions',(select coalesce(jsonb_agg(jsonb_build_object('region',region_name,'rank',strategic_rank,'avg_predicate_score',avg_predicate_score,'avg_criminal_economy_score',avg_criminal_economy_score,'max_igr',max_igr,'alerted_context',alerted_context,'sanctioned_context',sanctioned_context) order by strategic_rank),'[]'::jsonb) from territory_region_ranked where strategic_rank<=5),
      'caveat','Ranking descriptivo sobre promedios comunales y señales CEAD/Atlas; no mide prevalencia de lavado ni atribuye criminalidad a habitantes o empresas.'
    ),
    jsonb_build_object(
      'id','external_novelties',
      'question','¿Qué novedades externas deberían mirar hoy los directivos?',
      'answer','CURRENT_EVIDENCE',
      'external_alert_count',(select count(*) from external_alerts),
      'strategic_press_count',(select article_count from press_stats),
      'recent_uaf_sanction_count',(select recent_event_count from sanction_stats),
      'window_days',(select novelty_days from cfg),
      'caveat','Prensa y sanciones son señales de contexto y hechos públicos; una mención no acredita ilícito ni reemplaza validación analítica.'
    ),
    jsonb_build_object(
      'id','organized_crime_proxy',
      'question','¿Qué se puede decir sobre la dinámica territorial asociada a crimen organizado?',
      'answer','PROXY_ONLY',
      'top_components',(select coalesce(jsonb_agg(jsonb_build_object('component',component_label,'avg_score',avg_score,'avg_trend',avg_trend,'total_2025',total_2025,'communes',commune_count) order by avg_score desc),'[]'::jsonb) from (select * from cead_component_summary limit 5) x),
      'caveat','Atlas no dispone aquí de una medición directa de organizaciones criminales. Usa delitos base, economía criminal y contexto criminógeno como proxies territoriales, complementados con prensa trazada.'
    ),
    jsonb_build_object(
      'id','reporting_concentration',
      'question','¿La reportabilidad está distribuida de forma homogénea entre sectores?',
      'answer','SECTOR_CONCENTRATION',
      'ros_total_2025',(select ros_total from sector_concentration),
      'silent_sector_count',(select silent_sector_count from sector_concentration),
      'caveat','Baja o nula reportabilidad no implica por sí sola incumplimiento; el ROS se genera ante operaciones sospechosas y no tiene periodicidad mínima.'
    )
  ) as payload
  from pressure_calc
)
select jsonb_build_object(
  'contract','ATLAS_OBS_UAF_STRATEGIC_REPORT_V2',
  'generated_at',now(),
  'snapshot_hash',md5((select payload::text from base) || now()::date::text || (select novelty_days::text from cfg)),
  'periodo',jsonb_build_object('desde',(select y0 from cfg),'hasta',(select y1 from cfg)),
  'novedad',jsonb_build_object('dias',(select novelty_days from cfg),'desde',(select novelty_from from cfg),'hasta',current_date),
  'base',(select payload from base),
  'preguntas_estrategicas',(select payload from questions),
  'novedades',jsonb_build_object(
    'alertas_externas',coalesce((select jsonb_agg(to_jsonb(x)) from external_alerts x),'[]'::jsonb),
    'prensa_resumen',coalesce((select to_jsonb(x) from press_stats x),'{}'::jsonb),
    'prensa_temas',coalesce((select jsonb_agg(to_jsonb(x)) from press_themes x),'[]'::jsonb),
    'prensa_reciente',coalesce((select jsonb_agg(to_jsonb(x)) from press_latest x),'[]'::jsonb),
    'sanciones_resumen',coalesce((select to_jsonb(x) from sanction_stats x),'{}'::jsonb),
    'sanciones_recientes',coalesce((select jsonb_agg(to_jsonb(x)) from sanction_recent x),'[]'::jsonb),
    'sanciones_universo',coalesce((select to_jsonb(x) from sanction_overview x),'{}'::jsonb)
  ),
  'territorio',jsonb_build_object(
    'year',(select year from territory_year),
    'regiones',coalesce((select jsonb_agg(to_jsonb(x) order by strategic_rank) from territory_region_ranked x),'[]'::jsonb),
    'comunas_prioritarias',coalesce((select jsonb_agg(to_jsonb(x)) from territory_communes x),'[]'::jsonb),
    'componentes_cead',coalesce((select jsonb_agg(to_jsonb(x)) from cead_component_summary x),'[]'::jsonb),
    'metodologia','Los puntajes territoriales son proxies descriptivos y no representan probabilidad de LA/FT. Los agregados regionales usan promedio simple de comunas.'
  ),
  'sectores',jsonb_build_object(
    'movimientos',coalesce((select jsonb_agg(to_jsonb(x)) from sector_movers x),'[]'::jsonb),
    'resumen',coalesce((select to_jsonb(x) from sector_concentration x),'{}'::jsonb)
  ),
  'reglas',jsonb_build_object(
    'datos','Todos los conteos, rankings, variaciones, filtros temáticos y selección de novedades son determinísticos y trazables a tablas de Atlas.',
    'prensa','La clasificación temática usa expresiones regulares explícitas sobre título y resumen; no usa LLM.',
    'ia','La IA puede redactar síntesis, organizar implicancias y adaptar el lenguaje al público. No puede recalcular, crear, corregir o reemplazar cifras ni convertir proxies en hechos.'
  )
);
$body$;

revoke all on function public.obs_uaf_strategic_report_payload(integer, integer, integer) from public, anon;
grant execute on function public.obs_uaf_strategic_report_payload(integer, integer, integer) to authenticated, service_role;
