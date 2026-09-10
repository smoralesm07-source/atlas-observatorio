do $$
declare f text;
begin
  select pg_get_functiondef('public.obs_fintech_market_weight_status()'::regprocedure) into f;
  if position('''APP_DOWNLOADS_COUNT''' in f)=0 then
    f := replace(f,
      '''PROJECTS_FINANCED_COUNT'',''FINANCINGS_COUNT'',''VERIFICATIONS_24H_COUNT'')',
      '''PROJECTS_FINANCED_COUNT'',''FINANCINGS_COUNT'',''VERIFICATIONS_24H_COUNT'',''APP_DOWNLOADS_COUNT'')'
    );
    execute f;
  end if;
end
$$;
