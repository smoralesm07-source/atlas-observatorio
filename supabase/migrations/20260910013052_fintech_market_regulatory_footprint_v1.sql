create or replace function public.obs_fintech_market_weight_status()
returns jsonb
language plpgsql
stable security definer
set search_path to 'public','extensions','pg_temp'
as $function$
declare ok boolean; outj jsonb;
begin
  select exists(select 1 from public.aml_allowed_users au where au.user_id=auth.uid() and au.enabled) into ok;
  if not ok then return jsonb_build_object('error','NOT_AUTHORIZED'); end if;

  select jsonb_build_object(
    'observations',(select count(*) from public.aml_fintech_market_metric_observation),
    'subjects_profiled',(select count(distinct subject_type||'|'||subject_key) from public.aml_fintech_market_metric_observation where evidence_type<>'NO_OBSERVABLE'),
    'entities_profiled',(select count(distinct subject_key) from public.aml_fintech_market_metric_observation where subject_type='ENTITY' and evidence_type<>'NO_OBSERVABLE'),
    'candidates_profiled',(select count(distinct subject_key) from public.aml_fintech_market_metric_observation where subject_type='CANDIDATE' and evidence_type<>'NO_OBSERVABLE'),
    'regulatory_footprint',jsonb_build_object(
      'cmf_current',(select count(distinct fintech_id) from public.aml_fintech_regulatory_status where regulator='CMF' and status='VIGENTE'),
      'uaf_current',(select count(distinct fintech_id) from public.aml_fintech_regulatory_status where regulator='UAF' and status='INSCRITO_PUBLICADO'),
      'dual_current',(select count(*) from (select fintech_id from public.aml_fintech_regulatory_status group by fintech_id having bool_or(regulator='CMF' and status='VIGENTE') and bool_or(regulator='UAF' and status='INSCRITO_PUBLICADO')) q)
    ),
    'cohorts',coalesce((select jsonb_agg(to_jsonb(x) order by x.entity_count desc,x.cohort_label) from (
      select co.cohort_code,co.cohort_label,count(*)::int entity_count,
        count(*) filter(where e.business_model is not null)::int business_model_classified,
        count(*) filter(where e.target_customer is not null)::int target_customer_classified,
        count(*) filter(where e.revenue_model is not null)::int revenue_model_classified,
        count(*) filter(where co.metric_count>0)::int metrics_profiled,
        count(*) filter(where co.function_count>0)::int function_profiled,
        count(*) filter(where e.psav_status='CONFIRMED')::int psav_confirmed,
        count(*) filter(where e.psav_status='EXPOSURE')::int va_exposure,
        count(*) filter(where exists(select 1 from public.aml_fintech_regulatory_status r where r.fintech_id=co.fintech_id and r.regulator='CMF' and r.status='VIGENTE'))::int cmf_registered,
        count(*) filter(where exists(select 1 from public.aml_fintech_regulatory_status r where r.fintech_id=co.fintech_id and r.regulator='UAF' and r.status='INSCRITO_PUBLICADO'))::int uaf_registered,
        count(*) filter(where exists(select 1 from public.aml_fintech_regulatory_status r where r.fintech_id=co.fintech_id and r.regulator='CMF' and r.status='VIGENTE') and exists(select 1 from public.aml_fintech_regulatory_status r where r.fintech_id=co.fintech_id and r.regulator='UAF' and r.status='INSCRITO_PUBLICADO'))::int dual_registered,
        count(*) filter(where exists(select 1 from public.aml_fintech_market_peer_position p where p.subject_type='ENTITY' and p.subject_key=co.fintech_id and p.peer_group like 'COHORT|'||co.cohort_code||'|%' and p.percentile is not null))::int comparable_entities
      from atlas_private.aml_fintech_market_cohort_snapshot_v1 co
      join public.aml_fintech_entity e on e.fintech_id=co.fintech_id
      group by co.cohort_code,co.cohort_label
    ) x),'[]'::jsonb),
    'leaders',coalesce((select jsonb_agg(to_jsonb(z) order by z.cohort_label,z.metric_label) from (
      select distinct on(co.cohort_code,o.metric_code)
        co.cohort_code,co.cohort_label,o.metric_code,mc.label metric_label,mc.dimension,
        coalesce(e.brand,e.legal_name,o.subject_key) entity_name,o.subject_key fintech_id,
        o.value_numeric,o.value_text,o.unit,o.currency,o.qualifier,o.geography,o.source_url,
        p.peer_count,p.peer_rank,p.percentile,p.tier
      from (
        select distinct on(subject_key,metric_code) *
        from public.aml_fintech_market_metric_observation
        where subject_type='ENTITY' and value_numeric is not null and evidence_type<>'NO_OBSERVABLE'
          and coalesce((metadata->>'historical_observation')::boolean,false)=false
        order by subject_key,metric_code,coalesce(period_end,period_start) desc nulls last,observed_at desc
      ) o
      join public.aml_fintech_market_metric_catalog mc using(metric_code)
      join atlas_private.aml_fintech_market_cohort_snapshot_v1 co on co.fintech_id=o.subject_key
      join public.aml_fintech_entity e on e.fintech_id=o.subject_key
      left join public.aml_fintech_market_peer_position p on p.subject_type='ENTITY' and p.subject_key=o.subject_key and p.metric_code=o.metric_code and p.peer_group='COHORT|'||co.cohort_code||'|'||o.metric_code
      where o.metric_code in ('USERS','CLIENTS','BUSINESS_CLIENTS','MERCHANTS','INSURED_PERSONS','TRANSACTIONS_MONTHLY_COUNT','TRANSACTIONS_ANNUAL_COUNT','TRANSACTIONS_QUARTERLY_COUNT','PROCESSED_VOLUME_MONTHLY_USD','ANNUAL_TRANSACTION_VOLUME_USD','ANNUALIZED_TRANSACTION_VOLUME_USD_EST','CUMULATIVE_TRANSACTION_VOLUME_USD','TPV_USD','ORIGINATED_VOLUME_USD','AUM_AUC_USD','COUNTRIES_SERVICE_REACH','COUNTRIES_OPERATING','PAYMENT_METHODS_COUNT','API_CONNECTIONS','AGREEMENTS_COUNT','HEALTH_PROVIDERS_NETWORK','PROJECTS_FINANCED_COUNT','FINANCINGS_COUNT','VERIFICATIONS_24H_COUNT','APP_DOWNLOADS')
      order by co.cohort_code,o.metric_code,(case when mc.higher_means_more_weight then o.value_numeric else -o.value_numeric end) desc,o.observed_at desc
    ) z),'[]'::jsonb),
    'dimensions',coalesce((select jsonb_agg(x order by x.dimension) from (
       select c.dimension,count(distinct o.subject_type||'|'||o.subject_key)::int actors,count(*)::int observations
       from public.aml_fintech_market_metric_observation o join public.aml_fintech_market_metric_catalog c using(metric_code)
       where o.evidence_type<>'NO_OBSERVABLE' group by c.dimension) x),'[]'::jsonb),
    'top_metrics',coalesce((select jsonb_agg(x order by x.actors desc,x.metric_code) from (
       select o.metric_code,c.label,c.dimension,count(distinct o.subject_type||'|'||o.subject_key)::int actors
       from public.aml_fintech_market_metric_observation o join public.aml_fintech_market_metric_catalog c using(metric_code)
       where o.evidence_type<>'NO_OBSERVABLE' group by o.metric_code,c.label,c.dimension order by actors desc,o.metric_code limit 12) x),'[]'::jsonb),
    'latest_run',coalesce((select to_jsonb(r) from public.aml_fintech_market_weight_run r order by r.run_id desc limit 1),'null'::jsonb),
    'refreshed_at',(select max(observed_at) from public.aml_fintech_market_metric_observation),
    'methodology','Cohortes analíticas normalizan verticales equivalentes sin reemplazar la clasificación fuente. La posición vigente compara sólo observaciones no históricas, dentro de la misma métrica y cohorte, con al menos 3 pares. La huella regulatoria CMF/UAF se informa separadamente y no integra el percentil ni constituye una medida de tamaño. Usuarios, clientes, comercios, transacciones, volumen, alcance y métodos de pago nunca se suman entre sí y no constituyen cuota de mercado.'
  ) into outj;
  return outj;
end
$function$;

create or replace function public.obs_fintech_market_weight_detail(p_subject_type text,p_subject_key text)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public','extensions','pg_temp'
as $function$
declare ok boolean; outj jsonb;
begin
  select exists(select 1 from public.aml_allowed_users au where au.user_id=auth.uid() and au.enabled) into ok;
  if not ok then return jsonb_build_object('error','NOT_AUTHORIZED'); end if;

  select jsonb_build_object(
    'subject_type',upper(p_subject_type),'subject_key',p_subject_key,
    'cohort',case when upper(p_subject_type)='ENTITY' then coalesce((select to_jsonb(c) from atlas_private.aml_fintech_market_cohort_snapshot_v1 c where c.fintech_id=p_subject_key),'null'::jsonb) else 'null'::jsonb end,
    'regulation',case when upper(p_subject_type)='ENTITY' then coalesce((select jsonb_agg(to_jsonb(r) order by r.regulator,r.registry,r.effective_date desc nulls last) from (
      select regulator,registry,service,status,registration_no,effective_date,end_date,source_url,observed_at
      from public.aml_fintech_regulatory_status
      where fintech_id=p_subject_key
    ) r),'[]'::jsonb) else '[]'::jsonb end,
    'metrics',coalesce((select jsonb_agg(to_jsonb(x) order by x.dimension,x.sort_order,x.observed_at desc) from (
      select o.observation_id,o.metric_code,c.label,c.dimension,o.value_numeric,o.value_text,o.unit,o.currency,o.qualifier,
             o.period_start,o.period_end,o.geography,o.evidence_type,o.confidence,o.source_code,o.source_url,o.published_at,o.observed_at,o.basis,o.evidence_excerpt,
             gp.peer_count,gp.peer_rank,gp.percentile,gp.tier,
             cp.peer_count cohort_peer_count,cp.peer_rank cohort_peer_rank,cp.percentile cohort_percentile,cp.tier cohort_tier,c.sort_order
      from public.aml_fintech_market_metric_observation o
      join public.aml_fintech_market_metric_catalog c using(metric_code)
      left join public.aml_fintech_market_peer_position gp on gp.subject_type=o.subject_type and gp.subject_key=o.subject_key and gp.metric_code=o.metric_code and gp.peer_group=o.metric_code
      left join atlas_private.aml_fintech_market_cohort_snapshot_v1 co on o.subject_type='ENTITY' and co.fintech_id=o.subject_key
      left join public.aml_fintech_market_peer_position cp on cp.subject_type=o.subject_type and cp.subject_key=o.subject_key and cp.metric_code=o.metric_code and cp.peer_group='COHORT|'||co.cohort_code||'|'||o.metric_code
      where o.subject_type=upper(p_subject_type) and o.subject_key=p_subject_key
    ) x),'[]'::jsonb),
    'dimensions',coalesce((select jsonb_agg(to_jsonb(d) order by case d.dimension when 'ECONOMIC_SCALE' then 1 when 'BUSINESS_ACTIVITY' then 2 when 'REACH' then 3 else 4 end)
      from public.aml_fintech_market_dimension_snapshot d where d.subject_type=upper(p_subject_type) and d.subject_key=p_subject_key),'[]'::jsonb),
    'note','Percentil cohorte es la comparación preferente para entidades y sólo existe con al menos 3 pares en la misma métrica. La evidencia histórica se conserva pero no determina el ranking vigente. La huella regulatoria se muestra como contexto independiente y no se suma al peso observable.'
  ) into outj;
  return outj;
end
$function$;