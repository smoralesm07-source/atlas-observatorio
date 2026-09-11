import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Panel } from '../../components/primitives';
import { hrefFor } from '../../lib/router';
import { supabase } from '../../lib/supabase';
import './Novedades.css';

type RadarKind = 'PRENSA' | 'SANCION';
type RadarSubtype = 'NUEVA_COINCIDENCIA' | 'PRENSA' | 'SANCION';
type RadarSeverity = 'CRITICAL' | 'HIGH' | 'NORMAL';

interface RadarItem {
  id: string;
  kind: RadarKind;
  subtype: RadarSubtype;
  severity: RadarSeverity;
  urgency_score: number;
  event_at: string;
  entity_id: string;
  rut: string | null;
  entity_name: string;
  uaf_sector: string | null;
  sii_status: string | null;
  source_label: string | null;
  source_url: string | null;
  headline: string | null;
  detail: string | null;
  identity_confidence: number | null;
  mention_confidence: number | null;
  signal_label: string | null;
  article_count: number | null;
  source_count: number | null;
  ipa_gap: 'SIN_IPA_VIGENTE' | 'IPA_BAJO' | null;
  match_basis: string | null;
  amount_uf: number | null;
  is_new_match: boolean;
}

interface RadarFeed {
  contract: 'ATLAS_OBS_PRIORITY_RADAR_V1';
  generated_at: string;
  window_days: number;
  counts: {
    total: number;
    press: number;
    new_matches: number;
    sanctions: number;
    critical: number;
  };
  items: RadarItem[];
  semantics: string;
}

export function NovedadesObservatorio({ compact = false }: { compact?: boolean }) {
  const [feed, setFeed] = useState<RadarFeed | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<RadarItem | null>(null);

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);

    try {
      const { data, error: rpcError } = await supabase.rpc('obs_uaf_priority_radar');
      if (rpcError) throw rpcError;
      if (!data || typeof data !== 'object') throw new Error('El radar no devolvió un contrato válido.');
      setFeed(data as RadarFeed);
      setError(null);
    } catch (loadError) {
      setError(messageOf(loadError));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
    const timer = window.setInterval(() => void load(true), 2 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (!selected) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelected(null);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [selected]);

  const highlights = useMemo(() => selectHighlights(feed?.items ?? []), [feed]);
  const criticalCount = feed?.counts.critical ?? 0;

  return (
    <div className={`pulse-priority-radar${compact ? ' pulse-updates-compact is-compact' : ''}`}>
      <Panel
        title="Novedades prioritarias"
        pad={false}
        actions={
          <div className="priority-compact-actions">
            {criticalCount > 0 && <span className="priority-compact-critical"><i />{criticalCount} crítica{criticalCount === 1 ? '' : 's'}</span>}
            <span className="priority-compact-live"><i /> dinámico</span>
            <button
              type="button"
              className="priority-compact-refresh"
              onClick={() => void load(true)}
              disabled={refreshing}
              aria-label="Actualizar novedades prioritarias"
              title="Actualizar ahora"
            >
              {refreshing ? '…' : '↻'}
            </button>
          </div>
        }
      >
        <div className="priority-compact-shell">
          {loading && !feed ? (
            <div className="priority-compact-state">Leyendo señales recientes…</div>
          ) : error && !feed ? (
            <div className="priority-compact-state is-error">
              <b>No fue posible cargar las novedades.</b>
              <button type="button" onClick={() => void load(false)}>Reintentar</button>
            </div>
          ) : highlights.length === 0 ? (
            <div className="priority-compact-state">Sin novedades prioritarias en los últimos 90 días.</div>
          ) : (
            <div className="priority-compact-list" aria-live="polite">
              {highlights.map((item) => (
                <PriorityItem key={item.id} item={item} onOpen={() => setSelected(item)} />
              ))}
            </div>
          )}

          <div className="priority-compact-footer">
            <span>Prensa y sanciones · últimos {feed?.window_days ?? 90} días</span>
            <span>{error && feed ? 'sincronización parcial' : feed?.generated_at ? `Act. ${formatGenerated(feed.generated_at)}` : 'Atlas'}</span>
          </div>
        </div>
      </Panel>

      {selected && createPortal(
        <PriorityDetail item={selected} onClose={() => setSelected(null)} />,
        document.body,
      )}
    </div>
  );
}

function PriorityItem({ item, onOpen }: { item: RadarItem; onOpen: () => void }) {
  const critical = item.severity === 'CRITICAL';
  const sanction = item.kind === 'SANCION';
  const summary = cleanText(item.headline || item.detail || defaultSummary(item));
  const tone = critical ? 'critical' : sanction ? 'sanction' : item.is_new_match ? 'new' : 'press';

  return (
    <button
      type="button"
      className="priority-compact-item"
      data-tone={tone}
      onClick={onOpen}
      aria-label={`Abrir detalle de ${item.entity_name}`}
    >
      <span className="priority-compact-icon" aria-hidden="true">
        <SignalIcon kind={item.kind} critical={critical} />
      </span>

      <span className="priority-compact-copy">
        <span className="priority-compact-kicker">
          {critical ? 'ALERTA CRÍTICA' : sanction ? 'SANCIÓN RECIENTE' : item.is_new_match ? 'NUEVA COINCIDENCIA' : 'PRENSA RECIENTE'}
        </span>
        <strong>{item.entity_name}</strong>
        <small>{summary}</small>
      </span>

      <span className="priority-compact-side">
        <time dateTime={item.event_at}>{shortDate(item.event_at)}</time>
        <b aria-hidden="true">›</b>
      </span>
    </button>
  );
}

function PriorityDetail({ item, onClose }: { item: RadarItem; onClose: () => void }) {
  const critical = item.severity === 'CRITICAL';
  const sanction = item.kind === 'SANCION';
  const active = /ACTIVE|VIGENTE|ACTIVO/i.test(item.sii_status ?? '');
  const confidence = normalizeConfidence(item.identity_confidence ?? item.mention_confidence);
  const entityHref = hrefFor({ view: 'ficha', entityId: item.entity_id });
  const typeLabel = sanction ? 'Sanción reciente' : item.is_new_match ? 'Nueva coincidencia en prensa' : 'Prensa reciente';
  const title = cleanText(item.headline || defaultSummary(item));
  const detail = item.detail && cleanText(item.detail) !== title ? cleanText(item.detail) : null;

  return (
    <div className="priority-detail-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="priority-detail-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="priority-detail-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="priority-detail-head">
          <span className="priority-detail-icon" data-tone={critical ? 'critical' : sanction ? 'sanction' : 'press'} aria-hidden="true">
            <SignalIcon kind={item.kind} critical={critical} />
          </span>
          <div>
            <span className="priority-detail-eyebrow">{critical ? 'Atención crítica · ' : ''}{typeLabel}</span>
            <h3 id="priority-detail-title">{item.entity_name}</h3>
            <p>{item.rut ? `RUT ${item.rut}` : 'Entidad individualizada'}{item.uaf_sector ? ` · ${item.uaf_sector}` : ''}</p>
          </div>
          <button type="button" className="priority-detail-close" onClick={onClose} aria-label="Cerrar detalle">×</button>
        </header>

        <div className="priority-detail-badges">
          {critical && <span data-tone="critical">ALERTA CRÍTICA</span>}
          {item.is_new_match && <span data-tone="new">NUEVA COINCIDENCIA</span>}
          {active && <span data-tone="active">SO ACTIVO</span>}
          {item.ipa_gap === 'SIN_IPA_VIGENTE' && <span data-tone="gap">SIN IPA VIGENTE</span>}
          {item.signal_label && <span>{item.signal_label}</span>}
        </div>

        <div className="priority-detail-body">
          <section className="priority-detail-story">
            <span>{sanction ? 'Antecedente registrado' : 'Qué levantó Atlas'}</span>
            <h4>{title}</h4>
            {detail && <p>{detail}</p>}
          </section>

          <dl className="priority-detail-grid">
            <div><dt>Fecha</dt><dd>{formatEvent(item.event_at)}</dd></div>
            <div><dt>Fuente</dt><dd>{item.source_label ?? 'Fuente no informada'}</dd></div>
            {confidence != null && <div><dt>Coincidencia</dt><dd>{confidence}%</dd></div>}
            {item.article_count != null && item.article_count > 0 && <div><dt>Notas asociadas</dt><dd>{item.article_count}</dd></div>}
            {item.source_count != null && item.source_count > 0 && <div><dt>Medios</dt><dd>{item.source_count}</dd></div>}
            {sanction && item.amount_uf != null && <div><dt>Monto</dt><dd>{formatUf(item.amount_uf)} UF</dd></div>}
            {item.sii_status && <div><dt>Estado SII</dt><dd>{humanStatus(item.sii_status)}</dd></div>}
            {item.match_basis && <div><dt>Base de identidad</dt><dd>{formatMatchBasis(item.match_basis)}</dd></div>}
          </dl>

          {!sanction && critical && (
            <div className="priority-detail-callout">
              <b>Por qué aparece aquí</b>
              <span>La señal externa es reciente, la entidad fue resuelta con alta confianza y requiere revisión analítica prioritaria.</span>
            </div>
          )}
        </div>

        <footer className="priority-detail-foot">
          <span>La alerta prioriza revisión; no acredita por sí sola responsabilidad ni incumplimiento.</span>
          <div>
            {item.source_url && <a href={item.source_url} target="_blank" rel="noreferrer">Abrir fuente ↗</a>}
            <a className="is-primary" href={entityHref}>Abrir ficha de entidad →</a>
          </div>
        </footer>
      </section>
    </div>
  );
}

function SignalIcon({ kind, critical }: { kind: RadarKind; critical: boolean }) {
  if (critical) {
    return (
      <svg viewBox="0 0 24 24">
        <path d="M12 2.8 22 20.5H2L12 2.8Z" />
        <path d="M12 8v6.1M12 17.3v.2" />
      </svg>
    );
  }

  if (kind === 'SANCION') {
    return (
      <svg viewBox="0 0 24 24">
        <path d="m8 5 7 7M10.5 2.5l11 11-3 3-11-11 3-3ZM4 18h10M3 21h12" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24">
      <path d="M4 4h16v16H4zM7 8h5M7 11h10M7 14h10M7 17h7M15 7h2v2h-2z" />
    </svg>
  );
}

function selectHighlights(items: RadarItem[]) {
  const unique = new Map(items.map((item) => [item.id, item]));
  const all = Array.from(unique.values()).sort(comparePriority);
  const press = all.filter((item) => item.kind === 'PRENSA');
  const sanctions = all.filter((item) => item.kind === 'SANCION').sort(compareRecent);
  const picked: RadarItem[] = [];

  for (const item of press.slice(0, 2)) picked.push(item);
  if (sanctions[0]) picked.push(sanctions[0]);

  for (const item of all) {
    if (picked.length >= 3) break;
    if (!picked.some((current) => current.id === item.id)) picked.push(item);
  }

  return picked.slice(0, 3);
}

function comparePriority(a: RadarItem, b: RadarItem) {
  const priority = (item: RadarItem) => {
    if (item.severity === 'CRITICAL') return 0;
    if (item.is_new_match) return 1;
    if (item.kind === 'SANCION' && item.severity === 'HIGH') return 2;
    if (item.kind === 'SANCION') return 3;
    return 4;
  };
  return priority(a) - priority(b)
    || Number(b.urgency_score ?? 0) - Number(a.urgency_score ?? 0)
    || sortableDate(b.event_at) - sortableDate(a.event_at);
}

function compareRecent(a: RadarItem, b: RadarItem) {
  return sortableDate(b.event_at) - sortableDate(a.event_at);
}

function defaultSummary(item: RadarItem) {
  if (item.kind === 'SANCION') return 'Nuevo antecedente sancionatorio asociado al sujeto obligado.';
  if (item.is_new_match) return 'Nueva coincidencia de entidad detectada por el monitor de prensa.';
  return 'Nueva mención relevante detectada en prensa.';
}

function sortableDate(value: string) {
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value;
  const millis = new Date(normalized).getTime();
  return Number.isFinite(millis) ? millis : 0;
}

function shortDate(value: string) {
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value);
  if (Number.isNaN(d.getTime())) return value?.slice(0, 10) || '—';
  return new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: 'short' }).format(d);
}

function formatEvent(value: string) {
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value);
  if (Number.isNaN(d.getTime())) return value?.slice(0, 16) || '—';
  return new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: 'short', year: 'numeric' }).format(d);
}

function formatGenerated(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 'reciente';
  return new Intl.DateTimeFormat('es-CL', { hour: '2-digit', minute: '2-digit' }).format(d);
}

function normalizeConfidence(value: number | null) {
  if (value == null || !Number.isFinite(Number(value))) return null;
  const numeric = Number(value);
  return Math.round(numeric <= 1 ? numeric * 100 : numeric);
}

function humanStatus(value: string) {
  if (/ACTIVE|VIGENTE|ACTIVO/i.test(value)) return 'Activo';
  return value.replaceAll('_', ' ').toLowerCase().replace(/^./, (char) => char.toUpperCase());
}

function formatMatchBasis(value: string) {
  if (value.includes('RUT_EXACT')) return 'RUT exacto';
  if (value.includes('CURATED')) return 'Alias validado';
  if (value.includes('LEGAL_NAME_EXACT')) return 'Razón social exacta';
  return 'Resolución estricta';
}

function formatUf(value: number) {
  return new Intl.NumberFormat('es-CL', { maximumFractionDigits: 1 }).format(value);
}

function cleanText(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function messageOf(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) return String((error as { message: unknown }).message);
  return String(error);
}
