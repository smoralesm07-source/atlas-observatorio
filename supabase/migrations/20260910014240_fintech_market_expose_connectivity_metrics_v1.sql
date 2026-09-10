do $body$
declare f text;
begin
  select pg_get_functiondef(p.oid) into f
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='obs_fintech_market_weight_status' and pg_get_function_identity_arguments(p.oid)='';
  if f is null then raise exception 'obs_fintech_market_weight_status not found'; end if;
  f := replace(f,
    $old$'APP_DOWNLOADS_COUNT')$old$,
    $new$'APP_DOWNLOADS_COUNT','FINANCIAL_INSTITUTIONS_CONNECTED_COUNT','DATA_SOURCES_CONNECTED_COUNT','PROCESSED_VOLUME_PERIOD_USD')$new$
  );
  execute f;
end
$body$;