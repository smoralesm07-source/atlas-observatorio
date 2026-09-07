-- ATLAS Observatorio · agenda de refresco y contrato de estado
--
-- Por que la agenda vive en la base y no en CI:
--
-- obs_refresh_all() tarda unos 25 s sobre 50 mil entidades. PostgREST conecta
-- como el rol authenticator, que impone statement_timeout de 8 s, y ese limite
-- lo hereda service_role. Fijar el timeout dentro de la funcion no ayuda: el
-- temporizador se arma cuando la sentencia de nivel superior empieza y no se
-- re-arma al cambiar el ajuste a mitad de ejecucion (verificado: la corrida se
-- cancelo igual a los 8 s). Un job de CI que llamara la RPC habria fallado en
-- cada corrida.
--
-- La materializacion es trabajo interno de la base, asi que la agenda es de la
-- base. pg_cron ya sostiene los demas refrescos de ATLAS, de modo que esto no
-- introduce un mecanismo nuevo. El SET va como sentencia previa e independiente
-- para que el temporizador del SELECT se arme ya con el valor nuevo.

do $$
begin
  perform cron.unschedule('atlas-observatorio-refresh')
  where exists (select 1 from cron.job where jobname = 'atlas-observatorio-refresh');
end
$$;

select cron.schedule(
  'atlas-observatorio-refresh',
  '25 */6 * * *',   -- separado de los pulls de ATLAS (:11, :41, :53)
  $job$set statement_timeout to '600s'; select public.obs_refresh_all();$job$
);

-- Contrato liviano para vigilar la frescura del corte desde CI o desde la app,
-- sin ejecutar nada pesado: responde en milisegundos y cabe de sobra en 8 s.
create or replace function public.obs_refresh_status()
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'contract', 'ATLAS_OBS_STATUS_V1',
    'vigente', (
      select to_jsonb(s) || jsonb_build_object(
        'antiguedad_horas', round(extract(epoch from (now() - s.generated_at)) / 3600.0, 2))
      from public.obs_snapshot s
      where s.status = 'READY' order by s.generated_at desc limit 1),
    'ultimo_intento', (
      select jsonb_build_object('snapshot_id', s.snapshot_id, 'status', s.status,
                                'generated_at', s.generated_at, 'error_detail', s.error_detail)
      from public.obs_snapshot s order by s.generated_at desc limit 1),
    'agenda', (
      select jsonb_build_object('jobname', j.jobname, 'schedule', j.schedule, 'active', j.active)
      from cron.job j where j.jobname = 'atlas-observatorio-refresh')
  );
$$;

revoke all on function public.obs_refresh_status() from public, anon;
grant execute on function public.obs_refresh_status() to authenticated, service_role;
