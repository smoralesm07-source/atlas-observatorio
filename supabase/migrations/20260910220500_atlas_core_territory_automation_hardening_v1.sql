-- El estado de automatizacion queda reservado a service_role. No es necesario
-- exponer un SECURITY DEFINER adicional a usuarios autenticados para que el
-- refresco funcione.

create or replace function public.obs_territory_refresh_status()
returns jsonb
language sql
stable
security definer
set search_path=public,atlas_core,pg_temp
as $$
  select jsonb_build_object(
    'contract','ATLAS_OBS_TERRITORY_REFRESH_STATUS_V1',
    'status',s.status,
    'mode',s.mode,
    'progress',case when s.status='RUNNING' and s.mode='FULL' and s.next_prefix is not null
      then jsonb_build_object('current_prefix',s.next_prefix,'prefix_start',s.prefix_start,'prefix_end',s.prefix_end,
        'pct',round(100.0*greatest(0,s.next_prefix-s.prefix_start)/greatest(1,s.prefix_end-s.prefix_start+1),1))
      else null end,
    'last_completed_at',s.last_completed_at,
    'last_batch_at',s.last_batch_at,
    'cycle_count',s.cycle_count,
    'batch_count',s.batch_count,
    'consecutive_failures',s.consecutive_failures,
    'has_error',s.last_error is not null,
    'updated_at',s.updated_at,
    'cron',(select jsonb_build_object('schedule',j.schedule,'active',j.active)
            from cron.job j where j.jobname='atlas-core-territory-refresh-worker')
  )
  from atlas_core.territory_refresh_state s
  where s.singleton=true;
$$;

revoke all on function public.obs_territory_refresh_status() from public, anon, authenticated;
grant execute on function public.obs_territory_refresh_status() to service_role;
