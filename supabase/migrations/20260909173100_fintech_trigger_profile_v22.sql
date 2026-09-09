create or replace function public.aml_fintech_trigger_enrichment()
returns bigint
language plpgsql
security definer
set search_path to 'public','vault','net','pg_temp'
as $function$
declare v_token text; v_request bigint;
begin
  select decrypted_secret into v_token from vault.decrypted_secrets where name='atlas_fintech_cron_token' limit 1;
  if v_token is null then raise exception 'FINTECH_CRON_TOKEN_MISSING'; end if;
  select net.http_post(
    url:='https://ldmtlwzqaqmegedktlxr.supabase.co/functions/v1/atlas-fintech-profile-v22',
    body:=jsonb_build_object('limit',8),
    headers:=jsonb_build_object('content-type','application/json','x-atlas-cron-token',v_token),
    timeout_milliseconds:=120000
  ) into v_request;
  return v_request;
end;
$function$;

revoke all on function public.aml_fintech_trigger_enrichment() from public,anon,authenticated;
grant execute on function public.aml_fintech_trigger_enrichment() to service_role;