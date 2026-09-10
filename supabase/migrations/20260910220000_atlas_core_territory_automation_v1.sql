-- ATLAS Observatorio · automatización incremental del universo territorial amplio
-- pg_cron ejecuta un worker liviano cada 2 minutos. Si no cambian las fuentes,
-- el worker termina sin trabajo. Cambios RES/SII abren un ciclo FULL por lotes;
-- cambios analíticos sólo recompensan overlays + snapshot.

create table if not exists atlas_core.territory_refresh_state (
  singleton boolean primary key default true check (singleton),
  status text not null default 'IDLE' check (status in ('IDLE','RUNNING','ERROR')),
  mode text check (mode in ('FULL','OVERLAY')),
  prefix_start integer not null default 762,
  prefix_end integer not null default 799,
  next_prefix integer,
  last_prefix integer,
  last_res_watermark timestamptz,
  last_sii_watermark timestamptz,
  last_obs_watermark timestamptz,
  last_osfl_watermark timestamptz,
  last_fintech_watermark timestamptz,
  target_res_watermark timestamptz,
  target_sii_watermark timestamptz,
  target_obs_watermark timestamptz,
  target_osfl_watermark timestamptz,
  target_fintech_watermark timestamptz,
  cycle_started_at timestamptz,
  last_batch_at timestamptz,
  last_completed_at timestamptz,
  cycle_count bigint not null default 0,
  batch_count bigint not null default 0,
  consecutive_failures integer not null default 0,
  last_error text,
  last_result jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists atlas_core.territory_refresh_log (
  log_id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  event_type text not null,
  mode text,
  prefix integer,
  status text not null,
  detail jsonb
);

create index if not exists atlas_core_territory_refresh_log_time_idx
  on atlas_core.territory_refresh_log (occurred_at desc);

revoke all on atlas_core.territory_refresh_state from public, anon, authenticated;
revoke all on atlas_core.territory_refresh_log from public, anon, authenticated;
grant select, insert, update, delete on atlas_core.territory_refresh_state to service_role;
grant select, insert, update, delete on atlas_core.territory_refresh_log to service_role;

create or replace function atlas_core.territory_source_watermarks()
returns table(
  res_watermark timestamptz,
  sii_watermark timestamptz,
  obs_watermark timestamptz,
  osfl_watermark timestamptz,
  fintech_watermark timestamptz
)
language sql
stable
security invoker
set search_path=public,atlas_core,pg_temp
as $$
  select
    (select max(refreshed_at) from public.aml_res_source_snapshot where status='NORMALIZED'),
    (select max(refreshed_at) from public.aml_sii_registry_snapshot where status='NORMALIZED'),
    (select max(generated_at) from public.obs_snapshot where status='READY'),
    greatest(
      (select max(updated_at) from public.aml_osfl_snapshot),
      (select max(coalesce(last_successful_ingest_at, updated_at)) from public.aml_osfl_registry_source_snapshot)
    ),
    (select max(refreshed_at) from public.aml_v_fintech_entity_current);
$$;
revoke all on function atlas_core.territory_source_watermarks() from public, anon, authenticated;
grant execute on function atlas_core.territory_source_watermarks() to service_role;

insert into atlas_core.territory_refresh_state(
  singleton,status,mode,next_prefix,
  last_res_watermark,last_sii_watermark,last_obs_watermark,last_osfl_watermark,last_fintech_watermark,
  last_completed_at,last_result,updated_at
)
select true,'IDLE',null,null,
       w.res_watermark,w.sii_watermark,w.obs_watermark,w.osfl_watermark,w.fintech_watermark,
       now(),jsonb_build_object('status','BASELINE','note','Initial broad territory universe already materialized'),now()
from atlas_core.territory_source_watermarks() w
on conflict(singleton) do nothing;

create or replace function atlas_core.overlay_territory_all()
returns jsonb
language plpgsql
security definer
set search_path=public,atlas_core,pg_temp
as $$
declare
  v_atlas bigint;
  v_uaf bigint;
  v_potential bigint;
  v_osfl bigint;
  v_fintech bigint;
  v_snapshot jsonb;
begin
  v_atlas := atlas_core.overlay_territory_atlas();
  v_uaf := atlas_core.overlay_territory_uaf();
  v_potential := atlas_core.overlay_territory_potential();
  v_osfl := atlas_core.overlay_territory_osfl();
  v_fintech := atlas_core.overlay_territory_fintech();
  v_snapshot := atlas_core.refresh_territory_snapshot();
  return jsonb_build_object(
    'atlas_rows',v_atlas,
    'uaf_rows',v_uaf,
    'potential_rows',v_potential,
    'osfl_rows',v_osfl,
    'fintech_rows',v_fintech,
    'snapshot',v_snapshot
  );
end;
$$;
revoke all on function atlas_core.overlay_territory_all() from public, anon, authenticated;
grant execute on function atlas_core.overlay_territory_all() to service_role;

create or replace function atlas_core.request_territory_refresh(p_mode text default 'FULL')
returns jsonb
language plpgsql
security definer
set search_path=public,atlas_core,pg_temp
as $$
declare
  v_mode text := upper(coalesce(p_mode,'FULL'));
  w record;
  s atlas_core.territory_refresh_state%rowtype;
begin
  if v_mode not in ('FULL','OVERLAY') then
    raise exception 'mode must be FULL or OVERLAY';
  end if;
  select * into s from atlas_core.territory_refresh_state where singleton=true for update;
  if s.status='RUNNING' then
    return jsonb_build_object('status','ALREADY_RUNNING','mode',s.mode,'next_prefix',s.next_prefix);
  end if;
  select * into w from atlas_core.territory_source_watermarks();
  update atlas_core.territory_refresh_state
  set status='RUNNING', mode=v_mode,
      next_prefix=case when v_mode='FULL' then prefix_start else null end,
      last_prefix=null,
      target_res_watermark=w.res_watermark,
      target_sii_watermark=w.sii_watermark,
      target_obs_watermark=w.obs_watermark,
      target_osfl_watermark=w.osfl_watermark,
      target_fintech_watermark=w.fintech_watermark,
      cycle_started_at=clock_timestamp(),
      consecutive_failures=0,last_error=null,updated_at=clock_timestamp()
  where singleton=true;
  insert into atlas_core.territory_refresh_log(event_type,mode,status,detail)
  values('CYCLE_REQUESTED',v_mode,'RUNNING',jsonb_build_object('manual',true));
  return jsonb_build_object('status','REQUESTED','mode',v_mode);
end;
$$;
revoke all on function atlas_core.request_territory_refresh(text) from public, anon, authenticated;
grant execute on function atlas_core.request_territory_refresh(text) to service_role;

create or replace function atlas_core.run_territory_refresh_worker()
returns jsonb
language plpgsql
security definer
set search_path=public,atlas_core,pg_temp
as $$
declare
  s atlas_core.territory_refresh_state%rowtype;
  w record;
  v_prefix text;
  v_batch jsonb;
  v_result jsonb;
  v_heavy_changed boolean;
  v_overlay_changed boolean;
begin
  if not pg_try_advisory_xact_lock(hashtextextended('atlas_core.territory_refresh_worker',0)) then
    return jsonb_build_object('status','BUSY');
  end if;

  select * into s from atlas_core.territory_refresh_state where singleton=true for update;
  select * into w from atlas_core.territory_source_watermarks();

  if s.status='ERROR' then
    if s.updated_at > now() - interval '30 minutes' then
      return jsonb_build_object('status','ERROR_BACKOFF','last_error',s.last_error);
    end if;
    update atlas_core.territory_refresh_state
      set status='RUNNING',consecutive_failures=0,last_error=null,updated_at=clock_timestamp()
      where singleton=true;
    select * into s from atlas_core.territory_refresh_state where singleton=true;
  end if;

  if s.status='IDLE' then
    v_heavy_changed :=
      w.res_watermark is distinct from s.last_res_watermark
      or w.sii_watermark is distinct from s.last_sii_watermark;
    v_overlay_changed :=
      w.obs_watermark is distinct from s.last_obs_watermark
      or w.osfl_watermark is distinct from s.last_osfl_watermark
      or w.fintech_watermark is distinct from s.last_fintech_watermark;

    if not v_heavy_changed and not v_overlay_changed then
      return jsonb_build_object('status','FRESH','last_completed_at',s.last_completed_at);
    end if;

    if v_heavy_changed then
      update atlas_core.territory_refresh_state
      set status='RUNNING',mode='FULL',next_prefix=prefix_start,last_prefix=null,
          target_res_watermark=w.res_watermark,target_sii_watermark=w.sii_watermark,
          target_obs_watermark=w.obs_watermark,target_osfl_watermark=w.osfl_watermark,target_fintech_watermark=w.fintech_watermark,
          cycle_started_at=clock_timestamp(),consecutive_failures=0,last_error=null,updated_at=clock_timestamp()
      where singleton=true;
      insert into atlas_core.territory_refresh_log(event_type,mode,status,detail)
      values('CYCLE_STARTED','FULL','RUNNING',jsonb_build_object('reason','SOURCE_WATERMARK_CHANGED'));
      return jsonb_build_object('status','STARTED','mode','FULL','next_prefix',s.prefix_start);
    end if;

    update atlas_core.territory_refresh_state
    set status='RUNNING',mode='OVERLAY',next_prefix=null,last_prefix=null,
        target_res_watermark=w.res_watermark,target_sii_watermark=w.sii_watermark,
        target_obs_watermark=w.obs_watermark,target_osfl_watermark=w.osfl_watermark,target_fintech_watermark=w.fintech_watermark,
        cycle_started_at=clock_timestamp(),consecutive_failures=0,last_error=null,updated_at=clock_timestamp()
    where singleton=true;
    insert into atlas_core.territory_refresh_log(event_type,mode,status,detail)
    values('CYCLE_STARTED','OVERLAY','RUNNING',jsonb_build_object('reason','ANALYTIC_WATERMARK_CHANGED'));
    select * into s from atlas_core.territory_refresh_state where singleton=true;
  end if;

  begin
    if s.mode='FULL' and s.next_prefix is not null and s.next_prefix <= s.prefix_end then
      v_prefix := lpad(s.next_prefix::text,3,'0');
      v_batch := atlas_core.load_territory_res_prefix(v_prefix);
      update atlas_core.territory_refresh_state
      set last_prefix=s.next_prefix,next_prefix=s.next_prefix+1,last_batch_at=clock_timestamp(),
          batch_count=batch_count+1,consecutive_failures=0,last_error=null,last_result=v_batch,updated_at=clock_timestamp()
      where singleton=true;
      insert into atlas_core.territory_refresh_log(event_type,mode,prefix,status,detail)
      values('BATCH','FULL',s.next_prefix,'OK',v_batch);
      return jsonb_build_object('status','BATCH_OK','prefix',v_prefix,'detail',v_batch);
    end if;

    v_result := atlas_core.overlay_territory_all();
    update atlas_core.territory_refresh_state
    set status='IDLE',mode=null,next_prefix=null,last_prefix=null,
        last_res_watermark=target_res_watermark,
        last_sii_watermark=target_sii_watermark,
        last_obs_watermark=target_obs_watermark,
        last_osfl_watermark=target_osfl_watermark,
        last_fintech_watermark=target_fintech_watermark,
        target_res_watermark=null,target_sii_watermark=null,target_obs_watermark=null,target_osfl_watermark=null,target_fintech_watermark=null,
        last_completed_at=clock_timestamp(),cycle_count=cycle_count+1,consecutive_failures=0,last_error=null,last_result=v_result,updated_at=clock_timestamp()
    where singleton=true;
    insert into atlas_core.territory_refresh_log(event_type,mode,status,detail)
    values('CYCLE_COMPLETED',s.mode,'OK',v_result);
    delete from atlas_core.territory_refresh_log where occurred_at < now()-interval '120 days';
    return jsonb_build_object('status','COMPLETED','mode',s.mode,'detail',v_result);

  exception when others then
    update atlas_core.territory_refresh_state
    set consecutive_failures=consecutive_failures+1,
        status=case when consecutive_failures+1 >= 5 then 'ERROR' else status end,
        last_error=sqlstate||': '||sqlerrm,last_result=jsonb_build_object('sqlstate',sqlstate,'error',sqlerrm),updated_at=clock_timestamp()
    where singleton=true;
    insert into atlas_core.territory_refresh_log(event_type,mode,prefix,status,detail)
    values('FAILURE',s.mode,s.next_prefix,'ERROR',jsonb_build_object('sqlstate',sqlstate,'error',sqlerrm));
    return jsonb_build_object('status','FAILED','mode',s.mode,'prefix',s.next_prefix,'sqlstate',sqlstate,'error',sqlerrm);
  end;
end;
$$;
revoke all on function atlas_core.run_territory_refresh_worker() from public, anon, authenticated;
grant execute on function atlas_core.run_territory_refresh_worker() to service_role;

create or replace function public.obs_territory_refresh_status()
returns jsonb
language sql
stable
security definer
set search_path=public,atlas_core,pg_temp
as $$
  select case when auth.uid() is null then null else jsonb_build_object(
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
    'cron',(select jsonb_build_object('schedule',j.schedule,'active',j.active) from cron.job j where j.jobname='atlas-core-territory-refresh-worker')
  ) end
  from atlas_core.territory_refresh_state s where s.singleton=true;
$$;
revoke all on function public.obs_territory_refresh_status() from public, anon;
grant execute on function public.obs_territory_refresh_status() to authenticated, service_role;

do $$
begin
  perform cron.unschedule('atlas-core-territory-refresh-worker')
  where exists(select 1 from cron.job where jobname='atlas-core-territory-refresh-worker');
end
$$;

select cron.schedule(
  'atlas-core-territory-refresh-worker',
  '*/2 * * * *',
  $job$set statement_timeout to '180s'; select atlas_core.run_territory_refresh_worker();$job$
);
