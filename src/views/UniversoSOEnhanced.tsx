import { useEffect, useMemo, useState } from 'react';
import { useRpc } from '../lib/rpc';
import { hrefFor } from '../lib/router';
import type {
  SectorOverview,
  UafPotential,
  UafPotentialCandidate,
  UafPulse,
  UafReportingSector,
  UafSubjectRow,
} from '../lib/contracts';
import { CohortDrawer, type CohortRequest } from '../components/CohortDrawer';
import { Empty, ErrorBox, Loading, Panel, Semantics } from '../components/primitives';
import { fecha, n, n1, rutFormat, titleCase } from '../lib/format';
import '../styles/universo-so-enhanced.css';

type Mode = 'padron' | 'brechas' | 'gestion';
type Queue = 'desinscripcion' | 'inscripcion';
type ManageKind = 'DESINSCRIPCION' | 'INSCRIPCION';
type ManageStatus = 'PENDIENTE' | 'CONTACTO_REVISADO' | 'LISTO_SOLICITUD';
type SectorLens = 'gestion' | 'reportabilidad' | 'perfil';
type ReportMetric = 'ros' | 'intensidad' | 'icr';
type SectorFilter = 'todos' | 'atencion' | 'termino' | 'sancion' | 'potencial';

interface ManageItem {
  kind: ManageKind;
  rut: string;
  name: string;
  sector: string | null;
  entityId: string | null;
  region: string | null;
  reason: string;
}

type RegistryTotal = {
  year: number;
  total: number;
  as_of_date: string;
  source_kind: string;
  source_label: string;
  source_url: string | null;
  note: string | null;
};

type RegistryEvolution = {
  total: RegistryTotal[];
  increases: unknown[];
  decreases: unknown[];
  note: string;
};

type SectorVisualRow = UafPulse['by_sector'][number] & {
  siiCoverage: number | null;
  vulnerability: number | null;
  sanctionRate: number | null;
  topRegion: string | null;
  topRegionShare: number | null;
  potential: number;
  observed: number;
  ros2025: number | null;
  intensity: number | null;
  icr: number | null;
  deltaRos: number | null;
};

const TERM_PAGE = 200;
const STORAGE_KEY = 'atlas-observatorio-universo-so-management-v1';

const STATUS: Record<ManageStatus, { label: string; tone: string }> = {
  PENDIENTE: { label: 'Pendiente', tone: 'var(--ink-4)' },
  CONTACTO_REVISADO: { label: 'Contacto revisado', tone: 'var(--sig-watch)' },
  LISTO_SOLICITUD: { label: 'Listo para solicitud', tone: 'var(--present)' },
};

const clamp = (v: number) => Math.max(0, Math.min(100, v));
const pct = (part: number, total: number) => total > 0 ? (part / total) * 100 : 0;
const webSearch = (query: string) => `https://www.google.com/search?q=${encodeURIComponent(query)}`;
const managementKey = (item: Pick<ManageItem, 'kind' | 'rut'>) => `${item.kind}|${item.rut}`;

function readStatuses(): Record<string, ManageStatus> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) as Record<string, ManageStatus> : {};
  } catch {
    return {};
  }
}

function termItem(s: UafSubjectRow): ManageItem {
  return {
    kind: 'DESINSCRIPCION',
    rut: s.rut,
    name: s.name,
    sector: s.uaf_sector,
    entityId: s.entity_id,
    region: s.region,
    reason: s.sii_termination_date
      ? `Término de giro observado el ${fecha(s.sii_termination_date)}`
      : 'Término de giro observado ante el SII',
  };
}

function potentialItem(c: UafPotentialCandidate): ManageItem {
  return {
    kind: 'INSCRIPCION',
    rut: c.rut,
    name: c.name,
    sector: c.implied_sector,
    entityId: c.entity_id,
    region: c.region,
    reason: c.matched_activity
      ? `Actividad SII coincidente: ${titleCase(c.matched_activity)}`
      : 'Hipótesis de inscripción derivada de la conciliación SII ↔ UAF',
  };
}

function contactSources(item: ManageItem) {
  const name = item.name.replace(/\s+/g, ' ').trim();
  const rut = rutFormat(item.rut);
  return [
    ['Búsqueda web', 'sitio oficial, contacto, teléfono o correo', webSearch(`"${name}" "${rut}" contacto`)],
    ['Correo / teléfono', 'huellas públicas de contacto', webSearch(`"${name}" ("correo" OR "email" OR "teléfono" OR "contacto")`)],
    ['Mercado Público', 'fichas, órdenes y datos del proveedor', webSearch(`site:mercadopublico.cl "${item.rut}" "${name}"`)],
    ['RES', 'Registro de Empresas y Sociedades', webSearch(`site:registrodeempresasysociedades.cl "${item.rut}"`)],
    ['LinkedIn', 'perfil corporativo y presencia pública', webSearch(`site:linkedin.com/company "${name}" Chile`)],
    ['SII público', 'referencias tributarias indexadas públicamente', webSearch(`site:sii.cl "${item.rut}" "${name}"`)],
  ] as const;
}

export function UniversoSOEnhanced({
  onNavigate,
  initialMode = 'padron',
}: {
  onNavigate: (hash: string) => void;
  initialMode?: Mode;
}) {
  const pulse = useRpc<UafPulse>('obs_uaf_pulse', {});
  const potential = useRpc<UafPotential>('obs_uaf_potential', {});
  const sectors = useRpc<SectorOverview>('obs_sector_overview', {});
  const evolution = useRpc<RegistryEvolution>('obs_uaf_registry_evolution', {});

  const [mode, setMode] = useState<Mode>(initialMode);
  const [cohort, setCohort] = useState<CohortRequest | null>(null);
  const [sectorLens, setSectorLens] = useState<SectorLens>('gestion');
  const [reportMetric, setReportMetric] = useState<ReportMetric>('ros');
  const [sectorSearch, setSectorSearch] = useState('');
  const [sectorFilter, setSectorFilter] = useState<SectorFilter>('todos');
  const [sectorExpanded, setSectorExpanded] = useState(false);
  const [candidateSearch, setCandidateSearch] = useState('');
  const [onlyPending, setOnlyPending] = useState(false);
  const [queue, setQueue] = useState<Queue>('desinscripcion');
  const [termOffset, setTermOffset] = useState(0);
  const [termSearch, setTermSearch] = useState('');
  const [potentialSearch, setPotentialSearch] = useState('');
  const [selected, setSelected] = useState<Record<string, ManageItem>>({});
  const [statuses, setStatuses] = useState<Record<string, ManageStatus>>(readStatuses);
  const [contact, setContact] = useState<ManageItem | null>(null);

  const termQueue = useRpc<UafSubjectRow[]>('obs_uaf_cohort', {
    p_cohort: 'TERMINO_GIRO',
    p_value: null,
    p_limit: TERM_PAGE,
    p_offset: termOffset,
  }, { skip: mode !== 'gestion' || queue !== 'desinscripcion' });

  useEffect(() => setMode(initialMode), [initialMode]);
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(statuses)); } catch { /* sesión privada */ }
  }, [statuses]);

  const actionable = potential.data?.totales?.accionables ?? 0;

  const sectorRows = useMemo<SectorVisualRow[]>(() => {
    const bySector = pulse.data?.by_sector ?? [];
    const detail = new Map((sectors.data?.sectores ?? []).map((row) => [row.uaf_sector_canonical, row]));
    const gaps = new Map((potential.data?.sectores ?? []).map((row) => [row.sector, row]));
    const reporting = new Map(
      (pulse.data?.reporting?.sectores ?? [])
        .filter((row): row is UafReportingSector & { sector_canonical: string } => Boolean(row.sector_canonical))
        .map((row) => [row.sector_canonical, row]),
    );

    return bySector.map((row) => {
      const d = detail.get(row.sector);
      const g = gaps.get(row.sector);
      const r = reporting.get(row.sector);
      return {
        ...row,
        siiCoverage: d?.sii_coverage_pct ?? null,
        vulnerability: d?.vulnerability_index ?? null,
        sanctionRate: d?.sanction_rate_per_100 ?? null,
        topRegion: d?.top_region ?? null,
        topRegionShare: d?.top_region_share_pct ?? null,
        potential: g?.accionables ?? 0,
        observed: g?.observadas ?? 0,
        ros2025: r?.ros_2025 ?? null,
        intensity: r?.ros_per_100_so_2025 ?? null,
        icr: r?.icr_pct ?? null,
        deltaRos: r?.delta_ros_2025_vs_2024_pct ?? null,
      };
    });
  }, [pulse.data, sectors.data, potential.data]);

  const filteredSectors = useMemo(() => {
    const q = sectorSearch.trim().toLowerCase();
    return sectorRows
      .filter((row) => {
        if (q && !row.sector.toLowerCase().includes(q)) return false;
        if (sectorFilter === 'atencion') return row.en_atencion > 0;
        if (sectorFilter === 'termino') return row.terminados > 0;
        if (sectorFilter === 'sancion') return row.sancionados > 0;
        if (sectorFilter === 'potencial') return row.potential > 0;
        return true;
      })
      .sort((a, b) => b.sujetos - a.sujetos);
  }, [sectorRows, sectorSearch, sectorFilter]);

  const candidates = useMemo(() => {
    const q = candidateSearch.trim().toLowerCase();
    return (potential.data?.candidatos ?? [])
      .filter((c) => {
        if (onlyPending && c.review_state) return false;
        if (!q) return true;
        return c.name.toLowerCase().includes(q)
          || c.rut.toLowerCase().includes(q)
          || (c.implied_sector ?? '').toLowerCase().includes(q)
          || (c.matched_activity ?? '').toLowerCase().includes(q);
      })
      .slice()
      .sort((a, b) => (b.ivo_score ?? -1) - (a.ivo_score ?? -1));
  }, [potential.data, candidateSearch, onlyPending]);

  const termRows = useMemo(() => {
    const q = termSearch.trim().toLowerCase();
    return (termQueue.data ?? []).filter((s) => !q
      || s.name.toLowerCase().includes(q)
      || s.rut.toLowerCase().includes(q)
      || (s.uaf_sector ?? '').toLowerCase().includes(q)
      || (s.region ?? '').toLowerCase().includes(q));
  }, [termQueue.data, termSearch]);

  const potentialQueueRows = useMemo(() => {
    const q = potentialSearch.trim().toLowerCase();
    return (potential.data?.candidatos ?? []).filter((c) => !q
      || c.name.toLowerCase().includes(q)
      || c.rut.toLowerCase().includes(q)
      || (c.implied_sector ?? '').toLowerCase().includes(q)
      || (c.matched_activity ?? '').toLowerCase().includes(q));
  }, [potential.data, potentialSearch]);

  const selectedItems = useMemo(() => Object.values(selected), [selected]);

  if (pulse.loading) return <Loading label="Leyendo el universo de sujetos obligados…" />;
  if (pulse.error) return <ErrorBox error={pulse.error} onRetry={pulse.reload} />;
  if (!pulse.data?.universe) {
    return <Empty title="Sin padrón UAF publicado" hint="El snapshot vigente no trae el universo de sujetos obligados." />;
  }

  const data = pulse.data;
  const u = data.universe;
  const cross = data.crosscuts;

  const changeMode = (next: Mode) => {
    setMode(next);
    window.history.replaceState(null, '', hrefFor({ view: 'universo', mode: next }));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const openCohort = (request: CohortRequest) => setCohort(request);
  const openEntity = (entityId: string) => onNavigate(hrefFor({ view: 'ficha', entityId }));

  const toggle = (item: ManageItem) => {
    const key = managementKey(item);
    setSelected((current) => {
      const next = { ...current };
      if (next[key]) delete next[key]; else next[key] = item;
      return next;
    });
  };

  const manage = (item: ManageItem) => {
    setSelected((current) => ({ ...current, [managementKey(item)]: item }));
    setQueue(item.kind === 'DESINSCRIPCION' ? 'desinscripcion' : 'inscripcion');
    changeMode('gestion');
  };

  const setStatus = (item: ManageItem, status: ManageStatus) => {
    setStatuses((current) => ({ ...current, [managementKey(item)]: status }));
  };

  const exportBatch = () => {
    if (!selectedItems.length) return;
    const quote = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const rows = [
      ['accion', 'rut', 'razon_social', 'sector', 'region', 'motivo', 'estado'],
      ...selectedItems.map((item) => [
        item.kind === 'DESINSCRIPCION' ? 'SOLICITAR_DESINSCRIPCION' : 'SOLICITAR_INSCRIPCION',
        rutFormat(item.rut), item.name, item.sector ?? '', item.region ?? '', item.reason,
        statuses[managementKey(item)] ?? 'PENDIENTE',
      ]),
    ];
    const csv = rows.map((row) => row.map((cell) => quote(String(cell))).join(';')).join('\n');
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `atlas_universo_so_gestion_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="uso-view fade-in">
      <header className="uso-head">
        <div>
          <div className="uso-kicker">Padrón UAF · conciliación SII · fuentes abiertas</div>
          <h1>Universo SO</h1>
          <p>Lectura nacional, sectorial y operativa del universo obligado.</p>
        </div>
        <div className="uso-cut">
          <span><b>{n(u.total)}</b> inscritos</span>
          <span><b>{n(u.sectores_uaf)}</b> sectores</span>
          <span>{data.snapshot ? fecha(data.snapshot.published_at ?? data.snapshot.generated_at) : 'corte vigente'}</span>
        </div>
      </header>

      <nav className="uso-modebar" aria-label="Vistas de Universo SO">
        <button data-on={mode === 'padron'} onClick={() => changeMode('padron')}><span>Padrón</span><em>{n(u.total)}</em></button>
        <button data-on={mode === 'brechas'} onClick={() => changeMode('brechas')}><span>Brechas</span><em>{potential.loading ? '…' : n(actionable)}</em></button>
        <button data-on={mode === 'gestion'} onClick={() => changeMode('gestion')}><span>Gestión</span><em>{n(selectedItems.length)}</em></button>
      </nav>

      {mode === 'padron' && (
        <section className="uso-page fade-in">
          <div className="uso-section-label"><span>Pulso Estratégico</span><em>los gráficos abren el universo que representan</em></div>

          <div className="uso-hero-grid">
            <VisualPanel title="Evolución del padrón" meta="stock publicado · 2020–2026" className="uso-span-2">
              {evolution.loading && !evolution.data ? (
                <CompactState>Construyendo serie…</CompactState>
              ) : evolution.data?.total?.length ? (
                <RegistryChart points={evolution.data.total} />
              ) : (
                <CompactState>Serie histórica no disponible en este corte.</CompactState>
              )}
            </VisualPanel>

            <VisualPanel title="Capas sobre el padrón" meta="proporciones independientes">
              <SignalMatrix
                total={u.total}
                rows={[
                  { label: 'Término de giro', value: u.terminados, tone: 'high', onClick: () => openCohort({ cohort: 'TERMINO_GIRO', title: 'Sujetos con término de giro' }) },
                  { label: 'Sanción', value: cross?.sancionados_con_antecedente ?? 0, tone: 'critical', onClick: () => openCohort({ cohort: 'SANCIONADO', title: 'Sujetos con antecedente sancionatorio' }) },
                  { label: 'Prensa', value: cross?.prensa ?? 0, tone: 'watch', onClick: () => openCohort({ cohort: 'PRENSA', title: 'Sujetos con presencia en prensa' }) },
                  { label: 'OSFL', value: cross?.osfl ?? 0, tone: 'unknown', onClick: () => openCohort({ cohort: 'OSFL', title: 'Sujetos obligados que además son OSFL' }) },
                  { label: 'Proveedor Estado', value: cross?.proveedores ?? 0, tone: 'accent', onClick: () => openCohort({ cohort: 'PROVEEDOR_ESTADO', title: 'Sujetos obligados proveedores del Estado' }) },
                ]}
              />
            </VisualPanel>
          </div>

          <div className="uso-visual-grid">
            <VisualPanel title="Mapa sectorial" meta="cada círculo es un sector" className="uso-span-2">
              <div className="uso-chart-toolbar">
                <div className="uso-seg">
                  <button data-on={sectorLens === 'gestion'} onClick={() => setSectorLens('gestion')}>Gestión</button>
                  <button data-on={sectorLens === 'reportabilidad'} onClick={() => setSectorLens('reportabilidad')}>Reportabilidad</button>
                  <button data-on={sectorLens === 'perfil'} onClick={() => setSectorLens('perfil')}>Perfil</button>
                </div>
                <span>Tamaño del círculo = nº de SO</span>
              </div>
              <SectorMap rows={sectorRows} lens={sectorLens} onPick={(sector) => openCohort({ cohort: 'SECTOR', value: sector, title: titleCase(sector) })} />
            </VisualPanel>

            <VisualPanel title="Reportabilidad sectorial" meta="Informe Estadístico UAF">
              <div className="uso-chart-toolbar uso-chart-toolbar-tight">
                <div className="uso-seg">
                  <button data-on={reportMetric === 'ros'} onClick={() => setReportMetric('ros')}>ROS 2025</button>
                  <button data-on={reportMetric === 'intensidad'} onClick={() => setReportMetric('intensidad')}>ROS / 100 SO</button>
                  <button data-on={reportMetric === 'icr'} onClick={() => setReportMetric('icr')}>ICR</button>
                </div>
              </div>
              <ReportingBars rows={sectorRows} metric={reportMetric} onPick={(sector) => openCohort({ cohort: 'SECTOR', value: sector, title: titleCase(sector) })} />
            </VisualPanel>

            <VisualPanel title="Ciclo tributario" meta="inicio de actividades vs término de giro">
              <LifecycleChart started={data.lifecycle.started_by_year} terminated={data.lifecycle.terminated_by_year} />
            </VisualPanel>

            <VisualPanel title="Prioridad fiscalizadora" meta="distribución IPF">
              <BandStack rows={data.ipf_bands.map((row) => ({ label: row.banda, value: row.sujetos }))} total={u.con_ipf} />
              <button className="uso-panel-link" onClick={() => openCohort({ cohort: 'IPF_ALTO', title: 'Sujetos con IPF alta o muy alta' })}>Abrir IPF alta / muy alta →</button>
            </VisualPanel>
          </div>

          <div className="uso-context-grid">
            <VisualPanel title="Territorio" meta={`${n(u.con_territorio)} SO con comuna observable`}>
              <RegionBars rows={data.by_region.slice().sort((a, b) => b.sujetos - a.sujetos).slice(0, 7)} onPick={(region) => openCohort({ cohort: 'REGION', value: region, title: `Sujetos obligados · ${titleCase(region)}` })} />
            </VisualPanel>
            <VisualPanel title="Industria real según SII" meta="top 7 por sujetos">
              <IndustryBars rows={data.by_industry.slice().sort((a, b) => b.sujetos - a.sujetos).slice(0, 7)} onPick={(industry) => openCohort({ cohort: 'INDUSTRIA', value: industry, title: titleCase(industry) })} />
            </VisualPanel>
            <VisualPanel title="Cambios que merecen contexto" meta="no imputan incumplimiento">
              <ContextSignals
                rows={[
                  { label: 'Giro atípico', value: u.giro_atipico, onClick: () => openCohort({ cohort: 'GIRO_ATIPICO', title: 'Sujetos con giro atípico en su sector' }) },
                  { label: 'Cambio de actividad', value: u.cambio_actividad, onClick: () => openCohort({ cohort: 'CAMBIO_ACTIVIDAD', title: 'Sujetos con cambio de actividad' }) },
                  { label: 'Cambio de región', value: u.cambio_region },
                  { label: 'Estructura amplia', value: u.estructura_amplia },
                  { label: 'En atención', value: u.en_atencion, onClick: () => openCohort({ cohort: 'ATENCION', title: 'Sujetos que piden revisión' }) },
                ]}
                total={u.total}
              />
            </VisualPanel>
          </div>

          <Panel title="Explorador sectorial" meta={`${n(filteredSectors.length)} sectores en el filtro`} pad={false}>
            <div className="uso-explorer-tools">
              <label className="uso-search"><input value={sectorSearch} onChange={(e) => setSectorSearch(e.target.value)} placeholder="Buscar sector…" /></label>
              <div className="uso-seg">
                <button data-on={sectorFilter === 'todos'} onClick={() => setSectorFilter('todos')}>Todos</button>
                <button data-on={sectorFilter === 'atencion'} onClick={() => setSectorFilter('atencion')}>Atención</button>
                <button data-on={sectorFilter === 'termino'} onClick={() => setSectorFilter('termino')}>Término</button>
                <button data-on={sectorFilter === 'sancion'} onClick={() => setSectorFilter('sancion')}>Sanción</button>
                <button data-on={sectorFilter === 'potencial'} onClick={() => setSectorFilter('potencial')}>Brecha</button>
              </div>
            </div>
            <SectorCards rows={sectorExpanded ? filteredSectors : filteredSectors.slice(0, 12)} onPick={(sector) => openCohort({ cohort: 'SECTOR', value: sector, title: titleCase(sector) })} />
            {filteredSectors.length > 12 && (
              <div className="uso-expand-row"><button onClick={() => setSectorExpanded((v) => !v)}>{sectorExpanded ? 'Ver menos' : `Ver los ${n(filteredSectors.length)} sectores`}</button></div>
            )}
          </Panel>
        </section>
      )}

      {mode === 'brechas' && (
        <section className="uso-page fade-in">
          <div className="uso-section-label"><span>Brechas de cobertura</span><em>screening SII ↔ UAF · no acredita obligación</em></div>

          {potential.error ? (
            <ErrorBox error={potential.error} onRetry={potential.reload} />
          ) : potential.loading && !potential.data ? (
            <Loading label="Conciliando SII y padrón UAF…" />
          ) : !potential.data?.disponible ? (
            <Empty title="Sin conciliación materializada" />
          ) : (
            <>
              <VisualPanel title="Embudo de screening" meta={potential.data.corte.sii_periodo ?? 'corte vigente'}>
                <GapFunnel rows={potential.data.embudo} />
              </VisualPanel>

              <div className="uso-gap-grid">
                <VisualPanel title="De dónde salen" meta="sectores con candidatos">
                  <PotentialSectorBars rows={potential.data.sectores.slice().sort((a, b) => b.accionables - a.accionables).slice(0, 8)} />
                </VisualPanel>
                <VisualPanel title="Distribución IVO" meta="cola accionable">
                  <BandStack rows={potential.data.mix.banda.map((row) => ({ label: row.banda, value: row.n }))} total={actionable} />
                </VisualPanel>
                <VisualPanel title="Escala observada" meta="tramo SII">
                  <SimpleBars rows={potential.data.mix.escala.slice().sort((a, b) => b.n - a.n).slice(0, 7).map((row) => ({ label: row.tramo, value: row.n }))} />
                </VisualPanel>
                <VisualPanel title="Territorio de candidatos" meta="top regiones">
                  <SimpleBars rows={potential.data.mix.region.slice().sort((a, b) => b.n - a.n).slice(0, 7).map((row) => ({ label: row.region, value: row.n }))} />
                </VisualPanel>
              </div>

              <Panel title="Candidatos para revisión" meta={`${n(candidates.length)} en el filtro`} pad={false}>
                <div className="uso-candidate-tools">
                  <label className="uso-search uso-search-wide"><input value={candidateSearch} onChange={(e) => setCandidateSearch(e.target.value)} placeholder="Razón social, RUT, sector o actividad…" /></label>
                  <button className="uso-toggle" data-on={onlyPending} onClick={() => setOnlyPending((v) => !v)}>Sólo sin revisar</button>
                </div>
                <CandidateCards rows={candidates} onEntity={openEntity} onManage={(candidate) => manage(potentialItem(candidate))} />
              </Panel>
            </>
          )}
        </section>
      )}

      {mode === 'gestion' && (
        <section className="uso-page fade-in">
          <div className="uso-section-label"><span>Mesa operativa</span><em>seleccionar · ubicar · preparar gestión</em></div>

          <ManagementSummary
            terminated={u.terminados}
            actionable={actionable}
            selected={selectedItems}
            statuses={statuses}
            queue={queue}
            onQueue={setQueue}
          />

          <div className="uso-management-grid">
            <div className="panel uso-management-main">
              <div className="panel-head"><h3>{queue === 'desinscripcion' ? 'Revisión de desinscripción' : 'Revisión de inscripción'}</h3><div className="meta">selecciona casos para el lote</div></div>
              {queue === 'desinscripcion' ? (
                <>
                  <div className="uso-management-tools"><label className="uso-search uso-search-wide"><input value={termSearch} onChange={(e) => setTermSearch(e.target.value)} placeholder="Nombre, RUT, sector o región…" /></label></div>
                  {termQueue.error ? <div className="uso-inline-state"><ErrorBox error={termQueue.error} onRetry={termQueue.reload} /></div> : termQueue.loading ? <div className="uso-inline-state"><Loading /></div> : <ManagementTable rows={termRows.map(termItem)} selected={selected} statuses={statuses} onToggle={toggle} onContact={setContact} onEntity={openEntity} />}
                  <div className="uso-pagination"><span className="num">{n(termOffset + 1)}–{n(Math.min(termOffset + TERM_PAGE, termQueue.data?.[0]?.total_count ?? u.terminados))} de {n(termQueue.data?.[0]?.total_count ?? u.terminados)}</span><div><button className="btn btn-sm" disabled={termOffset === 0} onClick={() => setTermOffset(Math.max(0, termOffset - TERM_PAGE))}>← Anterior</button><button className="btn btn-sm" disabled={termOffset + TERM_PAGE >= (termQueue.data?.[0]?.total_count ?? u.terminados)} onClick={() => setTermOffset(termOffset + TERM_PAGE)}>Siguiente →</button></div></div>
                </>
              ) : (
                <>
                  <div className="uso-management-tools"><label className="uso-search uso-search-wide"><input value={potentialSearch} onChange={(e) => setPotentialSearch(e.target.value)} placeholder="Nombre, RUT, sector o actividad…" /></label></div>
                  {potential.error ? <div className="uso-inline-state"><ErrorBox error={potential.error} onRetry={potential.reload} /></div> : potential.loading ? <div className="uso-inline-state"><Loading /></div> : <ManagementTable rows={potentialQueueRows.map(potentialItem)} selected={selected} statuses={statuses} onToggle={toggle} onContact={setContact} onEntity={openEntity} />}
                </>
              )}
            </div>

            <BatchPanel selected={selectedItems} statuses={statuses} onClear={() => setSelected({})} onContact={setContact} onReady={(item) => setStatus(item, 'LISTO_SOLICITUD')} onExport={exportBatch} />
          </div>
        </section>
      )}

      <Semantics><strong>Lectura.</strong> Universo SO combina fuentes abiertas para caracterizar y ordenar revisión. Término de giro, sanciones, prensa, IVO, IPF, IGR, compras públicas y coincidencias de actividad no constituyen por sí solos incumplimiento ni riesgo LA/FT.</Semantics>

      {cohort && <CohortDrawer request={cohort} onClose={() => setCohort(null)} onOpenEntity={(entityId) => { setCohort(null); openEntity(entityId); }} />}
      {contact && <ContactDrawer item={contact} status={statuses[managementKey(contact)] ?? 'PENDIENTE'} onClose={() => setContact(null)} onStatus={(status) => setStatus(contact, status)} onOpenEntity={contact.entityId ? () => openEntity(contact.entityId as string) : undefined} />}
    </div>
  );
}

function VisualPanel({ title, meta, className = '', children }: { title: string; meta?: string; className?: string; children: React.ReactNode }) {
  return <section className={`uso-panel ${className}`}><header><h3>{title}</h3>{meta && <span>{meta}</span>}</header><div className="uso-panel-body">{children}</div></section>;
}

function CompactState({ children }: { children: React.ReactNode }) {
  return <div className="uso-compact-state">{children}</div>;
}

function RegistryChart({ points }: { points: RegistryTotal[] }) {
  const rows = points.slice().sort((a, b) => a.year - b.year);
  const W = 760, H = 180, L = 34, R = 34, T = 24, B = 30;
  const values = rows.map((p) => p.total);
  const min = Math.min(...values), max = Math.max(...values);
  const pad = Math.max(150, (max - min) * 0.12);
  const low = Math.max(0, min - pad), high = max + pad * 0.3;
  const span = Math.max(1, high - low);
  const x = (i: number) => L + i * ((W - L - R) / Math.max(1, rows.length - 1));
  const y = (v: number) => T + (H - T - B) * (1 - (v - low) / span);
  const line = rows.map((p, i) => `${i ? 'L' : 'M'} ${x(i).toFixed(1)} ${y(p.total).toFixed(1)}`).join(' ');
  const area = `${line} L ${x(rows.length - 1)} ${H - B} L ${x(0)} ${H - B} Z`;
  return <svg className="uso-registry-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Evolución publicada del padrón UAF">
    {[0.25, 0.5, 0.75].map((g) => <line key={g} x1={L} x2={W - R} y1={T + (H - T - B) * g} y2={T + (H - T - B) * g} className="uso-gridline" />)}
    <path d={area} className="uso-registry-area" /><path d={line} className="uso-registry-line" />
    {rows.map((p, i) => <g key={p.year}><circle cx={x(i)} cy={y(p.total)} r={i === rows.length - 1 ? 4.4 : 3.2} className="uso-registry-dot"><title>{`${p.year}: ${n(p.total)} inscritos`}</title></circle><text x={x(i)} y={y(p.total) - 9} className="uso-chart-value">{n(p.total)}</text><text x={x(i)} y={H - 8} className="uso-chart-year">{p.year}</text></g>)}
  </svg>;
}

function SignalMatrix({ total, rows }: { total: number; rows: { label: string; value: number; tone: string; onClick: () => void }[] }) {
  return <div className="uso-signal-matrix">{rows.map((row) => <button key={row.label} onClick={row.onClick} style={{ ['--uso-tone' as string]: `var(--${row.tone === 'accent' ? 'accent' : row.tone === 'unknown' ? 'unknown' : `sig-${row.tone}`})` }}><span><b>{row.label}</b><em>{n1(pct(row.value, total))}%</em></span><i><u style={{ width: `${clamp(pct(row.value, total))}%` }} /></i><strong className="num">{n(row.value)}</strong></button>)}</div>;
}

function sectorAxes(row: SectorVisualRow, lens: SectorLens) {
  if (lens === 'reportabilidad') return { x: row.intensity, y: row.icr, xLabel: 'ROS / 100 SO', yLabel: 'ICR %' };
  if (lens === 'perfil') return { x: row.siiCoverage, y: row.ipf_medio, xLabel: 'Cobertura SII %', yLabel: 'IPF medio' };
  return { x: pct(row.terminados, row.sujetos), y: pct(row.en_atencion, row.sujetos), xLabel: 'Término de giro %', yLabel: 'En atención %' };
}

function SectorMap({ rows, lens, onPick }: { rows: SectorVisualRow[]; lens: SectorLens; onPick: (sector: string) => void }) {
  const points = rows.map((row) => ({ row, ...sectorAxes(row, lens) })).filter((p): p is { row: SectorVisualRow; x: number; y: number; xLabel: string; yLabel: string } => p.x != null && p.y != null && Number.isFinite(p.x) && Number.isFinite(p.y));
  if (!points.length) return <CompactState>Sin sectores comparables para esta lente.</CompactState>;
  const W = 700, H = 300, L = 52, R = 42, T = 22, B = 42;
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  const x0 = Math.min(0, ...xs), x1 = Math.max(...xs) || 1;
  const y0 = Math.min(0, ...ys), y1 = Math.max(...ys) || 1;
  const maxSize = Math.max(1, ...points.map((p) => p.row.sujetos));
  const px = (v: number) => L + ((v - x0) / (x1 - x0 || 1)) * (W - L - R);
  const py = (v: number) => H - B - ((v - y0) / (y1 - y0 || 1)) * (H - T - B);
  const radius = (v: number) => 4 + Math.sqrt(v / maxSize) * 15;
  const labelled = new Set(points.slice().sort((a, b) => b.row.sujetos - a.row.sujetos).slice(0, 6).map((p) => p.row.sector));
  const ticks = [0, .25, .5, .75, 1];
  return <div className="uso-sector-map"><svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Mapa comparativo de sectores UAF">
    {ticks.map((t) => <g key={`x${t}`}><line x1={L + t * (W - L - R)} x2={L + t * (W - L - R)} y1={T} y2={H - B} className="uso-gridline" /><text x={L + t * (W - L - R)} y={H - 19} className="uso-axis-tick">{n1(x0 + t * (x1 - x0))}</text></g>)}
    {ticks.map((t) => <g key={`y${t}`}><line x1={L} x2={W - R} y1={T + t * (H - T - B)} y2={T + t * (H - T - B)} className="uso-gridline" /><text x={L - 7} y={py(y0 + (1 - t) * (y1 - y0)) + 3} className="uso-axis-tick uso-axis-left">{n1(y0 + (1 - t) * (y1 - y0))}</text></g>)}
    {points.map((p) => <g key={p.row.sector} className="uso-sector-point" onClick={() => onPick(p.row.sector)}><circle cx={px(p.x)} cy={py(p.y)} r={radius(p.row.sujetos)} data-gap={p.row.potential > 0}><title>{`${titleCase(p.row.sector)} · ${n(p.row.sujetos)} SO · ${p.xLabel}: ${n1(p.x)} · ${p.yLabel}: ${n1(p.y)}${p.row.potential ? ` · ${n(p.row.potential)} potenciales` : ''}`}</title></circle>{labelled.has(p.row.sector) && <text x={px(p.x) + radius(p.row.sujetos) + 4} y={py(p.y) + 3} className="uso-sector-label">{shortLabel(p.row.sector, 23)}</text>}</g>)}
    <text x={(L + W - R) / 2} y={H - 2} className="uso-axis-title">{points[0].xLabel}</text><text transform={`translate(12 ${(T + H - B) / 2}) rotate(-90)`} className="uso-axis-title">{points[0].yLabel}</text>
  </svg><div className="uso-map-legend"><span><i />sector</span><span><i data-gap />con brecha accionable</span><em>Selecciona un círculo para abrir sus entidades.</em></div></div>;
}

function ReportingBars({ rows, metric, onPick }: { rows: SectorVisualRow[]; metric: ReportMetric; onPick: (sector: string) => void }) {
  const value = (row: SectorVisualRow) => metric === 'ros' ? row.ros2025 : metric === 'intensidad' ? row.intensity : row.icr;
  const list = rows.filter((row) => value(row) != null).slice().sort((a, b) => (value(b) ?? 0) - (value(a) ?? 0)).slice(0, 8);
  const max = Math.max(1, ...list.map((row) => value(row) ?? 0));
  if (!list.length) return <CompactState>Sin reportabilidad comparable.</CompactState>;
  return <div className="uso-rank-bars">{list.map((row) => {
    const v = value(row) ?? 0;
    const suffix = metric === 'ros' ? '' : '%';
    return <button key={row.sector} onClick={() => onPick(row.sector)}><span title={titleCase(row.sector)}>{shortLabel(titleCase(row.sector), 28)}</span><i><u style={{ width: `${clamp(v / max * 100)}%` }} /></i><b className="num">{metric === 'ros' ? n(v) : `${n1(v)}${suffix}`}</b></button>;
  })}</div>;
}

function LifecycleChart({ started, terminated }: { started: { ano: number; n: number }[]; terminated: { ano: number; n: number }[] }) {
  const starts = new Map(started.map((r) => [r.ano, r.n]));
  const terms = new Map(terminated.map((r) => [r.ano, r.n]));
  const years = [...new Set([...started.map((r) => r.ano), ...terminated.map((r) => r.ano)])].sort((a, b) => a - b).slice(-8);
  const max = Math.max(1, ...years.flatMap((year) => [starts.get(year) ?? 0, terms.get(year) ?? 0]));
  return <div><div className="uso-lifecycle-bars">{years.map((year) => <div key={year}><div className="uso-lifecycle-stack"><i data-kind="start" style={{ height: `${(starts.get(year) ?? 0) / max * 100}%` }} title={`Inicio de actividades ${year}: ${n(starts.get(year) ?? 0)}`} /><i data-kind="term" style={{ height: `${(terms.get(year) ?? 0) / max * 100}%` }} title={`Término de giro ${year}: ${n(terms.get(year) ?? 0)}`} /></div><span>{String(year).slice(-2)}</span></div>)}</div><div className="uso-inline-legend"><span><i data-kind="start" />Inicio actividad</span><span><i data-kind="term" />Término giro</span></div></div>;
}

function BandStack({ rows, total }: { rows: { label: string; value: number }[]; total: number }) {
  const clean = rows.filter((r) => r.value > 0);
  const sum = Math.max(1, clean.reduce((acc, r) => acc + r.value, 0));
  return <div className="uso-band-stack"><div className="uso-band-track">{clean.map((row, index) => <span key={row.label} data-index={index % 5} style={{ width: `${row.value / sum * 100}%` }} title={`${titleCase(row.label.replace(/_/g, ' '))}: ${n(row.value)}`} />)}</div><div className="uso-band-legend">{clean.map((row, index) => <span key={row.label}><i data-index={index % 5} /><em>{titleCase(row.label.replace(/_/g, ' '))}</em><b className="num">{n(row.value)}</b></span>)}</div>{total > 0 && <div className="uso-band-total"><b className="num">{n(total)}</b><span>con medida disponible</span></div>}</div>;
}

function RegionBars({ rows, onPick }: { rows: UafPulse['by_region']; onPick: (region: string) => void }) {
  const max = Math.max(1, ...rows.map((r) => r.sujetos));
  return <div className="uso-two-layer-bars">{rows.map((row) => <button key={row.region} onClick={() => onPick(row.region)}><span>{shortLabel(titleCase(row.region), 24)}</span><i><u style={{ width: `${row.sujetos / max * 100}%` }} /><u data-overlay style={{ width: `${row.sujetos ? row.en_atencion / row.sujetos * (row.sujetos / max * 100) : 0}%` }} /></i><b className="num">{n(row.sujetos)}</b></button>)}</div>;
}

function IndustryBars({ rows, onPick }: { rows: UafPulse['by_industry']; onPick: (industry: string) => void }) {
  const max = Math.max(1, ...rows.map((r) => r.sujetos));
  return <div className="uso-rank-bars">{rows.map((row) => <button key={row.industria} onClick={() => onPick(row.industria)}><span title={titleCase(row.industria)}>{shortLabel(titleCase(row.industria), 27)}</span><i><u style={{ width: `${row.sujetos / max * 100}%` }} /></i><b className="num">{n(row.sujetos)}</b></button>)}</div>;
}

function ContextSignals({ rows, total }: { rows: { label: string; value: number; onClick?: () => void }[]; total: number }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return <div className="uso-context-signals">{rows.map((row) => <button key={row.label} disabled={!row.onClick} onClick={row.onClick}><span>{row.label}</span><i><u style={{ width: `${row.value / max * 100}%` }} /></i><b className="num">{n(row.value)}</b><em>{n1(pct(row.value, total))}%</em></button>)}</div>;
}

function SectorCards({ rows, onPick }: { rows: SectorVisualRow[]; onPick: (sector: string) => void }) {
  if (!rows.length) return <div className="uso-inline-state"><Empty title="Sin sectores para este filtro" /></div>;
  return <div className="uso-sector-cards">{rows.map((row) => <button key={row.sector} onClick={() => onPick(row.sector)}><header><span>{titleCase(row.sector)}</span><b className="num">{n(row.sujetos)}</b></header><div className="uso-sector-card-bars"><span><em>Término</em><i><u style={{ width: `${clamp(pct(row.terminados, row.sujetos))}%` }} /></i></span><span><em>Atención</em><i><u data-tone="attention" style={{ width: `${clamp(pct(row.en_atencion, row.sujetos))}%` }} /></i></span></div><footer>{row.ros2025 != null && <span><b className="num">{n(row.ros2025)}</b> ROS 2025</span>}{row.potential > 0 && <span data-gap><b className="num">{n(row.potential)}</b> potenciales</span>}{row.siiCoverage != null && <span><b className="num">{n1(row.siiCoverage)}%</b> perfil SII</span>}</footer></button>)}</div>;
}

function GapFunnel({ rows }: { rows: { orden: number; etiqueta: string; n: number; glosa: string }[] }) {
  const ordered = rows.slice().sort((a, b) => a.orden - b.orden);
  const max = Math.max(1, ...ordered.map((r) => r.n));
  return <div className="uso-gap-funnel">{ordered.map((row, index) => { const previous = index ? ordered[index - 1].n : row.n; const retention = previous > 0 ? row.n / previous * 100 : 0; return <div key={row.orden} data-last={index === ordered.length - 1}><span className="uso-funnel-index">{index + 1}</span><div><b className="num">{n(row.n)}</b><strong>{row.etiqueta}</strong><i><u style={{ width: `${Math.max(2, Math.log10(row.n + 1) / Math.log10(max + 1) * 100)}%` }} /></i></div>{index > 0 && <em>{n1(retention)}% continúa</em>}</div>; })}</div>;
}

function PotentialSectorBars({ rows }: { rows: UafPotential['sectores'] }) {
  const max = Math.max(1, ...rows.map((r) => r.accionables));
  return <div className="uso-rank-bars">{rows.map((row) => <div className="uso-static-rank" key={row.sector}><span title={titleCase(row.sector)}>{shortLabel(titleCase(row.sector), 28)}</span><i><u style={{ width: `${row.accionables / max * 100}%` }} /></i><b className="num">{n(row.accionables)}</b></div>)}</div>;
}

function SimpleBars({ rows }: { rows: { label: string; value: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return <div className="uso-rank-bars">{rows.map((row) => <div className="uso-static-rank" key={row.label}><span title={row.label}>{shortLabel(titleCase(row.label), 28)}</span><i><u style={{ width: `${row.value / max * 100}%` }} /></i><b className="num">{n(row.value)}</b></div>)}</div>;
}

function CandidateCards({ rows, onEntity, onManage }: { rows: UafPotentialCandidate[]; onEntity: (id: string) => void; onManage: (row: UafPotentialCandidate) => void }) {
  if (!rows.length) return <div className="uso-inline-state"><Empty title="Sin candidatos para este filtro" /></div>;
  return <div className="uso-candidate-cards">{rows.map((c) => <article key={c.rut}><div className="uso-candidate-main"><div><b>{titleCase(c.name)}</b><span className="mono">{rutFormat(c.rut)}</span></div><p>{c.implied_sector ? titleCase(c.implied_sector) : 'Sector por confirmar'}<em>{c.matched_activity ? titleCase(c.matched_activity) : 'Actividad principal no disponible'}</em></p><div className="uso-candidate-tags">{c.region && <span>{titleCase(c.region)}</span>}{c.sales_band_size && <span>{titleCase(c.sales_band_size)}</span>}{c.res_available && <span>RES</span>}{c.uaf_sanction_events > 0 && <span data-tone="critical">Sanción {n(c.uaf_sanction_events)}</span>}{c.review_state && <span data-tone="review">{titleCase(c.review_state.replace(/_/g, ' '))}</span>}</div></div><div className="uso-score-pair"><ScoreMeter label="IVO" value={c.ivo_score} note={c.ivo_band ? titleCase(c.ivo_band) : '—'} /><ScoreMeter label="Materialidad" value={c.materiality_score} note={c.ivo_credibility_pct != null ? `${n1(c.ivo_credibility_pct)}% cred.` : '—'} /></div><div className="uso-candidate-actions">{c.entity_id && <button className="btn btn-sm" onClick={() => onEntity(c.entity_id as string)}>Ficha</button>}<button className="btn btn-sm btn-accent" onClick={() => onManage(c)}>Gestionar →</button></div></article>)}</div>;
}

function ScoreMeter({ label, value, note }: { label: string; value: number | null; note: string }) {
  const v = value ?? 0;
  return <div className="uso-score-meter"><span><em>{label}</em><b className="num">{value == null ? '—' : n1(value)}</b></span><i><u style={{ width: `${clamp(v)}%` }} /></i><small>{note}</small></div>;
}

function ManagementSummary({ terminated, actionable, selected, statuses, queue, onQueue }: { terminated: number; actionable: number; selected: ManageItem[]; statuses: Record<string, ManageStatus>; queue: Queue; onQueue: (q: Queue) => void }) {
  const ready = selected.filter((item) => statuses[managementKey(item)] === 'LISTO_SOLICITUD').length;
  const contact = selected.filter((item) => statuses[managementKey(item)] === 'CONTACTO_REVISADO').length;
  return <div className="uso-management-summary"><button data-on={queue === 'desinscripcion'} onClick={() => onQueue('desinscripcion')}><span>Desinscripción</span><b className="num">{n(terminated)}</b><em>con término de giro</em></button><button data-on={queue === 'inscripcion'} onClick={() => onQueue('inscripcion')}><span>Inscripción</span><b className="num">{n(actionable)}</b><em>candidatos accionables</em></button><div className="uso-progress-card"><span>Lote actual</span><b className="num">{n(selected.length)}</b><div><i><u style={{ width: `${selected.length ? ready / selected.length * 100 : 0}%` }} /></i><em>{n(ready)} listos · {n(contact)} con contacto revisado</em></div></div></div>;
}

function ManagementTable({ rows, selected, statuses, onToggle, onContact, onEntity }: { rows: ManageItem[]; selected: Record<string, ManageItem>; statuses: Record<string, ManageStatus>; onToggle: (item: ManageItem) => void; onContact: (item: ManageItem) => void; onEntity: (id: string) => void }) {
  if (!rows.length) return <div className="uso-inline-state"><Empty title="Sin resultados para este filtro" /></div>;
  return <div className="uso-management-list">{rows.map((item) => { const key = managementKey(item); return <article key={key} data-selected={Boolean(selected[key])}><label><input type="checkbox" checked={Boolean(selected[key])} onChange={() => onToggle(item)} /><span /></label><div className="uso-management-identity"><b>{titleCase(item.name)}</b><span className="mono">{rutFormat(item.rut)}</span></div><div className="uso-management-reason"><span>{item.sector ? titleCase(item.sector) : 'Sin sector'}</span><em>{item.reason}</em></div><StatusChip status={statuses[key] ?? 'PENDIENTE'} /><div className="uso-row-actions"><button className="btn btn-sm" onClick={() => onContact(item)}>Ubicar</button>{item.entityId && <button className="btn btn-sm" onClick={() => onEntity(item.entityId as string)}>Ficha</button>}</div></article>; })}</div>;
}

function BatchPanel({ selected, statuses, onClear, onContact, onReady, onExport }: { selected: ManageItem[]; statuses: Record<string, ManageStatus>; onClear: () => void; onContact: (item: ManageItem) => void; onReady: (item: ManageItem) => void; onExport: () => void }) {
  return <aside className="uso-batch-panel"><header><div><span>Lote de gestión</span><b>{n(selected.length)} seleccionados</b></div>{selected.length > 0 && <button onClick={onClear}>Limpiar</button>}</header>{selected.length === 0 ? <div className="uso-batch-empty">Selecciona entidades desde cualquiera de las dos colas.</div> : <div className="uso-batch-list">{selected.map((item) => <div key={managementKey(item)}><span data-kind={item.kind}>{item.kind === 'DESINSCRIPCION' ? 'Desinscripción' : 'Inscripción'}</span><b>{titleCase(item.name)}</b><em className="mono">{rutFormat(item.rut)}</em><StatusChip status={statuses[managementKey(item)] ?? 'PENDIENTE'} /><footer><button onClick={() => onContact(item)}>Ubicar</button><button onClick={() => onReady(item)}>Marcar listo</button></footer></div>)}</div>}<button className="btn btn-accent uso-export" onClick={onExport} disabled={!selected.length}>Exportar lote CSV</button><p>Los estados quedan en este navegador; el archivo permite continuar la gestión institucional fuera de Atlas.</p></aside>;
}

function ContactDrawer({ item, status, onClose, onStatus, onOpenEntity }: { item: ManageItem; status: ManageStatus; onClose: () => void; onStatus: (status: ManageStatus) => void; onOpenEntity?: () => void }) {
  return <><div className="uso-contact-scrim" onClick={onClose} /><aside className="uso-contact-drawer" role="dialog" aria-label={`Ubicar ${item.name}`}><header><div><span>Búsqueda abierta de contacto</span><h2>{titleCase(item.name)}</h2><p><span className="mono">{rutFormat(item.rut)}</span>{item.sector ? ` · ${titleCase(item.sector)}` : ''}</p></div><button className="drawer-close" onClick={onClose}>×</button></header><div className="uso-contact-body"><div className="uso-contact-intent"><span>Gestión sugerida</span><b>{item.kind === 'DESINSCRIPCION' ? 'Ubicar para solicitar revisión de desinscripción' : 'Ubicar para solicitar revisión de inscripción'}</b><p>{item.reason}</p></div><div className="uso-contact-links">{contactSources(item).map(([label, hint, href]) => <a key={label} href={href} target="_blank" rel="noreferrer"><span><b>{label}</b><em>{hint}</em></span><strong>↗</strong></a>)}</div>{onOpenEntity && <button className="btn" onClick={onOpenEntity}>Abrir Entidad 360</button>}</div><footer><div><span>Estado</span><StatusChip status={status} /></div><div><button className="btn btn-sm" onClick={() => onStatus('CONTACTO_REVISADO')}>Contacto revisado</button><button className="btn btn-sm btn-accent" onClick={() => onStatus('LISTO_SOLICITUD')}>Listo para solicitud</button></div></footer></aside></>;
}

function StatusChip({ status }: { status: ManageStatus }) {
  const meta = STATUS[status];
  return <span className="uso-status-chip" style={{ ['--status-tone' as string]: meta.tone }}><i />{meta.label}</span>;
}

function shortLabel(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
