create or replace function atlas_private.aml_fintech_market_geo_bucket(p_geography text)
returns text
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select case upper(coalesce(nullif(trim(p_geography),''),'UNSPECIFIED'))
    when 'CHILE' then 'CHILE'
    when 'LATAM' then 'REGIONAL'
    when 'AMERICAS' then 'REGIONAL'
    when 'INTERNATIONAL' then 'GLOBAL'
    when 'GLOBAL' then 'GLOBAL'
    when 'COMPANY_WIDE' then 'COMPANY_WIDE'
    else 'UNSPECIFIED'
  end
$$;

do $do$
declare
  v_def text := pg_get_functiondef('atlas_private.aml_fintech_refresh_market_weight()'::regprocedure);
  v_before text;
begin
  v_before := v_def;
  v_def := replace(v_def,
    'and coalesce((o.metadata->>''historical_observation'')::boolean,false)=false',
    'and coalesce((o.metadata->>''historical_observation'')::boolean,false)=false
      and coalesce((o.metadata->>''historical'')::boolean,false)=false
      and coalesce((o.metadata->>''historical_snapshot'')::boolean,false)=false
      and coalesce((o.metadata->>''not_current_coverage'')::boolean,false)=false
      and coalesce((o.metadata->>''exclude_from_peer_ranking'')::boolean,false)=false');
  if v_def = v_before then raise exception 'historical filter pattern not found'; end if;

  v_before := v_def;
  v_def := replace(v_def,
    'o.subject_type,o.subject_key,o.metric_code,o.value_numeric,c.higher_means_more_weight',
    'o.subject_type,o.subject_key,o.metric_code,o.value_numeric,c.higher_means_more_weight,atlas_private.aml_fintech_market_geo_bucket(o.geography) as geo_bucket');
  if v_def = v_before then raise exception 'global latest pattern not found'; end if;

  v_before := v_def;
  v_def := replace(v_def,'count(*) over(partition by metric_code) peer_count,','count(*) over(partition by metric_code,geo_bucket) peer_count,');
  v_def := replace(v_def,'rank() over(partition by metric_code order by','rank() over(partition by metric_code,geo_bucket order by');
  v_def := replace(v_def,'percent_rank() over(partition by metric_code order by','percent_rank() over(partition by metric_code,geo_bucket order by');
  if v_def = v_before then raise exception 'global partition patterns not found'; end if;

  v_before := v_def;
  v_def := replace(v_def,
    'o.subject_key,o.metric_code,o.value_numeric,c.higher_means_more_weight,co.cohort_code',
    'o.subject_key,o.metric_code,o.value_numeric,c.higher_means_more_weight,co.cohort_code,atlas_private.aml_fintech_market_geo_bucket(o.geography) as geo_bucket');
  if v_def = v_before then raise exception 'cohort latest pattern not found'; end if;

  v_before := v_def;
  v_def := replace(v_def,'count(*) over(partition by cohort_code,metric_code) peer_count,','count(*) over(partition by cohort_code,metric_code,geo_bucket) peer_count,');
  v_def := replace(v_def,'rank() over(partition by cohort_code,metric_code order by','rank() over(partition by cohort_code,metric_code,geo_bucket order by');
  v_def := replace(v_def,'percent_rank() over(partition by cohort_code,metric_code order by','percent_rank() over(partition by cohort_code,metric_code,geo_bucket order by');
  if v_def = v_before then raise exception 'cohort partition patterns not found'; end if;

  execute v_def;
end
$do$;

select atlas_private.aml_fintech_refresh_market_weight();