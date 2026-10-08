import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { SourceStatusRow } from '../lib/contracts';
import '../styles/source-health-indicator.css';

type HealthTone = 'ok' | 'warning' | 'critical' | 'unknown';

const TTL_MS = 5 * 60 * 1000;
const PRIORITY_CODES = [
  'RADAR_UAF', 'RADAR_SII', 'RADAR_PRENSA', 'PRESUPUESTO_ABIERTO',
  'PRESUPUESTO_ABIERTO_MUNICIPAL', 'MERCADO_PUBLICO',
  'RADAR_OSFL', 'RADAR_SANCIONES', 'RADAR_DELICTUAL', 'RES',
  'ATLAS_SOURCE_HEALTH',
];

function healthTone(source: SourceStatusRow): HealthTone {
  const software = String(source.software_status || '').toLowerCase();
  const data = String(source.data_status || '').toLowerCase();

  if (/^(degraded|down|failed|error|offline)$/.test(software)) return 'critical';
  if (/^(watch|stale|degraded|silent|error)$/.test(software)
    || /^(degraded|stale|silent|error)$/.test(data)) return 'warning';
  if (software === 'healthy' && data === 'fresh') return 'ok';
  return 'unknown';
}

function toneLabel(tone: HealthTone) {
  return tone === 'ok' ? 'Operativa'
    : tone === 'warning' ? 'Atención'
      : tone === 'critical' ? 'Incidencia' : 'Sin verificar';
}

function sourceDate(value: string | null): string {
  if (!value) return 'No informada';
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return 'Fecha no válida';
  return new Intl.DateTimeFormat('es-CL', {
    timeZone: 'America/Santiago',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(parsed);
}

function sourceSort(a: SourceStatusRow, b: SourceStatusRow) {
  const ia = PRIORITY_CODES.indexOf(a.source_code);
  const ib = PRIORITY_CODES.indexOf(b.source_code);
  if (ia !== ib) return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
  return a.source_name.localeCompare(b.source_name, 'es');
}

/**
 * Health source of truth: the existing authenticated obs_source_status read
 * contract used by the Fuentes screen. Read-only, no new browser credentials,
 * health writes or probing of third-party endpoints.
 */
export function SourceHealthIndicator() {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<SourceStatusRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [verifiedAt, setVerifiedAt] = useState<Date | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const mounted = useRef(true);
  const inflight = useRef(false);

  const load = useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    setLoading(true);
    try {
      const { data, error: rpcError } = await supabase.rpc('obs_source_status', {});
      if (!mounted.current) return;
      if (rpcError) throw rpcError;
      const result = Array.isArray(data) ? data as SourceStatusRow[] : [];
      setRows(result);
      setError(result.length ? null : 'El catálogo de fuentes no devolvió registros.');
      setVerifiedAt(new Date());
    } catch (e) {
      if (mounted.current) {
        setError(e instanceof Error ? e.message : 'No fue posible consultar el estado de las fuentes.');
      }
    } finally {
      inflight.current = false;
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void load();
    const timer = window.setInterval(() => {
      if (!document.hidden) void load();
    }, TTL_MS);
    const onVisible = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      mounted.current = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  const sortedRows = useMemo(() => rows.slice().sort(sourceSort), [rows]);
  const counts = useMemo(() => sortedRows.reduce((acc, source) => {
    acc[healthTone(source)] += 1;
    return acc;
  }, { ok: 0, warning: 0, critical: 0, unknown: 0 }), [sortedRows]);

  const overall: HealthTone = error || !verifiedAt ? 'unknown'
    : counts.critical > 0 ? 'critical'
      : counts.warning > 0 ? 'warning'
        : counts.unknown > 0 ? 'unknown'
          : counts.ok > 0 ? 'ok' : 'unknown';

  return (
    <div className="obs-source-health" ref={rootRef} data-state={overall} data-testid="source-health">
      <button
        type="button"
        className="obs-source-health-trigger"
        aria-expanded={open}
        aria-controls="obs-source-health-panel"
        aria-label={`Salud de fuentes: ${error ? 'no verificable' : toneLabel(overall)}. Abrir ficha de detalle`}
        onClick={() => setOpen((previous) => !previous)}
        title="Estado general de las fuentes que alimentan Atlas"
      >
        <i className="obs-source-health-dot" aria-hidden="true" />
        <span>Fuentes</span>
        <svg width="11" height="11" viewBox="0 0 16 16" aria-hidden="true" fill="none">
          <path d="m3.5 6 4.5 4 4.5-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <section id="obs-source-health-panel" className="obs-source-health-panel" role="dialog" aria-label="Detalle de salud de las fuentes">
          <header className="obs-source-health-heading">
            <div>
              <strong>Salud de las fuentes</strong>
              <small>{verifiedAt ? `Consultado el ${sourceDate(verifiedAt.toISOString())}` : 'Esperando primera comprobación'}</small>
            </div>
            <button type="button" className="obs-source-health-refresh" onClick={() => void load()} disabled={loading}>
              {loading ? 'Consultando…' : 'Actualizar'}
            </button>
          </header>

          {error ? (
            <p className="obs-source-health-error" role="status">
              No se pudo verificar el estado actual. {error}
            </p>
          ) : (
            <div className="obs-source-health-summary" aria-live="polite">
              <span>{sortedRows.length} fuentes</span>
              <span>{counts.ok} operativas</span>
              <span>{counts.warning} en atención</span>
              <span>{counts.critical} con incidencia</span>
              {counts.unknown > 0 && <span>{counts.unknown} sin verificar</span>}
            </div>
          )}

          <div className="obs-source-health-list">
            {sortedRows.map((source) => {
              const tone = healthTone(source);
              const onDemand = source.integration_mode === 'on_demand';
              return (
                <details className="obs-source-health-item" key={source.source_code} data-tone={tone}>
                  <summary>
                    <span className="obs-source-health-name">
                      <i className="obs-source-health-row-dot" aria-hidden="true" />
                      <span>{source.source_name}</span>
                    </span>
                    <span className="obs-source-health-state">{toneLabel(tone)}</span>
                    <span className="obs-source-health-caret" aria-hidden="true">⌄</span>
                  </summary>
                  <div className="obs-source-health-details">
                    <div>
                      <small>{onDemand ? 'Última actividad informada' : 'Última ingesta informada'}</small>
                      <strong>{sourceDate(source.last_successful_ingest_at)}</strong>
                    </div>
                    <div>
                      <small>Último registro en origen</small>
                      <strong>{sourceDate(source.last_source_record_at)}</strong>
                    </div>
                    <div>
                      <small>Estado del canal</small>
                      <strong>{source.software_status || 'Sin estado'}</strong>
                    </div>
                    <div>
                      <small>Estado de datos</small>
                      <strong>{source.data_status || 'Sin estado'}</strong>
                    </div>
                    {source.entity_coverage != null && (
                      <div>
                        <small>Entidades en el corte Atlas</small>
                        <strong>{Number(source.entity_coverage).toLocaleString('es-CL')}</strong>
                      </div>
                    )}
                    {source.scope_partial && (
                      <p className="obs-source-health-note">Cobertura parcial: los registros publicados no representan necesariamente el universo completo.</p>
                    )}
                    {source.notes && <p className="obs-source-health-note">{source.notes}</p>}
                  </div>
                </details>
              );
            })}
            {!loading && sortedRows.length === 0 && <p className="obs-source-health-empty">No hay fuentes verificables por el momento.</p>}
            {loading && sortedRows.length === 0 && <p className="obs-source-health-empty">Consultando el catálogo…</p>}
          </div>
          <footer>
            <span>La fecha de ingesta, el último registro y la disponibilidad son dimensiones distintas.</span>
            <span>En conectores y servicios bajo demanda, una actividad técnica no acredita una nueva carga.</span>
          </footer>
        </section>
      )}
    </div>
  );
}
