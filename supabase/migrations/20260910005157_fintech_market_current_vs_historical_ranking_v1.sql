create or replace function atlas_private.aml_fintech_refresh_market_weight()
returns jsonb
language plpgsql
security definer
set search_path to 'public','atlas_private','extensions','pg_temp'
as $$
declare v_obs int; v_pos_global int:=0; v_pos_cohort int:=0; v_dim int; v_cohort jsonb;
begin
  insert into public.aml_fintech_market_metric_observation(
    observation_key,subject_type,subject_key,metric_code,value_numeric,value_text,unit,qualifier,
    evidence_type,confidence,source_code,source_url,observed_at,basis,metadata,last_seen_at)
  select 'SII_SALES_BAND|'||e.fintech_id,'ENTITY',e.fintech_id,'SII_SALES_BAND_RANK',e.sii_sales_band_rank,
         case when e.sii_sales_band is null then null else 'Tramo '||e.sii_sales_band end,'rank','EXACT',
         'OBSERVADO_OFICIAL',1,'SII_PUBLIC','https://www.sii.cl/',now(),
         'Tramo de ventas disponible en la capa SII abierta integrada por ATLAS.',jsonb_build_object('sales_band',e.sii_sales_band),now()
  from public.aml_v_fintech_entity_current e where e.sii_sales_band_rank is not null
  on conflict(observation_key) do update set value_numeric=excluded.value_numeric,value_text=excluded.value_text,observed_at=excluded.observed_at,last_seen_at=now(),metadata=excluded.metadata;

  insert into public.aml_fintech_market_metric_observation(
    observation_key,subject_type,subject_key,metric_code,value_numeric,unit,qualifier,evidence_type,confidence,source_code,source_url,observed_at,basis,last_seen_at)
  select 'SII_WORKERS|'||e.fintech_id,'ENTITY',e.fintech_id,'WORKERS',e.sii_workers,'workers','EXACT',
         'OBSERVADO_OFICIAL',1,'SII_PUBLIC','https://www.sii.cl/',now(),
         'Trabajadores disponibles en la capa SII abierta integrada por ATLAS.',now()
  from public.aml_v_fintech_entity_current e where e.sii_workers is not null
  on conflict(observation_key) do update set value_numeric=excluded.value_numeric,observed_at=excluded.observed_at,last_seen_at=now();

  insert into public.aml_fintech_market_metric_observation(
    observation_key,subject_type,subject_key,metric_code,value_numeric,value_text,unit,currency,qualifier,
    period_start,period_end,evidence_type,confidence,source_code,source_url,published_at,observed_at,basis,last_seen_at)
  select 'LEGACY|'||m.metric_id::text,'ENTITY',m.fintech_id,m.metric_code,m.value_numeric,m.value_text,m.unit,m.currency,'EXACT',
         m.period_start,m.period_end,m.evidence_type,m.confidence,m.source_code,m.source_url,m.published_at,m.observed_at,
         'Métrica estructurada previamente en aml_fintech_market_metric.',now()
  from public.aml_fintech_market_metric m join public.aml_fintech_market_metric_catalog c on c.metric_code=m.metric_code
  on conflict(observation_key) do update set value_numeric=excluded.value_numeric,value_text=excluded.value_text,last_seen_at=now();

  select atlas_private.aml_fintech_refresh_market_cohorts_v1() into v_cohort;
  delete from public.aml_fintech_market_peer_position where subject_type in ('ENTITY','CANDIDATE');

  with latest as (
    select distinct on(o.subject_type,o.subject_key,o.metric_code)
      o.subject_type,o.subject_key,o.metric_code,o.value_numeric,c.higher_means_more_weight
    from public.aml_fintech_market_metric_observation o
    join public.aml_fintech_market_metric_catalog c using(metric_code)
    where o.value_numeric is not null and o.evidence_type <> 'NO_OBSERVABLE'
      and coalesce((o.metadata->>'historical_observation')::boolean,false)=false
    order by o.subject_type,o.subject_key,o.metric_code,coalesce(o.period_end,o.period_start) desc nulls last,o.observed_at desc
  ), ranked as (
    select l.*,
      count(*) over(partition by metric_code) peer_count,
      rank() over(partition by metric_code order by (case when higher_means_more_weight then value_numeric else -value_numeric end) desc) peer_rank,
      percent_rank() over(partition by metric_code order by (case when higher_means_more_weight then value_numeric else -value_numeric end))::numeric percentile_low_to_high
    from latest l
  )
  insert into public.aml_fintech_market_peer_position(subject_type,subject_key,metric_code,peer_group,peer_count,peer_rank,percentile,tier,anchor_value,calculated_at)
  select subject_type,subject_key,metric_code,metric_code,peer_count,peer_rank,
    case when peer_count>=3 then round(percentile_low_to_high,4) else null end,
    case when peer_count<3 then 'INSUFFICIENT_PEERS'
         when percentile_low_to_high>=0.9 then 'VERY_HIGH'
         when percentile_low_to_high>=0.67 then 'HIGH'
         when percentile_low_to_high>=0.33 then 'MEDIUM'
         else 'LOW' end,
    value_numeric,now()
  from ranked;
  get diagnostics v_pos_global = row_count;

  with latest as (
    select distinct on(o.subject_key,o.metric_code)
      o.subject_key,o.metric_code,o.value_numeric,c.higher_means_more_weight,co.cohort_code
    from public.aml_fintech_market_metric_observation o
    join public.aml_fintech_market_metric_catalog c using(metric_code)
    join atlas_private.aml_fintech_market_cohort_snapshot_v1 co on co.fintech_id=o.subject_key
    where o.subject_type='ENTITY' and o.value_numeric is not null and o.evidence_type <> 'NO_OBSERVABLE'
      and coalesce((o.metadata->>'historical_observation')::boolean,false)=false
    order by o.subject_key,o.metric_code,coalesce(o.period_end,o.period_start) desc nulls last,o.observed_at desc
  ), ranked as (
    select l.*,
      count(*) over(partition by cohort_code,metric_code) peer_count,
      rank() over(partition by cohort_code,metric_code order by (case when higher_means_more_weight then value_numeric else -value_numeric end) desc) peer_rank,
      percent_rank() over(partition by cohort_code,metric_code order by (case when higher_means_more_weight then value_numeric else -value_numeric end))::numeric percentile_low_to_high
    from latest l
  )
  insert into public.aml_fintech_market_peer_position(subject_type,subject_key,metric_code,peer_group,peer_count,peer_rank,percentile,tier,anchor_value,calculated_at)
  select 'ENTITY',subject_key,metric_code,'COHORT|'||cohort_code||'|'||metric_code,peer_count,peer_rank,
    case when peer_count>=3 then round(percentile_low_to_high,4) else null end,
    case when peer_count<3 then 'INSUFFICIENT_PEERS'
         when percentile_low_to_high>=0.9 then 'VERY_HIGH'
         when percentile_low_to_high>=0.67 then 'HIGH'
         when percentile_low_to_high>=0.33 then 'MEDIUM'
         else 'LOW' end,
    value_numeric,now()
  from ranked;
  get diagnostics v_pos_cohort = row_count;

  delete from public.aml_fintech_market_dimension_snapshot where subject_type in ('ENTITY','CANDIDATE');
  with latest as (
    select distinct on(o.subject_type,o.subject_key,o.metric_code)
      o.subject_type,o.subject_key,o.metric_code,o.value_numeric,o.evidence_type,c.dimension
    from public.aml_fintech_market_metric_observation o
    join public.aml_fintech_market_metric_catalog c using(metric_code)
    order by o.subject_type,o.subject_key,o.metric_code,coalesce(o.period_end,o.period_start) desc nulls last,o.observed_at desc
  ), agg as (
    select subject_type,subject_key,dimension,
      count(*) filter(where evidence_type<>'NO_OBSERVABLE')::int total_metric_count,
      count(*) filter(where value_numeric is not null and evidence_type<>'NO_OBSERVABLE')::int numeric_metric_count
    from latest group by subject_type,subject_key,dimension
  ), strongest as (
    select distinct on(p.subject_type,p.subject_key,c.dimension)
      p.subject_type,p.subject_key,c.dimension,p.metric_code,p.percentile
    from public.aml_fintech_market_peer_position p
    join public.aml_fintech_market_metric_catalog c using(metric_code)
    where p.percentile is not null
      and ((p.subject_type='ENTITY' and p.peer_group like 'COHORT|%') or (p.subject_type='CANDIDATE' and p.peer_group=p.metric_code))
    order by p.subject_type,p.subject_key,c.dimension,p.percentile desc nulls last,p.metric_code
  )
  insert into public.aml_fintech_market_dimension_snapshot(subject_type,subject_key,dimension,numeric_metric_count,total_metric_count,strongest_metric_code,strongest_percentile,evidence_coverage,refreshed_at)
  select a.subject_type,a.subject_key,a.dimension,a.numeric_metric_count,a.total_metric_count,s.metric_code,s.percentile,
    case when a.total_metric_count>=3 and a.numeric_metric_count>=2 then 'HIGH'
         when a.total_metric_count>=2 then 'MEDIUM'
         when a.total_metric_count>=1 then 'LOW' else 'NONE' end,now()
  from agg a left join strongest s using(subject_type,subject_key,dimension);
  get diagnostics v_dim = row_count;

  select count(*) into v_obs from public.aml_fintech_market_metric_observation;
  return jsonb_build_object('observations',v_obs,'global_peer_positions',v_pos_global,'cohort_peer_positions',v_pos_cohort,'dimension_snapshots',v_dim,'cohorts',v_cohort,'refreshed_at',now());
end
$$;

create or replace function public.obs_fintech_market_weight_status()
returns jsonb
language plpgsql
stable security definer
set search_path to 'public','extensions','pg_temp'
as $$
declare ok boolean; outj jsonb;
begin
  select exists(select 1 from public.aml_allowed_users au where au.user_id=auth.uid() and au.enabled) into ok;
  if not ok then return jsonb_build_object('error','NOT_AUTHORIZED'); end if;

  select jsonb_build_object(
    'observations',(select count(*) from public.aml_fintech_market_metric_observation),
    'subjects_profiled',(select count(distinct subject_type||'|'||subject_key) from public.aml_fintech_market_metric_observation where evidence_type<>'NO_OBSERVABLE'),
    'entities_profiled',(select count(distinct subject_key) from public.aml_fintech_market_metric_observation where subject_type='ENTITY' and evidence_type<>'NO_OBSERVABLE'),
    'candidates_profiled',(select count(distinct subject_key) from public.aml_fintech_market_metric_observation where subject_type='CANDIDATE' and evidence_type<>'NO_OBSERVABLE'),
    'cohorts',coalesce((select jsonb_agg(to_jsonb(x) order by x.entity_count desc,x.cohort_label) from (
      select co.cohort_code,co.cohort_label,count(*)::int entity_count,
        count(*) filter(where e.business_model is not null)::int business_model_classified,
        count(*) filter(where e.target_customer is not null)::int target_customer_classified,
        count(*) filter(where e.revenue_model is not null)::int revenue_model_classified,
        count(*) filter(where co.metric_count>0)::int metrics_profiled,
        count(*) filter(where co.function_count>0)::int function_profiled,
        count(*) filter(where e.psav_status='CONFIRMED')::int psav_confirmed,
        count(*) filter(where e.psav_status='EXPOSURE')::int va_exposure,
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
      where o.metric_code in ('USERS','CLIENTS','BUSINESS_CLIENTS','MERCHANTS','INSURED_PERSONS','TRANSACTIONS_MONTHLY_COUNT','TRANSACTIONS_ANNUAL_COUNT','TRANSACTIONS_QUARTERLY_COUNT','PROCESSED_VOLUME_MONTHLY_USD','ANNUAL_TRANSACTION_VOLUME_USD','ANNUALIZED_TRANSACTION_VOLUME_USD_EST','CUMULATIVE_TRANSACTION_VOLUME_USD','TPV_USD','ORIGINATED_VOLUME_USD','AUM_AUC_USD','COUNTRIES_SERVICE_REACH','COUNTRIES_OPERATING','PAYMENT_METHODS_COUNT','API_CONNECTIONS','AGREEMENTS_COUNT','HEALTH_PROVIDERS_NETWORK')
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
    'methodology','Cohortes analíticas normalizan verticales equivalentes sin reemplazar la clasificación fuente. La posición vigente compara sólo observaciones no históricas, dentro de la misma métrica y cohorte, con al menos 3 pares. La evidencia histórica se conserva en ficha pero no determina el ranking actual. Usuarios, clientes, comercios, transacciones, volumen, alcance y métodos de pago nunca se suman entre sí y no constituyen cuota de mercado.'
  ) into outj;
  return outj;
end
$$;

revoke execute on function public.obs_fintech_market_weight_status() from public, anon;
grant execute on function public.obs_fintech_market_weight_status() to authenticated;
