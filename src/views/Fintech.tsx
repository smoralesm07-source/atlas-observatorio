import { useEffect, useState, type ReactNode } from 'react';
import { ErrorBox, Loading } from '../components/primitives';
import { useDebounced, useRpc } from '../lib/rpc';
import { supabase } from '../lib/supabase';

const PAGE_SIZE = 8;

type CountItem = { label: string; count: number };
type SourceRow = {
  source_code: string; label: string; authority_level: string; source_type: string; source_url: string | null;
  role: string; notes: string | null; volume: number; entity_count: number; candidate_count: number; relationship_count: number;
};
type SegmentRow = {
  segment_label: string; count_2024: number; count_2026: number; delta: number; growth_pct: number | null;
  source_url: string | null; methodology_note: string;
};
type CoverageRow = { label: string; count: number; total: number; code: string };
type RecentEvent = {
  event_id: number; fintech_id: string; entity_name: string; event_type: string; event_date: string | null;
  title: string; summary: string | null; source_code: string | null; source_url: string | null;
};
type Dashboard = {
  error?: string;
  national: {
    reference_total: number; reference_local: number; reference_foreign: number; reference_date: string | null; reference_source: string;
    sector_observed: number; semantic_resolved: number; semantic_product_resolved: number; semantic_out_of_scope: number;
    atlas_confirmed: number; with_rut: number; without_rut: number; with_cmf_public: number; with_uaf_public: number;
    psav_confirmed: number; business_model_classified: number; target_customer_classified: number; revenue_model_classified: number;
    function_profiled: number; with_market_metrics: number; operating_validated: number; operating_unknown: number;
    structural_events: number; refreshed_at: string | null;
  };
  sources: SourceRow[];
  reference_segments: SegmentRow[];
  verticals: CountItem[];
  business_models: CountItem[];
  operating_status: CountItem[];
  regions: CountItem[];
  actor_kinds: CountItem[];
  coverage: CoverageRow[];
  recent_events: RecentEvent[];
  filters: { regions: string[]; verticals: string[]; models: string[]; sources: Array<{ code: string; label: string }> };
  semantics: { universe: string; coverage: string; segments: string; boundary: string };
};

type SearchRow = {
  fintech_id: string; atlas_entity_id: string | null; rut: string | null; brand: string | null; legal_name: string;
  vertical: string | null; business_model: string | null; target_customer: string | null; revenue_model: string | null;
  psav_status: string; operating_status: string; operating_status_as_of: string | null; actor_kind: string | null;
  region: string | null; commune: string | null; sii_main_activity: string | null; sales_band: string | null;
  workers: number | null; has_cmf_public: boolean; has_uaf_public: boolean; market_metric_count: number;
  function_count: number; source_codes: string[]; last_seen_at: string; confidence: number;
};
type SearchData = { error?: string; total: number; rows: SearchRow[] };

type DetailEntity = {
  fintech_id: string; atlas_entity_id: string | null; rut: string | null; brand: string | null; legal_name: string;
  website: string | null; origin_country: string | null; presence_chile: string; entity_status: string; identification_status: string;
  identification_basis: string; primary_vertical: string | null; business_model: string | null; target_customer: string | null;
  revenue_model: string | null; psav_status: string; operating_status: string; operating_status_basis: string | null;
  operating_status_source_code: string | null; operating_status_source_url: string | null; operating_status_as_of: string | null;
  actor_kind: string | null; lifecycle_basis: string | null; lifecycle_validated_at: string | null; confidence: number;
  region: string | null; commune: string | null; sii_main_activity: string | null; sii_economic_sector: string | null;
  sii_sales_band: string | null; sii_workers: number | null; sii_activity_start_date: string | null; uaf_sector_canonical: string | null;
  has_cmf_public: boolean; has_uaf_public: boolean; market_metric_count: number; first_seen_at: string; last_seen_at: string;
};
type RegulatoryRow = { regulator: string; registry: string; service: string; status: string; registration_no: string | null; effective_date: string | null; source_url: string | null; observed_at: string };
type ActivityRow = { activity_code: string; activity_label: string; activity_group: string | null; is_primary: boolean; confidence: number };
type EventRow = { event_id: number; event_type: string; event_date: string | null; title: string; summary: string | null; source_url: string | null };
type EvidenceSource = { source_code: string; catalog_label: string; authority_level: string; source_url: string | null; status: string; first_seen_at: string; last_seen_at: string };
type RelationshipRow = {
  relationship_id: number; relation_type: string; target_fintech_id: string | null; target_rut: string | null;
  target_atlas_entity_id: string | null; target_label: string; source_code: string | null; source_url: string | null;
  evidence_basis: string; confidence: number; active: boolean;
};
type MetricRow = { metric_id: number; metric_code: string; value_numeric: number | null; value_text: string | null; unit: string | null; currency: string | null; evidence_type: string };
type DetailData = {
  error?: string; entity: DetailEntity; activities: ActivityRow[]; regulation: RegulatoryRow[]; market_metrics: MetricRow[];
  events: EventRow[]; relationships: RelationshipRow[]; sources: EvidenceSource[]; boundary_note: string;
};
type FunctionalRow = { function_code: string; label: string; group: string; fatf_vasp: boolean; evidence_status: string; confidence: number; basis: string | null; source_code: string | null; source_url: string | null };
type FunctionalDetail = { error?: string; psav_status: string; psav_basis: string | null; psav_confidence: number | null; functions: FunctionalRow[]; method_note: string };

type Filters = { region: string; vertical: string; model: string; source: string; regulator: string; psav: string; operating: string };
const EMPTY: Filters = { region: '', vertical: '', model: '', source: '', regulator: 'TODOS', psav: 'TODOS', operating: 'TODOS' };
type Tab = 'timeline' | 'relations' | 'regulation' | 'functions';

export function Fintech({ onNavigate }: { onNavigate: (hash: string) => void }) {
  const dashboard = useRpc<Dashboard>('obs_fintech_dashboard_v2', {});
  const [query, setQuery] = useState('');
  const q = useDebounced(query, 240);
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('timeline');
  const [exporting, setExporting] = useState(false);

  const search = useRpc<SearchData>('obs_fintech_search_v2', {
    p_q: q || null,
    p_region: filters.region || null,
    p_vertical: filters.vertical || null,
    p_model: filters.model || null,
    p_source: filters.source || null,
    p_regulator: filters.regulator,
    p_psav: filters.psav,
    p_operating: filters.operating,
    p_limit: PAGE_SIZE,
    p_offset: page * PAGE_SIZE,
  });
  const detail = useRpc<DetailData>('obs_fintech_entity_detail', { p_fintech_id: selected }, { skip: !selected });
  const functional = useRpc<FunctionalDetail>('obs_fintech_function_detail', { p_fintech_id: selected }, { skip: !selected });

  useEffect(() => {
    const rows = search.data?.rows ?? [];
    if (!rows.length) { setSelected(null); return; }
    if (!selected || !rows.some((row) => row.fintech_id === selected)) setSelected(rows[0].fintech_id);
  }, [search.data?.rows, selected]);

  const totalResults = search.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(totalResults / PAGE_SIZE));
  const data = dashboard.data;

  function setFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(0);
  }
  function reset() { setQuery(''); setFilters(EMPTY); setPage(0); }

  async function exportSnapshot() {
    setExporting(true);
    try {
      const { data: payload, error } = await supabase.rpc('obs_fintech_export');
      if (error) throw error;
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `atlas-fintech-corte-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      window.alert(`No fue posible exportar el corte: ${(error as Error).message}`);
    } finally { setExporting(false); }
  }

  if (dashboard.loading) return <Loading label="Construyendo panorama del ecosistema Fintech…" />;
  if (dashboard.error) return <ErrorBox error={dashboard.error} onRetry={dashboard.reload} />;
  if (!data || data.error) return <ErrorBox error="No fue posible leer la sección Fintech autorizada." onRetry={dashboard.reload} />;

  const n = data.national;
  const mainSources = selectSources(data.sources);

  return <div className="fintech-page fade-in">
    <header className="fintech-head">
      <div>
        <div className="fintech-kicker">Ecosistema fintech · Chile</div>
        <h1>Fintech <span>|</span> Panorama y caracterización</h1>
        <p>Del universo sectorial a la entidad: cobertura, identidad jurídica, relaciones corporativas, actividad, regulación y trayectoria verificable.</p>
      </div>
      <div className="fintech-head-meta">
        <span><b>Corte de referencia</b>{formatDate(n.reference_date)}</span>
        <span><b>Atlas actualizado</b>{formatDateTime(n.refreshed_at)}</span>
        <button onClick={exportSnapshot} disabled={exporting}>{exporting ? 'Exportando…' : 'Exportar corte'}</button>
      </div>
    </header>

    <Section index="1" title="Contexto del ecosistema" hint="Separamos la referencia sectorial del universo individualizado y deduplicado en ATLAS.">
      <div className="fintech-context-grid">
        <button className="fintech-hero-card orange" onClick={reset} title={data.semantics.universe}>
          <FIcon name="people" /><span className="label">Universo Fintech Chile</span><strong>{formatNumber(n.reference_total)}</strong>
          <small>FinteChile/EY 2026 · {formatNumber(n.reference_local)} locales · {formatNumber(n.reference_foreign)} extranjeras</small>
        </button>
        <button className="fintech-hero-card blue" onClick={reset} title={data.semantics.universe}>
          <FIcon name="bars" /><span className="label">ATLAS observado</span><strong>{formatNumber(n.sector_observed)}</strong>
          <small>Universo sectorial deduplicado individualizado</small>
          <span className="fintech-progress"><i style={{ width: `${pct(n.semantic_resolved, n.sector_observed)}%` }} /></span>
        </button>
        <div className="fintech-cross-card">
          <div className="fintech-cross-title"><FIcon name="link" /><div><b>Cruces analíticos</b><small>sobre el universo resuelto y confirmado</small></div></div>
          <button onClick={reset}><span>Resueltas semánticamente</span><strong>{formatNumber(n.semantic_resolved)}</strong><small>{pct(n.semantic_resolved, n.sector_observed)}% del universo base</small></button>
          <button onClick={() => setFilter('source','SII_PUBLIC')}><span>Actores confirmados</span><strong>{formatNumber(n.atlas_confirmed)}</strong><small>{formatNumber(n.with_rut)} con RUT · {formatNumber(n.without_rut)} sin RUT chileno</small></button>
          <button onClick={() => setFilter('regulator','CMF')}><span>Huella regulatoria pública</span><strong>{formatNumber(n.with_cmf_public)}</strong><small>CMF · UAF {formatNumber(n.with_uaf_public)} · PSAV {formatNumber(n.psav_confirmed)}</small></button>
        </div>
        <button className="fintech-alert-card" onClick={() => document.getElementById('fintech-events')?.scrollIntoView({ behavior:'smooth', block:'center' })}>
          <FIcon name="pulse" /><div><span>Eventos estructurales</span><strong>{formatNumber(n.structural_events)}</strong><small>cambios operativos, adquisiciones, rebrandings y alertas regulatorias</small></div>
        </button>
      </div>
      <div className="fintech-context-note"><b>Lectura correcta:</b><span>557 es una referencia sectorial agregada; 201/200 son universos ATLAS individualizados. No se presenta una marca o producto como una nueva persona jurídica sin evidencia.</span></div>
    </Section>

    <Section index="2" title="Fuentes y evolución sectorial" hint="Qué aporta cada fuente y qué cambios agregados muestra el ecosistema entre 2024 y 2026.">
      <div className="fintech-source-evolution">
        <SourceTable sources={mainSources} active={filters.source} onPick={(code) => setFilter('source', filters.source === code ? '' : code)} />
        <SegmentEvolution rows={data.reference_segments} note={data.semantics.segments} />
      </div>
    </Section>

    <Section index="3" title="Caracterización del universo observado" hint="Los gráficos filtran la tabla inferior y muestran tanto lo conocido como las brechas que aún debemos cerrar.">
      <div className="fintech-character-grid">
        <IdentityDonut withRut={n.with_rut} withoutRut={n.without_rut} kinds={data.actor_kinds} />
        <VerticalBars rows={data.verticals} total={n.atlas_confirmed} active={filters.vertical} onPick={(value) => setFilter('vertical', filters.vertical === value ? '' : value)} />
        <CoverageBars rows={data.coverage} note={data.semantics.coverage} />
        <OperatingBars rows={data.operating_status} total={n.atlas_confirmed} active={filters.operating} onPick={(value) => setFilter('operating', filters.operating === value ? 'TODOS' : value)} />
      </div>
      <div className="fintech-intelligence-strip" id="fintech-events">
        <div className="fintech-model-mini"><b>Modelos observados</b>{data.business_models.slice(0,4).map((row) => <button key={row.label} onClick={() => setFilter('model', row.label === 'Por clasificar' ? '' : row.label)}><span>{row.label}</span><strong>{formatNumber(row.count)}</strong></button>)}</div>
        <RecentEvents rows={data.recent_events} />
        <ReferenceInsight rows={data.reference_segments} />
      </div>
    </Section>

    <Section index="4" title="Explorar y caracterizar fintech" hint="Selecciona una entidad para revisar identidad, vigencia, relaciones, regulación, funciones y hechos con fecha verificable.">
      <div className="fintech-explorer-grid">
        <div className="fintech-results-panel">
          <div className="fintech-filterbar">
            <label className="fintech-search"><FIcon name="search" /><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} placeholder="Buscar por nombre o RUT…" /></label>
            <Select label="Región" value={filters.region} options={data.filters.regions} onChange={(value) => setFilter('region', value)} />
            <Select label="Vertical" value={filters.vertical} options={data.filters.verticals} onChange={(value) => setFilter('vertical', value)} />
            <Select label="Modelo" value={filters.model} options={data.filters.models} onChange={(value) => setFilter('model', value)} />
            <SourceSelect value={filters.source} options={data.filters.sources} onChange={(value) => setFilter('source', value)} />
            <Select label="Condición CMF" value={filters.regulator} options={['TODOS','CMF','UAF']} labels={{ TODAS:'Todas', TODOS:'Todas', CMF:'Con huella CMF', UAF:'UAF público' }} noEmpty onChange={(value) => setFilter('regulator', value)} />
            <Select label="PSAV" value={filters.psav} options={['TODOS','SI','NO']} labels={{ TODOS:'Todos', SI:'Con función PSAV', NO:'Sin función PSAV' }} noEmpty onChange={(value) => setFilter('psav', value)} />
            <Select label="Estado operativo" value={filters.operating} options={['TODOS','ACTIVE','LIMITED','NO_NEW_BUSINESS','CEASED','UNKNOWN']} labels={{ TODOS:'Todos', ACTIVE:'Activa', LIMITED:'Limitada', NO_NEW_BUSINESS:'Sin nuevos negocios', CEASED:'Cesada', UNKNOWN:'Por validar' }} noEmpty onChange={(value) => setFilter('operating', value)} />
            <button className="fintech-clear" onClick={reset}>Limpiar</button>
          </div>
          <div className="fintech-results-head"><div><b>Resultados</b><span>{search.loading ? 'Actualizando…' : `${formatNumber(totalResults)} entidades`}</span></div><span>Página {Math.min(page + 1,pages)} de {pages}</span></div>
          {search.error ? <ErrorBox error={search.error} onRetry={search.reload} /> : <ResultTable rows={search.data?.rows ?? []} selected={selected} onSelect={(id) => { setSelected(id); setTab('timeline'); }} />}
          <div className="fintech-pagination">
            <button disabled={page===0} onClick={() => setPage((current) => Math.max(0,current-1))}>‹</button>
            {pageButtons(page,pages).map((item) => <button key={item} data-active={item===page} onClick={() => setPage(item)}>{item+1}</button>)}
            <button disabled={page+1>=pages} onClick={() => setPage((current) => Math.min(pages-1,current+1))}>›</button>
          </div>
        </div>
        <QuickPanel detail={detail.data} functional={functional.data} loading={detail.loading || functional.loading} error={detail.error || functional.error} tab={tab} onTab={setTab} onRetry={() => { detail.reload(); functional.reload(); }} onOpen={(id) => onNavigate(`#/entidad/${encodeURIComponent(id)}`)} />
      </div>
    </Section>

    <div className="fintech-boundary"><FIcon name="info" /><span>{data.semantics.boundary} El radar está diseñado para exportar contexto abierto y alimentar el estudio posterior sin mezclarlo con información reservada.</span></div>
  </div>;
}

function Section({ index,title,hint,children }: { index:string; title:string; hint:string; children:ReactNode }) {
  return <section className="fintech-section"><div className="fintech-section-head"><h2><span>{index}.</span> {title}</h2><p>{hint}</p></div>{children}</section>;
}

function selectSources(rows: SourceRow[]) {
  const preferred = ['FINTECHILE_EY','FINNOVISTA','FINTECHILE_MEMBERS','LATAMFINTECH_CHILE','SII_PUBLIC','CMF_RPSF','UAF_PUBLIC','RES_PUBLIC','INAPI_PUBLIC'];
  return preferred.map((code) => rows.find((row) => row.source_code===code)).filter(Boolean) as SourceRow[];
}

function SourceTable({ sources,active,onPick }: { sources:SourceRow[]; active:string; onPick:(code:string)=>void }) {
  return <div className="fintech-source-card"><div className="fintech-card-title"><span>Fuente</span><span>Rol de la fuente</span><span>Volumen</span></div>
    {sources.map((source) => {
      const filterable = source.entity_count>0;
      return <button key={source.source_code} className="fintech-source-row" data-active={active===source.source_code} data-filterable={filterable} onClick={() => filterable && onPick(source.source_code)} title={source.notes ?? source.role}>
        <span className={`fintech-source-icon src-${source.source_code.toLowerCase().replaceAll('_','-')}`}>{sourceBadge(source.source_code)}</span>
        <b>{shortSourceLabel(source)}</b><span>{source.role}</span><strong>{formatNumber(source.volume)}</strong>
      </button>;
    })}
  </div>;
}

function SegmentEvolution({ rows,note }: { rows:SegmentRow[]; note:string }) {
  const visible = rows.slice(0,8);
  const max = Math.max(1,...visible.flatMap((row) => [row.count_2024,row.count_2026]));
  return <div className="fintech-segment-card">
    <div className="fintech-chart-top"><div><div className="fintech-card-heading">Evolución por vertical · referencia sectorial</div><small>Comparación agregada 2024 → 2026 publicada en el Mapa Fintech 2026.</small></div><div className="fintech-segment-legend"><span><i className="y24" />2024</span><span><i className="y26" />2026</span></div></div>
    <div className="fintech-segment-list">{visible.map((row) => <div key={row.segment_label} className="fintech-segment-row"><span>{segmentLabel(row.segment_label)}</span><div><i className="y24" style={{ width:`${row.count_2024/max*100}%` }} /><i className="y26" style={{ width:`${row.count_2026/max*100}%` }} /></div><b>{row.count_2024} → {row.count_2026}</b><em data-pos={row.delta>=0}>{row.delta>=0?'+':''}{row.delta}</em></div>)}</div>
    <p className="fintech-chart-note">{note}</p>
  </div>;
}

function IdentityDonut({ withRut,withoutRut,kinds }: { withRut:number; withoutRut:number; kinds:CountItem[] }) {
  const total = withRut+withoutRut;
  const angle = total ? withRut/total*360 : 0;
  return <div className="fintech-chart-card"><div className="fintech-card-heading">Estructura jurídica del universo</div>
    <div className="fintech-donut-wrap"><div className="fintech-donut" style={{ background:`conic-gradient(var(--fin-orange) 0 ${angle}deg,var(--fin-blue) ${angle}deg 360deg)` }}><div><b>{formatNumber(total)}</b><span>actores</span></div></div>
      <div className="fintech-donut-legend"><div><i className="orange"/><span>Con RUT chileno</span><b>{formatNumber(withRut)}</b><small>{pct(withRut,total)}%</small></div><div><i className="blue"/><span>Sin RUT chileno</span><b>{formatNumber(withoutRut)}</b><small>{pct(withoutRut,total)}%</small></div></div></div>
    <div className="fintech-kind-row">{kinds.slice(0,3).map((row) => <span key={row.label}><b>{formatNumber(row.count)}</b>{actorKindLabel(row.label)}</span>)}</div>
  </div>;
}

function VerticalBars({ rows,total,active,onPick }: { rows:CountItem[]; total:number; active:string; onPick:(value:string)=>void }) {
  const visible = rows.filter((row) => row.label!=='Por clasificar').slice(0,8);
  const max = Math.max(1,...visible.map((row) => row.count));
  return <div className="fintech-chart-card"><div className="fintech-card-heading">Principales verticales ATLAS</div><div className="fintech-bars-list">{visible.map((row) => <button key={row.label} data-active={active===row.label} onClick={() => onPick(row.label)}><span>{row.label}</span><i><b style={{ width:`${row.count/max*100}%` }}/></i><strong>{formatNumber(row.count)}</strong><small>{pct(row.count,total)}%</small></button>)}</div></div>;
}

function CoverageBars({ rows,note }: { rows:CoverageRow[]; note:string }) {
  return <div className="fintech-chart-card"><div className="fintech-card-heading">Cobertura de caracterización</div><div className="fintech-coverage-list">{rows.map((row) => <div key={row.code}><span>{row.label}</span><i><b style={{ width:`${pct(row.count,row.total)}%` }}/></i><strong>{formatNumber(row.count)}</strong><small>{pct(row.count,row.total)}%</small></div>)}</div><p className="fintech-chart-note">{note}</p></div>;
}

function OperatingBars({ rows,total,active,onPick }: { rows:CountItem[]; total:number; active:string; onPick:(value:string)=>void }) {
  const ordered = ['ACTIVE','LIMITED','NO_NEW_BUSINESS','CEASED','UNKNOWN'].map((code) => rows.find((row) => row.label===code)).filter(Boolean) as CountItem[];
  return <div className="fintech-chart-card"><div className="fintech-card-heading">Vigencia operativa observada</div><div className="fintech-operating-list">{ordered.map((row) => <button key={row.label} data-active={active===row.label} onClick={() => onPick(row.label)}><span><i className={`status-${row.label.toLowerCase()}`} />{operatingLabel(row.label)}</span><strong>{formatNumber(row.count)}</strong><small>{pct(row.count,total)}%</small><em><b style={{ width:`${pct(row.count,total)}%` }}/></em></button>)}</div><p className="fintech-chart-note">Vigencia jurídica y operación comercial son dimensiones distintas. “Por validar” se conserva explícitamente hasta obtener evidencia 2026.</p></div>;
}

function RecentEvents({ rows }: { rows:RecentEvent[] }) {
  return <div className="fintech-events-card"><div className="fintech-mini-head"><b>Eventos y cambios estructurales</b><span>últimos hechos con fecha</span></div>{rows.length ? rows.slice(0,5).map((row) => <div className="fintech-event-row" key={row.event_id}><i className={eventClass(row.event_type)} /><span><b>{row.entity_name}</b><small>{row.title}</small></span><time>{formatDate(row.event_date)}</time></div>) : <p>Sin eventos estructurados todavía.</p>}</div>;
}

function ReferenceInsight({ rows }: { rows:SegmentRow[] }) {
  const growth = [...rows].sort((a,b) => b.delta-a.delta).slice(0,3);
  const decline = [...rows].filter((row) => row.delta<0).sort((a,b) => a.delta-b.delta)[0];
  return <div className="fintech-insight-card"><div className="fintech-mini-head"><b>Cambios que conviene estudiar</b><span>2024 → 2026</span></div>{growth.map((row) => <div key={row.segment_label} className="fintech-insight-row"><span>{segmentLabel(row.segment_label)}</span><strong>+{row.delta}</strong><small>{row.growth_pct!=null?`${row.growth_pct}%`:'n/d'}</small></div>)}{decline && <div className="fintech-insight-row down"><span>{segmentLabel(decline.segment_label)}</span><strong>{decline.delta}</strong><small>{decline.growth_pct}%</small></div>}</div>;
}

function ResultTable({ rows,selected,onSelect }: { rows:SearchRow[]; selected:string|null; onSelect:(id:string)=>void }) {
  if (!rows.length) return <div className="fintech-empty">No hay entidades para los filtros actuales.</div>;
  return <div className="fintech-table"><div className="fintech-tr fintech-th"><span>Entidad</span><span>RUT</span><span>Vertical</span><span>Modelo</span><span>Fuentes</span><span>Estado</span></div>{rows.map((row) => <button key={row.fintech_id} className="fintech-tr" data-active={selected===row.fintech_id} onClick={() => onSelect(row.fintech_id)}><span><b>{row.brand || row.legal_name}</b><small>{row.legal_name!==row.brand?row.legal_name:''}</small></span><span>{row.rut ?? 'Sin RUT chileno'}</span><span>{row.vertical ?? 'Por clasificar'}</span><span>{row.business_model ?? '—'}</span><span className="fintech-source-tags">{displaySources(row.source_codes).map((code) => <em key={code} className={`tag-${tagFamily(code)}`}>{sourceBadge(code)}</em>)}</span><span className="fintech-status"><i className={`status-${row.operating_status.toLowerCase()}`} />{operatingLabel(row.operating_status)}</span></button>)}</div>;
}

function QuickPanel({ detail,functional,loading,error,tab,onTab,onRetry,onOpen }: { detail:DetailData|null; functional:FunctionalDetail|null; loading:boolean; error:string|null; tab:Tab; onTab:(tab:Tab)=>void; onRetry:()=>void; onOpen:(id:string)=>void }) {
  if (loading) return <aside className="fintech-detail-panel"><Loading label="Caracterizando entidad…" /></aside>;
  if (error) return <aside className="fintech-detail-panel"><ErrorBox error={error} onRetry={onRetry} /></aside>;
  if (!detail?.entity) return <aside className="fintech-detail-panel fintech-empty">Selecciona una entidad para profundizar.</aside>;
  const e = detail.entity;
  const timeline = [...detail.events].sort((a,b) => String(a.event_date??'').localeCompare(String(b.event_date??'')));
  return <aside className="fintech-detail-panel">
    <div className="fintech-detail-head"><div><span>Vista rápida de entidad seleccionada</span><h3>{e.brand || e.legal_name}</h3><p>{e.rut ?? 'Sin RUT chileno'} · {e.primary_vertical ?? 'Vertical por clasificar'} · {e.region ?? 'Región n/d'}</p></div>{e.atlas_entity_id && <button onClick={() => onOpen(e.atlas_entity_id!)}>↗</button>}</div>
    <div className="fintech-detail-grid"><Field label="Región" value={e.region}/><Field label="Comuna" value={e.commune}/><Field label="Vertical principal" value={e.primary_vertical}/><Field label="Modelo de negocio" value={e.business_model}/><Field label="Actividad SII" value={e.sii_main_activity}/><Field label="Tramo ventas" value={e.sii_sales_band ? `Tramo ${e.sii_sales_band}` : null}/><Field label="Condición CMF" value={e.has_cmf_public?'Huella pública':'Sin huella observada'}/><Field label="Sector UAF" value={e.has_uaf_public ? (e.uaf_sector_canonical ?? 'Sector UAF por clasificar') : 'Sin registro público observado'}/><Field label="PSAV" value={psavLabel(functional?.psav_status ?? e.psav_status)}/><Field label="Estado operativo" value={operatingLabel(e.operating_status)} status={e.operating_status}/></div>
    <div className="fintech-tabs"><button data-active={tab==='timeline'} onClick={() => onTab('timeline')}>Línea de tiempo</button><button data-active={tab==='relations'} onClick={() => onTab('relations')}>Relaciones corporativas</button><button data-active={tab==='regulation'} onClick={() => onTab('regulation')}>Regulación</button><button data-active={tab==='functions'} onClick={() => onTab('functions')}>Funciones</button></div>
    <div className="fintech-tab-body">
      {tab==='timeline' && <>{e.sii_activity_start_date && <TimelineItem date={e.sii_activity_start_date} title="Inicio de actividades SII" detail={e.sii_main_activity}/>} {timeline.length ? timeline.slice(-6).map((ev) => <TimelineItem key={ev.event_id} date={ev.event_date} title={ev.title} detail={ev.summary ?? eventTypeLabel(ev.event_type)}/>) : !e.sii_activity_start_date && <EmptyText>Sin hechos con fecha verificable todavía.</EmptyText>}</>}
      {tab==='relations' && <>{detail.relationships.length ? detail.relationships.slice(0,7).map((r) => <InfoRow key={r.relationship_id} label={relationshipLabel(r.relation_type)} value={`${r.target_label}${r.target_rut?` · ${r.target_rut}`:''}`} meta={`${Math.round(r.confidence*100)}% · ${r.source_code ?? 'fuente abierta'}`}/>) : <EmptyText>Sin relaciones corporativas estructuradas.</EmptyText>}</>}
      {tab==='regulation' && <>{detail.regulation.length ? detail.regulation.slice(0,8).map((r) => <InfoRow key={`${r.regulator}-${r.registry}-${r.service}`} label={r.regulator} value={r.service} meta={r.status.replaceAll('_',' ')}/>) : <EmptyText>Sin huella regulatoria estructurada.</EmptyText>}</>}
      {tab==='functions' && <>{functional?.functions?.length ? functional.functions.slice(0,8).map((f) => <InfoRow key={`${f.function_code}-${f.source_code}`} label={f.fatf_vasp?'GAFI / VASP':f.group.replaceAll('_',' ')} value={f.label} meta={`${Math.round(f.confidence*100)}% · ${f.source_code ?? 'fuente abierta'}`}/>) : <EmptyText>Sin función financiera estructurada con evidencia suficiente.</EmptyText>}</>}
    </div>
    <div className="fintech-detail-footer"><span>{e.operating_status_basis ?? e.lifecycle_basis ?? 'La vigencia operativa aún debe validarse con evidencia abierta actual.'}</span>{e.atlas_entity_id && <button onClick={() => onOpen(e.atlas_entity_id!)}>Abrir ficha completa de la entidad →</button>}</div>
  </aside>;
}

function Field({ label,value,status }: { label:string; value:string|null|undefined; status?:string }) { return <div><span>{label}</span><b>{status && <i className={`status-${status.toLowerCase()}`} />}{value ?? 'n/d'}</b></div>; }
function TimelineItem({ date,title,detail }: { date:string|null; title:string; detail:string|null|undefined }) { return <div className="fintech-timeline-item"><time>{formatDate(date)}</time><i/><span><b>{title}</b><small>{detail ?? ''}</small></span></div>; }
function InfoRow({ label,value,meta }: { label:string; value:string; meta:string }) { return <div className="fintech-info-row"><span>{label}</span><b>{value}</b><small>{meta}</small></div>; }
function EmptyText({ children }: { children:ReactNode }) { return <p className="fintech-muted">{children}</p>; }

function Select({ label,value,options,labels={},noEmpty=false,onChange }: { label:string; value:string; options:string[]; labels?:Record<string,string>; noEmpty?:boolean; onChange:(value:string)=>void }) {
  return <label className="fintech-select"><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)}>{!noEmpty && <option value="">Todas</option>}{options.map((option) => <option key={option} value={option}>{labels[option] ?? option}</option>)}</select></label>;
}
function SourceSelect({ value,options,onChange }: { value:string; options:Array<{code:string;label:string}>; onChange:(value:string)=>void }) { return <label className="fintech-select"><span>Fuente</span><select value={value} onChange={(event) => onChange(event.target.value)}><option value="">Todas</option>{options.map((option) => <option key={option.code} value={option.code}>{option.label}</option>)}</select></label>; }

function FIcon({ name }: { name:'people'|'bars'|'link'|'pulse'|'search'|'info' }) {
  const paths:Record<string,ReactNode> = {
    people:<><circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3.5 19c.5-4 2.4-6 5.5-6s5 2 5.5 6M14 14c3-.4 5.2 1.1 6 4"/></>,
    bars:<><path d="M4 20V12M10 20V5M16 20V9M22 20H2"/></>,
    link:<><path d="M9 14 7 16a4 4 0 0 0 6 6l3-3M15 10l2-2a4 4 0 0 0-6-6L8 5M8 13l8-8"/></>,
    pulse:<><path d="M2 13h5l2-6 4 12 3-8 2 2h4"/></>,
    search:<><circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/></>,
    info:<><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/></>,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function sourceBadge(code:string) {
  const map:Record<string,string> = { FINTECHILE_EY:'FT',FINNOVISTA:'FV',FINTECHILE_MEMBERS:'FT',LATAMFINTECH_CHILE:'LF',SII_PUBLIC:'SII',CMF_RPSF:'CMF',UAF_PUBLIC:'UAF',RES_PUBLIC:'RES',INAPI_PUBLIC:'IN',COMPANY_OFFICIAL:'WEB',COMPANY_WEB:'WEB',PRESS_OPEN:'PRE' };
  return map[code] ?? code.replaceAll('_','').slice(0,3).toUpperCase();
}
function shortSourceLabel(source:SourceRow) {
  const map:Record<string,string> = { FINTECHILE_EY:'FinteChile / EY',FINNOVISTA:'Finnovista',FINTECHILE_MEMBERS:'FinteChile · miembros',LATAMFINTECH_CHILE:'LATAMFintech',SII_PUBLIC:'SII',CMF_RPSF:'CMF · RPSF',UAF_PUBLIC:'UAF / Ley 19.913',RES_PUBLIC:'RES / Diario Oficial',INAPI_PUBLIC:'INAPI' };
  return map[source.source_code] ?? source.label;
}
function displaySources(codes:string[]) { const pref=['SII_PUBLIC','CMF_RPSF','UAF_PUBLIC','RES_PUBLIC','INAPI_PUBLIC','FINTECHILE_MEMBERS','LATAMFINTECH_CHILE','COMPANY_OFFICIAL']; const unique=[...new Set(codes ?? [])]; return [...pref.filter((code) => unique.includes(code)),...unique.filter((code) => !pref.includes(code))].slice(0,4); }
function tagFamily(code:string) { if (code.startsWith('CMF')||code==='UAF_PUBLIC') return 'orange'; if (code.includes('FINTECHILE')||code.includes('LATAM')) return 'teal'; return 'blue'; }
function segmentLabel(label:string) { const map:Record<string,string>={ 'Payments & Remittances':'Pagos y remesas','Technological Infrastructure for Banks & Fintechs':'Infraestructura tecnológica','Enterprise Financial Management':'Gestión financiera empresas','Wealth Management':'Wealth / inversiones','Personal Financial Management':'Finanzas personales','Digital Banking':'Banca digital','Open Finance':'Open finance','Crypto':'Crypto' }; return map[label] ?? label; }
function actorKindLabel(value:string) { return ({ LEGAL_ENTITY:' entidades legales',FOREIGN_ACTOR:' actores extranjeros',BRAND:' marcas',PRODUCT:' productos',MULTI_LEGAL_BRAND:' marcas multivehículo' } as Record<string,string>)[value] ?? ` ${value.toLowerCase().replaceAll('_',' ')}`; }
function operatingLabel(value:string) { return ({ ACTIVE:'Activa',LIMITED:'Operación limitada',NO_NEW_BUSINESS:'Sin nuevos negocios',CEASED:'Cesada',UNKNOWN:'Por validar' } as Record<string,string>)[value] ?? value; }
function psavLabel(value:string) { return ({ CONFIRMED:'Confirmado',PROBABLE:'Probable',EXPOSURE:'Exposición AV',NO_EVIDENCE:'Sin evidencia funcional' } as Record<string,string>)[value] ?? value; }
function relationshipLabel(value:string) { return ({ PRODUCT_OF:'Producto de',BRAND_OF:'Marca de',LEGAL_VEHICLE_OF:'Vehículo legal de',ACQUIRED_BY:'Adquirida por',SUCCESSOR_OF:'Sucesora de',PREDECESSOR_OF:'Predecesora de',OPERATED_BY:'Operada por',CONTROLLED_BY:'Controlada por' } as Record<string,string>)[value] ?? value.replaceAll('_',' '); }
function eventTypeLabel(value:string) { return value.replaceAll('_',' ').toLowerCase(); }
function eventClass(value:string) { if (value.includes('ALERT')||value.includes('OPERATING')) return 'critical'; if (value.includes('ACQUISITION')||value.includes('PIVOT')) return 'orange'; return 'blue'; }
function pct(a:number,b:number) { return b>0 ? Math.round(a/b*100) : 0; }
function formatNumber(value:number|null|undefined) { return value==null ? 'n/d' : new Intl.NumberFormat('es-CL').format(value); }
function formatDate(value:string|null|undefined) { if (!value) return 'n/d'; return new Intl.DateTimeFormat('es-CL',{ day:'2-digit',month:'short',year:'numeric' }).format(new Date(value)); }
function formatDateTime(value:string|null|undefined) { if (!value) return 'n/d'; return new Intl.DateTimeFormat('es-CL',{ day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit' }).format(new Date(value)); }
function pageButtons(page:number,pages:number) { const start=Math.max(0,Math.min(page-2,pages-5)); return Array.from({length:Math.min(5,pages)},(_,index)=>start+index); }