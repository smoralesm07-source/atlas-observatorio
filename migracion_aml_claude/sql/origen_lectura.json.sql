-- SOLO LECTURA. Ejecutar en AML CLAUDE (bzqxvidggykkdouotylg).
-- Copiar el valor JSON de "manifest" como source.json para el comparador offline.
-- No devuelve datos personales, credenciales, secretos, RUT ni filas transaccionales.
WITH snap AS (
  SELECT snapshot_id, generated_at, period_end, supplier_count, pair_count, signal_count
  FROM public.ps_snapshot
  ORDER BY generated_at DESC LIMIT 1
)
SELECT jsonb_build_object(
  'project', 'AML_CLAUDE',
  'captured_at', now(),
  'snapshot_id', snap.snapshot_id,
  'snapshot_date', snap.generated_at,
  'period_end', snap.period_end,
  'supplier_count', snap.supplier_count,
  'pair_count', snap.pair_count,
  'signal_count', snap.signal_count,
  'findings_count', (SELECT count(*) FROM public.ps_finding),
  'school_events', (SELECT count(*) FROM public.school_alert_events),
  'school_subscriptions', (SELECT count(*) FROM public.school_alert_subscriptions),
  'school_deliveries', (SELECT count(*) FROM public.school_alert_deliveries),
  'provider_schema_size_bytes', (
    SELECT coalesce(sum(pg_total_relation_size(c.oid)),0)
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='provider_analyzer' AND c.relkind IN ('r','p')
  ),
  'latest_provider_run', (
    SELECT jsonb_build_object('pipeline',pipeline,'status',status,'updated_at',updated_at)
    FROM provider_analyzer.run_state ORDER BY updated_at DESC LIMIT 1
  )
) AS manifest FROM snap;
