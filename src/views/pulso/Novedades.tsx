import { useCallback, useEffect, useMemo, useState } from 'react';
import { Panel } from '../../components/primitives';
import { hrefFor } from '../../lib/router';
import { supabase } from '../../lib/supabase';
import './Novedades.css';

type RadarKind = 'PRENSA' | 'SANCION';
type RadarSubtype = 'NUEVA_COINCIDENCIA' | 'PRENSA' | 'SANCION';
type RadarSeverity = 'CRITICAL' | 'HIGH' | 'NORMAL';
type FilterKey = 'ALL' | 'PRESS' | 'NEW' | 'SANCTIONS' | 'CRITICAL';
type SortKey = 'PRIORITY' | 'RECENT';

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

const FILTERS: Array<{ key: FilterKey; label: string; count: keyof RadarFeed['counts'] }> = [
  { key: 'ALL', label: 'Todas', count: 'total' },
  { key: 'PRESS', label: 'Prensa', count: 'press' },
  { key: 'NEW', label: 'Nuevas coincidencias', count: 'new_matches' },
  { key: 'SANCTIONS', label: 'Sanciones', count: 'sanctions' },
  { key: 'CRITICAL', label: 'Críticas', count: 'critical' },
];

export function NovedadesObservatorio({ compact = false }: { compact?: boolean }) {
  const [feed, setFeed] = useState<RadarFeed | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>('ALL');
  const [sort, setSort] = useState<SortKey>('PRIORITY');

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

  const filteredItems = useMemo(() => {
    const base = (feed?.items ?? []).filter((item) => matchesFilter(item, filter));
    return base.sort((a, b) => sort === 'RECENT' ? compareRecent(a, b) : comparePriority(a, b));
  }, [feed, filter, sort]);

  const visible = filteredItems.slice(0, compact ? 4 : 8);
  const counts = feed?.counts ?? { total: 0, press: 0, new_matches: 0, sanctions: 0, critical: 0 };

  return (
    <div className={`pulse-priority-radar${compact ? ' is-compact' : ''}`}>
      <Panel
        title="Novedades prioritarias"
        pad={false}
        actions={
          <div className="priority-radar-actions">
            <span className="priority-radar-live"><i /> dinámico</span>
            <span className="priority-radar-window">últimos {feed?.window_days ?? 90} días</span>
            <button
              type="button"
              className="priority-radar-refresh"
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
        <div className="priority-radar-shell">
          <div className="priority-radar-toolbar">
            <div className="priority-radar-filters" role="tablist" aria-label="Filtrar novedades">
              {FILTERS.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  role="tab"
                  aria-selected={filter === option.key}
                  className={filter === option.key ? 'is-active' : undefined}
                  onClick={() => setFilter(option.key)}
                >
                  {option.label} <b>{counts[option.count]}</b>
                </button>
              ))}
            </div>

            <label className="priority-radar-sort">
              <span>Orden</span>
              <select value={sort} onChange={(event) => setSort(event.target.value as SortKey)}>
                <option value="PRIORITY">Prioridad</option>
                <option value="RECENT">Más recientes</option>
              </select>
            </label>
          </div>

          {loading && !feed ? (
            <div className="priority-radar-state">Leyendo prensa y sanciones recientes…</div>
          ) : error && !feed ? (
            <div className="priority-radar-state is-error">
              <b>No fue posible cargar el radar.</b>
              <button type="button" onClick={() => void load(false)}>Reintentar</button>
            </div>
          ) : visible.length === 0 ? (
            <div className="priority-radar-state">No hay novedades para este filtro en la ventana de 90 días.</div>
          ) : (
            <div className="priority-radar-list" aria-live="polite">
              {visible.map((item, index) => <RadarRow key={item.id} item={item} rank={index + 1} />)}
            </div>
          )}

          <footer className="priority-radar-footer">
            <span>
              Mostrando <b>{visible.length}</b> de <b>{filteredItems.length}</b> novedades · prensa y sanciones SO
            </span>
            <span className="priority-radar-footer-right">
              {error && feed && <em title={error}>actualización parcial</em>}
              <span>{feed?.generated_at ? `Actualizado ${formatGenerated(feed.generated_at)}` : 'Radar ATLAS'}</span>
            </span>
          </footer>
        </div>
      </Panel>
    </div>
  );
}

function RadarRow({ item, rank }: { item: RadarItem; rank: number }) {
  const critical = item.severity === 'CRITICAL';
  const sanction = item.kind === 'SANCION';
  const active = isActive(item.sii_status);
  const href = hrefFor({ view: 'ficha', entityId: item.entity_id });
  const confidence = Number(item.identity_confidence ?? item.mention_confidence ?? 0);
  const headline = item.headline && item.headline !== item.entity_name ? item.headline : item.detail;

  return (
    <article
      className={`priority-radar-row${critical ? ' is-critical' : ''}${item.is_new_match ? ' is-new-match' : ''}${sanction ? ' is-sanction' : ''}`}
      data-severity={item.severity}
    >
      <div className="priority-radar-rail" aria-hidden="true">
        {critical ? <AlertIcon /> : <span>{rank}</span>}
      </div>

      <div className="priority-radar-main">
        <div className="priority-radar-badges">
          {critical && <Badge tone="critical">ALERTA CRÍTICA</Badge>}
          {sanction ? <Badge tone="sanction">SANCIÓN RECIENTE</Badge> : <Badge tone="press">PRENSA</Badge>}
          {item.is_new_match && <Badge tone="new">NUEVA COINCIDENCIA</Badge>}
          {active && <Badge tone="active">SO ACTIVO</Badge>}
          {item.ipa_gap === 'SIN_IPA_VIGENTE' && <Badge tone="gap">SIN IPA VIGENTE</Badge>}
          {!critical && confidence >= 90 && <Badge tone="confidence">ALTA CONFIANZA {Math.round(confidence)}%</Badge>}
        </div>

        <h4>{item.entity_name}</h4>
        {headline && <p className="priority-radar-headline">{cleanText(headline)}</p>}

        <div className="priority-radar-meta">
          {item.source_label && <span className="priority-radar-source"><SourceIcon kind={item.kind} /> {item.source_label}</span>}
          {item.uaf_sector && <span>{item.uaf_sector}</span>}
          {item.signal_label && !sanction && <span className="is-signal">{item.signal_label}</span>}
          {item.article_count && item.article_count > 1 && <span>{item.article_count} notas</span>}
          {item.source_count && item.source_count > 1 && <span>{item.source_count} medios</span>}
          {sanction && item.amount_uf != null && <span className="is-sanction-detail">Multa {formatUf(item.amount_uf)} UF</span>}
        </div>
      </div>

      <div className="priority-radar-side">
        <div className="priority-radar-time">
          <time dateTime={item.event_at}>{formatEvent(item.event_at)}</time>
          <span>{relativeAge(item.event_at)}</span>
        </div>
        <div className="priority-radar-links">
          <a className={critical ? 'is-primary' : undefined} href={href}>Abrir ficha <b>→</b></a>
          {item.source_url && <a className="is-source" href={item.source_url} target="_blank" rel="noreferrer">Fuente ↗</a>}
        </div>
      </div>
    </article>
  );
}

function Badge({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span className="priority-radar-badge" data-tone={tone}>{children}</span>;
}

function AlertIcon() {
  return (
    <svg className="priority-radar-alert-icon" viewBox="0 0 24 24">
      <path d="M12 2.8 22 20.5H2L12 2.8Z" />
      <path d="M12 8v6.1M12 17.3v.2" />
    </svg>
  );
}

function SourceIcon({ kind }: { kind: RadarKind }) {
  if (kind === 'SANCION') {
    return <span className="priority-radar-mini-icon" aria-hidden="true">◆</span>;
  }
  return <span className="priority-radar-mini-icon" aria-hidden="true">▤</span>;
}

function matchesFilter(item: RadarItem, filter: FilterKey) {
  if (filter === 'ALL') return true;
  if (filter === 'PRESS') return item.kind === 'PRENSA';
  if (filter === 'NEW') return item.is_new_match;
  if (filter === 'SANCTIONS') return item.kind === 'SANCION';
  return item.severity === 'CRITICAL';
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
  return sortableDate(b.event_at) - sortableDate(a.event_at)
    || Number(b.urgency_score ?? 0) - Number(a.urgency_score ?? 0);
}

function isActive(value: string | null) {
  return /ACTIVE|VIGENTE|ACTIVO/i.test(value ?? '');
}

function sortableDate(value: string) {
  const millis = new Date(value).getTime();
  return Number.isFinite(millis) ? millis : 0;
}

function formatEvent(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value?.slice(0, 16) || '—';
  return new Intl.DateTimeFormat('es-CL', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(d);
}

function formatGenerated(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 'recientemente';
  return new Intl.DateTimeFormat('es-CL', { hour: '2-digit', minute: '2-digit' }).format(d);
}

function relativeAge(value: string) {
  const then = sortableDate(value);
  if (!then) return 'fecha no disponible';
  const diff = Math.max(0, Date.now() - then);
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 1) return 'hace menos de 1 h';
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `hace ${days} ${days === 1 ? 'día' : 'días'}`;
  const months = Math.max(1, Math.floor(days / 30));
  return `hace ${months} ${months === 1 ? 'mes' : 'meses'}`;
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
