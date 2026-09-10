do $do$
declare
  v_def text := pg_get_functiondef('atlas_private.aml_fintech_refresh_market_weight()'::regprocedure);
  v_before text;
begin
  v_before := v_def;
  v_def := replace(v_def,
    'order by o.subject_type,o.subject_key,o.metric_code,coalesce(o.period_end,o.period_start) desc nulls last,o.observed_at desc',
    'order by o.subject_type,o.subject_key,o.metric_code,(o.period_end is null and o.period_start is null) desc,coalesce(o.period_end,o.period_start) desc nulls last,o.observed_at desc');
  if v_def = v_before then raise exception 'global/live ordering pattern not found'; end if;

  v_before := v_def;
  v_def := replace(v_def,
    'order by o.subject_key,o.metric_code,coalesce(o.period_end,o.period_start) desc nulls last,o.observed_at desc',
    'order by o.subject_key,o.metric_code,(o.period_end is null and o.period_start is null) desc,coalesce(o.period_end,o.period_start) desc nulls last,o.observed_at desc');
  if v_def = v_before then raise exception 'cohort/live ordering pattern not found'; end if;

  execute v_def;
end
$do$;

select atlas_private.aml_fintech_refresh_market_weight();