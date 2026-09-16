-- Versiona y asegura obs_uaf_strategic_depth_payload.
--
-- Esta función no la consume hoy ninguna vista del frontend, pero existe en la
-- base, es SECURITY DEFINER y tiene EXECUTE concedido a `authenticated`, por lo
-- que estaba expuesta en /rest/v1/rpc/ sin control de membresía. Se versiona y
-- se le aplica el mismo gate que al informe estratégico.
--
-- Cuerpo idéntico a producción salvo por el `where public.atlas_require_allowed_user()`
-- en la CTE `cfg`, de la que dependen todas las ventanas de comparación.

create or replace function public.obs_uaf_strategic_depth_payload(p_novelty_days integer default 30)
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $body$
with cfg as (
  select least(180, greatest(7, coalesce(p_novelty_days,30))) as days,
         current_date - least(180, greatest(7, coalesce(p_novelty_days,30))) as cur_from,
         current_date - 2*least(180, greatest(7, coalesce(p_novelty_days,30))) as prev_from
  where public.atlas_require_allowed_user()
),
press_classified as (
  select a.article_id,a.article_date,a.media,a.region,a.commune,a.title,a.url,a.summary,
    case
      when lower(coalesce(a.title,'')||' '||coalesce(a.summary,'')) ~ '(lavado de (activos|dinero)|blanqueo|la\/ft|laft)' then 'Lavado de activos'
      when lower(coalesce(a.title,'')||' '||coalesce(a.summary,'')) ~ '(crimen organizado|organizaci[oó]n criminal|narcotr[aá]fico|tr[aá]fico de drogas|cartel|tren de aragua)' then 'Crimen organizado / drogas'
      when lower(coalesce(a.title,'')||' '||coalesce(a.summary,'')) ~ '(corrupci[oó]n|cohecho|soborno|malversaci[oó]n|fraude al fisco)' then 'Corrupción / delitos funcionarios'
      when lower(coalesce(a.title,'')||' '||coalesce(a.summary,'')) ~ '(fraude|estafa|defraudaci[oó]n|delitos econ[oó]micos)' then 'Fraude / delitos económicos'
      when lower(coalesce(a.title,'')||' '||coalesce(a.summary,'')) ~ '(contrabando|trata de personas|tr[aá]fico de migrantes)' then 'Contrabando / trata'
      else null end as theme
  from public.atlas_press_article_history a, cfg c
  where a.article_date >= c.prev_from
),
press_relevant as (select * from press_classified where theme is not null),
press_periods as (
  select theme,
    count(*) filter(where article_date >= (select cur_from from cfg)) as current_n,
    count(*) filter(where article_date < (select cur_from from cfg)) as previous_n,
    count(distinct media) filter(where article_date >= (select cur_from from cfg)) as current_media,
    max(article_date) filter(where article_date >= (select cur_from from cfg)) as latest_date
  from press_relevant group by theme
),
press_momentum as (
  select theme,current_n,previous_n,current_media,latest_date,
    case when previous_n=0 then null else round((current_n-previous_n)*100.0/previous_n,1) end as delta_pct
  from press_periods
  order by abs(coalesce(case when previous_n=0 then null else (current_n-previous_n)*100.0/previous_n end,0)) desc, current_n desc
),
press_quality as (
  select
    count(*) filter(where article_date >= (select cur_from from cfg)) as relevant_articles,
    count(*) filter(where article_date >= (select cur_from from cfg) and region is not null and btrim(region)<>'') as geocoded_articles,
    count(distinct media) filter(where article_date >= (select cur_from from cfg)) as media_count,
    round(100.0*count(*) filter(where article_date >= (select cur_from from cfg) and region is not null and btrim(region)<>'') / nullif(count(*) filter(where article_date >= (select cur_from from cfg)),0),1) as geocoded_pct
  from press_relevant
),
press_region as (
  select lower(btrim(region)) region_key,max(region) region,count(*) as press_n
  from press_relevant
  where article_date >= (select cur_from from cfg) and region is not null and btrim(region)<>''
  group by lower(btrim(region))
),
sanction_base as (
  select event_date,region,regulator,canonical_name,document_url,is_uaf_registered
  from public.aml_v_sanctions_cases_current_v1, cfg c
  where sanction_record=true and is_uaf_registered=true and event_date >= c.prev_from
),
sanction_periods as (
  select
    count(*) filter(where event_date >= (select cur_from from cfg)) as current_n,
    count(*) filter(where event_date < (select cur_from from cfg)) as previous_n,
    count(*) filter(where event_date >= (select cur_from from cfg) and document_url is not null) as current_documented,
    count(distinct regulator) filter(where event_date >= (select cur_from from cfg)) as regulator_count
  from sanction_base
),
sanction_region as (
  select lower(btrim(region)) region_key,max(region) region,count(*) as sanction_n
  from sanction_base
  where event_date >= (select cur_from from cfg) and region is not null and btrim(region)<>''
  group by lower(btrim(region))
),
territory_year as (select max(t.year) as max_year from public.obs_territory t),
territory_region as (
  select t.region_name,
    round(avg(t.igr_score),2) as avg_igr,
    max(t.igr_score) as max_igr,
    round(avg(t.igr_methodological_coverage),3) as coverage,
    sum(coalesce(t.ctx_findings,0)) as finding_context,
    sum(coalesce(t.ctx_alerted,0)) as alert_context,
    count(*) as commune_n
  from public.obs_territory t, territory_year y
  where t.year=y.max_year
  group by t.region_name
),
finding_region as (
  select lower(btrim(region)) region_key,max(region) region,count(*) as finding_n,
    round(avg(score_investigate),1) as investigate_avg,
    round(avg(score_supervise),1) as supervise_avg
  from public.obs_finding
  where region is not null and btrim(region)<>''
  group by lower(btrim(region))
),
region_join as (
  select tr.region_name,
    tr.avg_igr,tr.max_igr,tr.coverage,tr.commune_n,tr.finding_context,tr.alert_context,
    coalesce(fr.finding_n,0) as finding_n,
    coalesce(fr.investigate_avg,0) as investigate_avg,
    coalesce(fr.supervise_avg,0) as supervise_avg,
    coalesce(sr.sanction_n,0) as sanction_n,
    coalesce(pr.press_n,0) as press_n
  from territory_region tr
  left join finding_region fr on fr.region_key=lower(btrim(tr.region_name))
  left join sanction_region sr on sr.region_key=lower(btrim(tr.region_name))
  left join press_region pr on pr.region_key=lower(btrim(tr.region_name))
),
region_max as (
  select max(avg_igr) m_igr,max(finding_n) m_find,max(sanction_n) m_san,max(press_n) m_press from region_join
),
region_scored as (
  select r.*,
    (case when m.m_igr>0 then r.avg_igr/m.m_igr*100 else 0 end)::numeric(6,1) as igr_score_norm,
    (case when m.m_find>0 then r.finding_n::numeric/m.m_find*100 else 0 end)::numeric(6,1) as finding_score_norm,
    (case when m.m_san>0 then r.sanction_n::numeric/m.m_san*100 else 0 end)::numeric(6,1) as sanction_score_norm,
    (case when m.m_press>0 then r.press_n::numeric/m.m_press*100 else 0 end)::numeric(6,1) as press_score_norm
  from region_join r cross join region_max m
),
region_convergence as (
  select *, (0.40*igr_score_norm+0.25*finding_score_norm+0.20*sanction_score_norm+0.15*press_score_norm)::numeric(6,1) as convergence_index
  from region_scored
),
region_top as (
  select * from region_convergence order by convergence_index desc nulls last,avg_igr desc nulls last limit 10
),
sector_base as (
  select s.uaf_sector_canonical as sector,s.subject_count,s.vulnerability_index,s.ipf_mean,s.ipf_p90,
         s.sanctioned_subjects,s.sanction_events,s.sanction_rate_per_100,s.sii_terminated,s.atypical_activity_subjects,
         s.top_region,s.top_region_share_pct,
         r.ros_2025,r.ros_per_100_so_2025,r.delta_ros_2025_vs_2024_pct,r.silence_5y,r.indicios_2025
  from public.obs_sector s
  left join public.obs_uaf_reporting_sector r
    on lower(btrim(coalesce(r.sector_canonical,r.sector_official,'')))=lower(btrim(coalesce(s.uaf_sector_canonical,'')))
),
sector_max as (
  select max(coalesce(vulnerability_index,0)) m_vuln,max(coalesce(sanction_rate_per_100,0)) m_san,max(coalesce(ipf_mean,0)) m_ipf,
         max(least(abs(coalesce(delta_ros_2025_vs_2024_pct,0)),300)) m_delta
  from sector_base
),
sector_scored as (
  select s.*,
    (case when m.m_vuln>0 then coalesce(s.vulnerability_index,0)/m.m_vuln*100 else 0 end)::numeric(6,1) as vuln_norm,
    (case when m.m_san>0 then coalesce(s.sanction_rate_per_100,0)/m.m_san*100 else 0 end)::numeric(6,1) as sanction_norm,
    (case when m.m_ipf>0 then coalesce(s.ipf_mean,0)/m.m_ipf*100 else 0 end)::numeric(6,1) as ipf_norm,
    (case when m.m_delta>0 then least(abs(coalesce(s.delta_ros_2025_vs_2024_pct,0)),300)/m.m_delta*100 else 0 end)::numeric(6,1) as reporting_change_norm
  from sector_base s cross join sector_max m
),
sector_convergence as (
  select *,(0.35*vuln_norm+0.25*sanction_norm+0.25*ipf_norm+0.15*reporting_change_norm)::numeric(6,1) as attention_index
  from sector_scored
),
sector_top as (
  select * from sector_convergence order by attention_index desc nulls last,vulnerability_index desc nulls last limit 10
),
alert_mix as (
  select family,count(*) n,max(strength) max_strength
  from public.obs_alert group by family order by n desc,max_strength desc
),
coverage as (
  select jsonb_build_object(
    'press_relevant_articles',pq.relevant_articles,
    'press_geocoded_articles',pq.geocoded_articles,
    'press_geocoded_pct',pq.geocoded_pct,
    'press_media_count',pq.media_count,
    'sanctions_current',sp.current_n,
    'sanctions_previous',sp.previous_n,
    'sanctions_documented',sp.current_documented,
    'sanction_regulators',sp.regulator_count,
    'territory_regions',(select count(*) from territory_region),
    'territory_avg_coverage',(select round(avg(coverage),3) from territory_region),
    'finding_regions',(select count(*) from finding_region)
  ) payload
  from press_quality pq cross join sanction_periods sp
),
questions as (
  select jsonb_build_array(
    jsonb_build_object(
      'id','regional_convergence',
      'question','¿Dónde convergen hoy señales territoriales, hallazgos, sanciones y prensa?',
      'answer','REGIONAL_CONVERGENCE',
      'top_regions',(select coalesce(jsonb_agg(jsonb_build_object('region',region_name,'indice',convergence_index,'igr',avg_igr,'hallazgos',finding_n,'sanciones',sanction_n,'prensa',press_n) order by convergence_index desc),'[]'::jsonb) from (select * from region_top limit 5) q),
      'caveat','Índice de priorización descriptivo normalizado. Una capa sin cobertura aporta cero. No es probabilidad de LA/FT ni prevalencia criminal.'
    ),
    jsonb_build_object(
      'id','sector_convergence',
      'question','¿Qué sectores reúnen más señales para una conversación de supervisión?',
      'answer','SECTOR_CONVERGENCE',
      'top_sectors',(select coalesce(jsonb_agg(jsonb_build_object('sector',sector,'indice',attention_index,'vulnerabilidad',vulnerability_index,'tasa_sancion',sanction_rate_per_100,'ipf',ipf_mean,'var_ros',delta_ros_2025_vs_2024_pct) order by attention_index desc),'[]'::jsonb) from (select * from sector_top limit 5) q),
      'caveat','El índice ordena atención analítica. Datos faltantes aportan cero y la magnitud de variación ROS se topa en 300% para evitar que bases pequeñas dominen el resultado.'
    ),
    jsonb_build_object(
      'id','novelty_momentum',
      'question','¿Qué temas están aumentando o disminuyendo en la conversación pública reciente?',
      'answer','PRESS_MOMENTUM',
      'themes',(select coalesce(jsonb_agg(to_jsonb(q) order by abs(coalesce(delta_pct,0)) desc,current_n desc),'[]'::jsonb) from press_momentum q),
      'caveat','Variación de cobertura de prensa en ventanas equivalentes; puede responder a agenda mediática y no a incidencia delictual.'
    ),
    jsonb_build_object(
      'id','evidence_coverage',
      'question','¿Qué tan completa es la evidencia usada para responder preguntas regionales y coyunturales?',
      'answer','COVERAGE',
      'coverage',(select payload from coverage),
      'caveat','La cobertura desigual debe mostrarse como limitación del informe, no ocultarse con inferencias.'
    )
  ) payload
)
select jsonb_build_object(
  'contract','ATLAS_OBS_UAF_STRATEGIC_DEPTH_V4',
  'generated_at',now(),
  'window',jsonb_build_object('days',(select days from cfg),'current_from',(select cur_from from cfg),'previous_from',(select prev_from from cfg),'to',current_date),
  'regional_convergence',coalesce((select jsonb_agg(to_jsonb(q) order by convergence_index desc) from region_top q),'[]'::jsonb),
  'sector_convergence',coalesce((select jsonb_agg(to_jsonb(q) order by attention_index desc) from sector_top q),'[]'::jsonb),
  'press_momentum',coalesce((select jsonb_agg(to_jsonb(q)) from press_momentum q),'[]'::jsonb),
  'alert_mix',coalesce((select jsonb_agg(to_jsonb(q)) from alert_mix q),'[]'::jsonb),
  'coverage',(select payload from coverage),
  'preguntas_profundas',(select payload from questions),
  'methodology',jsonb_build_object(
    'regional_index','40% IGR normalizado + 25% hallazgos normalizados + 20% sanciones recientes normalizadas + 15% prensa georreferenciada normalizada. Si una capa no tiene cobertura, aporta cero.',
    'sector_index','35% vulnerabilidad sectorial + 25% tasa sancionatoria + 25% IPF medio + 15% magnitud de variación ROS topada en 300%. Datos faltantes aportan cero.',
    'momentum','Compara la ventana seleccionada con la ventana inmediatamente anterior de igual duración.',
    'interpretation','Todos son índices de priorización analítica; ninguno estima probabilidad de LA/FT ni culpabilidad.'
  )
);
$body$;

revoke all on function public.obs_uaf_strategic_depth_payload(integer) from public, anon;
grant execute on function public.obs_uaf_strategic_depth_payload(integer) to authenticated, service_role;
