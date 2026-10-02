-- Presupuesto Abierto: promoción asíncrona de snapshots históricos.
--
-- La carga completa puede superar el timeout HTTP/PostgREST porque promueve
-- millones de filas en una sola transacción. Esta capa agenda la promoción en
-- pg_cron con una ventana de 15 minutos y se autoelimina al quedar READY.

create or replace function public.obs_public_funds_finalize_worker(p_snapshot_id text, p_job_name text)
returns void
language plpgsql
security definer
set search_path to 'public','cron','pg_temp'
as $$
declare
  v_jobid bigint;
  v_status text;
begin
  select status into v_status
  from public.obs_public_funds_ingest_state
  where snapshot_id=p_snapshot_id;

  if v_status='LOADING' then
    perform public.obs_public_funds_finalize(p_snapshot_id);
  end if;

  select jobid into v_jobid from cron.job where jobname=p_job_name limit 1;
  if v_jobid is not null then
    perform cron.unschedule(v_jobid);
  end if;
end
$$;

create or replace function public.obs_public_funds_request_finalize(p_snapshot_id text)
returns jsonb
language plpgsql
security definer
set search_path to 'public','cron','pg_temp'
as $$
declare
  v_job_name text;
  v_existing bigint;
  v_jobid bigint;
  v_status text;
  v_command text;
begin
  if p_snapshot_id is null or p_snapshot_id !~ '^PF-[0-9]{6}-[A-Fa-f0-9]{7,40}$' then
    raise exception 'INVALID_SNAPSHOT_ID' using errcode='22023';
  end if;

  select status into v_status
  from public.obs_public_funds_ingest_state
  where snapshot_id=p_snapshot_id;

  if v_status is null then
    raise exception 'SNAPSHOT_NOT_FOUND' using errcode='22023';
  end if;

  if v_status='READY' then
    return jsonb_build_object('ok',true,'accepted',false,'status','READY','snapshot_id',p_snapshot_id);
  end if;

  if v_status<>'LOADING' then
    raise exception 'SNAPSHOT_NOT_LOADING' using errcode='22023';
  end if;

  v_job_name := 'obs-pf-finalize-' || lower(p_snapshot_id);
  select jobid into v_existing from cron.job where jobname=v_job_name limit 1;
  if v_existing is not null then
    perform cron.unschedule(v_existing);
  end if;

  v_command := format(
    'set statement_timeout=''15min''; select public.obs_public_funds_finalize_worker(%L,%L);',
    p_snapshot_id,
    v_job_name
  );

  v_jobid := cron.schedule(v_job_name,'30 seconds',v_command);
  return jsonb_build_object('ok',true,'accepted',true,'status','LOADING','snapshot_id',p_snapshot_id,'job_id',v_jobid);
end
$$;

revoke all on function public.obs_public_funds_finalize_worker(text,text) from public,anon,authenticated;
revoke all on function public.obs_public_funds_request_finalize(text) from public,anon,authenticated;
grant execute on function public.obs_public_funds_request_finalize(text) to service_role;

comment on function public.obs_public_funds_request_finalize(text) is
  'Agenda la promoción atómica de un snapshot de Presupuesto Abierto fuera del timeout HTTP/PostgREST. El job se autoelimina al finalizar y reintenta si la promoción falla.';
