-- SOLO LECTURA. Ejecutar en Atlas principal (ldmtlwzqaqmegedktlxr).
-- Copiar el valor JSON de "manifest" como core.json para el comparador offline.
-- No llama a obs_refresh_full() ni a RPC que escriban datos.
WITH snap AS (
  SELECT snapshot_id, source_snapshot_id, refreshed_at, period_end, supplier_count, pair_count, signal_count
  FROM public.obs_spend_snapshot ORDER BY refreshed_at DESC LIMIT 1
)
SELECT jsonb_build_object(
  'project', 'ATLAS_CORE',
  'captured_at', now(),
  'snapshot_id', snap.snapshot_id,
  'source_snapshot_id', snap.source_snapshot_id,
  'refreshed_at', snap.refreshed_at,
  'period_end', snap.period_end,
  'supplier_count', snap.supplier_count,
  'pair_count', snap.pair_count,
  'signal_count', snap.signal_count,
  'findings_count', (SELECT count(*) FROM public.obs_spend_finding),
  'supplier_directory_count', (SELECT count(*) FROM public.obs_state_supplier_directory),
  'prioritized_pairs_count', (SELECT count(*) FROM public.obs_spend_pair),
  'observatory_cron_failures_7d', (
    SELECT count(*)
    FROM cron.job_run_details d JOIN cron.job j ON j.jobid=d.jobid
    WHERE j.jobname='atlas-observatorio-refresh'
      AND d.start_time>now()-interval '7 days'
      AND d.status<>'succeeded'
  )
) AS manifest FROM snap;
