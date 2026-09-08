import { useEffect, useMemo, useState } from 'react';
import { useDebounced, useRpc } from '../lib/rpc';
import { ErrorBox, Loading } from '../components/primitives';

const PAGE_SIZE = 8;

type Metric = { label: string; count: number; pct?: number };
type SourceMetric = { code: string; label: string; role: string; volume: number; detail: string };
type EvolutionPoint = { year: number; stock: number; starts: number; terminations: number; growth_pct: number | null; eligible: number; observed: number };

type OsflDashboard = {
  error?: string;
  national: {
    official_total: number;
    official_snapshot_date: string | null;
    official_source: string | null;
    official_loaded_rows: number;
    observed: number;
    coverage_pct: number;
    sii_history: number;
    direct_uaf: number;
    potential_uaf: number;
    law19913_bridge: number;
    registro19862: number;
    sanctioned: number;
    public_funds: number;
    with_region: number;
    refreshed_at: string | null;
  };
  sources: SourceMetric[];
  types: Metric[];
  activities: Metric[];
  regions: Metric[];
  evolution: EvolutionPoint[];
  filters: { regions: string[]; activities: string[]; types: string[] };
  semantics: {
    official_universe: string;
    observed_universe: string;
    type_inference: string;
    evolution: string;
  };
};

type OsflRow = {
  entity_id: string;
  rut: string | null;
  name: string;
  type: string;
  region: string | null;
  commune: string | null;
  activity_group: string | null;
  main_activity: string | null;
  status: string | null;
  sources: Record<string, boolean>;
  uaf_class: string | null;
  uaf_label: string | null;
  uaf_sector: string | null;
  public_funds: boolean;
  transfer_count: number;
  transfer_amount_clp: number;
  sanctions: boolean;
  sanction_count: number;
  source_count: number;
  activity_start_date: string | null;
  termination_date: string | null;
};

type OsflSearch = { total: number; limit: number; offset: number; rows: OsflRow[] };
type TimelineEvent = { date: string; label: string; source: string; detail: string | null; kind: string };
type OsflDetail = {
  entity: {
    entity_id: string; rut: string | null; name: string; type: string; region: string | null; commune: string | null;
    activity_group: string | null; main_activity: string | null; status: string | null;
    activity_start_date: string | null; termination_date: string | null; sales_band: string | null;
    size_class: string | null; workers: number | null; source_count: number;
  };
  sources: { SII: boolean; UAF_DIRECT: boolean; UAF_POTENTIAL: boolean; REGISTRO_19862: boolean; SANCIONES: boolean; FONDOS_PUBLICOS: boolean };
  uaf: { class: string | null; label: string | null; sector: string | null; semantics: string | null };
  public_funds: { confirmed: boolean; transfer_count: number; funder_count: number; amount_clp: number; first_date: string | null; last_date: string | null };
  sanctions: { event_count: number; regulator_count: number; first_date: string | null; last_date: string | null; regulators: string[]; amount_uf: number; amount_clp: number };
  economic: { activity_codes: string | null; activity_names: string | null; latest_year: number | null; operational_scale: string | null; workers_band: string | null; sales_percentile: number | null; workers_percentile: number | null; activity_changes: number | null };
  timeline: TimelineEvent[];
  timeline_note: string;
};

type Filters = {
  region: string;
  type: string;
  activity: string;
  source: string;
  uaf: string;
  publicFunds: string;
  sanctions: string;
};

const EMPTY_FILTERS: Filters = { region: '', type: '', activity: '', source: '', uaf: 'TODAS', publicFunds: 'TODOS', sanctions: 'TODAS' };

export function Osfl({ onNavigate }: { onNavigate: (hash: string) => void }) {
  const dashboard = useRpc<OsflDashboard>('obs_osfl_dashboard', {});
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 240);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<'timeline' | 'economic' | 'background'>('timeline');

  const search = useRpc<OsflSearch>('obs_osfl_search', {
    p_q: dq || null,
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
  const detail = useRpc<OsflDetail>('obs_osfl_entity_detail', { p_entity_id: selectedId }, { skip: !selectedId });

  useEffect(() => {
    const rows = search.data?.rows ?? [];
    if (!rows.length) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !rows.some((r) => r.entity_id === selectedId)) setSelectedId(rows[0].entity_id);
  }, [search.data?.rows, selectedId]);

  const setFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(0);
  };
  const reset = () => { setFilters(EMPTY_FILTERS); setQ(''); setPage(0); };
  const focusSource = (source: string) => { setFilters({ ...EMPTY_FILTERS, source }); setPage(0); };

  if (dashboard.loading) return <Loading label="Construyendo panorama nacional de OSFL…" />;
  if (dashboard.error) return <ErrorBox error={dashboard.error} onRetry={dashboard.reload} />;
  if (!dashboard.data || dashboard.data.error) return <ErrorBox error="No fue posible leer el universo OSFL autorizado." onRetry={dashboard.reload} />;

  const d = dashboard.data;
  const nat = d.national;
  const pages = Math.max(1, Math.ceil((search.data?.total ?? 0) / PAGE_SIZE));

  return (
    <div className="osfl-page fade-in">
      <header className="osfl-head">
        <div>
          <div className="osfl-kicker">Organizaciones sin fines de lucro · Chile</div>
          <h1>OSFL <span>|</span> Panorama y caracterización</h1>
          <p>Del universo nacional a la entidad: cobertura, caracterización económica, cruces regulatorios y trayectoria verificable.</p>
        </div>
        <div className="osfl-head-meta">
          <span><b>Corte legal</b>{fmtDate(nat.official_snapshot_date)}</span>
          <span><b>Atlas actualizado</b>{fmtDateTime(nat.refreshed_at)}</span>
        </div>
      </header>

      <Section index="1" title="Contexto nacional" hint="Visión general del universo OSFL en Chile y de la porción individualizada en Atlas.">
        <div className="osfl-context-grid">
          <button className="osfl-hero-card orange" onClick={reset} title={d.semantics.official_universe}>
            <Icon name="people" />
            <span className="label">Universo OSFL Chile</span>
            <strong>{fmt(nat.official_total)}</strong>
            <small>Registro Civil · universo nacional de referencia</small>
          </button>
          <button className="osfl-hero-card blue" onClick={reset} title={d.semantics.observed_universe}>
            <Icon name="bars" />
            <span className="label">Atlas observado</span>
            <strong>{fmt(nat.observed)}</strong>
            <small>Cobertura individualizada · {pct(nat.coverage_pct)}</small>
            <span className="osfl-progress"><i style={{ width: `${Math.min(100, nat.coverage_pct)}%` }} /></span>
          </button>
          <div className="osfl-cross-card">
            <div className="osfl-cross-title"><Icon name="link" /><div><b>Cruces analíticos</b><small>sobre {fmt(nat.observed)} OSFL observadas</small></div></div>
            <button onClick={() => focusSource('SII')}><span>Con historial SII</span><strong>{fmt(nat.sii_history)}</strong><small>{pctOf(nat.sii_history, nat.observed)}</small></button>
            <button onClick={() => focusSource('UAF')}><span>Puente Ley 19.913</span><strong>{fmt(nat.law19913_bridge)}</strong><small>{fmt(nat.direct_uaf)} SO · {fmt(nat.potential_uaf)} potenciales</small></button>
            <button onClick={() => focusSource('19862')}><span>Registro 19.862</span><strong>{fmt(nat.registro19862)}</strong><small>{pctOf(nat.registro19862, nat.observed)}</small></button>
          </div>
          <button className="osfl-alert-card" onClick={() => { setFilters({ ...EMPTY_FILTERS, sanctions: 'SI' }); setPage(0); }}>
            <Icon name="alert" /><div><span>Alertas / señales</span><strong>{fmt(nat.sanctioned)}</strong><small>OSFL con antecedentes sancionatorios</small></div>
          </button>
        </div>
      </Section>

      <Section index="2" title="Fuentes y cobertura" hint="Qué aporta cada fuente y cómo evoluciona el universo individualizado disponible para análisis.">
        <div className="osfl-source-evolution">
          <SourcesTable sources={d.sources} onSource={(code) => code === 'RC' ? undefined : focusSource(code === 'SANC' ? 'SANCIONES' : code)} />
          <EvolutionChart points={d.evolution} officialTotal={nat.official_total} note={d.semantics.evolution} />
        </div>
      </Section>

      <Section index="3" title="Caracterización del universo observado" hint="Distribución de las OSFL individualizadas en Atlas. Cada gráfico funciona como filtro.">
        <div className="osfl-character-grid">
          <TypeDonut data={d.types} total={nat.observed} note={d.semantics.type_inference} active={filters.type} onPick={(v) => setFilter('type', filters.type === v ? '' : v)} />
          <ActivityBars data={d.activities} total={nat.observed} active={filters.activity} onPick={(v) => setFilter('activity', filters.activity === v ? '' : v)} />
          <RegionRanking data={d.regions} total={nat.observed} active={filters.region} onPick={(v) => setFilter('region', filters.region === v ? '' : v)} />
        </div>
      </Section>

      <Section index="4" title="Explorar y caracterizar OSFL" hint="Busque, filtre y seleccione una entidad. La cronología se construye sólo con hitos que tienen fecha verificable.">
        <div className="osfl-explorer-grid">
          <div className="osfl-results-panel">
            <div className="osfl-filterbar">
              <label className="osfl-search"><Icon name="search" /><input value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} placeholder="Buscar por nombre o RUT…" /></label>
              <FilterSelect label="Región" value={filters.region} onChange={(v) => setFilter('region', v)} options={d.filters.regions} />
              <FilterSelect label="Tipo" value={filters.type} onChange={(v) => setFilter('type', v)} options={d.filters.types} />
              <FilterSelect label="Actividad principal (SII)" value={filters.activity} onChange={(v) => setFilter('activity', v)} options={d.filters.activities} wide />
              <FilterSelect label="Fuente" value={filters.source} onChange={(v) => setFilter('source', v)} options={['SII','UAF','19862','SANCIONES']} labels={{ '19862':'Registro 19.862','SANCIONES':'Sanciones' }} />
              <FilterSelect label="Condición UAF" value={filters.uaf} onChange={(v) => setFilter('uaf', v)} options={['TODAS','DIRECTA','POTENCIAL','SIN_PUENTE']} labels={{ TODAS:'Todas', DIRECTA:'SO registrado', POTENCIAL:'Potencial sujeto', SIN_PUENTE:'Sin puente 19.913' }} noEmpty />
              <FilterSelect label="Fondos públicos" value={filters.publicFunds} onChange={(v) => setFilter('publicFunds', v)} options={['TODOS','SI','NO']} labels={{ TODOS:'Todos', SI:'Transferencia confirmada', NO:'Sin transferencia confirmada' }} noEmpty />
              <FilterSelect label="Sanciones" value={filters.sanctions} onChange={(v) => setFilter('sanctions', v)} options={['TODAS','SI','NO']} labels={{ TODAS:'Todas', SI:'Con sanciones', NO:'Sin sanciones' }} noEmpty />
              <button className="osfl-clear" onClick={reset}>Limpiar</button>
            </div>

            <div className="osfl-results-head">
              <div><b>Resultados</b><span>{search.loading ? 'Actualizando…' : `${fmt(search.data?.total ?? 0)} entidades`}</span></div>
              <div className="osfl-page-info">Página {Math.min(page + 1, pages)} de {pages}</div>
            </div>

            <div className="osfl-table-wrap">
              <table className="osfl-table">
                <thead><tr><th>Entidad</th><th>RUT</th><th>Tipo</th><th>Región</th><th>Actividad principal (SII)</th><th>Fuentes</th><th>Estado</th><th /></tr></thead>
                <tbody>
                  {(search.data?.rows ?? []).map((row) => (
                    <tr key={row.entity_id} data-selected={selectedId === row.entity_id} onClick={() => setSelectedId(row.entity_id)}>
                      <td className="entity-name">{row.name}</td>
                      <td className="mono">{row.rut ?? '—'}</td>
                      <td>{row.type}</td>
                      <td>{shortRegion(row.region)}</td>
                      <td className="activity-cell" title={row.main_activity ?? 'Sin actividad principal observable'}>{row.main_activity ? titleCaseLite(row.main_activity) : <em>Sin actividad detallada</em>}</td>
                      <td><SourceBadges sources={row.sources} /></td>
                      <td><StatusPill status={row.status} /></td>
                      <td><button className="osfl-open" onClick={(e) => { e.stopPropagation(); setSelectedId(row.entity_id); }} aria-label="Ver caracterización">›</button></td>
                    </tr>
                  ))}
                  {!search.loading && !(search.data?.rows?.length) && <tr><td colSpan={8} className="osfl-empty">No hay entidades para los filtros seleccionados.</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="osfl-pagination">
              <button disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>‹</button>
              {pageButtons(page, pages).map((p) => <button key={p} data-active={p === page} onClick={() => setPage(p)}>{p + 1}</button>)}
              <button disabled={page + 1 >= pages} onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}>›</button>
            </div>
          </div>

          <QuickEntityPanel detail={detail.data} loading={detail.loading} tab={detailTab} onTab={setDetailTab} onOpen={(id) => onNavigate(`#/entidad/${encodeURIComponent(id)}`)} />
        </div>
      </Section>
    </div>
  );
}

function Section({ index, title, hint, children }: { index: string; title: string; hint: string; children: React.ReactNode }) {
  return <section className="osfl-section"><div className="osfl-section-head"><h2><span>{index}.</span> {title}</h2><p>{hint}</p></div>{children}</section>;
}

function SourcesTable({ sources, onSource }: { sources: SourceMetric[]; onSource: (code: string) => void }) {
  return <div className="osfl-source-card">
    <div className="osfl-card-title"><span>Fuente</span><span>Rol de la fuente</span><span>Volumen</span></div>
    {sources.map((s) => <button key={s.code} className="osfl-source-row" onClick={() => onSource(s.code)} title={s.detail} data-reference={s.code === 'RC'}>
      <span className={`osfl-source-icon src-${s.code.toLowerCase()}`}>{s.code === '19862' ? '19' : s.code.slice(0,3)}</span>
      <b>{s.label}</b><span>{s.role}</span><strong>{fmt(s.volume)}</strong>
    </button>)}
  </div>;
}

function EvolutionChart({ points, officialTotal, note }: { points: EvolutionPoint[]; officialTotal: number; note: string }) {
  if (!points.length) return <div className="osfl-evolution-card"><div className="osfl-card-heading">Evolución del universo OSFL</div><div className="osfl-empty">Sin serie temporal disponible.</div></div>;
  const W = 720, H = 210, L = 48, R = 28, T = 38, B = 35;
  const maxStock = Math.max(...points.map((p) => p.stock), 1);
  const maxStarts = Math.max(...points.map((p) => p.starts), 1);
  const x = (i: number) => L + i * ((W - L - R) / Math.max(1, points.length - 1));
  const yStock = (v: number) => T + (H - T - B) * (1 - v / maxStock);
  const yStarts = (v: number) => T + (H - T - B) * (1 - v / maxStarts);
  const path = points.map((p, i) => `${i ? 'L' : 'M'} ${x(i).toFixed(1)} ${yStock(p.stock).toFixed(1)}`).join(' ');
  const last = points[points.length - 1];
  return <div className="osfl-evolution-card" title={note}>
    <div className="osfl-chart-top"><div><div className="osfl-card-heading">Evolución del universo OSFL</div><small>Stock observable con fecha de inicio válida + nuevos inicios por año</small></div><div className="osfl-reference"><span>Referencia nacional actual</span><b>{fmt(officialTotal)}</b></div></div>
    <div className="osfl-legend"><span className="line orange" />Stock observado <span className="bar blue" />Nuevos inicios/año</div>
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Evolución anual de OSFL observadas">
      {[0,.25,.5,.75,1].map((r) => <g key={r}><line x1={L} x2={W-R} y1={T+(H-T-B)*r} y2={T+(H-T-B)*r} className="gridline" /><text x={L-8} y={T+(H-T-B)*r+4} textAnchor="end" className="axis-label">{compact(Math.round(maxStock*(1-r)))}</text></g>)}
      {points.map((p,i) => <rect key={`b${p.year}`} x={x(i)-6} y={yStarts(p.starts)} width="12" height={H-B-yStarts(p.starts)} rx="3" className="start-bar"><title>{p.year}: {fmt(p.starts)} inicios</title></rect>)}
      <path d={path} className="stock-line" />
      {points.map((p,i) => <g key={p.year}><circle cx={x(i)} cy={yStock(p.stock)} r="4" className="stock-dot"><title>{p.year}: stock {fmt(p.stock)} · {fmt(p.starts)} inicios</title></circle><text x={x(i)} y={H-11} textAnchor="middle" className="axis-label">{p.year}</text></g>)}
      <g transform={`translate(${x(points.length-1)-44} ${Math.max(T+4,yStock(last.stock)-28)})`}><rect width="88" height="23" rx="5" className="last-label-bg" /><text x="44" y="16" textAnchor="middle" className="last-label">{fmt(last.stock)}</text></g>
    </svg>
  </div>;
}

function TypeDonut({ data, total, note, active, onPick }: { data: Metric[]; total: number; note: string; active: string; onPick: (v: string) => void }) {
  const wanted = ['Fundación','Corporación','Asociación'];
  const exact = wanted.map((label) => ({ label, count: data.find((d) => d.label === label)?.count ?? 0 }));
  const rest = Math.max(0, total - exact.reduce((a,b) => a+b.count,0));
  const items = [...exact, { label: 'Otras', count: rest }];
  const colors = ['var(--osfl-orange)','var(--osfl-blue)','var(--osfl-sky)','var(--osfl-muted)'];
  let acc = 0;
  const stops = items.map((it,i) => { const start=acc; acc += total ? (it.count/total)*100 : 0; return `${colors[i]} ${start}% ${acc}%`; }).join(',');
  return <div className="osfl-chart-card type-card" title={note}>
    <div className="osfl-card-heading">Tipos de OSFL observadas <Info /></div>
    <div className="osfl-donut-wrap"><div className="osfl-donut" style={{ background: `conic-gradient(${stops})` }}><div><b>{fmt(total)}</b><span>OSFL</span></div></div>
      <div className="osfl-donut-legend">{items.map((it,i) => <button key={it.label} data-active={active === it.label} onClick={() => it.label !== 'Otras' && onPick(it.label)}><i style={{ background: colors[i] }} /><span>{it.label}</span><b>{pctOf(it.count,total)}</b><small>{fmt(it.count)}</small></button>)}</div>
    </div>
    <div className="osfl-chart-note">Tipología inferida por denominación; el universo legal individualizado aún no está cargado.</div>
  </div>;
}

function ActivityBars({ data, total, active, onPick }: { data: Metric[]; total: number; active: string; onPick: (v: string) => void }) {
  const max = Math.max(...data.map((d) => d.count),1);
  return <div className="osfl-chart-card activity-card"><div className="osfl-card-heading">Principales actividades económicas (SII)</div><div className="osfl-bars-list">
    {data.slice(0,6).map((d) => <button key={d.label} data-active={active===d.label} onClick={() => onPick(d.label)} title={d.label}><span>{titleCaseLite(d.label)}</span><i><b style={{ width: `${(d.count/max)*100}%` }} /></i><strong>{fmt(d.count)}</strong><small>{pctOf(d.count,total)}</small></button>)}
  </div><div className="osfl-chart-note">Sólo se muestran actividades principales observables; el resto mantiene su clasificación de cobertura.</div></div>;
}

function RegionRanking({ data, total, active, onPick }: { data: Metric[]; total: number; active: string; onPick: (v: string) => void }) {
  const rows = data.filter((d) => d.label !== 'Sin región observada').slice(0,5); const max=Math.max(...rows.map((r)=>r.count),1);
  return <div className="osfl-chart-card region-card"><div className="osfl-card-heading">Top 5 regiones <span>(OSFL observadas)</span></div><div className="osfl-region-table"><div className="head"><span>Región</span><span>Cantidad</span><span>%</span><span /></div>
    {rows.map((r) => <button key={r.label} data-active={active===r.label} onClick={() => onPick(r.label)}><span>{shortRegion(r.label)}</span><strong>{fmt(r.count)}</strong><span>{pctOf(r.count,total)}</span><i><b style={{width:`${(r.count/max)*100}%`}} /></i></button>)}
  </div></div>;
}

function QuickEntityPanel({ detail, loading, tab, onTab, onOpen }: { detail: OsflDetail | null; loading: boolean; tab: 'timeline'|'economic'|'background'; onTab: (t:'timeline'|'economic'|'background')=>void; onOpen:(id:string)=>void }) {
  if (loading && !detail) return <aside className="osfl-detail-panel"><div className="osfl-detail-placeholder">Cargando caracterización…</div></aside>;
  if (!detail?.entity) return <aside className="osfl-detail-panel"><div className="osfl-detail-placeholder"><Icon name="target" /><b>Seleccione una OSFL</b><span>La ficha rápida mostrará sus cruces y trayectoria.</span></div></aside>;
  const e=detail.entity;
  return <aside className="osfl-detail-panel">
    <div className="osfl-detail-head"><div><span className="osfl-detail-kicker">Vista rápida de entidad seleccionada</span><h3>{e.name}</h3><p><span className="mono">RUT {e.rut ?? '—'}</span> · {e.type} · {shortRegion(e.region)}</p></div><button onClick={()=>onOpen(e.entity_id)} title="Abrir Entidad 360">↗</button></div>
    <div className="osfl-detail-summary">
      <Fact label="Región" value={shortRegion(e.region)} /><Fact label="Comuna" value={e.commune ?? '—'} /><Fact label="Actividad principal" value={e.main_activity ? titleCaseLite(e.main_activity) : 'Sin actividad detallada'} wide />
    </div>
    <div className="osfl-detail-crosses"><div><span>Fuentes</span><SourceBadges sources={{ SII: detail.sources.SII, UAF: detail.sources.UAF_DIRECT, POTENTIAL_UAF: detail.sources.UAF_POTENTIAL, '19862': detail.sources.REGISTRO_19862, SANCIONES: detail.sources.SANCIONES }} /></div><Fact label="Condición UAF" value={detail.uaf.label ?? 'Sin puente 19.913'} /><Fact label="Fondos públicos" value={detail.public_funds.confirmed ? 'Transferencia confirmada' : detail.sources.REGISTRO_19862 ? 'Presencia Registro 19.862' : 'Sin evidencia confirmada'} /><Fact label="Sanciones" value={detail.sanctions.event_count ? `${fmt(detail.sanctions.event_count)} evento(s)` : 'Sin antecedentes observados'} alert={detail.sanctions.event_count>0} /></div>
    <div className="osfl-detail-tabs"><button data-active={tab==='timeline'} onClick={()=>onTab('timeline')}>Línea de tiempo</button><button data-active={tab==='economic'} onClick={()=>onTab('economic')}>Actividad económica</button><button data-active={tab==='background'} onClick={()=>onTab('background')}>Antecedentes</button></div>
    <div className="osfl-detail-body">
      {tab==='timeline' && <Timeline events={detail.timeline} note={detail.timeline_note} />}
      {tab==='economic' && <div className="osfl-facts-grid"><Fact label="Inicio de actividades" value={fmtDate(e.activity_start_date)} /><Fact label="Estado SII" value={statusLabel(e.status)} /><Fact label="Tramo de ventas" value={e.sales_band ?? '—'} /><Fact label="Tamaño SII" value={e.size_class ?? '—'} /><Fact label="Trabajadores" value={e.workers == null ? '—' : fmt(e.workers)} /><Fact label="Último año" value={detail.economic.latest_year?.toString() ?? '—'} /><Fact label="Giros observados" value={detail.economic.activity_names ? detail.economic.activity_names.split('|').map(s=>titleCaseLite(s.trim())).join(' · ') : '—'} wide /></div>}
      {tab==='background' && <div className="osfl-background"><BackgroundRow label="Ley 19.913" value={detail.uaf.label ?? 'Sin puente identificado'} meta={detail.uaf.sector ?? undefined} /><BackgroundRow label="Registro 19.862" value={detail.sources.REGISTRO_19862 ? 'Presente' : 'Sin coincidencia'} /><BackgroundRow label="Fondos públicos" value={detail.public_funds.confirmed ? `${fmt(detail.public_funds.transfer_count)} transferencias confirmadas` : 'Sin transferencia confirmada en la fuente actual'} meta={detail.public_funds.amount_clp ? money(detail.public_funds.amount_clp) : undefined} /><BackgroundRow label="Sanciones" value={detail.sanctions.event_count ? `${fmt(detail.sanctions.event_count)} evento(s) · ${detail.sanctions.regulators.join(', ')}` : 'Sin antecedentes sancionatorios observados'} alert={detail.sanctions.event_count>0} /></div>}
    </div>
    <button className="osfl-full-button" onClick={()=>onOpen(e.entity_id)}>Abrir ficha completa de la entidad <span>→</span></button>
  </aside>;
}

function Timeline({ events, note }: { events: TimelineEvent[]; note: string }) {
  if (!events.length) return <div className="osfl-no-timeline"><Icon name="clock" /><b>Sin hitos fechados suficientes</b><span>{note}</span></div>;
  return <div><div className="osfl-timeline">{events.map((ev,i)=><div className={`osfl-timeline-event kind-${ev.kind.toLowerCase()}`} key={`${ev.date}-${ev.label}-${i}`}><i /><b>{fmtDate(ev.date)}</b><span>{ev.label}</span><small>{ev.source}{ev.detail ? ` · ${ev.detail}` : ''}</small></div>)}</div><p className="osfl-timeline-note">{note}</p></div>;
}

function FilterSelect({ label, value, onChange, options, labels={}, noEmpty=false, wide=false }: { label:string; value:string; onChange:(v:string)=>void; options:string[]; labels?:Record<string,string>; noEmpty?:boolean; wide?:boolean }) {
  return <label className={`osfl-filter ${wide?'wide':''}`}><span>{label}</span><select value={value} onChange={(e)=>onChange(e.target.value)}>{!noEmpty && <option value="">Todas</option>}{options.map((o)=><option key={o} value={o}>{labels[o] ?? titleCaseLite(o)}</option>)}</select></label>;
}

function SourceBadges({ sources }: { sources: Record<string, boolean> }) {
  const defs=[['SII','SII'],['UAF','UAF'],['POTENTIAL_UAF','UAF?'],['19862','19.862'],['SANCIONES','SAN']];
  const on=defs.filter(([k])=>sources?.[k]);
  return <div className="osfl-source-badges">{on.length ? on.map(([k,l])=><span key={k} data-kind={k}>{l}</span>) : <em>Atlas</em>}</div>;
}

function StatusPill({ status }: { status: string | null }) { const active=status==='ACTIVE_AS_PUBLISHED'; const ended=status==='TERMINATED_AS_PUBLISHED'; return <span className="osfl-status" data-tone={active?'active':ended?'ended':'unknown'}><i />{active?'Activa':ended?'Término de giro':'Observada'}</span>; }
function Fact({label,value,wide=false,alert=false}:{label:string;value:string;wide?:boolean;alert?:boolean}) { return <div className={`osfl-fact ${wide?'wide':''} ${alert?'alert':''}`}><span>{label}</span><b>{value}</b></div>; }
function BackgroundRow({label,value,meta,alert=false}:{label:string;value:string;meta?:string;alert?:boolean}) { return <div className="osfl-background-row" data-alert={alert}><span>{label}</span><b>{value}</b>{meta&&<small>{meta}</small>}</div>; }
function Info(){ return <span className="osfl-info" aria-hidden="true">i</span>; }

function Icon({ name }: { name: string }) {
  const common={ width:20,height:20,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.8,strokeLinecap:'round' as const,strokeLinejoin:'round' as const };
  if(name==='people') return <svg {...common}><circle cx="9" cy="8" r="3"/><path d="M3 19v-1a5 5 0 0 1 10 0v1"/><circle cx="17" cy="9" r="2.4"/><path d="M15 14.2a4.2 4.2 0 0 1 6 3.8v1"/></svg>;
  if(name==='bars') return <svg {...common}><path d="M5 20V11M12 20V4M19 20v-7"/><path d="M3 20h18"/></svg>;
  if(name==='link') return <svg {...common}><path d="M10 13a5 5 0 0 0 7.1.1l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1"/><path d="M14 11a5 5 0 0 0-7.1-.1l-2 2A5 5 0 0 0 12 20l1.1-1.1"/></svg>;
  if(name==='alert') return <svg {...common}><path d="M12 3 2.7 20h18.6L12 3Z"/><path d="M12 9v4M12 17h.01"/></svg>;
  if(name==='search') return <svg {...common}><circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/></svg>;
  if(name==='target') return <svg {...common}><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/></svg>;
  return <svg {...common}><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/></svg>;
}

function fmt(v: number | null | undefined) { return new Intl.NumberFormat('es-CL',{maximumFractionDigits:0}).format(Number(v ?? 0)); }
function pct(v:number|null|undefined){ return `${Number(v ?? 0).toLocaleString('es-CL',{minimumFractionDigits:1,maximumFractionDigits:1})}%`; }
function pctOf(v:number,total:number){ return total ? `${((v/total)*100).toLocaleString('es-CL',{minimumFractionDigits:1,maximumFractionDigits:1})}%` : '0,0%'; }
function compact(v:number){ return new Intl.NumberFormat('es-CL',{notation:'compact',maximumFractionDigits:1}).format(v); }
function money(v:number){ return `$ ${new Intl.NumberFormat('es-CL',{notation:'compact',maximumFractionDigits:1}).format(v)}`; }
function fmtDate(v:string|null|undefined){ if(!v)return '—'; const d=new Date(`${v}`.length===10?`${v}T12:00:00`:v); return Number.isNaN(+d)?v:new Intl.DateTimeFormat('es-CL',{day:'2-digit',month:'short',year:'numeric'}).format(d); }
function fmtDateTime(v:string|null|undefined){ if(!v)return '—'; const d=new Date(v); return Number.isNaN(+d)?v:new Intl.DateTimeFormat('es-CL',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(d); }
function titleCaseLite(v:string){ return v.toLocaleLowerCase('es-CL').replace(/(^|[\s(/-])([a-záéíóúñ])/g,(_,a,b)=>a+b.toLocaleUpperCase('es-CL')); }
function shortRegion(v:string|null){ if(!v)return 'Sin región'; return v.replace('Metropolitana de Santiago','Metropolitana').replace('Libertador Gral. Bernardo O’Higgins',"O'Higgins").replace("Libertador Gral. Bernardo O'Higgins","O'Higgins").replace('Aysén del General Carlos Ibáñez del Campo','Aysén').replace('Magallanes y de la Antártica Chilena','Magallanes'); }
function statusLabel(v:string|null){ return v==='ACTIVE_AS_PUBLISHED'?'Activa según SII':v==='TERMINATED_AS_PUBLISHED'?'Término de giro publicado':v ?? 'Sin estado observable'; }
function pageButtons(page:number,pages:number){ const from=Math.max(0,Math.min(page-2,pages-5)); return Array.from({length:Math.min(5,pages)},(_,i)=>from+i); }
