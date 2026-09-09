import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import '../styles/sanciones.css';

type Filters = {
  q: string;
  universe: string;
  regulator: string;
  region: string;
  event_kind: string;
  year: string;
  amount_band: string;
};

type Dashboard = {
  snapshot_id?: string;
  metrics?: {
    unified_universe_count?: number | string;
    entity_count?: number | string;
    event_count?: number | string;
    regulatory_event_count?: number | string;
    cgr_event_count?: number | string;
    document_count?: number | string;
    supervisor_count?: number | string;
    amount_clp?: number | string;
    amount_uf?: number | string;
  };
  universes?: Array<{ code: string; evaluated_count: number | string; entity_count: number | string; event_count?: number | string }>;
  supervisors?: Array<{ regulator: string; event_count: number | string; entity_count?: number | string; regulatory_event_count?: number | string; cgr_event_count?: number | string }>;
  regions?: Array<{ region: string; event_count: number | string; entity_count?: number | string }>;
  types?: Array<{ event_kind: string; event_count: number | string; entity_count?: number | string }>;
  years?: Array<{ event_year: number | string; event_count: number | string; entity_count?: number | string }>;
  filters?: { regulators?: string[]; regions?: string[]; types?: string[]; years?: Array<number | string> };
  semantics?: { regulatory?: string; cgr?: string; currency?: string; priority?: string };
};

type EventItem = {
  event_id: string;
  event_date?: string | null;
  event_year?: number | null;
  regulator?: string | null;
  event_class?: string | null;
  event_kind?: string | null;
  entity_id?: string | null;
  entity_key?: string | null;
  rut?: string | null;
  canonical_name?: string | null;
  source_entity_name?: string | null;
  identity_status?: string | null;
  identity_confidence?: number | string | null;
  region?: string | null;
  amount_clp?: number | string | null;
  amount_uf?: number | string | null;
  reason?: string | null;
  resolution_ref?: string | null;
  document_url?: string | null;
  document_quality?: string | null;
  document_excerpt?: string | null;
  cgr_stage?: string | null;
  cgr_risk_family?: string | null;
  cgr_severity?: string | null;
  in_uaf_registry?: boolean | null;
  in_sii_registry?: boolean | null;
  in_osfl_registry?: boolean | null;
  priority_score?: number | string | null;
};

type EventsResponse = {
  page?: { limit?: number; offset?: number; total?: number | string };
  items?: EventItem[];
};

type DetailResponse = { event?: EventItem; related_events?: EventItem[] };

const EMPTY: Filters = { q: '', universe: '', regulator: '', region: '', event_kind: '', year: '', amount_band: '' };
const TYPE_COLORS = ['#ff8a1f', '#19c6df', '#7b78ff', '#f0618f', '#79d59c', '#8fa3b5', '#e3b341'];
const PAGE_SIZE = 12;
const NF = new Intl.NumberFormat('es-CL');
const CLP = new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 });

function n(v: unknown) { const x = Number(v); return Number.isFinite(x) ? x : 0; }
function count(v: unknown) { return NF.format(n(v)); }
function pct(v: unknown) { return `${n(v).toLocaleString('es-CL', { maximumFractionDigits: 1 })}%`; }
function amountCLP(v: unknown, compact = false) {
  const x = n(v); if (x <= 0) return '—';
  if (compact && x >= 1e6) return `$ ${Number(x / 1e6).toLocaleString('es-CL', { maximumFractionDigits: 1 })} MM`;
  return CLP.format(Math.round(x));
}
function amountUF(v: unknown) { const x = n(v); return x > 0 ? `${x.toLocaleString('es-CL', { maximumFractionDigits: 1 })} UF` : '—'; }
function formatDate(v?: string | null, long = false) {
  if (!v) return 'Sin fecha';
  const d = new Date(v); if (Number.isNaN(d.getTime())) return String(v);
  if (long) return d.toLocaleDateString('es-CL', { year: 'numeric', month: 'short', day: '2-digit' }).replace(/\./g, '');
  return d.toLocaleDateString('es-CL');
}
function universeLabel(e: EventItem) {
  const values: string[] = [];
  if (e.in_uaf_registry) values.push('UAF');
  if (e.in_sii_registry) values.push('SII');
  if (e.in_osfl_registry) values.push('OSFL');
  return values.join(' · ') || 'Fuera de padrón consolidado';
}
function priority(v: unknown): [string, string] {
  const x = n(v); if (x >= 70) return ['Alta', 'high']; if (x >= 45) return ['Media', 'medium']; return ['Contextual', 'low'];
}
async function sanctionsRpc<T>(request: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc('atlas_v2_sanctions_query', { p_request: request });
  if (error) throw error;
  return data as T;
}

export function Sanciones({ onNavigate }: { onNavigate: (hash: string) => void }) {
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [searchDraft, setSearchDraft] = useState('');
  const [offset, setOffset] = useState(0);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [events, setEvents] = useState<EventsResponse | null>(null);
  const [selected, setSelected] = useState<EventItem | null>(null);
  const [detail, setDetail] = useState<DetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null);
    const payload = { ...filters };
    Promise.all([
      sanctionsRpc<Dashboard>({ kind: 'dashboard', ...payload }),
      sanctionsRpc<EventsResponse>({ kind: 'events', ...payload, limit: PAGE_SIZE, offset }),
    ]).then(([d, e]) => {
      if (cancelled) return;
      setDashboard(d); setEvents(e); setSelected(e.items?.[0] ?? null);
    }).catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : 'No fue posible cargar Sanciones.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [filters, offset, reload]);

  useEffect(() => {
    let cancelled = false;
    if (!selected?.event_id) { setDetail(null); return; }
    sanctionsRpc<DetailResponse>({ kind: 'detail', event_id: selected.event_id })
      .then((d) => { if (!cancelled) setDetail(d); })
      .catch(() => { if (!cancelled) setDetail({ event: selected, related_events: [] }); });
    return () => { cancelled = true; };
  }, [selected]);

  const metrics = dashboard?.metrics ?? {};
  const options = dashboard?.filters ?? {};
  const universeRows = dashboard?.universes ?? [];
  const supervisors = dashboard?.supervisors ?? [];
  const regions = (dashboard?.regions ?? []).filter((r) => r.region !== 'Sin región informada');
  const types = dashboard?.types ?? [];
  const years = dashboard?.years ?? [];
  const page = events?.page ?? {};
  const items = events?.items ?? [];

  const typeTop = useMemo(() => types.slice(0, 6), [types]);
  const donut = useMemo(() => {
    const total = typeTop.reduce((s, r) => s + n(r.event_count), 0) || 1;
    let acc = 0;
    return { total, gradient: typeTop.map((r, i) => { const start = acc; acc += n(r.event_count) / total * 100; return `${TYPE_COLORS[i % TYPE_COLORS.length]} ${start}% ${acc}%`; }).join(',') };
  }, [typeTop]);

  function patch(next: Partial<Filters>) { setFilters((f) => ({ ...f, ...next })); setOffset(0); }
  function clear() { setFilters(EMPTY); setSearchDraft(''); setOffset(0); }
  function runSearch() { patch({ q: searchDraft.trim() }); }

  if (loading && !dashboard) return <div className="san-loading"><span className="san-spinner" /><strong>Construyendo monitor de sanciones…</strong></div>;
  if (error && !dashboard) return <div className="san-error"><strong>No fue posible cargar Sanciones.</strong><span>{error}</span><button onClick={() => setReload((x) => x + 1)}>Reintentar</button></div>;

  const totalAmounts = [amountCLP(metrics.amount_clp, true) !== '—' ? `${amountCLP(metrics.amount_clp, true)} CLP` : '', amountUF(metrics.amount_uf) !== '—' ? amountUF(metrics.amount_uf) : ''].filter(Boolean).join(' · ') || 'Sin monto agregado';

  return <div className="atlas-v2-sanctions san-command-center fade-in" data-sanctions-command-center="v2">
    <header className="san-command-head">
      <div><div className="atlas-v2-eyebrow">RADAR SANCIONATORIO · V2</div><h1>Sanciones</h1><p>Monitoreo consolidado de sanciones sobre universos UAF, SII y OSFL.</p></div>
      <div className="san-freshness"><span>Última actualización</span><strong>{formatDate(dashboard?.snapshot_id, true)}</strong><small>{count(metrics.document_count)} eventos con documento público</small></div>
    </header>

    <section className="san-filterbar">
      <Select label="Universo" value={filters.universe} options={['UAF', 'SII', 'OSFL']} onChange={(v) => patch({ universe: v })} />
      <Select label="Supervisor" value={filters.regulator} options={options.regulators ?? []} onChange={(v) => patch({ regulator: v })} />
      <Select label="Región" value={filters.region} options={options.regions ?? []} onChange={(v) => patch({ region: v })} all="Todas" />
      <Select label="Tipo de sanción" value={filters.event_kind} options={options.types ?? []} onChange={(v) => patch({ event_kind: v })} />
      <Select label="Año" value={filters.year} options={(options.years ?? []).map(String)} onChange={(v) => patch({ year: v })} />
      <Select label="Monto multa" value={filters.amount_band} options={[{ value: 'CLP', label: 'Con monto CLP' }, { value: 'UF', label: 'Con monto UF' }, { value: 'NO_AMOUNT', label: 'Sin monto publicado' }]} onChange={(v) => patch({ amount_band: v })} />
      <div className="san-filter-search"><input type="search" value={searchDraft} onChange={(e) => setSearchDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') runSearch(); }} placeholder="Buscar por RUT, entidad, motivo o resolución…" /><button className="san-search-button" onClick={runSearch}>Buscar</button></div>
      <button className="san-reset" onClick={clear}>Limpiar</button>
    </section>

    <div className="san-kpis">
      <Kpi label="Entidades evaluadas" value={count(metrics.unified_universe_count)} detail="Universo SII + UAF + OSFL deduplicado" glyph="▤" tone="cyan" />
      <Kpi label="Entidades sancionadas" value={count(metrics.entity_count)} detail={n(metrics.unified_universe_count) ? `${pct(n(metrics.entity_count) / n(metrics.unified_universe_count) * 100)} del universo` : 'Identidad resuelta'} glyph="◎" tone="orange" />
      <Kpi label="Eventos sancionatorios" value={count(metrics.event_count)} detail={`${count(metrics.regulatory_event_count)} regulatorios · ${count(metrics.cgr_event_count)} CGR`} glyph="⚖" tone="cyan" />
      <Kpi label="Monto total multas" value={totalAmounts} detail="UF y CLP se mantienen separados" glyph="◉" tone="orange" />
      <Kpi label="Supervisores activos" value={count(metrics.supervisor_count)} detail="CMF · UAF · SCJ · CGR" glyph="✦" tone="cyan" />
    </div>

    <div className="san-top-grid">
      <section className="san-panel san-universes">
        <PanelHead title="Universos analizados" subtitle="Membresías superpuestas: no deben sumarse entre sí." />
        <div className="san-universe-grid">{universeRows.map((r) => {
          const ratio = n(r.evaluated_count) ? n(r.entity_count) / n(r.evaluated_count) * 100 : 0;
          return <button key={r.code} className={`san-universe ${filters.universe === r.code ? 'active' : ''}`} onClick={() => patch({ universe: filters.universe === r.code ? '' : r.code })}>
            <div className="san-universe-title"><span className={`san-icon ${r.code === 'OSFL' ? 'orange' : 'cyan'}`}>{r.code === 'OSFL' ? '◇' : r.code === 'UAF' ? '◉' : '▦'}</span><strong>{r.code}</strong></div>
            <strong className="san-universe-total">{count(r.evaluated_count)}</strong><span>evaluadas</span>
            <div className="san-universe-foot"><strong>{count(r.entity_count)} sancionadas</strong><span>{pct(ratio)}</span></div>
            <div className="san-mini-track"><span style={{ width: `${Math.max(1, Math.min(100, ratio))}%` }} /></div>
          </button>;
        })}</div>
      </section>

      <section className="san-panel san-supervisors">
        <PanelHead title="Sanciones por supervisor" subtitle="Naranja: sanción regulatoria · Cian: acciones CGR / enforcement" />
        <div className="san-supervisor-chart">{supervisors.map((r) => {
          const max = Math.max(1, ...supervisors.map((x) => n(x.event_count))); const total = n(r.event_count); const reg = n(r.regulatory_event_count); const cgr = n(r.cgr_event_count); const regShare = total ? reg / total * 100 : 0;
          return <button key={r.regulator} className={`san-supervisor-column ${filters.regulator === r.regulator ? 'active' : ''}`} onClick={() => patch({ regulator: filters.regulator === r.regulator ? '' : r.regulator })}>
            <strong>{count(total)}</strong><div className="san-stack" style={{ height: `${Math.max(8, total / max * 100)}%` }}>{reg > 0 && <span className="regulatory" style={{ height: `${regShare}%` }} />}{cgr > 0 && <span className="cgr" style={{ height: `${100 - regShare}%` }} />}</div><span>{r.regulator || 'S/F'}</span>
          </button>;
        })}</div>
      </section>
    </div>

    <div className="san-analytics-grid">
      <RegionPanel rows={regions} selected={filters.region} onSelect={(region) => patch({ region: filters.region === region ? '' : region })} />
      <section className="san-panel san-types"><PanelHead title="Sanciones por tipo" subtitle="Tipología observada en las fuentes públicas." /><div className="san-type-layout">
        <div className="san-donut" style={{ background: `conic-gradient(${donut.gradient})` }}><span><strong>{count(donut.total)}</strong><small>eventos</small></span></div>
        <div className="san-type-legend">{typeTop.map((r, i) => <button key={r.event_kind} className={filters.event_kind === r.event_kind ? 'active' : ''} onClick={() => patch({ event_kind: filters.event_kind === r.event_kind ? '' : r.event_kind })}><i style={{ background: TYPE_COLORS[i % TYPE_COLORS.length] }} /><span>{r.event_kind}</span><strong>{count(r.event_count)}</strong></button>)}</div>
      </div></section>
      <EvolutionPanel rows={years} selected={filters.year} onSelect={(year) => patch({ year: filters.year === String(year) ? '' : String(year) })} />
    </div>

    <div className="san-workspace">
      <section className="san-panel san-events">
        <PanelHead title={`Casos prioritarios · ${count(page.total)}`} subtitle="Orden explicable para revisión: recurrencia, condición UAF/OSFL, monto, evidencia e identidad." />
        <div className="san-table-head"><span>Entidad / RUT</span><span>Universo</span><span>Supervisor</span><span>Región</span><span>Tipo de sanción</span><span>Monto</span><span>Fecha</span><span>Prioridad</span><span /></div>
        <div className="san-event-rows">{items.length ? items.map((item) => <EventRow key={item.event_id} item={item} onClick={() => setSelected(item)} active={selected?.event_id === item.event_id} />) : <div className="san-empty">Sin eventos para los filtros seleccionados.</div>}</div>
        <div className="san-pager"><span>{n(page.total) ? `${count(n(page.offset) + 1)}–${count(Math.min(n(page.total), n(page.offset) + n(page.limit || PAGE_SIZE)))} de ${count(page.total)}` : '0 resultados'}</span><div><button disabled={n(page.offset) <= 0} onClick={() => setOffset(Math.max(0, n(page.offset) - n(page.limit || PAGE_SIZE)))}>← Anterior</button><button disabled={n(page.offset) + n(page.limit || PAGE_SIZE) >= n(page.total)} onClick={() => setOffset(n(page.offset) + n(page.limit || PAGE_SIZE))}>Siguiente →</button></div></div>
      </section>
      <DetailCard detail={detail} fallback={selected} onNavigate={onNavigate} />
    </div>

    <div className="san-method-note"><strong>Lectura metodológica. </strong><span>{`${dashboard?.semantics?.regulatory ?? 'CMF/UAF/SCJ son sanciones regulatorias observadas.'} ${dashboard?.semantics?.cgr ?? 'CGR se presenta como acciones de enforcement separadas.'} ${dashboard?.semantics?.currency ?? 'UF y CLP permanecen separados.'}`}</span></div>
  </div>;
}

function Select({ label, value, options, onChange, all = 'Todos' }: { label: string; value: string; options: Array<string | { value: string; label: string }>; onChange: (v: string) => void; all?: string }) {
  return <label className="san-filter"><span>{label}</span><select value={value} onChange={(e) => onChange(e.target.value)}><option value="">{all}</option>{options.map((o) => typeof o === 'string' ? <option key={o} value={o}>{o}</option> : <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>;
}
function Kpi({ label, value, detail, glyph, tone }: { label: string; value: string; detail: string; glyph: string; tone: string }) {
  return <article className="san-kpi"><span className={`san-icon ${tone}`}>{glyph}</span><div><small>{label}</small><strong title={value}>{value}</strong><span>{detail}</span></div></article>;
}
function PanelHead({ title, subtitle }: { title: string; subtitle: string }) { return <div className="san-panel-head"><div><h2>{title}</h2><p>{subtitle}</p></div></div>; }

function RegionPanel({ rows, selected, onSelect }: { rows: Dashboard['regions']; selected: string; onSelect: (r: string) => void }) {
  const all = rows ?? []; const top = all.slice(0, 10); const total = all.reduce((s, r) => s + n(r.event_count), 0) || 1; const max = Math.max(1, ...top.map((r) => n(r.event_count)));
  const sum = (limit: number) => all.slice(0, limit).reduce((s, r) => s + n(r.event_count), 0); const leader = all[0];
  return <section className="san-panel san-regions"><PanelHead title="Sanciones por región" subtitle="Ranking interactivo y concentración territorial sobre eventos con región informada." /><div className="san-region-layout">
    <div className="san-region-list">{top.map((r, i) => <button key={r.region} className={selected === r.region ? 'active' : ''} onClick={() => onSelect(r.region)}><b>{i + 1}</b><span>{r.region}</span><i><em style={{ width: `${Math.max(2, n(r.event_count) / max * 100)}%` }} /></i><strong>{count(r.event_count)}</strong><span className="san-region-share">{pct(n(r.event_count) / total * 100)}</span></button>)}</div>
    <aside className="san-region-metrics"><RegionMetric label="Región líder" value={leader ? pct(n(leader.event_count) / total * 100) : '—'} detail={leader?.region ?? 'Sin datos'} orange /><RegionMetric label="Concentración Top 3" value={pct(sum(3) / total * 100)} detail={`${count(sum(3))} eventos`} /><RegionMetric label="Concentración Top 5" value={pct(sum(5) / total * 100)} detail={`${count(sum(5))} eventos`} /><RegionMetric label="Cobertura territorial" value={count(all.length)} detail="regiones con eventos informados" /></aside>
  </div></section>;
}
function RegionMetric({ label, value, detail, orange = false }: { label: string; value: string; detail: string; orange?: boolean }) { return <article className={`san-region-metric ${orange ? 'orange' : ''}`}><small>{label}</small><strong>{value}</strong><span>{detail}</span></article>; }

function EvolutionPanel({ rows, selected, onSelect }: { rows: Dashboard['years']; selected: string; onSelect: (y: string | number) => void }) {
  const data = rows ?? []; const width = 520, height = 210, pad = 28, innerW = width - pad * 2, innerH = height - 54; const max = Math.max(1, ...data.map((r) => n(r.event_count)));
  const points = data.map((r, i) => { const x = pad + (data.length <= 1 ? innerW / 2 : i * innerW / (data.length - 1)); const y = 12 + innerH - n(r.entity_count) / max * innerH; return { x, y }; });
  return <section className="san-panel san-evolution"><PanelHead title="Evolución de sanciones" subtitle="Barras: eventos · línea: entidades identificadas" /><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Evolución anual de sanciones">
    {data.map((r, i) => { const x = pad + (data.length <= 1 ? innerW / 2 : i * innerW / (data.length - 1)); const barW = Math.max(8, innerW / Math.max(12, data.length) * .58); const y = 12 + innerH - n(r.event_count) / max * innerH; return <g key={String(r.event_year)} onClick={() => onSelect(r.event_year)} className={selected === String(r.event_year) ? 'active' : ''}><rect x={x - barW / 2} y={y} width={barW} height={12 + innerH - y} rx="3" className="san-year-bar" /><text x={x} y={height - 13} textAnchor="middle" className="san-chart-label">{r.event_year}</text></g>; })}
    {points.length > 1 && <polyline points={points.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" className="san-year-line" />}{points.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r="4" className="san-year-point" />)}
  </svg></section>;
}

function EventRow({ item, onClick, active }: { item: EventItem; onClick: () => void; active: boolean }) {
  const [label, cls] = priority(item.priority_score); const amount = n(item.amount_clp) > 0 ? amountCLP(item.amount_clp, true) : n(item.amount_uf) > 0 ? amountUF(item.amount_uf) : '—';
  return <button className={`san-event ${active ? 'active' : ''}`} onClick={onClick}><span className="san-cell entity"><strong>{item.canonical_name || item.source_entity_name || 'Entidad no resuelta'}</strong><small>{item.rut || item.identity_status || 'Sin RUT'}</small></span><span className="san-cell">{universeLabel(item)}</span><span className="san-cell">{item.regulator || '—'}</span><span className="san-cell">{item.region || 'Sin región'}</span><span className="san-cell type">{item.event_kind || item.event_class || 'Sin clasificación'}</span><span className="san-cell">{amount}</span><span className="san-cell">{formatDate(item.event_date)}</span><span className={`san-priority ${cls}`}><i /><b>{label} {count(item.priority_score)}</b></span><span className="san-row-arrow">›</span></button>;
}

function DetailCard({ detail, fallback, onNavigate }: { detail: DetailResponse | null; fallback: EventItem | null; onNavigate: (hash: string) => void }) {
  const e = detail?.event ?? fallback; if (!e) return <aside className="san-detail san-detail-empty"><span className="san-icon cyan">⚖</span><h2>Ficha de sanción</h2><p>Selecciona un evento de la tabla para revisar identidad, resolución, motivo, recurrencia y documento público.</p></aside>;
  const related = detail?.related_events ?? []; const [label, cls] = priority(e.priority_score);
  const entityRoute = e.entity_id ? `#/entidad/${encodeURIComponent(e.entity_id)}` : e.rut ? `#/entidades?q=${encodeURIComponent(e.rut)}` : '';
  return <aside className="san-detail"><div className="san-detail-head"><div><small>{e.event_id || 'EVENTO'}</small><h2>Ficha de sanción</h2></div><span className={`san-priority ${cls}`}><i /><b>{label} · prioridad analítica</b></span></div>
    <div className="san-detail-entity"><span className="san-icon cyan">▦</span><div><strong>{e.canonical_name || e.source_entity_name || 'Entidad no resuelta'}</strong><span>{e.rut || e.identity_status || 'Sin RUT resuelto'}</span></div></div>
    <div className="san-detail-grid"><DetailField label="Universo" value={universeLabel(e)} /><DetailField label="Supervisor" value={e.regulator} /><DetailField label="Región" value={e.region} /><DetailField label="Fecha" value={formatDate(e.event_date, true)} /><DetailField label="Tipo" value={e.event_kind || e.event_class} /><DetailField label="Resolución" value={e.resolution_ref} /></div>
    <section className="san-detail-block"><h3>Monto informado</h3><div className="san-amount-pair"><strong>{amountCLP(e.amount_clp)}</strong><span>CLP</span><strong>{amountUF(e.amount_uf)}</strong><span>UF</span></div><small>Las monedas permanecen separadas; Atlas no realiza conversión implícita.</small></section>
    <section className="san-detail-block"><h3>Motivo / evidencia actual</h3><p>{e.reason || e.document_excerpt || 'La fuente no publica un resumen textual adicional.'}</p></section>
    {e.event_class === 'CGR_ENFORCEMENT_ACTION' && <div className="san-cgr-note"><strong>CGR · enforcement</strong><span>{[e.cgr_stage, e.cgr_risk_family, e.cgr_severity].filter(Boolean).join(' · ') || 'Acción administrativa contextual'}</span><small>No se interpreta automáticamente como sanción regulatoria firme.</small></div>}
    <section className="san-detail-block"><h3>Recurrencia observada · {count(related.length)} eventos</h3><div className="san-timeline">{related.slice(0, 6).map((r) => <div key={r.event_id}><i /><time>{formatDate(r.event_date)}</time><span>{r.regulator || ''} · {r.event_kind || r.event_class || ''}</span></div>)}</div></section>
    <section className="san-document"><h3>Documento de la sanción</h3>{e.document_url ? <a href={e.document_url} target="_blank" rel="noopener noreferrer"><span className="san-icon orange">↗</span><div><strong>{e.resolution_ref || 'Documento público'}</strong><span>{e.document_quality || 'Evidencia pública registrada'}</span></div></a> : <p>Sin enlace documental publicado.</p>}</section>
    {entityRoute && <button className="san-detail-cta" onClick={() => onNavigate(entityRoute)}>Abrir detalle en Entidad 360 →</button>}
    <small className="san-guardrail">Prioridad analítica ≠ probabilidad LA/FT. Una sanción administrativa no equivale por sí sola a evidencia LA/FT.</small>
  </aside>;
}
function DetailField({ label, value }: { label: string; value?: string | null }) { return <div className="san-detail-field"><span>{label}</span><strong>{value || '—'}</strong></div>; }
