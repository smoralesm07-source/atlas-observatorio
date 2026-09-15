-- El cache de prensa sólo cambia cuando se ingiere nueva información.
-- Antes se refrescaba cada 2 minutos y cada ejecución tardaba ~2 minutos,
-- manteniendo Postgres bajo carga casi permanente. Se alinea con el ingest
-- programado cada 2 horas y se deja una ventana de 10 minutos.

do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id
  from cron.job
  where command ilike '%obs_refresh_uaf_press_match_90d_cache%'
  order by jobid
  limit 1;

  if v_job_id is not null then
    perform cron.alter_job(
      v_job_id,
      '27 */2 * * *',
      null,
      null,
      null,
      true
    );
  end if;
end
$$;
