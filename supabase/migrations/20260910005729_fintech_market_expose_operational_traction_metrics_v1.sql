do $$
declare f text;
begin
  select pg_get_functiondef('public.obs_fintech_market_weight_status()'::regprocedure) into f;
  if position('''HEALTH_PROVIDERS_NETWORK'')' in f)=0 then
    raise exception 'Expected metric whitelist marker not found';
  end if;
  f := replace(f,
    '''HEALTH_PROVIDERS_NETWORK'')',
    '''HEALTH_PROVIDERS_NETWORK'',''PROJECTS_FINANCED_COUNT'',''FINANCINGS_COUNT'',''VERIFICATIONS_24H_COUNT'')'
  );
  execute f;
end
$$;
