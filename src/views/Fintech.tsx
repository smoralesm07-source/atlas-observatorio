import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ErrorBox, Loading } from '../components/primitives';
import { useDebounced, useRpc } from '../lib/rpc';
import { supabase } from '../lib/supabase';

const PAGE_SIZE = 10;

type CountItem = { label: string; count: number };
type UniverseSnapshot = {
  snapshot_key: string; source_code: string; source_label: string; source_date: string;
  reported_total: number | null; local_total: number | null; foreign_total: number | null;
  sample_size: number | null; methodology_note: string; source_url: string | null; metadata: Record<string, unknown>;
};
type SourceRow = {
  source_code: string; label: string; source_type: string; authority_level: string; cadence: string | null;
  source_url: string | null; notes: string | null; entity_count: number; refreshed_at: string;
};
type Dashboard = {
  error?: string;
  national: {
    atlas_confirmed: number; with_rut: number; with_cmf_public: number; with_uaf_public: number;
    psav_confirmed: number; psav_probable: number; business_model_classified: number;
    with_market_metrics: number; refreshed_at: string | null;
  };
  universe_snapshots: UniverseSnapshot[];
  verticals: CountItem[];
  business_models: CountItem[];
  sources: SourceRow[];
  semantics: { mission: string; universe: string; market_weight: string; reserved_boundary: string };
};

type EnrichmentStatus = {
  error?: string;
  facts: number;
  entity_profiles: number;
  candidate_profiles: number;
  identity_hints: number;
  business_model_classified: number;
  target_customer_classified: number;
  revenue_model_classified: number;
  virtual_asset_signal_subjects: number;
  latest_run: { run_id: number; status: string; rows_requested: number; rows_processed: number; rows_failed: number; payment_rows_seen: number; started_at: string; completed_at: string | null } | null;
  refreshed_at: string | null;
};

type FunctionalStatus = {
  error?: string;
  observations: number;
  subjects_profiled: number;
  entities_profiled: number;
  candidates_profiled: number;
  fatf_vasp_subjects: number;
  confirmed_psav: number;
  probable_psav: number;
  exposure_only: number;
  last_run: { run_id: number; status: string; rows_requested: number; rows_processed: number; rows_failed: number; observations_upserted: number; started_at: string; completed_at: string | null } | null;
  function_distribution: Array<{ function_code: string; label: string; group: string; fatf_vasp: boolean; count: number }>;
  method_note: string;
};

type FunctionalRow = {
  function_code: string; label: string; group: string; fatf_vasp: boolean; evidence_status: string;
  confidence: number; basis: string | null; source_code: string | null; source_url: string | null;
  evidence_excerpt: string | null; observed_at: string;
};
type FootprintRow = {
  function_code: string; label: string; fatf_vasp: boolean; status: string; explanation: string;
  regulatory_evidence: unknown[]; confidence: number; observed_at: string;
};
type FunctionalDetail = {
  error?: string;
  psav_status: string;
  psav_basis: string | null;
  psav_confidence: number | null;
  psav_refreshed_at: string | null;
  functions: FunctionalRow[];
  public_footprint: FootprintRow[];
  method_note: string;
};

type SearchRow = {
  fintech_id: string; atlas_entity_id: string | null; rut: string | null; brand: string | null; legal_name: string;
  vertical: string | null; business_model: string | null; target_customer: string | null; revenue_model: string | null;
  psav_status: string; operating_status: string; operating_status_as_of: string | null; actor_kind: string | null;
  region: string | null; commune: string | null; sii_main_activity: string | null;
  sales_band: string | null; sales_band_rank: number | null; workers: number | null;
  has_cmf_public: boolean; has_uaf_public: boolean; market_metric_count: number; last_seen_at: string; confidence: number;
};
type SearchData = { error?: string; total: number; rows: SearchRow[] };

type DetailEntity = {
  fintech_id: string; atlas_entity_id: string | null; rut: string | null; brand: string | null; legal_name: string;
  website: string | null; origin_country: string | null; presence_chile: string; entity_status: string;
  identification_status: string; identification_basis: string; primary_vertical: string | null;
  business_model: string | null; target_customer: string | null; revenue_model: string | null; psav_status: string;
  operating_status: string; operating_status_basis: string | null; operating_status_source_code: string | null;
  operating_status_source_url: string | null; operating_status_as_of: string | null; actor_kind: string | null;
  lifecycle_basis: string | null; lifecycle_validated_at: string | null;
  confidence: number; region: string | null; commune: string | null; sii_main_activity: string | null;
  sii_economic_sector: string | null; sii_sales_band: string | null; sii_sales_band_rank: number | null;
  sii_workers: number | null; sii_activity_start_date: string | null; uaf_sector_canonical: string | null;
  has_cmf_public: boolean; has_uaf_public: boolean; market_metric_count: number; first_seen_at: string; last_seen_at: string;
};
type RegulatoryRow = {
  regulator: string; registry: string; service: string; status: string; registration_no: string | null;
  effective_date: string | null; source_url: string | null; observed_at: string;
};
type MetricRow = {
  metric_id: number; metric_code: string; value_numeric: number | null; value_text: string | null; unit: string | null;
  currency: string | null; period_start: string | null; period_end: string | null; evidence_type: string; confidence: number | null;
  source_code: string | null; source_url: string | null; observed_at: string;
};
type ActivityRow = { activity_code: string; activity_label: string; activity_group: string | null; is_primary: boolean; confidence: number };
type EventRow = { event_id: number; event_type: string; event_date: string | null; title: string; summary: string | null; source_url: string | null };
type EvidenceSource = { source_code: string; catalog_label: string; authority_level: string; source_url: string | null; status: string; first_seen_at: string; last_seen_at: string };
type RelationshipRow = {
  relationship_id: number; subject_type: string; subject_key: string; relation_type: string;
  target_fintech_id: string | null; target_rut: string | null; target_atlas_entity_id: string | null; target_label: string;
  valid_from: string | null; valid_to: string | null; source_code: string | null; source_url: string | null;
  evidence_basis: string; confidence: number; active: boolean; metadata: Record<string, unknown>;
};
type DetailData = {
  error?: string;
  entity: DetailEntity;
  activities: ActivityRow[];
  regulation: RegulatoryRow[];
  market_metrics: MetricRow[];
  events: EventRow[];
  relationships: RelationshipRow[];
  sources: EvidenceSource[];
  market_weight: { sales_band: string | null; sales_band_rank: number | null; workers: number | null; metric_count: number; note: string };
  boundary_note: string;
};

type Filters = { vertical: string; model: string; psav: string; regulator: string };
const EMPTY: Filters = { vertical: '', model: '', psav: 'TODOS', regulator: 'TODOS' };

export function Fintech({ onNavigate }: { onNavigate: (hash: string) => void }) {
  const dashboard = useRpc<Dashboard>('obs_fintech_dashboard', {});
  const enrichment = useRpc<EnrichmentStatus>('obs_fintech_enrichment_status', {});
  const functional = useRpc<FunctionalStatus>('obs_fintech_functional_status', {});
  const [query, setQuery] = useState('');
  const q = useDebounced(query, 220);
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const search = useRpc<SearchData>('obs_fintech_search', {
    p_q: q || null,
    p_vertical: filters.vertical || null,
    p_model: filters.model || null,
    p_psav: filters.psav,
    p_regulator: filters.regulator,
    p_limit: PAGE_SIZE,
    p_offset: page * PAGE_SIZE,
  });
  const detail = useRpc<DetailData>('obs_fintech_entity_detail', { p_fintech_id: selected }, { skip: !selected });
  const functionDetail = useRpc<FunctionalDetail>('obs_fintech_function_detail', { p_fintech_id: selected }, { skip: !selected });

  useEffect(() => {
    const rows = search.data?.rows ?? [];
    if (!rows.length) { setSelected(null); return; }
    if (!selected || !rows.some((row) => row.fintech_id === selected)) setSelected(rows[0].fintech_id);
  }, [search.data?.rows, selected]);

  const verticalOptions = useMemo(() => (dashboard.data?.verticals ?? []).map((x) => x.label).filter((x) => x !== 'Por clasificar'), [dashboard.data]);
  const modelOptions = useMemo(() => (dashboard.data?.business_models ?? []).map((x) => x.label), [dashboard.data]);
  const pages = Math.max(1, Math.ceil((search.data?.total ?? 0) / PAGE_SIZE));

  function setFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(0);
  }
  function reset() { setQuery(''); setFilters(EMPTY); setPage(0); }

  async function exportSnapshot() {
    setExporting(true);
    try {
      const { data, error } = await supabase.rpc('obs_fintech_export');
      if (error) throw error;
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `atlas-fintech-corte-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      window.alert(`No fue posible exportar el corte: ${(e as Error).message}`);
    } finally { setExporting(false); }
  }

  if (dashboard.loading) return <Loading label="Construyendo radar Fintech y Activos Virtuales…" />;
  if (dashboard.error) return <ErrorBox error={dashboard.error} onRetry={dashboard.reload} />;
  if (!dashboard.data || dashboard.data.error) return <ErrorBox error="No fue posible leer el radar Fintech autorizado." onRetry={dashboard.reload} />;

  const d = dashboard.data;
  const n = d.national;
  const er = enrichment.data && !enrichment.data.error ? enrichment.data : null;
  const fs = functional.data && !functional.data.error ? functional.data : null;
  const newest = d.universe_snapshots[0];

  return <div className="fintech-page fade-in">
    <header className="fintech-head">
      <div>
        <div className="fintech-kicker">Inteligencia de mercado · fuentes abiertas · Chile</div>
        <h1>Fintech &amp; Activos Virtuales <span>|</span> Radar de mercado</h1>
        <p>Quiénes son, qué función financiera explotan, cuánto pesan y cómo cambia el ecosistema. Sin calificación de riesgo LA/FT.</p>
      </div>
      <div className="fintech-actions">
        <div className="fintech-cut"><b>Corte ATLAS</b><span>{formatDateTime(n.refreshed_at)}</span></div>
        <button onClick={exportSnapshot} disabled={exporting}>{exporting ? 'Exportando…' : 'Exportar corte abierto'}</button>
      </div>
    </header>

    <section className="fintech-section">
      <SectionTitle index="1" title="Universo y cobertura" hint="Separamos los cortes publicados por la industria del universo individualizado y deduplicado por ATLAS." />
      <div className="fintech-context-grid">
        <article className="fintech-hero">
          <span>Universo de referencia más reciente</span>
          <strong>{formatNumber(newest?.reported_total)}</strong>
          <b>{newest?.source_label ?? 'Fuente pendiente'}</b>
          <small>Corte {formatDate(newest?.source_date)} · no equivale a padrón legal</small>
        </article>
        <article className="fintech-card">
          <span>ATLAS individualizado</span><strong>{formatNumber(n.atlas_confirmed)}</strong>
          <small>{formatNumber(n.with_rut)} con RUT · subconjunto confirmado</small>
        </article>
        <article className="fintech-card">
          <span>Huella regulatoria pública</span><strong>{formatNumber(n.with_uaf_public)}</strong>
          <small>UAF pública · CMF vinculada: {formatNumber(n.with_cmf_public)}</small>
        </article>
        <article className="fintech-card">
          <span>PSAV funcional · fuente abierta</span><strong>{formatNumber(n.psav_confirmed + n.psav_probable)}</strong>
          <small>{formatNumber(n.psav_confirmed)} confirmados · {formatNumber(n.psav_probable)} probables</small>
        </article>
      </div>
      <UniverseSnapshots rows={d.universe_snapshots} />
    </section>

    <section className="fintech-section">
      <SectionTitle index="2" title="Modelo de negocio y función" hint="ATLAS distingue vertical, cliente, monetización y función financiera. Para activos virtuales usa una matriz funcional basada en GAFI/FATF y evidencia abierta trazable." />
      <div className="fintech-model-grid">
        <Distribution title="Vertical principal" rows={d.verticals} total={n.atlas_confirmed} active={filters.vertical} onPick={(v) => setFilter('vertical', filters.vertical === v ? '' : v)} />
        <Distribution title="Modelo de negocio" rows={d.business_models} total={n.atlas_confirmed} active={filters.model} onPick={(v) => setFilter('model', filters.model === v ? '' : v)} />
        <article className="fintech-method-card">
          <span className="eyebrow">Cobertura de caracterización</span>
          <strong>{formatPct(n.business_model_classified, n.atlas_confirmed)}</strong>
          <p>Entidades confirmadas con modelo B2B/B2C/B2B2C clasificado. Las funciones se determinan por separado y pueden provenir de evidencia corporativa u oficial.</p>
          <div className="fintech-progress"><i style={{ width: `${pct(n.business_model_classified, n.atlas_confirmed)}%` }} /></div>
          <small>Un candidato nunca se suma al universo confirmado sólo por su función observada.</small>
        </article>
      </div>

      {fs && <>
        <div className="fintech-universe-strip">
          <article><div><b>Funciones observadas</b><span>matriz funcional</span></div><strong>{formatNumber(fs.observations)}</strong><p>observaciones estructuradas</p><small>Fuente, URL, evidencia, confianza y fecha.</small></article>
          <article><div><b>Actores perfilados</b><span>entidades + candidatos</span></div><strong>{formatNumber(fs.subjects_profiled)}</strong><p>{formatNumber(fs.entities_profiled)} confirmados · {formatNumber(fs.candidates_profiled)} candidatos</p><small>Los candidatos se mantienen fuera del total ATLAS.</small></article>
          <article><div><b>Funciones GAFI/VASP</b><span>fuente abierta</span></div><strong>{formatNumber(fs.fatf_vasp_subjects)}</strong><p>actores con al menos una función funcional VA</p><small>No equivale por sí solo a una conclusión jurídica sobre su condición regulatoria.</small></article>
          <article><div><b>PSAV en universo confirmado</b><span>{fs.last_run?.status ?? 'n/d'}</span></div><strong>{formatNumber(fs.confirmed_psav)}</strong><p>{formatNumber(fs.probable_psav)} probables · {formatNumber(fs.exposure_only)} sólo exposición AV</p><small>{fs.last_run ? `Último lote #${fs.last_run.run_id} · ${formatDateTime(fs.last_run.completed_at ?? fs.last_run.started_at)}` : 'Sin ejecución registrada'}</small></article>
        </div>
        {fs.function_distribution.length > 0 && <article className="fintech-distribution">
          <div className="fintech-card-head"><b>Funciones con mayor presencia observable</b><span>confirmados + candidatos perfilados</span></div>
          <div className="fintech-bars">{fs.function_distribution.slice(0, 8).map((r) => <div key={r.function_code} className="fintech-line"><span>{r.fatf_vasp ? 'GAFI / VASP' : r.group.replaceAll('_',' ')}</span><b>{r.label}</b><small>{formatNumber(r.count)} actores</small></div>)}</div>
        </article>}
        <div className="fintech-boundary"><b>Lectura funcional</b><span>{fs.method_note}</span></div>
      </>}

      {er && <div className="fintech-universe-strip">
        <article><div><b>Motor de enriquecimiento</b><span>{formatDateTime(er.refreshed_at)}</span></div><strong>{formatNumber(er.facts)}</strong><p>evidencias estructuradas</p><small>Base de identidad, producto, cliente, monetización y presencia.</small></article>
        <article><div><b>Candidatos perfilados</b><span>fuera del total confirmado</span></div><strong>{formatNumber(er.candidate_profiles)}</strong><p>con huella corporativa procesada</p><small>Se mantienen separados hasta resolver identidad y pertenencia Fintech.</small></article>
        <article><div><b>Señales AV brutas</b><span>preclasificación</span></div><strong>{formatNumber(er.virtual_asset_signal_subjects)}</strong><p>actores con términos AV detectados</p><small>La matriz funcional aplica luego reglas más exigentes de contexto y proximidad.</small></article>
        <article><div><b>Último enriquecimiento</b><span>{er.latest_run?.status ?? 'n/d'}</span></div><strong>{formatNumber(er.latest_run?.rows_processed)}</strong><p>perfiles procesados · {formatNumber(er.latest_run?.payment_rows_seen)} actores CMF pagos observados</p><small>{er.latest_run ? `${formatNumber(er.latest_run.rows_failed)} fallidos · lote #${er.latest_run.run_id}` : 'Sin ejecución registrada'}</small></article>
      </div>}
    </section>

    <section className="fintech-section">
      <SectionTitle index="3" title="Peso de mercado observable" hint="No existe un score universal: se comparan métricas homogéneas dentro de cada vertical y siempre con fuente y fecha." />
      <div className="fintech-weight-grid">
        <article className="fintech-weight-rule">
          <b>Cómo leer el peso</b>
          <div><span>1</span><p><strong>Escala económica</strong> ventas abiertas, trabajadores e ingresos publicados.</p></div>
          <div><span>2</span><p><strong>Actividad del negocio</strong> TPV, originación, AUM/AUC, volumen cripto, remesas o equivalente.</p></div>
          <div><span>3</span><p><strong>Alcance</strong> clientes, comercios, usuarios activos, países y cuota de mercado.</p></div>
          <div><span>4</span><p><strong>Capital</strong> rondas, deuda, adquisiciones y financiamiento declarado.</p></div>
        </article>
        <article className="fintech-coverage-card">
          <span>Métricas de mercado a nivel entidad</span><strong>{formatNumber(n.with_market_metrics)}</strong>
          <small>con al menos una métrica estructurada adicional</small>
          <p>Mientras se completa la ingesta, la ficha muestra como proxy inicial el tramo de ventas y trabajadores disponibles en fuentes abiertas SII.</p>
        </article>
        <article className="fintech-warning-card">
          <b>Regla metodológica</b>
          <p><strong>Sin dato abierto ≠ actor pequeño.</strong> Un dato ausente se marca como “no observable”; nunca se transforma en cero ni penaliza a la entidad.</p>
          <span>OBSERVADO OFICIAL · DECLARADO · INFERIDO · NO OBSERVABLE</span>
        </article>
      </div>
    </section>

    <section className="fintech-section">
      <SectionTitle index="4" title="Explorar el ecosistema" hint="Buscar por marca, razón social o RUT; filtrar y bajar a una ficha funcional antes de abrir Entidad 360." />
      <div className="fintech-explorer">
        <div className="fintech-list-panel">
          <div className="fintech-filters">
            <label className="fintech-search"><span>⌕</span><input value={query} onChange={(e) => { setQuery(e.target.value); setPage(0); }} placeholder="Marca, razón social o RUT…" /></label>
            <Select label="Vertical" value={filters.vertical} options={verticalOptions} onChange={(v) => setFilter('vertical', v)} />
            <Select label="Modelo" value={filters.model} options={modelOptions} onChange={(v) => setFilter('model', v)} />
            <Select label="PSAV" value={filters.psav} options={['TODOS','CONFIRMED','PROBABLE','EXPOSURE','NO_EVIDENCE']} labels={{ TODOS:'Todos', CONFIRMED:'Función PSAV confirmada', PROBABLE:'Probable', EXPOSURE:'Exposición AV', NO_EVIDENCE:'Sin evidencia funcional' }} noEmpty onChange={(v) => setFilter('psav', v)} />
            <Select label="Registro público" value={filters.regulator} options={['TODOS','CMF','UAF']} labels={{ TODOS:'Todos', CMF:'CMF', UAF:'UAF' }} noEmpty onChange={(v) => setFilter('regulator', v)} />
            <button className="fintech-clear" onClick={reset}>Limpiar</button>
          </div>
          <div className="fintech-results-head"><div><b>Entidades confirmadas</b><span>{search.loading ? 'Actualizando…' : `${formatNumber(search.data?.total ?? 0)} resultados`}</span></div><span>Página {Math.min(page + 1, pages)} / {pages}</span></div>
          {search.error ? <ErrorBox error={search.error} onRetry={search.reload} /> : <EntityTable rows={search.data?.rows ?? []} selected={selected} onSelect={setSelected} />}
          <div className="fintech-pagination"><button disabled={page === 0} onClick={() => setPage((x) => Math.max(0, x - 1))}>‹</button><span>{page + 1}</span><button disabled={page + 1 >= pages} onClick={() => setPage((x) => Math.min(pages - 1, x + 1))}>›</button></div>
        </div>
        <DetailPanel data={detail.data} functional={functionDetail.data} loading={detail.loading || functionDetail.loading} error={detail.error || functionDetail.error} onRetry={() => { detail.reload(); functionDetail.reload(); }} onOpen={(id) => onNavigate(`#/entidad/${encodeURIComponent(id)}`)} />
      </div>
    </section>

    <section className="fintech-section fintech-sources-section">
      <SectionTitle index="5" title="Fuentes y frescura" hint="Cada afirmación debe poder regresar a su fuente. La discrepancia entre fuentes se conserva, no se oculta." />
      <div className="fintech-source-list">{d.sources.map((s) => <article key={s.source_code}><div><b>{s.label}</b><span>{s.authority_level.replaceAll('_',' ')}</span></div><p>{s.notes}</p><div><small>{s.cadence ?? 'Sin cadencia'}</small><strong>{formatNumber(s.entity_count)} entidades enlazadas</strong></div></article>)}</div>
      <div className="fintech-boundary"><b>Límite del radar</b><span>{d.semantics.reserved_boundary}</span></div>
    </section>
  </div>;
}

function SectionTitle({ index, title, hint }: { index: string; title: string; hint: string }) {
  return <div className="fintech-section-title"><h2><span>{index}.</span> {title}</h2><p>{hint}</p></div>;
}

function UniverseSnapshots({ rows }: { rows: UniverseSnapshot[] }) {
  return <div className="fintech-universe-strip">{rows.map((r) => <article key={r.snapshot_key}>
    <div><b>{r.source_label}</b><span>{formatDate(r.source_date)}</span></div>
    <strong>{formatNumber(r.reported_total)}</strong>
    <p>{r.local_total != null ? `${formatNumber(r.local_total)} locales` : 'Locales: n/d'}{r.foreign_total != null ? ` · ${formatNumber(r.foreign_total)} extranjeras` : ''}</p>
    <small>{r.methodology_note}</small>
  </article>)}</div>;
}

function Distribution({ title, rows, total, active, onPick }: { title: string; rows: CountItem[]; total: number; active: string; onPick: (v: string) => void }) {
  const max = Math.max(1, ...rows.map((x) => x.count));
  return <article className="fintech-distribution"><div className="fintech-card-head"><b>{title}</b><span>{formatNumber(total)} entidades</span></div>
    <div className="fintech-bars">{rows.slice(0, 7).map((r) => <button key={r.label} data-active={active === r.label} onClick={() => onPick(r.label)}><span>{r.label}</span><i><em style={{ width: `${(r.count / max) * 100}%` }} /></i><strong>{formatNumber(r.count)}</strong></button>)}</div>
  </article>;
}

function EntityTable({ rows, selected, onSelect }: { rows: SearchRow[]; selected: string | null; onSelect: (id: string) => void }) {
  if (!rows.length) return <div className="fintech-empty">No hay entidades para los filtros actuales.</div>;
  return <div className="fintech-table"><div className="fintech-tr fintech-th"><span>Entidad</span><span>Vertical</span><span>Escala abierta</span><span>Huella</span></div>
    {rows.map((r) => <button key={r.fintech_id} className="fintech-tr" data-active={selected === r.fintech_id} onClick={() => onSelect(r.fintech_id)}>
      <span><b>{r.brand || r.legal_name}</b><small>{r.rut ?? 'RUT no resuelto'} · {operatingLabel(r.operating_status)}</small></span>
      <span><b>{r.vertical ?? 'Por clasificar'}</b><small>{r.business_model ?? 'Modelo por clasificar'}{r.actor_kind ? ` · ${actorKindLabel(r.actor_kind)}` : ''}</small></span>
      <span><b>{r.sales_band ? `Tramo SII ${r.sales_band}` : 'No observable'}</b><small>{r.workers != null ? `${formatNumber(r.workers)} trabajadores` : 'Trabajadores n/d'}</small></span>
      <span className="fintech-badges">{r.operating_status !== 'UNKNOWN' && <em>{operatingShort(r.operating_status)}</em>}{r.has_cmf_public && <em>CMF</em>}{r.has_uaf_public && <em>UAF</em>}{r.psav_status !== 'NO_EVIDENCE' && <em>AV</em>}</span>
    </button>)}
  </div>;
}

function DetailPanel({ data, functional, loading, error, onRetry, onOpen }: { data: DetailData | null; functional: FunctionalDetail | null; loading: boolean; error: string | null; onRetry: () => void; onOpen: (id: string) => void }) {
  if (loading) return <aside className="fintech-detail"><Loading label="Caracterizando entidad…" /></aside>;
  if (error) return <aside className="fintech-detail"><ErrorBox error={error} onRetry={onRetry} /></aside>;
  if (!data?.entity) return <aside className="fintech-detail fintech-empty">Selecciona una entidad para profundizar.</aside>;
  const e = data.entity;
  const fd = functional && !functional.error ? functional : null;
  return <aside className="fintech-detail">
    <div className="fintech-detail-head"><div><span>{e.primary_vertical ?? 'Vertical por clasificar'}</span><h3>{e.brand || e.legal_name}</h3><p>{e.rut ?? 'RUT no resuelto'} · {[e.commune,e.region].filter(Boolean).join(', ') || 'Ubicación n/d'}</p></div><span className="fintech-confidence">{Math.round((e.confidence ?? 0) * 100)}%<small>identidad</small></span></div>
    <div className="fintech-detail-tags"><em>{operatingLabel(e.operating_status)}</em>{e.actor_kind && <em>{actorKindLabel(e.actor_kind)}</em>}<em>{e.business_model ?? 'Modelo por clasificar'}</em><em>{psavLabel(fd?.psav_status ?? e.psav_status)}</em>{e.has_uaf_public && <em>UAF público</em>}{e.has_cmf_public && <em>CMF</em>}</div>
    <div className="fintech-detail-grid">
      <div><span>Actividad SII</span><b>{e.sii_main_activity ?? 'No observada'}</b></div>
      <div><span>Ventas</span><b>{e.sii_sales_band ? `Tramo ${e.sii_sales_band}` : 'No observable'}</b></div>
      <div><span>Trabajadores</span><b>{e.sii_workers != null ? formatNumber(e.sii_workers) : 'n/d'}</b></div>
      <div><span>Estado operativo</span><b>{operatingLabel(e.operating_status)}</b></div>
    </div>

    <Block title="Estado y vigencia">
      <div className="fintech-line"><span>{e.operating_status_as_of ? `Corte ${formatDate(e.operating_status_as_of)}` : 'Corte no informado'}</span><b>{operatingLabel(e.operating_status)}</b><small>{e.operating_status_basis ?? e.lifecycle_basis ?? 'Sin fundamento de vigencia estructurado todavía.'}</small></div>
    </Block>

    {data.relationships?.length > 0 && <Block title="Relaciones corporativas">
      {data.relationships.map((r) => <div className="fintech-line" key={r.relationship_id}>
        <span>{relationshipLabel(r.relation_type)}</span><b>{r.target_label}{r.target_rut ? ` · ${r.target_rut}` : ''}</b><small>{Math.round(r.confidence * 100)}% · {r.source_code ?? 'fuente abierta'}{r.evidence_basis ? ` · ${r.evidence_basis}` : ''}</small>
      </div>)}
    </Block>}

    <Block title="Vector funcional">
      {fd?.functions.length ? fd.functions.map((f) => <div className="fintech-line" key={`${f.function_code}-${f.source_url ?? ''}-${f.evidence_status}`}>
        <span>{f.fatf_vasp ? 'GAFI / VASP' : f.group.replaceAll('_',' ')}</span>
        <b>{f.label}</b>
        <small>{evidenceLabel(f.evidence_status)} · {Math.round(f.confidence * 100)}%{f.source_code ? ` · ${f.source_code}` : ''}{f.source_url ? ' · evidencia ↗' : ''}</small>
      </div>) : <p className="fintech-muted">Sin funciones estructuradas observadas todavía. La ausencia de evidencia abierta no equivale a ausencia de actividad.</p>}
    </Block>

    {fd?.functions.some((f) => f.fatf_vasp) && <Block title="Huella pública vs función GAFI">
      {fd.public_footprint.filter((x) => x.fatf_vasp).map((x) => <div className="fintech-line" key={x.function_code}>
        <span>{footprintLabel(x.status)}</span><b>{x.label}</b><small>{x.explanation}</small>
      </div>)}
      <p className="fintech-muted">Esta comparación describe cobertura de fuentes públicas. No determina obligación, autorización, cumplimiento ni incumplimiento.</p>
    </Block>}

    <Block title="Huella regulatoria">{data.regulation.length ? data.regulation.map((r) => <div className="fintech-line" key={`${r.regulator}-${r.registry}-${r.service}`}><span>{r.regulator}</span><b>{r.status.replaceAll('_',' ')}</b><small>{r.service}</small></div>) : <p className="fintech-muted">Sin vínculo regulatorio estructurado todavía.</p>}</Block>
    <Block title="Actividad / productos">{data.activities.length ? data.activities.map((a) => <div className="fintech-line" key={a.activity_code}><span>{a.activity_group ?? 'Actividad'}</span><b>{a.activity_label}</b></div>) : <p className="fintech-muted">Pendiente de clasificación adicional desde fuentes corporativas y regulatorias abiertas.</p>}</Block>
    {data.events?.length > 0 && <Block title="Línea de tiempo">{data.events.slice(0, 6).map((ev) => <div className="fintech-line" key={ev.event_id}><span>{formatDate(ev.event_date)}</span><b>{ev.title}</b><small>{ev.event_type.replaceAll('_',' ')}{ev.summary ? ` · ${ev.summary}` : ''}</small></div>)}</Block>}
    <Block title="Evidencia de mercado">{data.market_metrics.length ? data.market_metrics.slice(0, 5).map((m) => <div className="fintech-line" key={m.metric_id}><span>{m.metric_code}</span><b>{metricValue(m)}</b><small>{m.evidence_type.replaceAll('_',' ')}</small></div>) : <p className="fintech-muted">Aún sin métricas transaccionales estructuradas. El tramo de ventas y trabajadores funciona sólo como proxy inicial.</p>}</Block>
    <Block title="Fuentes enlazadas">{data.sources.map((s) => <div className="fintech-line" key={s.source_code}><span>{s.source_code}</span><b>{s.catalog_label}</b><small>{formatDate(s.last_seen_at)}</small></div>)}</Block>
    <div className="fintech-detail-note">{fd?.method_note ?? data.boundary_note}</div>
    {e.atlas_entity_id && <button className="fintech-open360" onClick={() => onOpen(e.atlas_entity_id!)}>Abrir Entidad 360 →</button>}
  </aside>;
}

function Block({ title, children }: { title: string; children: ReactNode }) { return <section className="fintech-detail-block"><h4>{title}</h4>{children}</section>; }

function Select({ label, value, options, labels = {}, noEmpty = false, onChange }: { label: string; value: string; options: string[]; labels?: Record<string,string>; noEmpty?: boolean; onChange: (v: string) => void }) {
  return <label className="fintech-select"><span>{label}</span><select value={value} onChange={(e) => onChange(e.target.value)}>{!noEmpty && <option value="">Todos</option>}{options.map((x) => <option key={x} value={x}>{labels[x] ?? x}</option>)}</select></label>;
}

function metricValue(m: MetricRow) { if (m.value_numeric != null) return `${m.currency ? `${m.currency} ` : ''}${formatNumber(m.value_numeric)}${m.unit ? ` ${m.unit}` : ''}`; return m.value_text ?? 'n/d'; }
function psavLabel(v: string) { return ({ CONFIRMED:'PSAV funcional confirmado', PROBABLE:'PSAV funcional probable', EXPOSURE:'Exposición a AV', NO_EVIDENCE:'Sin evidencia funcional PSAV' } as Record<string,string>)[v] ?? v; }
function evidenceLabel(v: string) { return ({ OBSERVED:'Observado', PROBABLE:'Probable', SIGNAL:'Señal' } as Record<string,string>)[v] ?? v; }
function footprintLabel(v: string) { return ({ DIRECT_EQUIVALENT_OBSERVED:'Equivalente directo observado', RELATED_PUBLIC_FOOTPRINT:'Huella pública relacionada', NO_PUBLIC_EQUIVALENT_OBSERVED:'Sin equivalente público observado', NOT_ASSESSED:'No evaluado' } as Record<string,string>)[v] ?? v; }
function relationshipLabel(v: string) { return ({ PRODUCT_OF:'Producto de', BRAND_OF:'Marca de', LEGAL_VEHICLE_OF:'Vehículo legal de', ACQUIRED_BY:'Adquirido por', SUCCESSOR_OF:'Sucesor de', PREDECESSOR_OF:'Predecesor de', OPERATED_BY:'Operado por', CONTROLLED_BY:'Controlado por' } as Record<string,string>)[v] ?? v.replaceAll('_',' '); }
function operatingLabel(v: string) { return ({ ACTIVE:'Activo observado', LIMITED:'Operación limitada', NO_NEW_BUSINESS:'Sin nuevos negocios', CEASED:'Operación cesada', UNKNOWN:'Vigencia por validar' } as Record<string,string>)[v] ?? v; }
function operatingShort(v: string) { return ({ ACTIVE:'ACTIVO', LIMITED:'LIMITADO', NO_NEW_BUSINESS:'SIN ALTAS', CEASED:'CESADO', UNKNOWN:'POR VALIDAR' } as Record<string,string>)[v] ?? v; }
function actorKindLabel(v: string) { return ({ LEGAL_ENTITY:'Entidad jurídica', FOREIGN_ACTOR:'Actor extranjero', PRODUCT:'Producto', BRAND:'Marca', MULTI_LEGAL_BRAND:'Marca multivehículo', ACTOR:'Actor' } as Record<string,string>)[v] ?? v.replaceAll('_',' '); }
function pct(a: number, b: number) { return b > 0 ? Math.min(100, Math.round((a / b) * 100)) : 0; }
function formatPct(a: number, b: number) { return `${pct(a,b)}%`; }
function formatNumber(v: number | null | undefined) { return v == null ? 'n/d' : new Intl.NumberFormat('es-CL').format(v); }
function formatDate(v: string | null | undefined) { if (!v) return 'n/d'; return new Intl.DateTimeFormat('es-CL', { day:'2-digit', month:'short', year:'numeric' }).format(new Date(v)); }
function formatDateTime(v: string | null | undefined) { if (!v) return 'n/d'; return new Intl.DateTimeFormat('es-CL', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }).format(new Date(v)); }
