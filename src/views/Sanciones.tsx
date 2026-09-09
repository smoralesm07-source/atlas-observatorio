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
  entity_key?: string | null;
  rut: string | null;
  canonical_name: string | null;
  source_entity_name: string | null;
  identity_status: string | null;
  identity_method?: string | null;
  identity_confidence?: number | string | null;
  region: string | null;
  commune: string | null;
  territory_basis?: string | null;
  current_condition: string | null;
  condition_basis?: string | null;
  is_uaf_registered: boolean | null;
  is_potential_screening: boolean | null;
  uaf_sector: string | null;
  amount_uf: number | string | null;
  amount_clp: number | string | null;
  reason: string | null;
  resolution_ref: string | null;
  evidence_id?: string | null;
  document_url: string | null;
  document_quality: string | null;
  document_excerpt?: string | null;
  cgr_stage?: string | null;
  cgr_risk_family?: string | null;
  cgr_severity?: string | null;
  in_sii_registry?: boolean | null;
  in_uaf_registry?: boolean | null;
  in_osfl_registry?: boolean | null;
  in_unified_universe: boolean | null;
};

type Filters = { year: string; regulator: string; sector: string };
type ActorSummary = {
  key: string;
  name: string;
  rut: string;
  events: number;
  amountUf: number;
  lastDate: string | null;
  regulator: string;
  sector: string;
  region: string;
  entityId: string | null;
  rows: SanctionEvent[];
};

type RegulatorSummary = {
  regulator: string;
  events: number;
  entities: number;
  years: number;
  amountUf: number;
  lastDate: string | null;
};

type RegionSummary = {
  region: string;
  events: number;
  entities: number;
  amountUf: number;
};

const EMPTY_FILTERS: Filters = { year: '', regulator: '', sector: '' };
const PAGE = 1000;
const SOURCE_NAMES: Record<string, string> = {
  CMF: 'Comisión para el Mercado Financiero',
  UAF: 'Unidad de Análisis Financiero',
  SCJ: 'Superintendencia de Casinos de Juego',
  CGR: 'Contraloría General de la República',
};

export function Sanciones({ onNavigate }: { onNavigate: (hash: string) => void }) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [events, setEvents] = useState<SanctionEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [query, setQuery] = useState('');
  const [selectedRegion, setSelectedRegion] = useState<string | null>(null);
  const [selectedActor, setSelectedActor] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchPaged<T>(table: string): Promise<T[]> {
      const all: T[] = [];
      for (let start = 0; ; start += PAGE) {
        const { data, error: pageError } = await supabase
          .from(table)
          .select('*')
          .order('event_date', { ascending: false, nullsFirst: false })
          .range(start, start + PAGE - 1);
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
          fetchPaged<SanctionEvent>('aml_v_sanctions_radiography_current_v0960'),
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
  }), [events]);

  const globalRows = useMemo(() => events.filter((e) => {
    if (filters.year && String(e.event_year ?? '') !== filters.year) return false;
    if (filters.regulator && clean(e.regulator) !== filters.regulator) return false;
    if (filters.sector && sectorOf(e) !== filters.sector) return false;
    return true;
  }), [events, filters]);

  useEffect(() => {
    if (selectedRegion && !globalRows.some((e) => regionOf(e) === selectedRegion)) {
      setSelectedRegion(null);
      setSelectedActor(null);
    }
  }, [globalRows, selectedRegion]);

  const regionScopedRows = useMemo(
    () => selectedRegion ? globalRows.filter((e) => regionOf(e) === selectedRegion) : globalRows,
    [globalRows, selectedRegion],
  );

  useEffect(() => {
    if (selectedActor && !regionScopedRows.some((e) => actorKey(e) === selectedActor)) setSelectedActor(null);
  }, [regionScopedRows, selectedActor]);

  const visibleRows = useMemo(
    () => selectedActor ? regionScopedRows.filter((e) => actorKey(e) === selectedActor) : regionScopedRows,
    [regionScopedRows, selectedActor],
  );

  const stats = useMemo(() => deriveStats(visibleRows), [visibleRows]);
  const regulatorRows = useMemo(() => deriveRegulators(globalRows), [globalRows]);
  const regionRows = useMemo(() => deriveRegions(globalRows), [globalRows]);
  const regionalActors = useMemo(() => deriveActors(regionScopedRows).slice(0, 2), [regionScopedRows]);
  const selectedActorSummary = useMemo(
    () => selectedActor ? deriveActors(regionScopedRows).find((a) => a.key === selectedActor) ?? null : null,
    [regionScopedRows, selectedActor],
  );
  const searchResults = useMemo(() => {
    const q = normalize(query);
    if (q.length < 2) return [] as ActorSummary[];
    return deriveActors(globalRows.filter((e) => normalize([
      actorName(e), e.rut, e.reason, e.resolution_ref, e.regulator, e.uaf_sector, e.region,
    ].filter(Boolean).join(' ')).includes(q))).slice(0, 6);
  }, [globalRows, query]);

  const costly = useMemo(
    () => [...visibleRows].filter((e) => num(e.amount_uf) > 0).sort((a, b) => num(b.amount_uf) - num(a.amount_uf)).slice(0, 5),
    [visibleRows],
  );
  const recent = useMemo(
    () => [...visibleRows].sort((a, b) => dateValue(b.event_date) - dateValue(a.event_date)).slice(0, 5),
    [visibleRows],
  );
  const recent50 = useMemo(
    () => [...visibleRows].sort((a, b) => dateValue(b.event_date) - dateValue(a.event_date)).slice(0, 50),
    [visibleRows],
  );
  const quality = useMemo(() => deriveQuality(visibleRows), [visibleRows]);
  const years = useMemo(() => deriveYears(visibleRows), [visibleRows]);

  function setFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
    setSelectedRegion(null);
    setSelectedActor(null);
  }

  function toggleRegulator(value: string) {
    setFilter('regulator', filters.regulator === value ? '' : value);
  }

  function chooseRegion(region: string) {
    const next = selectedRegion === region ? null : region;
    setSelectedRegion(next);
    setSelectedActor(null);
  }

  function chooseActor(actor: ActorSummary) {
    if (actor.region && actor.region !== 's/i') setSelectedRegion(actor.region);
    setSelectedActor(actor.key);
  }

  function clearAll() {
    setFilters(EMPTY_FILTERS);
    setSelectedRegion(null);
    setSelectedActor(null);
    setQuery('');
  }

  if (loading) return <div className="sanctions-state"><span className="sanctions-spinner" />Construyendo inteligencia sancionatoria…</div>;
  if (error) return <div className="sanctions-state sanctions-error"><b>No fue posible abrir Sanciones</b><span>{error}</span><button onClick={() => setReloadKey((x) => x + 1)}>Reintentar</button></div>;

  const anyContext = Boolean(filters.year || filters.regulator || filters.sector || selectedRegion || selectedActor || query);
  const maxRegion = Math.max(...regionRows.map((r) => r.events), 1);
  const maxYear = Math.max(...years.map((r) => r.events), 1);

  return <div className="sanctions-v12 fade-in" data-sanctions-v12-root="true">
    <header className="san12-head">
      <div className="san12-title">
        <span className="san12-kicker">RADAR SANCIONATORIO · FUENTES ABIERTAS</span>
        <h1>Sanciones</h1>
        <p>Lectura integrada de sanciones administrativas y acciones de enforcement, con filtros globales y profundización progresiva por territorio y actor.</p>
      </div>
      <div className="san12-cut">
        <span>Corte ATLAS</span>
        <b>{formatDateTime(overview?.refreshed_at)}</b>
        <small>{fmt(overview?.event_count ?? events.length)} eventos en el read model</small>
      </div>
    </header>

    <section className="san12-command" aria-label="Filtros globales">
      <Filter label="Año" value={filters.year} onChange={(v) => setFilter('year', v)} options={options.years.map(String)} />
      <Filter label="Institución" value={filters.regulator} onChange={(v) => setFilter('regulator', v)} options={options.regulators} />
      <Filter label="Industria" value={filters.sector} onChange={(v) => setFilter('sector', v)} options={options.sectors} />
      <button className="san12-clear" disabled={!anyContext} onClick={clearAll}>Limpiar filtros</button>
    </section>

    <section className="san12-kpis">
      <Kpi label="Eventos" value={fmt(stats.events)} hint={selectedRegion ? `corte: ${selectedRegion}` : `${fmt(globalRows.length)} bajo filtros globales`} />
      <Kpi label="Entidades" value={fmt(stats.entities)} hint={`${fmt(stats.resolvedEntities)} con identidad enlazable`} />
      <Kpi label="Instituciones" value={fmt(stats.regulators)} hint={stats.topRegulator ? `mayor volumen: ${stats.topRegulator}` : 's/i'} />
      <Kpi label="Monto observable" value={`${fmtUf(stats.amountUf)} UF`} hint={`${fmt(stats.withAmount)} eventos con monto UF`} emphasis />
    </section>

    <section className="san12-searchbox">
      <div>
        <span>BÚSQUEDA DIRECTA</span>
        <b>Entidad, RUT, motivo o resolución</b>
      </div>
      <label>
        <input value={query} onChange={(e) => setQuery(e.target.value)} type="search" autoComplete="off" placeholder="Buscar en el corte actual…" />
        <span aria-hidden="true">⌕</span>
      </label>
      {query.trim().length >= 2 && <div className="san12-search-results">
        {searchResults.length ? searchResults.map((actor) => <button key={actor.key} onClick={() => chooseActor(actor)}>
          <span><b>{actor.name}</b><small>{actor.rut !== 's/i' ? actor.rut : actor.sector}</small></span>
          <em>{fmt(actor.events)} eventos</em>
        </button>) : <div className="san12-empty-inline">Sin coincidencias en los filtros actuales.</div>}
      </div>}
    </section>

    {(selectedRegion || selectedActor) && <div className="san12-contextbar">
      <span>Profundización activa</span>
      {selectedRegion && <button onClick={() => { setSelectedRegion(null); setSelectedActor(null); }}>Región · {selectedRegion} ×</button>}
      {selectedActorSummary && <button onClick={() => setSelectedActor(null)}>Actor · {selectedActorSummary.name} ×</button>}
      <button className="san12-back" onClick={() => selectedActor ? setSelectedActor(null) : chooseRegion(selectedRegion ?? '')}>← Volver</button>
    </div>}

    <section className="san12-section">
      <SectionHead index="A" title="Actores clave" subtitle="Instituciones con mayor presencia en el universo sancionatorio visible. Selecciona una para cruzar el tablero." />
      <div className="san12-actor-grid">
        {regulatorRows.map((r) => <button key={r.regulator} className="san12-actor-card" data-active={filters.regulator === r.regulator} onClick={() => toggleRegulator(r.regulator)}>
          <span>{r.regulator}</span>
          <small>{SOURCE_NAMES[r.regulator] ?? 'Institución supervisora'}</small>
          <div><b>{fmt(r.events)}</b><em>eventos</em></div>
          <footer><span>{fmt(r.entities)} entidades</span><span>{fmt(r.years)} años</span><span>{fmtUf(r.amountUf)} UF</span></footer>
        </button>)}
        {!regulatorRows.length && <Empty text="No hay instituciones para el corte actual." />}
      </div>
    </section>

    <section className="san12-section">
      <SectionHead index="B" title="Matriz regional" subtitle="Selecciona una región para abrir sus actores principales. La profundización se aplica al resto del módulo." />
      <div className="san12-region-layout">
        <article className="san12-panel san12-region-panel">
          <PanelHead title="Distribución territorial" meta={`${fmt(regionRows.length)} regiones observables`} />
          <div className="san12-region-list">
            {regionRows.map((r) => <div key={r.region} className="san12-region-item" data-active={selectedRegion === r.region}>
              <button className="san12-region-main" onClick={() => chooseRegion(r.region)}>
                <span className="san12-region-name">{r.region}</span>
                <span className="san12-track"><i style={{ width: `${Math.max(3, (r.events / maxRegion) * 100)}%` }} /></span>
                <b>{fmt(r.events)}</b>
                <small>{fmt(r.entities)} ent.</small>
                <em>{fmtUf(r.amountUf)} UF</em>
              </button>
              {selectedRegion === r.region && <div className="san12-region-actors">
                <span>Actores principales · máximo 2</span>
                {regionalActors.length ? regionalActors.map((actor) => <button key={actor.key} data-active={selectedActor === actor.key} onClick={() => setSelectedActor(selectedActor === actor.key ? null : actor.key)}>
                  <div><b>{actor.name}</b><small>{actor.rut !== 's/i' ? actor.rut : actor.sector}</small></div>
                  <span>{fmt(actor.events)} eventos</span>
                  <em>{fmtUf(actor.amountUf)} UF</em>
                </button>) : <Empty text="No hay actores identificables en esta región." compact />}
              </div>}
            </div>)}
          </div>
        </article>

        <article className="san12-panel san12-inspector" data-open={Boolean(selectedActorSummary)}>
          {selectedActorSummary ? <ActorInspector actor={selectedActorSummary} onBack={() => setSelectedActor(null)} onNavigate={onNavigate} /> : <>
            <PanelHead title="Inspector de actor" meta="profundización contextual" />
            <div className="san12-inspector-placeholder">
              <span>◎</span>
              <b>Selecciona un actor regional</b>
              <p>La ficha concentra identidad, territorio, sector, recurrencia, monto y trazabilidad documental sin abandonar el radar.</p>
            </div>
          </>}
        </article>
      </div>
    </section>

    <section className="san12-section">
      <SectionHead index="C" title="Rigor e intensidad regulatoria" subtitle="Se preserva el bloque IER de la referencia aprobada. El read model de Atlas no contiene el IER original, por lo que se marca s/i y se muestran métricas observables sin sustituirlo por un índice inventado." />
      <div className="san12-rigor-grid">
        {deriveRegulators(visibleRows).map((r) => <article key={r.regulator} className="san12-panel san12-rigor-card">
          <header><span>{r.regulator}</span><small>{SOURCE_NAMES[r.regulator] ?? 'Institución'}</small></header>
          <div className="san12-ier"><span>IER 0–100</span><b>s/i</b><small>No disponible en contrato actual</small></div>
          <div className="san12-rigor-metrics">
            <Metric label="Eventos" value={fmt(r.events)} />
            <Metric label="Entidades" value={fmt(r.entities)} />
            <Metric label="UF observadas" value={fmtUf(r.amountUf)} />
            <Metric label="Último caso" value={formatDate(r.lastDate)} />
          </div>
        </article>)}
        {!deriveRegulators(visibleRows).length && <Empty text="Sin actividad institucional para este corte." />}
      </div>
    </section>

    <section className="san12-section">
      <SectionHead index="D" title="Calidad del enforcement" subtitle="Cobertura documental y de identificación del corte visible. Los faltantes se reportan como no observables, nunca como ausencia de riesgo o incumplimiento." />
      <div className="san12-quality-layout">
        <article className="san12-panel">
          <PanelHead title="Cobertura de evidencia" meta={`${fmt(visibleRows.length)} eventos evaluados`} />
          <div className="san12-quality-list">
            <Quality label="Documento enlazado" value={quality.documentPct} count={quality.withDocument} total={visibleRows.length} />
            <Quality label="Referencia / resolución" value={quality.resolutionPct} count={quality.withResolution} total={visibleRows.length} />
            <Quality label="Identidad resuelta" value={quality.identityPct} count={quality.withIdentity} total={visibleRows.length} />
            <Quality label="Monto observable" value={quality.amountPct} count={quality.withAmount} total={visibleRows.length} />
          </div>
          {quality.qualityClasses <= 1 && <div className="san12-warning"><b>Lectura incompleta</b><span>La clasificación de calidad documental tiene cobertura o diversidad insuficiente para interpretar diferencias de calidad entre casos.</span></div>}
        </article>

        <article className="san12-panel">
          <PanelHead title="Evolución del corte" meta="eventos por año" />
          <div className="san12-year-bars">
            {years.map((r) => <button key={r.year} data-active={filters.year === String(r.year)} onClick={() => setFilter('year', filters.year === String(r.year) ? '' : String(r.year))}>
              <b>{r.events}</b><i style={{ height: `${Math.max(5, (r.events / maxYear) * 100)}%` }} /><span>{r.year}</span>
            </button>)}
          </div>
        </article>
      </div>
    </section>

    <section className="san12-section">
      <SectionHead index="E" title="Casos prioritarios" subtitle="Dos lecturas complementarias: mayor monto UF observado y mayor recencia. El ranking monetario se ordena numéricamente antes de formatear y no usa un corte temporal arbitrario." />
      <div className="san12-top-grid">
        <TopList title="Sanciones más costosas" eyebrow="TOP 5 · MONTO UF" rows={costly} mode="cost" onActor={(row) => chooseActor(actorFromRow(row))} />
        <TopList title="Sanciones más recientes" eyebrow="TOP 5 · FECHA" rows={recent} mode="recent" onActor={(row) => chooseActor(actorFromRow(row))} />
      </div>
    </section>

    <section className="san12-section san12-final-section">
      <SectionHead index="F" title="Detalle de sanciones recientes" subtitle="Expedientes visibles bajo el contexto activo. La tabla conserva trazabilidad hacia documento oficial y Entidad 360 cuando existe identidad enlazada." />
      <article className="san12-panel san12-table-panel">
        <div className="san12-table-head"><span>{fmt(recent50.length)} de {fmt(visibleRows.length)} eventos visibles</span><small>Orden: fecha descendente</small></div>
        <div className="san12-table-wrap">
          <table className="san12-table">
            <thead><tr><th>Fecha</th><th>Entidad</th><th>Institución</th><th>Industria</th><th>Región</th><th>UF</th><th>Motivo / referencia</th><th>Documento</th></tr></thead>
            <tbody>{recent50.map((row) => <tr key={row.event_id}>
              <td>{formatDate(row.event_date)}</td>
              <td><button className="san12-entity-link" onClick={() => chooseActor(actorFromRow(row))}>{actorName(row)}</button><small>{safe(row.rut)}</small></td>
              <td><span className="san12-reg-badge">{safe(row.regulator)}</span></td>
              <td>{sectorOf(row)}</td>
              <td>{regionOf(row)}</td>
              <td className="num">{num(row.amount_uf) > 0 ? fmtUf(num(row.amount_uf)) : 's/i'}</td>
              <td><span className="san12-reason">{short(row.reason || row.resolution_ref, 110)}</span></td>
              <td>{safeUrl(row.document_url) ? <a href={safeUrl(row.document_url)} target="_blank" rel="noreferrer">Abrir ↗</a> : <span className="san12-muted">s/i</span>}</td>
            </tr>)}</tbody>
          </table>
          {!recent50.length && <Empty text="No hay expedientes para el contexto activo." />}
        </div>
      </article>
    </section>
  </div>;
}

function Filter({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return <label className="san12-filter"><span>{label}</span><select value={value} onChange={(e) => onChange(e.target.value)}><option value="">Todos</option>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>;
}

function Kpi({ label, value, hint, emphasis = false }: { label: string; value: string; hint: string; emphasis?: boolean }) {
  return <article className="san12-kpi" data-emphasis={emphasis}><span>{label}</span><b>{value}</b><small>{hint}</small></article>;
}

function SectionHead({ index, title, subtitle }: { index: string; title: string; subtitle: string }) {
  return <header className="san12-section-head"><span>{index}</span><div><h2>{title}</h2><p>{subtitle}</p></div></header>;
}

function PanelHead({ title, meta }: { title: string; meta: string }) {
  return <header className="san12-panel-head"><b>{title}</b><span>{meta}</span></header>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="san12-metric"><span>{label}</span><b>{value}</b></div>;
}

function Quality({ label, value, count, total }: { label: string; value: number; count: number; total: number }) {
  return <div className="san12-quality-row">
    <div><b>{label}</b><span>{fmt(count)} de {fmt(total)}</span></div>
    <span className="san12-quality-track"><i style={{ width: `${Math.max(value ? 2 : 0, value)}%` }} /></span>
    <em>{value.toLocaleString('es-CL', { maximumFractionDigits: 1 })}%</em>
  </div>;
}

function ActorInspector({ actor, onBack, onNavigate }: { actor: ActorSummary; onBack: () => void; onNavigate: (hash: string) => void }) {
  const latest = [...actor.rows].sort((a, b) => dateValue(b.event_date) - dateValue(a.event_date))[0];
  return <div className="san12-inspector-content">
    <header><button onClick={onBack}>← Volver</button><span>FICHA DE ACTOR</span></header>
    <h3>{actor.name}</h3>
    <p>{actor.rut !== 's/i' ? actor.rut : 'RUT s/i'} · {actor.region}</p>
    <div className="san12-inspector-kpis">
      <Metric label="Eventos" value={fmt(actor.events)} />
      <Metric label="Monto UF" value={fmtUf(actor.amountUf)} />
      <Metric label="Último evento" value={formatDate(actor.lastDate)} />
      <Metric label="Institución" value={actor.regulator} />
    </div>
    <div className="san12-inspector-detail">
      <span>Industria / sector</span><b>{actor.sector}</b>
      <span>Último motivo observable</span><p>{short(latest?.reason, 260)}</p>
      <span>Referencia</span><b>{safe(latest?.resolution_ref)}</b>
    </div>
    <div className="san12-inspector-actions">
      {actor.entityId && <button onClick={() => onNavigate(`#/entidad/${encodeURIComponent(actor.entityId ?? '')}`)}>Abrir Entidad 360</button>}
      {safeUrl(latest?.document_url) && <a href={safeUrl(latest?.document_url)} target="_blank" rel="noreferrer">Documento oficial ↗</a>}
    </div>
  </div>;
}

function TopList({ title, eyebrow, rows, mode, onActor }: { title: string; eyebrow: string; rows: SanctionEvent[]; mode: 'cost' | 'recent'; onActor: (row: SanctionEvent) => void }) {
  return <article className="san12-panel san12-top-list">
    <header><span>{eyebrow}</span><h3>{title}</h3></header>
    <div>{rows.map((row, index) => <button key={row.event_id} onClick={() => onActor(row)}>
      <strong>{index + 1}</strong>
      <span><b>{actorName(row)}</b><small>{safe(row.regulator)} · {sectorOf(row)}</small></span>
      <em>{mode === 'cost' ? `${fmtUf(num(row.amount_uf))} UF` : formatDate(row.event_date)}</em>
    </button>)}</div>
    {!rows.length && <Empty text="Sin casos para este ranking." compact />}
  </article>;
}

function Empty({ text, compact = false }: { text: string; compact?: boolean }) {
  return <div className="san12-empty" data-compact={compact}>{text}</div>;
}

function deriveStats(rows: SanctionEvent[]) {
  const actorKeys = rows.map(actorKey).filter(Boolean);
  const regulators = unique(rows.map((e) => clean(e.regulator)).filter(Boolean));
  const withAmount = rows.filter((e) => num(e.amount_uf) > 0).length;
  const amountUf = rows.reduce((sum, e) => sum + num(e.amount_uf), 0);
  const top = countBy(rows.map((e) => clean(e.regulator)).filter(Boolean))[0];
  return {
    events: rows.length,
    entities: unique(actorKeys).length,
    resolvedEntities: unique(rows.filter((e) => e.entity_id).map(actorKey)).length,
    regulators: regulators.length,
    amountUf,
    withAmount,
    topRegulator: top?.key ?? '',
  };
}

function deriveRegulators(rows: SanctionEvent[]): RegulatorSummary[] {
  const map = new Map<string, SanctionEvent[]>();
  rows.forEach((e) => {
    const key = clean(e.regulator) || 's/i';
    map.set(key, [...(map.get(key) ?? []), e]);
  });
  return [...map.entries()].map(([regulator, list]) => ({
    regulator,
    events: list.length,
    entities: unique(list.map(actorKey).filter(Boolean)).length,
    years: unique(list.map((e) => e.event_year).filter((v): v is number => v != null)).length,
    amountUf: list.reduce((sum, e) => sum + num(e.amount_uf), 0),
    lastDate: latestDate(list),
  })).sort((a, b) => b.events - a.events || b.amountUf - a.amountUf);
}

function deriveRegions(rows: SanctionEvent[]): RegionSummary[] {
  const map = new Map<string, SanctionEvent[]>();
  rows.forEach((e) => {
    const region = regionOf(e);
    if (region === 's/i') return;
    map.set(region, [...(map.get(region) ?? []), e]);
  });
  return [...map.entries()].map(([region, list]) => ({
    region,
    events: list.length,
    entities: unique(list.map(actorKey).filter(Boolean)).length,
    amountUf: list.reduce((sum, e) => sum + num(e.amount_uf), 0),
  })).sort((a, b) => b.events - a.events || b.amountUf - a.amountUf);
}

function deriveActors(rows: SanctionEvent[]): ActorSummary[] {
  const map = new Map<string, SanctionEvent[]>();
  rows.forEach((e) => {
    const key = actorKey(e);
    if (!key) return;
    map.set(key, [...(map.get(key) ?? []), e]);
  });
  return [...map.entries()].map(([key, list]) => {
    const latest = [...list].sort((a, b) => dateValue(b.event_date) - dateValue(a.event_date))[0];
    return {
      key,
      name: actorName(latest),
      rut: safe(latest?.rut),
      events: list.length,
      amountUf: list.reduce((sum, e) => sum + num(e.amount_uf), 0),
      lastDate: latestDate(list),
      regulator: safe(latest?.regulator),
      sector: sectorOf(latest),
      region: regionOf(latest),
      entityId: latest?.entity_id ?? list.find((e) => e.entity_id)?.entity_id ?? null,
      rows: list,
    };
  }).sort((a, b) => b.events - a.events || b.amountUf - a.amountUf || dateValue(b.lastDate) - dateValue(a.lastDate));
}

function deriveYears(rows: SanctionEvent[]) {
  const counts = new Map<number, number>();
  rows.forEach((e) => { if (e.event_year != null) counts.set(e.event_year, (counts.get(e.event_year) ?? 0) + 1); });
  return [...counts.entries()].map(([year, events]) => ({ year, events })).sort((a, b) => a.year - b.year);
}

function deriveQuality(rows: SanctionEvent[]) {
  const withDocument = rows.filter((e) => Boolean(safeUrl(e.document_url))).length;
  const withResolution = rows.filter((e) => Boolean(clean(e.resolution_ref))).length;
  const withIdentity = rows.filter((e) => Boolean(e.entity_id || clean(e.rut) || clean(e.canonical_name))).length;
  const withAmount = rows.filter((e) => num(e.amount_uf) > 0 || num(e.amount_clp) > 0).length;
  const qualityClasses = unique(rows.map((e) => clean(e.document_quality)).filter(Boolean)).length;
  return {
    withDocument,
    withResolution,
    withIdentity,
    withAmount,
    qualityClasses,
    documentPct: percentage(withDocument, rows.length),
    resolutionPct: percentage(withResolution, rows.length),
    identityPct: percentage(withIdentity, rows.length),
    amountPct: percentage(withAmount, rows.length),
  };
}

function actorFromRow(row: SanctionEvent): ActorSummary {
  return {
    key: actorKey(row),
    name: actorName(row),
    rut: safe(row.rut),
    events: 1,
    amountUf: num(row.amount_uf),
    lastDate: row.event_date,
    regulator: safe(row.regulator),
    sector: sectorOf(row),
    region: regionOf(row),
    entityId: row.entity_id,
    rows: [row],
  };
}

function actorKey(e?: SanctionEvent | null) {
  if (!e) return '';
  return clean(e.entity_key) || clean(e.entity_id) || clean(e.rut) || normalize(actorName(e)) || clean(e.event_id);
}

function actorName(e?: SanctionEvent | null) {
  return clean(e?.canonical_name) || clean(e?.source_entity_name) || clean(e?.rut) || 'Entidad s/i';
}

function sectorOf(e?: SanctionEvent | null) {
  return clean(e?.uaf_sector) || 'Sin sector UAF';
}

function regionOf(e?: SanctionEvent | null) {
  const raw = clean(e?.region);
  if (!raw) return 's/i';
  const n = normalize(raw);
  if (n.includes('METROPOLITANA')) return 'Metropolitana de Santiago';
  if (n.includes('OHIGGINS') || n.includes('O HIGGINS') || n.includes('LIBERTADOR GENERAL BERNARDO')) return "Libertador Gral. Bernardo O'Higgins";
  if (n.includes('AYSEN')) return 'Aysén';
  if (n.includes('ARICA') && n.includes('PARINACOTA')) return 'Arica y Parinacota';
  if (n.includes('ARAUCANIA')) return 'La Araucanía';
  if (n.includes('BIOBIO')) return 'Biobío';
  if (n.includes('MAGALLANES')) return 'Magallanes y de la Antártica Chilena';
  return raw;
}

function countBy(values: string[]) {
  const map = new Map<string, number>();
  values.forEach((value) => map.set(value, (map.get(value) ?? 0) + 1));
  return [...map.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count);
}

function latestDate(rows: SanctionEvent[]) {
  return rows.reduce<string | null>((latest, e) => dateValue(e.event_date) > dateValue(latest) ? e.event_date : latest, null);
}

function safe(value: unknown) {
  const text = value == null ? '' : String(value).trim();
  return text || 's/i';
}

function clean(value: unknown) {
  return value == null ? '' : String(value).trim();
}

function normalize(value: unknown) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9K]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function safeUrl(value: unknown) {
  try {
    const url = new URL(String(value ?? ''));
    return /^https?:$/.test(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

function num(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

function percentage(part: number, total: number) {
  return total ? (part / total) * 100 : 0;
}

function dateValue(value: unknown) {
  if (!value) return 0;
  const n = new Date(String(value)).getTime();
  return Number.isFinite(n) ? n : 0;
}

function formatDate(value: unknown) {
  if (!value) return 's/i';
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? safe(value) : d.toLocaleDateString('es-CL');
}

function formatDateTime(value: unknown) {
  if (!value) return 's/i';
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? safe(value) : d.toLocaleString('es-CL', { dateStyle: 'medium', timeStyle: 'short' });
}

function fmt(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(n) : 's/i';
}

function fmtUf(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 's/i';
  return new Intl.NumberFormat('es-CL', { maximumFractionDigits: n >= 100 ? 0 : 1 }).format(n);
}

function short(value: unknown, max = 100) {
  const text = clean(value);
  if (!text) return 's/i';
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
