import { useEffect, useState, type ReactNode } from 'react';
import { useDebounced, useRpc } from '../lib/rpc';
import { ErrorBox, Loading } from '../components/primitives';

const PAGE_SIZE = 8;

type Metric = { label: string; count: number };
type SourceMetric = { code: string; label: string; role: string; volume: number; detail: string };
type EvolutionPoint = { year: number; stock: number; starts: number; terminations: number };

type Dashboard = {
  error?: string;
  national: {
    official_total: number; official_snapshot_date: string | null; observed: number; coverage_pct: number;
    sii_history: number; direct_uaf: number; potential_uaf: number; law19913_bridge: number;
    registro19862: number; sanctioned: number; refreshed_at: string | null;
  };
  sources: SourceMetric[];
  types: Metric[];
  activities: Metric[];
  regions: Metric[];
  evolution: EvolutionPoint[];
  filters: { regions: string[]; activities: string[]; types: string[] };
  semantics: { official_universe: string; observed_universe: string; type_inference: string; evolution: string };
};

type EntityRow = {
  entity_id: string; rut: string | null; name: string; type: string; region: string | null; commune: string | null;
  main_activity: string | null; status: string | null; sources: Record<string, boolean>;
};

type SearchData = { total: number; rows: EntityRow[] };
type TimelineEvent = { date: string; label: string; source: string; detail: string | null; kind: string };
type DetailData = {
  entity: {
    entity_id: string; rut: string | null; name: string; type: string; region: string | null; commune: string | null;
    main_activity: string | null; status: string | null; activity_start_date: string | null; sales_band: string | null;
    size_class: string | null; workers: number | null;
  };
  sources: { SII: boolean; UAF_DIRECT: boolean; UAF_POTENTIAL: boolean; REGISTRO_19862: boolean; SANCIONES: boolean; FONDOS_PUBLICOS: boolean };
  uaf: { label: string | null; sector: string | null };
  public_funds: { confirmed: boolean; transfer_count: number; amount_clp: number };
  sanctions: { event_count: number; regulators: string[] };
  economic: { activity_names: string | null; latest_year: number | null };
  timeline: TimelineEvent[];
  timeline_note: string;
};

type Filters = { region: string; type: string; activity: string; source: string; uaf: string; publicFunds: string; sanctions: string };
const EMPTY: Filters = { region: '', type: '', activity: '', source: '', uaf: 'TODAS', publicFunds: 'TODOS', sanctions: 'TODAS' };

type Tab = 'timeline' | 'economic' | 'background';

export function Osfl({ onNavigate }: { onNavigate: (hash: string) => void }) {
  const dashboard = useRpc<Dashboard>('obs_osfl_dashboard', {});
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounced(query, 240);
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('timeline');

  const search = useRpc<SearchData>('obs_osfl_search', {
    p_q: debouncedQuery || null,
    p_region: filters.region || null,
    p_type: filters.type || null,
    p_activity: filters.activity || null,
    p_source: filters.source || null,
    p_uaf: filters.uaf,
    p_public_funds: filters.publicFunds,
    p_sanctions: filters.sanctions,
    p_limit: PAGE_SIZE,
    p_offset: page * PAGE_SIZE,
  });
  const detail = useRpc<DetailData>('obs_osfl_entity_detail', { p_entity_id: selectedId }, { skip: !selectedId });

  useEffect(() => {
    const rows = search.data?.rows ?? [];
    if (!rows.length) {
      if (selectedId) setSelectedId(null);
      return;
    }
    if (!selectedId || !rows.some((row) => row.entity_id === selectedId)) setSelectedId(rows[0].entity_id);
  }, [search.data?.rows, selectedId]);

  function setFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(0);
  }
  function reset() {
    setQuery('');
    setFilters(EMPTY);
    setPage(0);
  }
  function focusSource(source: string) {
    setFilters({ ...EMPTY, source });
    setPage(0);
  }

  if (dashboard.loading) return <Loading label="Construyendo panorama nacional de OSFL…" />;
  if (dashboard.error) return <ErrorBox error={dashboard.error} onRetry={dashboard.reload} />;
  if (!dashboard.data || dashboard.data.error) return <ErrorBox error="No fue posible leer el universo OSFL autorizado." onRetry={dashboard.reload} />;

  const data = dashboard.data;
  const n = data.national;
  const totalResults = search.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(totalResults / PAGE_SIZE));

  return (
    <div className="osfl-page fade-in">
      <header className="osfl-head">
        <div>
          <div className="osfl-kicker">Organizaciones sin fines de lucro · Chile</div>
          <h1>OSFL <span>|</span> Panorama y caracterización</h1>
          <p>Del universo nacional a la entidad: cobertura, actividad económica, cruces regulatorios y trayectoria verificable.</p>
        </div>
        <div className="osfl-head-meta">
          <span><b>Corte legal</b>{formatDate(n.official_snapshot_date)}</span>
          <span><b>Atlas actualizado</b>{formatDateTime(n.refreshed_at)}</span>
        </div>
      </header>

      <Section index="1" title="Contexto nacional" hint="Visión general del universo OSFL en Chile y de la porción individualizada en Atlas.">
        <div className="osfl-context-grid">
          <button className="osfl-hero-card orange" onClick={reset} title={data.semantics.official_universe}>
            <Icon name="people" /><span className="label">Universo OSFL Chile</span><strong>{formatNumber(n.official_total)}</strong>
            <small>Registro Civil · universo nacional de referencia</small>
          </button>
          <button className="osfl-hero-card blue" onClick={reset} title={data.semantics.observed_universe}>
            <Icon name="bars" /><span className="label">Atlas observado</span><strong>{formatNumber(n.observed)}</strong>
            <small>Cobertura individualizada · {formatPct(n.coverage_pct)}</small>
            <span className="osfl-progress"><i style={{ width: `${Math.min(100, n.coverage_pct)}%` }} /></span>
          </button>
          <div className="osfl-cross-card">
            <div className="osfl-cross-title"><Icon name="link" /><div><b>Cruces analíticos</b><small>sobre {formatNumber(n.observed)} OSFL observadas</small></div></div>
            <button onClick={() => focusSource('SII')}><span>Con historial SII</span><strong>{formatNumber(n.sii_history)}</strong><small>{share(n.sii_history, n.observed)}</small></button>
            <button onClick={() => focusSource('UAF')}><span>Puente Ley 19.913</span><strong>{formatNumber(n.law19913_bridge)}</strong><small>{formatNumber(n.direct_uaf)} SO · {formatNumber(n.potential_uaf)} potenciales</small></button>
            <button onClick={() => focusSource('19862')}><span>Registro 19.862</span><strong>{formatNumber(n.registro19862)}</strong><small>{share(n.registro19862, n.observed)}</small></button>
          </div>
          <button className="osfl-alert-card" onClick={() => { setFilters({ ...EMPTY, sanctions: 'SI' }); setPage(0); }}>
            <Icon name="alert" /><div><span>Alertas / señales</span><strong>{formatNumber(n.sanctioned)}</strong><small>OSFL con antecedentes sancionatorios</small></div>
          </button>
        </div>
      </Section>

      <Section index="2" title="Fuentes y cobertura" hint="Qué aporta cada fuente y cómo evoluciona el universo individualizado disponible para análisis.">
        <div className="osfl-source-evolution">
          <SourceTable sources={data.sources} onPick={(code) => { if (code !== 'RC') focusSource(code === 'SANC' ? 'SANCIONES' : code); }} />
          <Evolution points={data.evolution} officialTotal={n.official_total} note={data.semantics.evolution} />
        </div>
      </Section>

      <Section index="3" title="Caracterización del universo observado" hint="Cada gráfico funciona como filtro para bajar desde el contexto nacional a las entidades.">
        <div className="osfl-character-grid">
          <TypeDonut data={data.types} total={n.observed} active={filters.type} note={data.semantics.type_inference} onPick={(value) => setFilter('type', filters.type === value ? '' : value)} />
          <ActivityBars data={data.activities} total={n.observed} active={filters.activity} onPick={(value) => setFilter('activity', filters.activity === value ? '' : value)} />
          <RegionRanking data={data.regions} total={n.observed} active={filters.region} onPick={(value) => setFilter('region', filters.region === value ? '' : value)} />
        </div>
      </Section>

      <Section index="4" title="Explorar y caracterizar OSFL" hint="La línea de tiempo aparece después de seleccionar una OSFL y sólo usa hechos con fecha disponible.">
        <div className="osfl-explorer-grid">
          <div className="osfl-results-panel">
            <div className="osfl-filterbar">
              <label className="osfl-search"><Icon name="search" /><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} placeholder="Buscar por nombre o RUT…" /></label>
              <Select label="Región" value={filters.region} options={data.filters.regions} onChange={(value) => setFilter('region', value)} />
              <Select label="Tipo" value={filters.type} options={data.filters.types} onChange={(value) => setFilter('type', value)} />
              <Select label="Actividad principal (SII)" value={filters.activity} options={data.filters.activities} onChange={(value) => setFilter('activity', value)} wide />
              <Select label="Fuente" value={filters.source} options={['SII', 'UAF', '19862', 'SANCIONES']} labels={{ '19862': 'Registro 19.862', SANCIONES: 'Sanciones' }} onChange={(value) => setFilter('source', value)} />
              <Select label="Condición UAF" value={filters.uaf} options={['TODAS', 'DIRECTA', 'POTENCIAL', 'SIN_PUENTE']} labels={{ TODAS: 'Todas', DIRECTA: 'SO registrado', POTENCIAL: 'Potencial sujeto', SIN_PUENTE: 'Sin puente 19.913' }} noEmpty onChange={(value) => setFilter('uaf', value)} />
              <Select label="Fondos públicos" value={filters.publicFunds} options={['TODOS', 'SI', 'NO']} labels={{ TODOS: 'Todos', SI: 'Transferencia confirmada', NO: 'Sin transferencia confirmada' }} noEmpty onChange={(value) => setFilter('publicFunds', value)} />
              <Select label="Sanciones" value={filters.sanctions} options={['TODAS', 'SI', 'NO']} labels={{ TODAS: 'Todas', SI: 'Con sanciones', NO: 'Sin sanciones' }} noEmpty onChange={(value) => setFilter('sanctions', value)} />
              <button className="osfl-clear" onClick={reset}>Limpiar</button>
            </div>

            <div className="osfl-results-head"><div><b>Resultados</b><span>{search.loading ? 'Actualizando…' : `${formatNumber(totalResults)} entidades`}</span></div><div className="osfl-page-info">Página {Math.min(page + 1, pages)} de {pages}</div></div>
            {search.error ? <ErrorBox error={search.error} onRetry={search.reload} /> : <ResultTable rows={search.data?.rows ?? []} selectedId={selectedId} onSelect={setSelectedId} />}
            <div className="osfl-pagination">
              <button disabled={page === 0} onClick={() => setPage((current) => Math.max(0, current - 1))}>‹</button>
              {pageButtons(page, pages).map((item) => <button key={item} data-active={item === page} onClick={() => setPage(item)}>{item + 1}</button>)}
              <button disabled={page + 1 >= pages} onClick={() => setPage((current) => Math.min(pages - 1, current + 1))}>›</button>
            </div>
          </div>

          <QuickPanel detail={detail.data} loading={detail.loading} error={detail.error} tab={tab} onTab={setTab} onRetry={detail.reload} onOpen={(id) => onNavigate(`#/entidad/${encodeURIComponent(id)}`)} />
        </div>
      </Section>
    </div>
  );
}

function Section({ index, title, hint, children }: { index: string; title: string; hint: string; children: ReactNode }) {
  return <section className="osfl-section"><div className="osfl-section-head"><h2><span>{index}.</span> {title}</h2><p>{hint}</p></div>{children}</section>;
}

function SourceTable({ sources, onPick }: { sources: SourceMetric[]; onPick: (code: string) => void }) {
  return <div className="osfl-source-card">
    <div className="osfl-card-title"><span>Fuente</span><span>Rol de la fuente</span><span>Volumen</span></div>
    {sources.map((source) => <button key={source.code} className="osfl-source-row" data-reference={source.code === 'RC'} onClick={() => onPick(source.code)} title={source.detail}>
      <span className={`osfl-source-icon src-${source.code.toLowerCase()}`}>{source.code === '19862' ? '19' : source.code.slice(0, 3)}</span>
      <b>{source.label}</b><span>{source.role}</span><strong>{formatNumber(source.volume)}</strong>
    </button>)}
  </div>;
}

function Evolution({ points, officialTotal, note }: { points: EvolutionPoint[]; officialTotal: number; note: string }) {
  if (!points.length) return <div className="osfl-evolution-card"><div className="osfl-empty">Sin serie temporal disponible.</div></div>;
  const W = 720, H = 210, L = 48, R = 28, T = 38, B = 35;
  const maxStock = Math.max(...points.map((point) => point.stock), 1);
  const maxStarts = Math.max(...points.map((point) => point.starts), 1);
  const x = (index: number) => L + index * ((W - L - R) / Math.max(1, points.length - 1));
  const stockY = (value: number) => T + (H - T - B) * (1 - value / maxStock);
  const startsY = (value: number) => T + (H - T - B) * (1 - value / maxStarts);
  const path = points.map((point, index) => `${index ? 'L' : 'M'} ${x(index).toFixed(1)} ${stockY(point.stock).toFixed(1)}`).join(' ');
  const last = points[points.length - 1];
  return <div className="osfl-evolution-card" title={note}>
    <div className="osfl-chart-top"><div><div className="osfl-card-heading">Evolución del universo OSFL</div><small>Stock observable con fecha de inicio válida + nuevos inicios por año</small></div><div className="osfl-reference"><span>Referencia nacional actual</span><b>{formatNumber(officialTotal)}</b></div></div>
    <div className="osfl-legend"><span className="line orange" />Stock observado <span className="bar blue" />Nuevos inicios/año</div>
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Evolución anual de OSFL observadas">
      {[0, .25, .5, .75, 1].map((ratio) => <g key={ratio}><line x1={L} x2={W - R} y1={T + (H - T - B) * ratio} y2={T + (H - T - B) * ratio} className="gridline" /><text x={L - 8} y={T + (H - T - B) * ratio + 4} textAnchor="end" className="axis-label">{compact(Math.round(maxStock * (1 - ratio)))}</text></g>)}
      {points.map((point, index) => <rect key={`starts-${point.year}`} x={x(index) - 6} y={startsY(point.starts)} width="12" height={H - B - startsY(point.starts)} rx="3" className="start-bar"><title>{point.year}: {formatNumber(point.starts)} inicios</title></rect>)}
      <path d={path} className="stock-line" />
      {points.map((point, index) => <g key={point.year}><circle cx={x(index)} cy={stockY(point.stock)} r="4" className="stock-dot"><title>{point.year}: stock {formatNumber(point.stock)} · {formatNumber(point.starts)} inicios</title></circle><text x={x(index)} y={H - 11} textAnchor="middle" className="axis-label">{point.year}</text></g>)}
      <g transform={`translate(${x(points.length - 1) - 44} ${Math.max(T + 4, stockY(last.stock) - 28)})`}><rect width="88" height="23" rx="5" className="last-label-bg" /><text x="44" y="16" textAnchor="middle" className="last-label">{formatNumber(last.stock)}</text></g>
    </svg>
  </div>;
}

function TypeDonut({ data, total, active, note, onPick }: { data: Metric[]; total: number; active: string; note: string; onPick: (value: string) => void }) {
  const labels = ['Fundación', 'Corporación', 'Asociación'];
  const direct = labels.map((label) => ({ label, count: data.find((item) => item.label === label)?.count ?? 0 }));
  const items = [...direct, { label: 'Otras', count: Math.max(0, total - direct.reduce((sum, item) => sum + item.count, 0)) }];
  const colors = ['var(--osfl-orange)', 'var(--osfl-blue)', 'var(--osfl-sky)', 'var(--osfl-muted)'];
  let accumulated = 0;
  const stops = items.map((item, index) => { const start = accumulated; accumulated += total ? item.count / total * 100 : 0; return `${colors[index]} ${start}% ${accumulated}%`; }).join(',');
  return <div className="osfl-chart-card type-card" title={note}>
    <div className="osfl-card-heading">Tipos de OSFL observadas <span className="osfl-info">i</span></div>
    <div className="osfl-donut-wrap"><div className="osfl-donut" style={{ background: `conic-gradient(${stops})` }}><div><b>{formatNumber(total)}</b><span>OSFL</span></div></div>
      <div className="osfl-donut-legend">{items.map((item, index) => <button key={item.label} data-active={active === item.label} onClick={() => { if (item.label !== 'Otras') onPick(item.label); }}><i style={{ background: colors[index] }} /><span>{item.label}</span><b>{share(item.count, total)}</b><small>{formatNumber(item.count)}</small></button>)}</div>
    </div>
    <div className="osfl-chart-note">Tipología inferida por denominación; el padrón legal individualizado aún no está cargado.</div>
  </div>;
}

function ActivityBars({ data, total, active, onPick }: { data: Metric[]; total: number; active: string; onPick: (value: string) => void }) {
  const max = Math.max(...data.map((item) => item.count), 1);
  return <div className="osfl-chart-card activity-card"><div className="osfl-card-heading">Principales actividades económicas (SII)</div><div className="osfl-bars-list">
    {data.slice(0, 6).map((item) => <button key={item.label} data-active={active === item.label} onClick={() => onPick(item.label)} title={item.label}><span>{titleCase(item.label)}</span><i><b style={{ width: `${item.count / max * 100}%` }} /></i><strong>{formatNumber(item.count)}</strong><small>{share(item.count, total)}</small></button>)}
  </div><div className="osfl-chart-note">Actividades principales observables en SII. El gráfico filtra la tabla inferior.</div></div>;
}

function RegionRanking({ data, total, active, onPick }: { data: Metric[]; total: number; active: string; onPick: (value: string) => void }) {
  const rows = data.filter((item) => item.label !== 'Sin región observada').slice(0, 5);
  const max = Math.max(...rows.map((item) => item.count), 1);
  return <div className="osfl-chart-card region-card"><div className="osfl-card-heading">Top 5 regiones <span>(OSFL observadas)</span></div><div className="osfl-region-table">
    <div className="head"><span>Región</span><span>Cantidad</span><span>%</span><span /></div>
    {rows.map((item) => <button key={item.label} data-active={active === item.label} onClick={() => onPick(item.label)}><span>{shortRegion(item.label)}</span><strong>{formatNumber(item.count)}</strong><span>{share(item.count, total)}</span><i><b style={{ width: `${item.count / max * 100}%` }} /></i></button>)}
  </div></div>;
}

function ResultTable({ rows, selectedId, onSelect }: { rows: EntityRow[]; selectedId: string | null; onSelect: (id: string) => void }) {
  return <div className="osfl-table-wrap"><table className="osfl-table"><thead><tr><th>Entidad</th><th>RUT</th><th>Tipo</th><th>Región</th><th>Actividad principal (SII)</th><th>Fuentes</th><th>Estado</th><th /></tr></thead><tbody>
    {rows.map((row) => <tr key={row.entity_id} data-selected={selectedId === row.entity_id} onClick={() => onSelect(row.entity_id)}>
      <td className="entity-name">{row.name}</td><td className="mono">{row.rut ?? '—'}</td><td>{row.type}</td><td>{shortRegion(row.region)}</td>
      <td className="activity-cell" title={row.main_activity ?? 'Sin actividad principal observable'}>{row.main_activity ? titleCase(row.main_activity) : <em>Sin actividad detallada</em>}</td>
      <td><SourceBadges sources={row.sources} /></td><td><Status status={row.status} /></td><td><button className="osfl-open" onClick={(event) => { event.stopPropagation(); onSelect(row.entity_id); }} aria-label="Ver caracterización">›</button></td>
    </tr>)}
    {!rows.length && <tr><td colSpan={8} className="osfl-empty">No hay entidades para los filtros seleccionados.</td></tr>}
  </tbody></table></div>;
}

function QuickPanel({ detail, loading, error, tab, onTab, onRetry, onOpen }: { detail: DetailData | null; loading: boolean; error: string | null; tab: Tab; onTab: (tab: Tab) => void; onRetry: () => void; onOpen: (id: string) => void }) {
  if (error) return <aside className="osfl-detail-panel"><ErrorBox error={error} onRetry={onRetry} /></aside>;
  if (loading && !detail) return <aside className="osfl-detail-panel"><div className="osfl-detail-placeholder">Cargando caracterización…</div></aside>;
  if (!detail?.entity) return <aside className="osfl-detail-panel"><div className="osfl-detail-placeholder"><Icon name="target" /><b>Seleccione una OSFL</b><span>La ficha rápida mostrará cruces, actividad y trayectoria.</span></div></aside>;
  const entity = detail.entity;
  return <aside className="osfl-detail-panel">
    <div className="osfl-detail-head"><div><span className="osfl-detail-kicker">Vista rápida de entidad seleccionada</span><h3>{entity.name}</h3><p><span className="mono">RUT {entity.rut ?? '—'}</span> · {entity.type} · {shortRegion(entity.region)}</p></div><button onClick={() => onOpen(entity.entity_id)} title="Abrir Entidad 360">↗</button></div>
    <div className="osfl-detail-summary"><Fact label="Región" value={shortRegion(entity.region)} /><Fact label="Comuna" value={entity.commune ?? '—'} /><Fact label="Actividad principal" value={entity.main_activity ? titleCase(entity.main_activity) : 'Sin actividad detallada'} wide /></div>
    <div className="osfl-detail-crosses"><div><span>Fuentes</span><SourceBadges sources={{ SII: detail.sources.SII, UAF: detail.sources.UAF_DIRECT, POTENTIAL_UAF: detail.sources.UAF_POTENTIAL, '19862': detail.sources.REGISTRO_19862, SANCIONES: detail.sources.SANCIONES }} /></div><Fact label="Condición UAF" value={detail.uaf.label ?? 'Sin puente 19.913'} /><Fact label="Fondos públicos" value={detail.public_funds.confirmed ? 'Transferencia confirmada' : detail.sources.REGISTRO_19862 ? 'Presencia Registro 19.862' : 'Sin evidencia confirmada'} /><Fact label="Sanciones" value={detail.sanctions.event_count ? `${formatNumber(detail.sanctions.event_count)} evento(s)` : 'Sin antecedentes observados'} alert={detail.sanctions.event_count > 0} /></div>
    <div className="osfl-detail-tabs"><button data-active={tab === 'timeline'} onClick={() => onTab('timeline')}>Línea de tiempo</button><button data-active={tab === 'economic'} onClick={() => onTab('economic')}>Actividad económica</button><button data-active={tab === 'background'} onClick={() => onTab('background')}>Antecedentes</button></div>
    <div className="osfl-detail-body">
      {tab === 'timeline' && <Timeline events={detail.timeline} note={detail.timeline_note} />}
      {tab === 'economic' && <div className="osfl-facts-grid"><Fact label="Inicio de actividades" value={formatDate(entity.activity_start_date)} /><Fact label="Estado SII" value={statusLabel(entity.status)} /><Fact label="Tramo de ventas" value={entity.sales_band ?? '—'} /><Fact label="Tamaño SII" value={entity.size_class ?? '—'} /><Fact label="Trabajadores" value={entity.workers == null ? '—' : formatNumber(entity.workers)} /><Fact label="Último año" value={detail.economic.latest_year?.toString() ?? '—'} /><Fact label="Giros observados" value={detail.economic.activity_names ? detail.economic.activity_names.split('|').map((value) => titleCase(value.trim())).join(' · ') : '—'} wide /></div>}
      {tab === 'background' && <div className="osfl-background"><Background label="Ley 19.913" value={detail.uaf.label ?? 'Sin puente identificado'} meta={detail.uaf.sector ?? undefined} /><Background label="Registro 19.862" value={detail.sources.REGISTRO_19862 ? 'Presente' : 'Sin coincidencia'} /><Background label="Fondos públicos" value={detail.public_funds.confirmed ? `${formatNumber(detail.public_funds.transfer_count)} transferencias confirmadas` : 'Sin transferencia confirmada en la fuente actual'} meta={detail.public_funds.amount_clp ? money(detail.public_funds.amount_clp) : undefined} /><Background label="Sanciones" value={detail.sanctions.event_count ? `${formatNumber(detail.sanctions.event_count)} evento(s) · ${detail.sanctions.regulators.join(', ')}` : 'Sin antecedentes sancionatorios observados'} alert={detail.sanctions.event_count > 0} /></div>}
    </div>
    <button className="osfl-full-button" onClick={() => onOpen(entity.entity_id)}>Abrir ficha completa de la entidad <span>→</span></button>
  </aside>;
}

function Timeline({ events, note }: { events: TimelineEvent[]; note: string }) {
  if (!events.length) return <div className="osfl-no-timeline"><Icon name="clock" /><b>Sin hitos fechados suficientes</b><span>{note}</span></div>;
  return <div><div className="osfl-timeline">{events.map((event, index) => <div className={`osfl-timeline-event kind-${event.kind.toLowerCase()}`} key={`${event.date}-${event.label}-${index}`}><i /><b>{formatDate(event.date)}</b><span>{event.label}</span><small>{event.source}{event.detail ? ` · ${event.detail}` : ''}</small></div>)}</div><p className="osfl-timeline-note">{note}</p></div>;
}

function Select({ label, value, options, labels = {}, noEmpty = false, wide = false, onChange }: { label: string; value: string; options: string[]; labels?: Record<string, string>; noEmpty?: boolean; wide?: boolean; onChange: (value: string) => void }) {
  return <label className={`osfl-filter ${wide ? 'wide' : ''}`}><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)}>{!noEmpty && <option value="">Todas</option>}{options.map((option) => <option key={option} value={option}>{labels[option] ?? titleCase(option)}</option>)}</select></label>;
}

function SourceBadges({ sources }: { sources: Record<string, boolean> }) {
  const definitions: [string, string][] = [['SII', 'SII'], ['UAF', 'UAF'], ['POTENTIAL_UAF', 'UAF?'], ['19862', '19.862'], ['SANCIONES', 'SAN']];
  const active = definitions.filter(([key]) => sources?.[key]);
  return <div className="osfl-source-badges">{active.length ? active.map(([key, label]) => <span key={key} data-kind={key}>{label}</span>) : <em>Atlas</em>}</div>;
}

function Status({ status }: { status: string | null }) {
  const active = status === 'ACTIVE_AS_PUBLISHED';
  const ended = status === 'TERMINATED_AS_PUBLISHED';
  return <span className="osfl-status" data-tone={active ? 'active' : ended ? 'ended' : 'unknown'}><i />{active ? 'Activa' : ended ? 'Término de giro' : 'Observada'}</span>;
}
function Fact({ label, value, wide = false, alert = false }: { label: string; value: string; wide?: boolean; alert?: boolean }) { return <div className={`osfl-fact ${wide ? 'wide' : ''} ${alert ? 'alert' : ''}`}><span>{label}</span><b>{value}</b></div>; }
function Background({ label, value, meta, alert = false }: { label: string; value: string; meta?: string; alert?: boolean }) { return <div className="osfl-background-row" data-alert={alert}><span>{label}</span><b>{value}</b>{meta && <small>{meta}</small>}</div>; }

function Icon({ name }: { name: string }) {
  const common = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  if (name === 'people') return <svg {...common}><circle cx="9" cy="8" r="3" /><path d="M3 19v-1a5 5 0 0 1 10 0v1" /><circle cx="17" cy="9" r="2.4" /><path d="M15 14.2a4.2 4.2 0 0 1 6 3.8v1" /></svg>;
  if (name === 'bars') return <svg {...common}><path d="M5 20V11M12 20V4M19 20v-7" /><path d="M3 20h18" /></svg>;
  if (name === 'link') return <svg {...common}><path d="M10 13a5 5 0 0 0 7.1.1l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1" /><path d="M14 11a5 5 0 0 0-7.1-.1l-2 2A5 5 0 0 0 12 20l1.1-1.1" /></svg>;
  if (name === 'alert') return <svg {...common}><path d="M12 3 2.7 20h18.6L12 3Z" /><path d="M12 9v4M12 17h.01" /></svg>;
  if (name === 'search') return <svg {...common}><circle cx="11" cy="11" r="6" /><path d="m16 16 4 4" /></svg>;
  if (name === 'target') return <svg {...common}><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /></svg>;
  return <svg {...common}><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></svg>;
}

function formatNumber(value: number | null | undefined) { return new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(Number(value ?? 0)); }
function formatPct(value: number | null | undefined) { return `${Number(value ?? 0).toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`; }
function share(value: number, total: number) { return total ? `${(value / total * 100).toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%` : '0,0%'; }
function compact(value: number) { return new Intl.NumberFormat('es-CL', { notation: 'compact', maximumFractionDigits: 1 }).format(value); }
function money(value: number) { return `$ ${new Intl.NumberFormat('es-CL', { notation: 'compact', maximumFractionDigits: 1 }).format(value)}`; }
function formatDate(value: string | null | undefined) { if (!value) return '—'; const date = new Date(value.length === 10 ? `${value}T12:00:00` : value); return Number.isNaN(+date) ? value : new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: 'short', year: 'numeric' }).format(date); }
function formatDateTime(value: string | null | undefined) { if (!value) return '—'; const date = new Date(value); return Number.isNaN(+date) ? value : new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date); }
function titleCase(value: string) { return value.toLocaleLowerCase('es-CL').replace(/(^|[\s(/-])([a-záéíóúñ])/g, (_, prefix: string, letter: string) => prefix + letter.toLocaleUpperCase('es-CL')); }
function shortRegion(value: string | null) { if (!value) return 'Sin región'; return value.replace('Metropolitana de Santiago', 'Metropolitana').replace('Libertador Gral. Bernardo O’Higgins', "O'Higgins").replace("Libertador Gral. Bernardo O'Higgins", "O'Higgins").replace('Aysén del General Carlos Ibáñez del Campo', 'Aysén').replace('Magallanes y de la Antártica Chilena', 'Magallanes'); }
function statusLabel(value: string | null) { return value === 'ACTIVE_AS_PUBLISHED' ? 'Activa según SII' : value === 'TERMINATED_AS_PUBLISHED' ? 'Término de giro publicado' : value ?? 'Sin estado observable'; }
function pageButtons(page: number, pages: number) { const start = Math.max(0, Math.min(page - 2, pages - 5)); return Array.from({ length: Math.min(5, pages) }, (_, index) => start + index); }
