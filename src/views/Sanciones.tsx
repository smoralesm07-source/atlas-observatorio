import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import '../styles/sanciones.css';

type Overview = {
  event_count: number | null;
  regulatory_sanction_event_count: number | null;
  cgr_enforcement_event_count: number | null;
  entity_key_count: number | null;
  sanctioned_universe_entity_count: number | null;
  events_with_document: number | null;
  events_with_amount_uf: number | null;
  amount_uf_total: number | string | null;
  amount_clp_total: number | string | null;
  first_event_date: string | null;
  last_event_date: string | null;
  refreshed_at: string | null;
};

type SanctionEvent = {
  event_id: string;
  event_date: string | null;
  event_year: number | null;
  regulator: string | null;
  event_class: string | null;
  event_kind: string | null;
  sanction_record: boolean | null;
  entity_id: string | null;
  rut: string | null;
  canonical_name: string | null;
  source_entity_name: string | null;
  identity_status: string | null;
  region: string | null;
  commune: string | null;
  current_condition: string | null;
  is_uaf_registered: boolean | null;
  is_potential_screening: boolean | null;
  uaf_sector: string | null;
  amount_uf: number | string | null;
  amount_clp: number | string | null;
  reason: string | null;
  resolution_ref: string | null;
  document_url: string | null;
  document_quality: string | null;
  in_unified_universe: boolean | null;
};

type Filters = { year: string; regulator: string; sector: string; region: string };
const EMPTY_FILTERS: Filters = { year: '', regulator: '', sector: '', region: '' };
const PAGE = 1000;

export function Sanciones({ onNavigate }: { onNavigate: (hash: string) => void }) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [events, setEvents] = useState<SanctionEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);

  useEffect(() => {
    let cancelled = false;
    async function fetchPaged<T>(table: string, columns: string): Promise<T[]> {
      const all: T[] = [];
      for (let start = 0; ; start += PAGE) {
        const { data, error: pageError } = await supabase.from(table).select(columns).range(start, start + PAGE - 1);
        if (pageError) throw pageError;
        const rows = (data ?? []) as T[];
        all.push(...rows);
        if (rows.length < PAGE) break;
      }
      return all;
    }
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [overviewResult, eventRows] = await Promise.all([
          supabase.from('aml_v_sanctions_overview_current_v0960').select('*').limit(1).maybeSingle(),
          fetchPaged<SanctionEvent>(
            'aml_v_sanctions_radiography_current_v0960',
            'event_id,event_date,event_year,regulator,event_class,event_kind,sanction_record,entity_id,rut,canonical_name,source_entity_name,identity_status,region,commune,current_condition,is_uaf_registered,is_potential_screening,uaf_sector,amount_uf,amount_clp,reason,resolution_ref,document_url,document_quality,in_unified_universe',
          ),
        ]);
        if (overviewResult.error) throw overviewResult.error;
        if (!cancelled) {
          setOverview((overviewResult.data ?? null) as Overview | null);
          setEvents(eventRows);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'No fue posible cargar el universo sancionatorio.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [reloadKey]);

  const options = useMemo(() => ({
    years: unique(events.map((e) => e.event_year).filter((v): v is number => v != null)).sort((a, b) => b - a),
    regulators: unique(events.map((e) => clean(e.regulator)).filter(Boolean)).sort(),
    sectors: unique(events.map((e) => sectorOf(e)).filter(Boolean)).sort(),
    regions: unique(events.map((e) => regionOf(e)).filter(Boolean)).sort(),
  }), [events]);

  const filtered = useMemo(() => events.filter((e) => {
    if (filters.year && String(e.event_year ?? '') !== filters.year) return false;
    if (filters.regulator && clean(e.regulator) !== filters.regulator) return false;
    if (filters.sector && sectorOf(e) !== filters.sector) return false;
    if (filters.region && regionOf(e) !== filters.region) return false;
    return true;
  }), [events, filters]);

  const stats = useMemo(() => deriveStats(filtered), [filtered]);
  const regulatorRows = useMemo(() => deriveRegulators(filtered), [filtered]);
  const regionRows = useMemo(() => deriveRegions(filtered), [filtered]);
  const sectorRows = useMemo(() => deriveSectors(filtered), [filtered]);
  const yearRows = useMemo(() => deriveYears(filtered), [filtered]);
  const costly = useMemo(() => [...filtered].filter((e) => num(e.amount_uf) > 0).sort((a, b) => num(b.amount_uf) - num(a.amount_uf)).slice(0, 5), [filtered]);
  const recent = useMemo(() => [...filtered].sort((a, b) => dateValue(b.event_date) - dateValue(a.event_date)).slice(0, 5), [filtered]);
  const recent50 = useMemo(() => [...filtered].sort((a, b) => dateValue(b.event_date) - dateValue(a.event_date)).slice(0, 50), [filtered]);

  function setFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
  }
  function toggleFilter(key: 'regulator' | 'sector' | 'region', value: string) {
    setFilters((current) => ({ ...current, [key]: current[key] === value ? '' : value }));
  }

  if (loading) return <div className="sanctions-state"><span className="sanctions-spinner" />Construyendo inteligencia sancionatoria…</div>;
  if (error) return <div className="sanctions-state sanctions-error"><b>No fue posible abrir Sanciones</b><span>{error}</span><button onClick={() => setReloadKey((x) => x + 1)}>Reintentar</button></div>;

  const refreshed = overview?.refreshed_at;
  const anyFilter = Object.values(filters).some(Boolean);

  return <div className="sanctions-page fade-in">
    <header className="sanctions-head">
      <div>
        <div className="sanctions-kicker">INTELIGENCIA ADMINISTRATIVA · FUENTES ABIERTAS</div>
        <h1>Sanciones <span>|</span> Administrative Sanctions Intelligence</h1>
        <p>Lectura transversal de eventos sancionatorios y de enforcement. Supervisores, entidades, territorio, sectores, montos y recurrencia en una sola vista.</p>
      </div>
      <div className="sanctions-cut"><b>Corte ATLAS</b><span>{formatDateTime(refreshed)}</span><small>{fmt(overview?.event_count)} eventos en el read model</small></div>
    </header>

    <section className="sanctions-filterbar" aria-label="Filtros globales de sanciones">
      <Filter label="Año" value={filters.year} onChange={(v) => setFilter('year', v)} options={options.years.map(String)} />
      <Filter label="Institución" value={filters.regulator} onChange={(v) => setFilter('regulator', v)} options={options.regulators} />
      <Filter label="Industria / sector UAF" value={filters.sector} onChange={(v) => setFilter('sector', v)} options={options.sectors} />
      <Filter label="Región" value={filters.region} onChange={(v) => setFilter('region', v)} options={options.regions} />
      <button className="sanctions-clear" disabled={!anyFilter} onClick={() => setFilters(EMPTY_FILTERS)}>Limpiar filtros</button>
    </section>

    <section className="sanctions-kpis">
      <Kpi label="Eventos visibles" value={fmt(stats.events)} hint={anyFilter ? `de ${fmt(events.length)} en el universo` : `${fmt(overview?.regulatory_sanction_event_count)} sanciones regulatorias`} />
      <Kpi label="Entidades afectadas" value={fmt(stats.entities)} hint={`${fmt(stats.resolvedEntities)} vinculadas al universo ATLAS`} />
      <Kpi label="Instituciones" value={fmt(stats.regulators)} hint={stats.topRegulator ? `mayor volumen: ${stats.topRegulator}` : 'sin eventos'} />
      <Kpi label="Monto observable" value={`${fmtUf(stats.amountUf)} UF`} hint={`${fmt(stats.withAmount)} eventos con monto UF`} emphasis />
      <Kpi label="Documentación" value={pct(stats.withDocument, stats.events)} hint="casos con documento enlazado" />
    </section>

    <section className="sanctions-block">
      <SectionHead index="A" title="Actores clave" subtitle="Qué instituciones concentran actividad, cuántas entidades alcanzan y cómo evoluciona su presencia." />
      <div className="sanctions-split wide-left">
        <article className="sanctions-panel">
          <PanelHead title="Instituciones supervisoras" meta={`${fmt(regulatorRows.length)} instituciones en el corte`} />
          <div className="sanctions-table-wrap">
            <table className="sanctions-table">
              <thead><tr><th>Institución</th><th>Eventos</th><th>Entidades</th><th>Años activos</th><th>Último caso</th><th>UF observadas</th></tr></thead>
              <tbody>{regulatorRows.map((r) => <tr key={r.regulator} data-active={filters.regulator === r.regulator} onClick={() => toggleFilter('regulator', r.regulator)}>
                <td><b>{r.regulator}</b></td><td>{fmt(r.events)}</td><td>{fmt(r.entities)}</td><td>{fmt(r.years)}</td><td>{formatDate(r.lastDate)}</td><td>{fmtUf(r.amountUf)}</td>
              </tr>)}</tbody>
            </table>
          </div>
        </article>
        <article className="sanctions-panel sanctions-focus">
          <PanelHead title="Lectura rápida" meta="sobre el filtro actual" />
          <Focus label="Institución dominante" value={stats.topRegulator || '—'} sub={stats.topRegulator ? `${fmt(stats.topRegulatorCount)} eventos` : 'Sin datos'} />
          <Focus label="Industria más observada" value={stats.topSector || 'Sin sector UAF'} sub={stats.topSector ? `${fmt(stats.topSectorCount)} eventos` : 'Cobertura sectorial incompleta'} />
          <Focus label="Región más observada" value={stats.topRegion || 'Sin región'} sub={stats.topRegion ? `${fmt(stats.topRegionCount)} eventos` : 'Territorio no resuelto'} />
          <Focus label="Último evento" value={formatDate(stats.lastDate)} sub={stats.lastEntity || 'Sin entidad identificada'} />
        </article>
      </div>
    </section>

    <section className="sanctions-block">
      <SectionHead index="B" title="Matriz territorial" subtitle="Distribución regional de eventos, entidades y montos. Selecciona una región para cruzar toda la vista." />
      <article className="sanctions-panel">
        <div className="sanctions-region-grid">
          {regionRows.map((r) => {
            const max = Math.max(...regionRows.map((x) => x.events), 1);
            return <button key={r.region} className="sanctions-region-row" data-active={filters.region === r.region} onClick={() => toggleFilter('region', r.region)}>
              <span className="region-name">{r.region}</span>
              <span className="region-bar"><i style={{ width: `${Math.max(4, (r.events / max) * 100)}%` }} /></span>
              <b>{fmt(r.events)}</b><small>{fmt(r.entities)} entidades</small><em>{fmtUf(r.amountUf)} UF</em>
            </button>;
          })}
        </div>
      </article>
    </section>

    <section className="sanctions-block">
      <SectionHead index="C" title="Rigor e intensidad regulatoria" subtitle="El IER del Workbench no forma parte del read model actual de Atlas. Se muestra intensidad monetaria observable (UF) y tendencia, sin tratarlas como equivalentes." />
      <div className="sanctions-split">
        <article className="sanctions-panel">
          <PanelHead title="Intensidad por institución" meta="sólo eventos con monto UF" />
          <div className="sanctions-rigor-list">{regulatorRows.map((r) => {
            const maxAvg = Math.max(...regulatorRows.map((x) => x.avgUf), 1);
            return <button key={r.regulator} data-active={filters.regulator === r.regulator} onClick={() => toggleFilter('regulator', r.regulator)}>
              <span><b>{r.regulator}</b><small>{fmtUf(r.avgUf)} UF promedio</small></span>
              <span className="rigor-track"><i style={{ width: `${Math.max(r.avgUf ? 5 : 0, (r.avgUf / maxAvg) * 100)}%` }} /></span>
              <em>{trendLabel(r.trend)}</em>
            </button>;
          })}</div>
        </article>
        <article className="sanctions-panel">
          <PanelHead title="Comparador de intensidad" meta={`media general ${fmtUf(stats.avgUf)} UF`} />
          <table className="sanctions-table compact"><thead><tr><th>Institución</th><th>UF media</th><th>% casos &gt; media</th><th>Tendencia</th><th>Más reciente</th></tr></thead>
            <tbody>{regulatorRows.map((r) => <tr key={r.regulator} onClick={() => toggleFilter('regulator', r.regulator)}><td><b>{r.regulator}</b></td><td>{fmtUf(r.avgUf)}</td><td>{pct(r.aboveAverage, r.withAmount)}</td><td>{trendLabel(r.trend)}</td><td>{formatDate(r.lastDate)}</td></tr>)}</tbody>
          </table>
        </article>
      </div>
    </section>

    <section className="sanctions-block">
      <SectionHead index="D" title="Cobertura de enforcement" subtitle="Cruce entre industria y evolución temporal para distinguir concentración estructural de episodios puntuales." />
      <div className="sanctions-split">
        <article className="sanctions-panel">
          <PanelHead title="Industrias / sectores" meta="clic para filtrar" />
          <RankBars rows={sectorRows.slice(0, 12).map((r) => ({ label: r.sector, value: r.events, sub: `${fmt(r.entities)} entidades` }))} active={filters.sector} onPick={(v) => toggleFilter('sector', v)} />
        </article>
        <article className="sanctions-panel">
          <PanelHead title="Evolución anual" meta={`${yearRows.length ? yearRows[yearRows.length - 1].year : '—'} último año con casos`} />
          <div className="sanctions-years">{yearRows.map((r) => {
            const max = Math.max(...yearRows.map((x) => x.events), 1);
            return <button key={r.year} data-active={filters.year === String(r.year)} onClick={() => setFilter('year', filters.year === String(r.year) ? '' : String(r.year))} title={`${r.year}: ${r.events} eventos`}>
              <span><i style={{ height: `${Math.max(5, (r.events / max) * 100)}%` }} /></span><b>{r.events}</b><small>{String(r.year).slice(-2)}</small>
            </button>;
          })}</div>
          <div className="sanctions-legend">{regulatorRows.map((r) => <button key={r.regulator} data-active={filters.regulator === r.regulator} onClick={() => toggleFilter('regulator', r.regulator)}>{r.regulator} · {fmt(r.events)}</button>)}</div>
        </article>
      </div>
    </section>

    <section className="sanctions-block">
      <SectionHead index="E" title="Casos prioritarios" subtitle="Rankings calculados sobre valores numéricos antes de formatear. Los filtros globales también aplican aquí." />
      <div className="sanctions-split">
        <TopCases title="Top 5 · mayor monto UF" rows={costly} metric={(e) => `${fmtUf(num(e.amount_uf))} UF`} onNavigate={onNavigate} />
        <TopCases title="Top 5 · más recientes" rows={recent} metric={(e) => formatDate(e.event_date)} onNavigate={onNavigate} />
      </div>
    </section>

    <section className="sanctions-block">
      <SectionHead index="F" title="Casos recientes" subtitle="Hasta 50 eventos ordenados cronológicamente. Los documentos oficiales se abren en una pestaña separada." />
      <article className="sanctions-panel">
        <div className="sanctions-table-wrap recent">
          <table className="sanctions-table"><thead><tr><th>Fecha</th><th>Entidad</th><th>Institución</th><th>Sector</th><th>Región</th><th>Monto UF</th><th>Hecho</th><th>Documento</th></tr></thead>
            <tbody>{recent50.map((e) => <tr key={e.event_id}>
              <td>{formatDate(e.event_date)}</td>
              <td>{e.entity_id ? <button className="sanctions-entity-link" onClick={() => onNavigate(`#/entidad/${encodeURIComponent(e.entity_id!)}`)}>{entityName(e)}</button> : <b>{entityName(e)}</b>}<small className="cell-sub">{e.rut || e.identity_status || ''}</small></td>
              <td><button className="sanctions-chip" onClick={() => toggleFilter('regulator', clean(e.regulator))}>{clean(e.regulator) || '—'}</button></td>
              <td><button className="sanctions-chip" onClick={() => toggleFilter('sector', sectorOf(e))}>{sectorOf(e)}</button></td>
              <td>{regionOf(e)}</td><td>{num(e.amount_uf) > 0 ? fmtUf(num(e.amount_uf)) : '—'}</td>
              <td className="reason-cell" title={e.reason || e.event_kind || ''}>{e.reason || e.event_kind || e.event_class || '—'}</td>
              <td>{e.document_url ? <a className="sanctions-doc" href={e.document_url} target="_blank" rel="noreferrer">Abrir ↗</a> : <span className="muted">No disponible</span>}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </article>
    </section>

    <footer className="sanctions-foot">
      <b>Regla de lectura</b><span>Ausencia de monto, RUT, sector, territorio o documento no se transforma en cero ni en señal adversa. La vista conserva los faltantes como “no observable”.</span>
    </footer>
  </div>;
}

function Filter({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return <label className="sanctions-filter"><span>{label}</span><select value={value} onChange={(e) => onChange(e.target.value)}><option value="">Todos</option>{options.map((o) => <option key={o} value={o}>{o}</option>)}</select></label>;
}
function Kpi({ label, value, hint, emphasis = false }: { label: string; value: string; hint: string; emphasis?: boolean }) {
  return <article className="sanctions-kpi" data-emphasis={emphasis}><span>{label}</span><strong>{value}</strong><small>{hint}</small></article>;
}
function SectionHead({ index, title, subtitle }: { index: string; title: string; subtitle: string }) {
  return <div className="sanctions-section-head"><span>{index}</span><div><h2>{title}</h2><p>{subtitle}</p></div></div>;
}
function PanelHead({ title, meta }: { title: string; meta: string }) { return <div className="sanctions-panel-head"><b>{title}</b><span>{meta}</span></div>; }
function Focus({ label, value, sub }: { label: string; value: string; sub: string }) { return <div className="sanctions-focus-row"><span>{label}</span><b>{value}</b><small>{sub}</small></div>; }
function RankBars({ rows, active, onPick }: { rows: { label: string; value: number; sub: string }[]; active: string; onPick: (value: string) => void }) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return <div className="sanctions-rank-bars">{rows.map((r) => <button key={r.label} data-active={active === r.label} onClick={() => onPick(r.label)}><span><b>{r.label}</b><small>{r.sub}</small></span><span className="rank-track"><i style={{ width: `${Math.max(5, (r.value / max) * 100)}%` }} /></span><em>{fmt(r.value)}</em></button>)}</div>;
}
function TopCases({ title, rows, metric, onNavigate }: { title: string; rows: SanctionEvent[]; metric: (e: SanctionEvent) => string; onNavigate: (hash: string) => void }) {
  return <article className="sanctions-panel"><PanelHead title={title} meta={`${rows.length} casos`} /><ol className="sanctions-top-list">{rows.map((e) => <li key={e.event_id}><span>{e.regulator || '—'}</span><div>{e.entity_id ? <button onClick={() => onNavigate(`#/entidad/${encodeURIComponent(e.entity_id!)}`)}>{entityName(e)}</button> : <b>{entityName(e)}</b>}<small>{sectorOf(e)} · {formatDate(e.event_date)}</small></div><strong>{metric(e)}</strong></li>)}</ol></article>;
}

function deriveStats(rows: SanctionEvent[]) {
  const entityKeys = new Set(rows.map((e) => e.entity_id || e.rut || clean(e.canonical_name) || clean(e.source_entity_name)).filter(Boolean));
  const resolved = new Set(rows.filter((e) => e.in_unified_universe).map((e) => e.entity_id || e.rut).filter(Boolean));
  const regulators = new Map<string, number>(); const sectors = new Map<string, number>(); const regions = new Map<string, number>();
  let amountUf = 0; let withAmount = 0; let withDocument = 0;
  rows.forEach((e) => { countMap(regulators, clean(e.regulator) || 'Sin institución'); countMap(sectors, sectorOf(e)); countMap(regions, regionOf(e)); const v = num(e.amount_uf); if (v > 0) { amountUf += v; withAmount += 1; } if (e.document_url) withDocument += 1; });
  const topReg = topMap(regulators), topSector = topMap(sectors), topRegion = topMap(regions);
  const newest = [...rows].sort((a, b) => dateValue(b.event_date) - dateValue(a.event_date))[0];
  return { events: rows.length, entities: entityKeys.size, resolvedEntities: resolved.size, regulators: regulators.size, amountUf, withAmount, withDocument, avgUf: withAmount ? amountUf / withAmount : 0, topRegulator: topReg[0], topRegulatorCount: topReg[1], topSector: topSector[0], topSectorCount: topSector[1], topRegion: topRegion[0], topRegionCount: topRegion[1], lastDate: newest?.event_date ?? null, lastEntity: newest ? entityName(newest) : null };
}
function deriveRegulators(rows: SanctionEvent[]) {
  const overallPositive = rows.map((e) => num(e.amount_uf)).filter((v) => v > 0); const overallAvg = overallPositive.length ? overallPositive.reduce((a, b) => a + b, 0) / overallPositive.length : 0;
  const groups = new Map<string, SanctionEvent[]>(); rows.forEach((e) => { const key = clean(e.regulator) || 'Sin institución'; groups.set(key, [...(groups.get(key) ?? []), e]); });
  return [...groups.entries()].map(([regulator, ev]) => { const positives = ev.map((e) => num(e.amount_uf)).filter((v) => v > 0); const byYear = new Map<number, number[]>(); ev.forEach((e) => { if (e.event_year && num(e.amount_uf) > 0) byYear.set(e.event_year, [...(byYear.get(e.event_year) ?? []), num(e.amount_uf)]); }); const points = [...byYear.entries()].sort((a, b) => a[0] - b[0]).map(([year, vals]) => [year, vals.reduce((a, b) => a + b, 0) / vals.length] as [number, number]); return { regulator, events: ev.length, entities: new Set(ev.map((e) => e.entity_id || e.rut || entityName(e))).size, years: new Set(ev.map((e) => e.event_year).filter(Boolean)).size, lastDate: [...ev].sort((a, b) => dateValue(b.event_date) - dateValue(a.event_date))[0]?.event_date ?? null, amountUf: positives.reduce((a, b) => a + b, 0), avgUf: positives.length ? positives.reduce((a, b) => a + b, 0) / positives.length : 0, withAmount: positives.length, aboveAverage: positives.filter((v) => overallAvg > 0 && v > overallAvg).length, trend: slope(points) }; }).sort((a, b) => b.events - a.events || dateValue(b.lastDate) - dateValue(a.lastDate));
}
function deriveRegions(rows: SanctionEvent[]) { const groups = new Map<string, SanctionEvent[]>(); rows.forEach((e) => { const k = regionOf(e); groups.set(k, [...(groups.get(k) ?? []), e]); }); return [...groups.entries()].map(([region, ev]) => ({ region, events: ev.length, entities: new Set(ev.map((e) => e.entity_id || e.rut || entityName(e))).size, amountUf: ev.reduce((s, e) => s + Math.max(0, num(e.amount_uf)), 0) })).sort((a, b) => b.events - a.events); }
function deriveSectors(rows: SanctionEvent[]) { const groups = new Map<string, SanctionEvent[]>(); rows.forEach((e) => { const k = sectorOf(e); groups.set(k, [...(groups.get(k) ?? []), e]); }); return [...groups.entries()].map(([sector, ev]) => ({ sector, events: ev.length, entities: new Set(ev.map((e) => e.entity_id || e.rut || entityName(e))).size })).sort((a, b) => b.events - a.events); }
function deriveYears(rows: SanctionEvent[]) { const m = new Map<number, number>(); rows.forEach((e) => { if (e.event_year) m.set(e.event_year, (m.get(e.event_year) ?? 0) + 1); }); return [...m.entries()].map(([year, events]) => ({ year, events })).sort((a, b) => a.year - b.year); }

function sectorOf(e: SanctionEvent) { return clean(e.uaf_sector) || clean(e.current_condition) || 'Sin sector UAF'; }
function regionOf(e: SanctionEvent) { return clean(e.region) || 'Sin región resuelta'; }
function entityName(e: SanctionEvent) { return clean(e.canonical_name) || clean(e.source_entity_name) || 'Entidad no resuelta'; }
function clean(v: string | null | undefined) { return (v ?? '').trim(); }
function num(v: number | string | null | undefined) { const n = typeof v === 'number' ? v : Number(v ?? 0); return Number.isFinite(n) ? n : 0; }
function unique<T>(values: T[]) { return [...new Set(values)]; }
function countMap(map: Map<string, number>, key: string) { map.set(key, (map.get(key) ?? 0) + 1); }
function topMap(map: Map<string, number>): [string, number] { return [...map.entries()].sort((a, b) => b[1] - a[1])[0] ?? ['', 0]; }
function dateValue(v: string | null | undefined) { const n = v ? new Date(`${v}T00:00:00`).getTime() : 0; return Number.isFinite(n) ? n : 0; }
function formatDate(v: string | null | undefined) { if (!v) return '—'; const d = new Date(`${v.slice(0, 10)}T12:00:00`); return Number.isNaN(d.getTime()) ? '—' : new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: 'short', year: 'numeric' }).format(d); }
function formatDateTime(v: string | null | undefined) { if (!v) return 'Sin fecha'; const d = new Date(v); return Number.isNaN(d.getTime()) ? 'Sin fecha' : new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d); }
function fmt(v: number | string | null | undefined) { return new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(num(v)); }
function fmtUf(v: number | string | null | undefined) { const n = num(v); return new Intl.NumberFormat('es-CL', { maximumFractionDigits: n >= 1000 ? 0 : 1 }).format(n); }
function pct(part: number, total: number) { if (!total) return '0%'; return `${new Intl.NumberFormat('es-CL', { maximumFractionDigits: 1 }).format((part / total) * 100)}%`; }
function slope(points: [number, number][]) { if (points.length < 2) return 0; const xm = points.reduce((s, p) => s + p[0], 0) / points.length; const ym = points.reduce((s, p) => s + p[1], 0) / points.length; const den = points.reduce((s, p) => s + (p[0] - xm) ** 2, 0); if (!den) return 0; return points.reduce((s, p) => s + (p[0] - xm) * (p[1] - ym), 0) / den; }
function trendLabel(v: number) { if (v > 0.05) return 'aumentó'; if (v < -0.05) return 'disminuyó'; return 'neutral'; }
