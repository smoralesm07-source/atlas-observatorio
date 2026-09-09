create or replace function public.aml_fintech_refresh_ecosystem_master()
returns jsonb
language plpgsql
set search_path=public,pg_temp
as $$
declare v_reconcile jsonb; v_snapshot bigint;
begin
  v_reconcile:=public.aml_fintech_reconcile_sector_directories();
  v_snapshot:=public.aml_fintech_capture_ecosystem_coverage();
  return jsonb_build_object('reconcile',v_reconcile,'coverage_snapshot_id',v_snapshot,'refreshed_at',now());
end$$;
revoke all on function public.aml_fintech_refresh_ecosystem_master() from public,anon,authenticated;
grant execute on function public.aml_fintech_refresh_ecosystem_master() to service_role;

do $$ declare j bigint; begin
  select jobid into j from cron.job where jobname='atlas-fintech-ecosystem-master';
  if j is not null then perform cron.unschedule(j); end if;
  perform cron.schedule('atlas-fintech-ecosystem-master','55 */3 * * *','select public.aml_fintech_refresh_ecosystem_master();');
end $$;