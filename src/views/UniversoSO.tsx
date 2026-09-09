import { useEffect, useMemo, useState } from 'react';
import { useRpc } from '../lib/rpc';
import { hrefFor } from '../lib/router';
import type {
  SectorOverview,
  UafCohort,
  UafPotential,
  UafPotentialCandidate,
  UafPulse,
  UafSubjectRow,
} from '../lib/contracts';
import { Empty, ErrorBox, Loading, Panel, Semantics } from '../components/primitives';
import { CohortDrawer, type CohortRequest } from '../components/CohortDrawer';
import { fecha, n, n1, rutFormat, titleCase } from '../lib/format';
import '../styles/universo-so.css';

type Mode = 'padron' | 'brechas' | 'gestion';
type Queue = 'desinscripcion' | 'inscripcion';
type ManageKind = 'DESINSCRIPCION' | 'INSCRIPCION';
type ManageStatus = 'PENDIENTE' | 'CONTACTO_REVISADO' | 'LISTO_SOLICITUD';

interface ManageItem {
  kind: ManageKind;
  rut: string;
  name: string;
  sector: string | null;
  entityId: string | null;
  region: string | null;
  reason: string;
}

const MANAGEMENT_STORAGE = 'atlas-observatorio-universo-so-management-v1';
const TERM_PAGE = 200;

const STATUS_META: Record<ManageStatus, { label: string; tone: string }> = {
  PENDIENTE: { label: 'Pendiente', tone: 'var(--ink-4)' },
  CONTACTO_REVISADO: { label: 'Contacto revisado', tone: 'var(--sig-watch)' },
  LISTO_SOLICITUD: { label: 'Listo para solicitud', tone: 'var(--present)' },
};

function loadManagementStatus(): Record<string, ManageStatus> {
  try {
    const raw = localStorage.getItem(MANAGEMENT_STORAGE);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, ManageStatus>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function manageKey(item: Pick<ManageItem, 'kind' | 'rut'>): string {
  return `${item.kind}|${item.rut}`;
}

function asTermItem(s: UafSubjectRow): ManageItem {
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

function asPotentialItem(c: UafPotentialCandidate): ManageItem {
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

function googleSearch(query: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

function contactLinks(item: ManageItem) {
  const name = item.name.replace(/\s+/g, ' ').trim();
  const rut = rutFormat(item.rut);
  return [
    {
      label: 'Búsqueda web',
      hint: 'sitio oficial, contacto, teléfono o correo',
      href: googleSearch(`"${name}" "${rut}" contacto`),
    },
    {
      label: 'Correo / teléfono',
      hint: 'huellas públicas de contacto',
      href: googleSearch(`"${name}" ("correo" OR "email" OR "teléfono" OR "contacto")`),
    },
    {
      label: 'Mercado Público',
      hint: 'fichas, órdenes y datos del proveedor',
      href: googleSearch(`site:mercadopublico.cl "${item.rut}" "${name}"`),
    },
    {
      label: 'RES',
      hint: 'Registro de Empresas y Sociedades',
      href: googleSearch(`site:registrodeempresasysociedades.cl "${item.rut}"`),
    },
    {
      label: 'LinkedIn',
      hint: 'perfil corporativo y presencia pública',
      href: googleSearch(`site:linkedin.com/company "${name}" Chile`),
    },
    {
      label: 'SII público',
      hint: 'referencias tributarias indexadas públicamente',
      href: googleSearch(`site:sii.cl "${item.rut}" "${name}"`),
    },
  ];
}

function share(part: number, total: number): number {
  return total > 0 ? (part / total) * 100 : 0;
}

export function UniversoSO({
  onNavigate,
  initialMode = 'padron',
}: {
  onNavigate: (hash: string) => void;
  initialMode?: Mode;
}) {
  const pulse = useRpc<UafPulse>('obs_uaf_pulse', {});
  const potential = useRpc<UafPotential>('obs_uaf_potential', {});
  const sectorOverview = useRpc<SectorOverview>('obs_sector_overview', {});

  const [mode, setMode] = useState<Mode>(initialMode);
  const [cohort, setCohort] = useState<CohortRequest | null>(null);
  const [sectorSearch, setSectorSearch] = useState('');
  const [sectorLayer, setSectorLayer] = useState<'todos' | 'termino' | 'sancion' | 'potencial'>('todos');
  const [gapSearch, setGapSearch] = useState('');
  const [candidateSearch, setCandidateSearch] = useState('');
  const [candidateBand, setCandidateBand] = useState<string>('TODAS');
  const [onlyUnreviewed, setOnlyUnreviewed] = useState(false);
  const [queue, setQueue] = useState<Queue>('desinscripcion');
  const [termOffset, setTermOffset] = useState(0);
  const [termSearch, setTermSearch] = useState('');
  const [potentialSearch, setPotentialSearch] = useState('');
  const [selected, setSelected] = useState<Record<string, ManageItem>>({});
  const [contactItem, setContactItem] = useState<ManageItem | null>(null);
  const [managementStatus, setManagementStatus] = useState<Record<string, ManageStatus>>(loadManagementStatus);

  const termQueue = useRpc<UafSubjectRow[]>('obs_uaf_cohort', {
    p_cohort: 'TERMINO_GIRO' satisfies UafCohort,
    p_value: null,
    p_limit: TERM_PAGE,
    p_offset: termOffset,
  }, { skip: mode !== 'gestion' || queue !== 'desinscripcion' });

  useEffect(() => setMode(initialMode), [initialMode]);

  useEffect(() => {
    try {
      localStorage.setItem(MANAGEMENT_STORAGE, JSON.stringify(managementStatus));
    } catch {
      // La gestión sigue operando en memoria cuando el navegador bloquea almacenamiento local.
    }
  }, [managementStatus]);

  useEffect(() => {
    if (!contactItem) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setContactItem(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [contactItem]);

  const u = pulse.data?.universe ?? null;
  const cross = pulse.data?.crosscuts ?? null;
  const actionable = potential.data?.totales?.accionables ?? 0;

  const sectorRows = useMemo(() => {
    if (!pulse.data) return [];
    const detail = new Map(
      (sectorOverview.data?.sectores ?? []).map((s) => [s.uaf_sector_canonical, s]),
    );
    const gaps = new Map(
      (potential.data?.sectores ?? []).map((s) => [s.sector, s]),
    );
    const query = sectorSearch.trim().toLowerCase();

    return pulse.data.by_sector
      .map((s) => {
        const d = detail.get(s.sector);
        const g = gaps.get(s.sector);
        return {
          ...s,
          siiCoverage: d?.sii_coverage_pct ?? null,
          vulnerability: d?.vulnerability_index ?? null,
          sanctionRate: d?.sanction_rate_per_100 ?? null,
          potential: g?.accionables ?? 0,
          observed: g?.observadas ?? 0,
        };
      })
      .filter((s) => {
        if (query && !s.sector.toLowerCase().includes(query)) return false;
        if (sectorLayer === 'termino' && s.terminados <= 0) return false;
        if (sectorLayer === 'sancion' && s.sancionados <= 0) return false;
        if (sectorLayer === 'potencial' && s.potential <= 0) return false;
        return true;
      })
      .sort((a, b) => b.sujetos - a.sujetos);
  }, [pulse.data, sectorOverview.data, potential.data, sectorSearch, sectorLayer]);

  const maxSector = Math.max(1, ...sectorRows.map((s) => s.sujetos));

  const gapRows = useMemo(() => {
    const query = gapSearch.trim().toLowerCase();
    return (potential.data?.sectores ?? [])
      .filter((s) => !query || s.sector.toLowerCase().includes(query))
      .slice()
      .sort((a, b) => b.accionables - a.accionables);
  }, [potential.data, gapSearch]);

  const candidateRows = useMemo(() => {
    const query = candidateSearch.trim().toLowerCase();
    return (potential.data?.candidatos ?? [])
      .filter((c) => {
        if (candidateBand !== 'TODAS' && (c.ivo_band ?? 'SIN_BANDA') !== candidateBand) return false;
        if (onlyUnreviewed && c.review_state) return false;
        if (!query) return true;
        return (
          c.name.toLowerCase().includes(query)
          || c.rut.toLowerCase().includes(query)
          || (c.implied_sector ?? '').toLowerCase().includes(query)
          || (c.matched_activity ?? '').toLowerCase().includes(query)
        );
      })
      .slice()
      .sort((a, b) => (b.ivo_score ?? -1) - (a.ivo_score ?? -1));
  }, [potential.data, candidateSearch, candidateBand, onlyUnreviewed]);

  const termRows = useMemo(() => {
    const query = termSearch.trim().toLowerCase();
    return (termQueue.data ?? []).filter((s) => {
      if (!query) return true;
      return (
        s.name.toLowerCase().includes(query)
        || s.rut.toLowerCase().includes(query)
        || (s.uaf_sector ?? '').toLowerCase().includes(query)
        || (s.region ?? '').toLowerCase().includes(query)
      );
    });
  }, [termQueue.data, termSearch]);

  const potentialQueueRows = useMemo(() => {
    const query = potentialSearch.trim().toLowerCase();
    return (potential.data?.candidatos ?? []).filter((c) => {
      if (!query) return true;
      return (
        c.name.toLowerCase().includes(query)
        || c.rut.toLowerCase().includes(query)
        || (c.implied_sector ?? '').toLowerCase().includes(query)
        || (c.matched_activity ?? '').toLowerCase().includes(query)
      );
    });
  }, [potential.data, potentialSearch]);

  const selectedItems = useMemo(
    () => Object.values(selected).sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name, 'es')),
    [selected],
  );

  const open = (request: CohortRequest) => setCohort(request);

  const setView = (next: Mode) => {
    setMode(next);
    const hash = hrefFor({ view: 'universo', mode: next });
    window.history.replaceState(null, '', hash);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const toggleItem = (item: ManageItem) => {
    const key = manageKey(item);
    setSelected((current) => {
      const next = { ...current };
      if (next[key]) delete next[key];
      else next[key] = item;
      return next;
    });
  };

  const addToManagement = (item: ManageItem) => {
    const key = manageKey(item);
    setSelected((current) => ({ ...current, [key]: item }));
    setQueue(item.kind === 'DESINSCRIPCION' ? 'desinscripcion' : 'inscripcion');
    setView('gestion');
  };

  const markStatus = (item: ManageItem, status: ManageStatus) => {
    const key = manageKey(item);
    setManagementStatus((current) => ({ ...current, [key]: status }));
  };

  const copyBatch = () => {
    const text = selectedItems
      .map((item) => `${item.kind === 'DESINSCRIPCION' ? 'DESINSCRIPCIÓN' : 'INSCRIPCIÓN'}\t${rutFormat(item.rut)}\t${item.name}\t${item.sector ?? ''}`)
      .join('\n');
    if (text) void navigator.clipboard?.writeText(text);
  };

  const exportBatch = () => {
    if (!selectedItems.length) return;
    const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const rows = [
      ['accion', 'rut', 'razon_social', 'sector', 'region', 'motivo', 'estado'],
      ...selectedItems.map((item) => [
        item.kind === 'DESINSCRIPCION' ? 'SOLICITAR_DESINSCRIPCION' : 'SOLICITAR_INSCRIPCION',
        rutFormat(item.rut),
        item.name,
        item.sector ?? '',
        item.region ?? '',
        item.reason,
        managementStatus[manageKey(item)] ?? 'PENDIENTE',
      ]),
    ];
    const csv = rows.map((row) => row.map((cell) => quote(String(cell))).join(';')).join('\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `atlas_universo_so_gestion_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  if (pulse.loading) return <Loading label="Leyendo el universo de sujetos obligados…" />;
  if (pulse.error) return <ErrorBox error={pulse.error} onRetry={pulse.reload} />;
  if (!pulse.data?.universe) {
    return <Empty title="Sin padrón UAF publicado" hint="El snapshot vigente no trae el universo de sujetos obligados." />;
  }

  return (
    <div className="so-view fade-in">
      <header className="so-command">
        <div className="so-command-copy">
          <div className="pulse-kicker">Padrón UAF + conciliación SII · Ley 19.913</div>
          <h1>Universo SO</h1>
          <p className="view-lede">
            Una sola superficie para entender la composición del padrón, abrir las entidades detrás de cada
            sector, cruzarlas con término de giro, sanciones, prensa, OSFL y compras públicas, y trabajar las
            brechas de inscripción o desinscripción detectadas por la conciliación SII ↔ UAF.
          </p>
        </div>
        <div className="so-command-meta">
          <span><b>Padrón</b> {n(u.total)} sujetos</span>
          <span><b>Sectores</b> {n(u.sectores_uaf)}</span>
          <span><b>Conciliación</b> {potential.data?.corte.sii_periodo ?? 'corte SII vigente'}</span>
        </div>
      </header>

      <nav className="so-modebar" aria-label="Vistas del Universo SO">
        <button data-on={mode === 'padron'} onClick={() => setView('padron')}>
          <span>Padrón</span><em>{n(u.total)}</em>
        </button>
        <button data-on={mode === 'brechas'} onClick={() => setView('brechas')}>
          <span>Brechas</span><em>{potential.loading ? '…' : n(actionable)}</em>
        </button>
        <button data-on={mode === 'gestion'} onClick={() => setView('gestion')}>
          <span>Gestión</span><em>{n(selectedItems.length)}</em>
        </button>
      </nav>

      <div className="so-kpi-grid">
        <SoKpi label="Padrón inscrito" value={n(u.total)} foot={`${n(u.sectores_uaf)} sectores`} tone="var(--accent)"
          onClick={() => open({ cohort: 'TODOS', title: 'Padrón completo de sujetos obligados' })} />
        <SoKpi label="Activos ante el SII" value={n(u.activos)} foot={`${n1(share(u.activos, u.total))}% del padrón`} tone="var(--present)"
          onClick={() => open({ cohort: 'ACTIVO', title: 'Sujetos activos ante el SII' })} />
        <SoKpi label="Término de giro" value={n(u.terminados)} foot="inscritos con cierre tributario" tone="var(--sig-high)"
          onClick={() => open({ cohort: 'TERMINO_GIRO', title: 'Sujetos con término de giro', hint: 'candidatos a revisión de desinscripción' })} />
        <SoKpi label="Potenciales SO" value={potential.loading ? '…' : n(actionable)} foot="hipótesis accionables SII ↔ UAF" tone="var(--sig-medium)"
          onClick={() => setView('brechas')} />
        <SoKpi label="Con señales externas" value={cross ? n(cross.con_senal) : '—'} foot="sanciones, prensa y otras capas" tone="var(--unknown)"
          onClick={() => open({ cohort: 'CON_SENAL', title: 'Sujetos con señales externas' })} />
      </div>

      {mode === 'padron' && (
        <PadronView
          u={u}
          cross={cross}
          sectorRows={sectorRows}
          maxSector={maxSector}
          sectorSearch={sectorSearch}
          setSectorSearch={setSectorSearch}
          sectorLayer={sectorLayer}
          setSectorLayer={setSectorLayer}
          sectorLoading={sectorOverview.loading}
          sectorError={sectorOverview.error}
          onRetrySectors={sectorOverview.reload}
          potentialLoading={potential.loading}
          actionable={actionable}
          onOpen={open}
          onBrechas={() => setView('brechas')}
        />
      )}

      {mode === 'brechas' && (
        <BrechasView
          potential={potential.data}
          loading={potential.loading}
          error={potential.error}
          reload={potential.reload}
          gapRows={gapRows}
          gapSearch={gapSearch}
          setGapSearch={setGapSearch}
          candidateRows={candidateRows}
          candidateSearch={candidateSearch}
          setCandidateSearch={setCandidateSearch}
          candidateBand={candidateBand}
          setCandidateBand={setCandidateBand}
          onlyUnreviewed={onlyUnreviewed}
          setOnlyUnreviewed={setOnlyUnreviewed}
          onManage={addToManagement}
          onOpenEntity={(entityId) => onNavigate(hrefFor({ view: 'ficha', entityId }))}
        />
      )}

      {mode === 'gestion' && (
        <GestionView
          queue={queue}
          setQueue={setQueue}
          uTotalTerminated={u.terminados}
          potentialTotal={actionable}
          selected={selected}
          selectedItems={selectedItems}
          managementStatus={managementStatus}
          termRows={termRows}
          termSearch={termSearch}
          setTermSearch={setTermSearch}
          termLoading={termQueue.loading}
          termError={termQueue.error}
          reloadTerm={termQueue.reload}
          termOffset={termOffset}
          setTermOffset={setTermOffset}
          termTotal={termQueue.data?.[0]?.total_count ?? u.terminados}
          potentialRows={potentialQueueRows}
          potentialSearch={potentialSearch}
          setPotentialSearch={setPotentialSearch}
          potentialLoading={potential.loading}
          potentialError={potential.error}
          toggleItem={toggleItem}
          setContactItem={setContactItem}
          markStatus={markStatus}
          onOpenEntity={(entityId) => onNavigate(hrefFor({ view: 'ficha', entityId }))}
          copyBatch={copyBatch}
          exportBatch={exportBatch}
          clearSelection={() => setSelected({})}
        />
      )}

      <Semantics>
        <strong>Cómo leer Universo SO.</strong> El padrón UAF describe sujetos inscritos; el término de giro
        observado en el SII es un motivo para revisar la permanencia en el registro, no una desinscripción automática.
        Los potenciales SO son hipótesis de registro levantadas desde actividad económica pública y requieren validación
        antes de cualquier gestión. Sanciones, prensa, OSFL y proveedor del Estado son capas de caracterización: no
        constituyen por sí solas una conclusión de incumplimiento ni de riesgo LA/FT.
      </Semantics>

      {cohort && (
        <CohortDrawer
          request={cohort}
          onClose={() => setCohort(null)}
          onOpenEntity={(entityId) => {
            setCohort(null);
            onNavigate(hrefFor({ view: 'ficha', entityId }));
          }}
        />
      )}

      {contactItem && (
        <ContactDrawer
          item={contactItem}
          status={managementStatus[manageKey(contactItem)] ?? 'PENDIENTE'}
          onClose={() => setContactItem(null)}
          onStatus={(status) => markStatus(contactItem, status)}
          onOpenEntity={contactItem.entityId
            ? () => onNavigate(hrefFor({ view: 'ficha', entityId: contactItem.entityId as string }))
            : undefined}
        />
      )}
    </div>
  );
}

function PadronView({
  u,
  cross,
  sectorRows,
  maxSector,
  sectorSearch,
  setSectorSearch,
  sectorLayer,
  setSectorLayer,
  sectorLoading,
  sectorError,
  onRetrySectors,
  potentialLoading,
  actionable,
  onOpen,
  onBrechas,
}: {
  u: NonNullable<UafPulse['universe']>;
  cross: UafPulse['crosscuts'];
  sectorRows: Array<{
    sector: string;
    sujetos: number;
    terminados: number;
    sancionados: number;
    en_atencion: number;
    ipf_medio: number | null;
    siiCoverage: number | null;
    vulnerability: number | null;
    sanctionRate: number | null;
    potential: number;
    observed: number;
  }>;
  maxSector: number;
  sectorSearch: string;
  setSectorSearch: (value: string) => void;
  sectorLayer: 'todos' | 'termino' | 'sancion' | 'potencial';
  setSectorLayer: (value: 'todos' | 'termino' | 'sancion' | 'potencial') => void;
  sectorLoading: boolean;
  sectorError: string | null;
  onRetrySectors: () => void;
  potentialLoading: boolean;
  actionable: number;
  onOpen: (request: CohortRequest) => void;
  onBrechas: () => void;
}) {
  const totalStatus = Math.max(1, u.activos + u.terminados + u.sin_perfil);
  return (
    <section className="so-section fade-in">
      <div className="so-status-card">
        <div className="so-status-head">
          <div>
            <span className="so-eyebrow">Estado tributario del padrón</span>
            <strong>{n(u.total)} sujetos inscritos</strong>
          </div>
          <span className="so-status-note">cada franja abre sus entidades</span>
        </div>
        <div className="so-status-track" aria-label="Composición del padrón según estado ante el SII">
          <button
            style={{ width: `${share(u.activos, totalStatus)}%` }}
            data-tone="active"
            onClick={() => onOpen({ cohort: 'ACTIVO', title: 'Sujetos activos ante el SII' })}
            title={`${n(u.activos)} activos`}
          />
          <button
            style={{ width: `${share(u.terminados, totalStatus)}%` }}
            data-tone="terminated"
            onClick={() => onOpen({ cohort: 'TERMINO_GIRO', title: 'Sujetos con término de giro' })}
            title={`${n(u.terminados)} con término de giro`}
          />
          <button
            style={{ width: `${share(u.sin_perfil, totalStatus)}%` }}
            data-tone="unknown"
            onClick={() => onOpen({ cohort: 'SIN_PERFIL_SII', title: 'Sujetos sin perfil SII de persona jurídica' })}
            title={`${n(u.sin_perfil)} sin perfil SII`}
          />
        </div>
        <div className="so-status-legend">
          <button onClick={() => onOpen({ cohort: 'ACTIVO', title: 'Sujetos activos ante el SII' })}><i data-tone="active" />Activos <b className="num">{n(u.activos)}</b></button>
          <button onClick={() => onOpen({ cohort: 'TERMINO_GIRO', title: 'Sujetos con término de giro' })}><i data-tone="terminated" />Término de giro <b className="num">{n(u.terminados)}</b></button>
          <button onClick={() => onOpen({ cohort: 'SIN_PERFIL_SII', title: 'Sujetos sin perfil SII de persona jurídica' })}><i data-tone="unknown" />Sin perfil SII <b className="num">{n(u.sin_perfil)}</b></button>
        </div>
      </div>

      <div className="so-cross-grid">
        <CrossCard label="Con antecedente sancionatorio" value={cross?.sancionados_con_antecedente ?? 0} tone="var(--sig-critical)" hint="resolución o antecedente abrible"
          onClick={() => onOpen({ cohort: 'SANCIONADO', title: 'Sujetos con antecedente sancionatorio' })} />
        <CrossCard label="Con prensa" value={cross?.prensa ?? 0} tone="var(--sig-watch)" hint="menciones coincidentes en el radar"
          onClick={() => onOpen({ cohort: 'PRENSA', title: 'Sujetos con presencia en prensa' })} />
        <CrossCard label="OSFL" value={cross?.osfl ?? 0} tone="var(--unknown)" hint="intersección con el universo OSFL"
          onClick={() => onOpen({ cohort: 'OSFL', title: 'Sujetos obligados que además son OSFL' })} />
        <CrossCard label="Proveedor del Estado" value={cross?.proveedores ?? 0} tone="var(--accent)" hint="presencia en el corte de compras públicas"
          onClick={() => onOpen({ cohort: 'PROVEEDOR_ESTADO', title: 'Sujetos obligados proveedores del Estado' })} />
        <button className="so-cross-card so-cross-gap" onClick={onBrechas}>
          <span>Potenciales SO</span>
          <b className="num">{potentialLoading ? '…' : n(actionable)}</b>
          <em>abrir conciliación SII ↔ UAF →</em>
        </button>
      </div>

      <Panel title="Composición del padrón por sector" meta="selecciona un sector para conocer las entidades" pad={false}>
        <div className="so-sector-tools">
          <label className="so-search">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden><circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.7" /><path d="m16 16 4 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>
            <input value={sectorSearch} onChange={(e) => setSectorSearch(e.target.value)} placeholder="Buscar sector…" />
          </label>
          <div className="seg seg-sm" role="group" aria-label="Filtrar sectores">
            <button data-on={sectorLayer === 'todos'} onClick={() => setSectorLayer('todos')}>Todos</button>
            <button data-on={sectorLayer === 'termino'} onClick={() => setSectorLayer('termino')}>Con término</button>
            <button data-on={sectorLayer === 'sancion'} onClick={() => setSectorLayer('sancion')}>Con sanción</button>
            <button data-on={sectorLayer === 'potencial'} onClick={() => setSectorLayer('potencial')}>Con potenciales</button>
          </div>
        </div>

        {sectorError ? (
          <div className="so-inline-state"><ErrorBox error={sectorError} onRetry={onRetrySectors} /></div>
        ) : sectorLoading && sectorRows.length === 0 ? (
          <div className="so-inline-state"><Loading label="Completando métricas sectoriales…" /></div>
        ) : sectorRows.length === 0 ? (
          <div className="so-inline-state"><Empty title="No hay sectores para este filtro" /></div>
        ) : (
          <div className="so-table-scroll">
            <table className="table so-sector-table">
              <thead>
                <tr>
                  <th>Sector</th>
                  <th className="right">SO UAF</th>
                  <th className="right">Término</th>
                  <th className="right">Sancionados</th>
                  <th className="right">Potenciales</th>
                  <th className="right">Cobertura SII</th>
                  <th className="right">IPF medio</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {sectorRows.map((s) => (
                  <tr key={s.sector}>
                    <td className="so-sector-name">
                      <button onClick={() => onOpen({ cohort: 'SECTOR', value: s.sector, title: titleCase(s.sector) })}>
                        <span>{titleCase(s.sector)}</span>
                        <span className="so-sector-bar"><i style={{ width: `${(s.sujetos / maxSector) * 100}%` }} /></span>
                      </button>
                    </td>
                    <td className="right num"><b>{n(s.sujetos)}</b></td>
                    <td className="right num">
                      {s.terminados > 0 ? <button className="so-number-link" onClick={() => onOpen({ cohort: 'SECTOR', value: s.sector, title: `${titleCase(s.sector)} · padrón` })}>{n(s.terminados)}</button> : '0'}
                    </td>
                    <td className="right num" style={{ color: s.sancionados > 0 ? 'var(--sig-critical)' : undefined }}>{n(s.sancionados)}</td>
                    <td className="right num" style={{ color: s.potential > 0 ? 'var(--sig-medium)' : undefined }}>{n(s.potential)}</td>
                    <td className="right num">{s.siiCoverage == null ? '—' : `${n1(s.siiCoverage)}%`}</td>
                    <td className="right num">{n1(s.ipf_medio)}</td>
                    <td className="right"><button className="btn btn-sm" onClick={() => onOpen({ cohort: 'SECTOR', value: s.sector, title: titleCase(s.sector) })}>Ver entidades →</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </section>
  );
}

function BrechasView({
  potential,
  loading,
  error,
  reload,
  gapRows,
  gapSearch,
  setGapSearch,
  candidateRows,
  candidateSearch,
  setCandidateSearch,
  candidateBand,
  setCandidateBand,
  onlyUnreviewed,
  setOnlyUnreviewed,
  onManage,
  onOpenEntity,
}: {
  potential: UafPotential | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
  gapRows: UafPotential['sectores'];
  gapSearch: string;
  setGapSearch: (value: string) => void;
  candidateRows: UafPotentialCandidate[];
  candidateSearch: string;
  setCandidateSearch: (value: string) => void;
  candidateBand: string;
  setCandidateBand: (value: string) => void;
  onlyUnreviewed: boolean;
  setOnlyUnreviewed: (value: boolean) => void;
  onManage: (item: ManageItem) => void;
  onOpenEntity: (entityId: string) => void;
}) {
  if (loading && !potential) return <Loading label="Conciliando padrón UAF con universo SII…" />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!potential?.disponible || !potential.totales) {
    return <Empty title="Sin corte de conciliación publicado" hint="El snapshot vigente no trae potenciales SO materializados RUT a RUT." />;
  }

  const maxFunnel = Math.max(1, ...potential.embudo.map((step) => step.n));
  const bands = Array.from(new Set((potential.candidatos ?? []).map((c) => c.ivo_band).filter(Boolean))) as string[];

  return (
    <section className="so-section fade-in">
      <div className="so-section-intro">
        <div>
          <span className="so-eyebrow">Conciliación SII ↔ UAF</span>
          <h2>De la brecha sectorial al RUT que puede revisarse</h2>
          <p>
            El embudo separa universo observado, evidencia disponible y candidatos accionables. Una actividad económica
            compatible es una señal de screening; no acredita por sí sola que exista obligación de inscripción.
          </p>
        </div>
        <div className="so-brecha-meta">
          <span><b>{n(potential.totales.accionables)}</b> accionables</span>
          <span><b>{n(potential.totales.sin_revisar)}</b> sin revisar</span>
          <span><b>{n(potential.totales.sectores)}</b> sectores</span>
        </div>
      </div>

      <div className="so-funnel">
        {potential.embudo.map((step, index) => (
          <div className="so-funnel-step" key={step.orden} data-last={index === potential.embudo.length - 1}>
            <div className="so-funnel-top"><b className="num">{n(step.n)}</b><span>{step.etiqueta}</span></div>
            <div className="so-funnel-track"><i style={{ width: `${(Math.log10(1 + step.n) / Math.log10(1 + maxFunnel)) * 100}%` }} /></div>
            <p>{step.glosa}</p>
          </div>
        ))}
      </div>

      <div className="so-brecha-grid">
        <Panel title="Brecha por sector" meta="ordenada por candidatos accionables" pad={false}>
          <div className="so-sector-tools">
            <label className="so-search"><input value={gapSearch} onChange={(e) => setGapSearch(e.target.value)} placeholder="Buscar sector…" /></label>
          </div>
          <div className="so-table-scroll so-gap-table-wrap">
            <table className="table">
              <thead><tr><th>Sector sugerido</th><th className="right">Observadas</th><th className="right">Accionables</th><th className="right">IVO medio</th><th className="right">Materialidad</th></tr></thead>
              <tbody>
                {gapRows.map((s) => (
                  <tr key={s.sector}>
                    <td style={{ fontWeight: 600 }}>{titleCase(s.sector)}</td>
                    <td className="right num" style={{ color: 'var(--ink-3)' }}>{n(s.observadas)}</td>
                    <td className="right num" style={{ color: s.accionables > 0 ? 'var(--sig-medium)' : undefined }}><b>{n(s.accionables)}</b></td>
                    <td className="right num">{n1(s.ivo_medio)}</td>
                    <td className="right num">{n1(s.materialidad_media)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="Cómo leer la cola" meta="criterio antes que volumen">
          <div className="so-reading-list">
            <div><i data-tone="medium" /><span><b>IVO</b> ordena la revisión de la hipótesis. No es probabilidad de obligación.</span></div>
            <div><i data-tone="accent" /><span><b>Materialidad</b> estima el costo de incorporar el sujeto al padrón, no gravedad.</span></div>
            <div><i data-tone="present" /><span><b>Constitución verificable</b> agrega una fuente independiente de identidad.</span></div>
            <div><i data-tone="critical" /><span><b>Antecedente sancionatorio</b> aporta contexto, pero no convierte una hipótesis en obligación.</span></div>
          </div>
          <p className="so-reading-note">Corte SII {potential.corte.sii_periodo ?? '—'} · padrón UAF {potential.corte.uaf_corte ?? '—'} · índice {potential.corte.index_version ?? '—'}.</p>
        </Panel>
      </div>

      <Panel title="Potenciales sujetos obligados" meta={`${n(candidateRows.length)} en el filtro actual`} pad={false}>
        <div className="so-candidate-tools">
          <label className="so-search so-search-wide"><input value={candidateSearch} onChange={(e) => setCandidateSearch(e.target.value)} placeholder="Razón social, RUT, sector o actividad…" /></label>
          <select value={candidateBand} onChange={(e) => setCandidateBand(e.target.value)}>
            <option value="TODAS">Todas las bandas IVO</option>
            {bands.map((band) => <option key={band} value={band}>{titleCase(band)}</option>)}
          </select>
          <button className="chip" data-on={onlyUnreviewed} onClick={() => setOnlyUnreviewed(!onlyUnreviewed)}>Sólo sin revisar</button>
        </div>
        {candidateRows.length === 0 ? (
          <div className="so-inline-state"><Empty title="Ningún candidato coincide con el filtro" /></div>
        ) : (
          <div className="so-table-scroll">
            <table className="table so-candidate-table">
              <thead><tr><th>Entidad</th><th>Sector sugerido</th><th>Actividad coincidente</th><th className="right">IVO</th><th className="right">Materialidad</th><th>Contexto</th><th></th></tr></thead>
              <tbody>
                {candidateRows.map((c) => (
                  <tr key={c.rut}>
                    <td><b>{titleCase(c.name)}</b><span className="so-cell-sub mono">{rutFormat(c.rut)}</span></td>
                    <td>{c.implied_sector ? titleCase(c.implied_sector) : '—'}</td>
                    <td className="so-activity-cell">{c.matched_activity ? titleCase(c.matched_activity) : '—'}<span className="so-cell-sub">{c.region ?? 'sin región observada'}</span></td>
                    <td className="right"><span className="so-score-pill" data-band={(c.ivo_band ?? '').toLowerCase()}><b className="num">{n1(c.ivo_score)}</b><em>{titleCase(c.ivo_band ?? '—')}</em></span></td>
                    <td className="right num">{n1(c.materiality_score)}</td>
                    <td><div className="so-mini-tags">{c.res_available && <span>RES</span>}{c.uaf_sanction_events > 0 && <span data-tone="critical">Sanción {n(c.uaf_sanction_events)}</span>}{c.review_state && <span data-tone="review">{titleCase(c.review_state.replace(/_/g, ' '))}</span>}</div></td>
                    <td className="right"><div className="so-row-actions">{c.entity_id && <button className="btn btn-sm" onClick={() => onOpenEntity(c.entity_id as string)}>Ficha</button>}<button className="btn btn-sm btn-accent" onClick={() => onManage(asPotentialItem(c))}>Gestionar →</button></div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </section>
  );
}

function GestionView({
  queue,
  setQueue,
  uTotalTerminated,
  potentialTotal,
  selected,
  selectedItems,
  managementStatus,
  termRows,
  termSearch,
  setTermSearch,
  termLoading,
  termError,
  reloadTerm,
  termOffset,
  setTermOffset,
  termTotal,
  potentialRows,
  potentialSearch,
  setPotentialSearch,
  potentialLoading,
  potentialError,
  toggleItem,
  setContactItem,
  markStatus,
  onOpenEntity,
  copyBatch,
  exportBatch,
  clearSelection,
}: {
  queue: Queue;
  setQueue: (queue: Queue) => void;
  uTotalTerminated: number;
  potentialTotal: number;
  selected: Record<string, ManageItem>;
  selectedItems: ManageItem[];
  managementStatus: Record<string, ManageStatus>;
  termRows: UafSubjectRow[];
  termSearch: string;
  setTermSearch: (value: string) => void;
  termLoading: boolean;
  termError: string | null;
  reloadTerm: () => void;
  termOffset: number;
  setTermOffset: (value: number) => void;
  termTotal: number;
  potentialRows: UafPotentialCandidate[];
  potentialSearch: string;
  setPotentialSearch: (value: string) => void;
  potentialLoading: boolean;
  potentialError: string | null;
  toggleItem: (item: ManageItem) => void;
  setContactItem: (item: ManageItem) => void;
  markStatus: (item: ManageItem, status: ManageStatus) => void;
  onOpenEntity: (entityId: string) => void;
  copyBatch: () => void;
  exportBatch: () => void;
  clearSelection: () => void;
}) {
  const selectLoadedTerms = () => {
    termRows.forEach((row) => {
      const item = asTermItem(row);
      if (!selected[manageKey(item)]) toggleItem(item);
    });
  };
  const selectLoadedPotentials = () => {
    potentialRows.forEach((row) => {
      const item = asPotentialItem(row);
      if (!selected[manageKey(item)]) toggleItem(item);
    });
  };

  return (
    <section className="so-section fade-in">
      <div className="so-section-intro">
        <div>
          <span className="so-eyebrow">Mesa operativa</span>
          <h2>Detectar → ubicar → preparar gestión</h2>
          <p>
            Selecciona casos, abre búsquedas dirigidas de contacto en fuentes abiertas y conserva un lote de trabajo.
            Atlas no envía solicitudes ni cambia el padrón: prepara la gestión con identidad, motivo y trazabilidad local.
          </p>
        </div>
      </div>

      <div className="so-queue-cards">
        <button data-on={queue === 'desinscripcion'} onClick={() => setQueue('desinscripcion')}>
          <span>Revisión de desinscripción</span><b className="num">{n(uTotalTerminated)}</b><em>SO inscritos con término de giro</em>
        </button>
        <button data-on={queue === 'inscripcion'} onClick={() => setQueue('inscripcion')}>
          <span>Revisión de inscripción</span><b className="num">{n(potentialTotal)}</b><em>potenciales SO accionables</em>
        </button>
        <div className="so-queue-selection"><span>Lote actual</span><b className="num">{n(selectedItems.length)}</b><em>seleccionados entre ambas colas</em></div>
      </div>

      <div className="so-management-grid">
        <div className="panel so-management-main">
          <div className="panel-head">
            <div>
              <h3>{queue === 'desinscripcion' ? 'SO con término de giro' : 'Potenciales SO para revisar inscripción'}</h3>
              <span className="meta">{queue === 'desinscripcion' ? 'padrón UAF conciliado con estado tributario SII' : 'hipótesis materializadas desde la conciliación SII ↔ UAF'}</span>
            </div>
          </div>

          {queue === 'desinscripcion' ? (
            <>
              <div className="so-management-tools">
                <label className="so-search so-search-wide"><input value={termSearch} onChange={(e) => setTermSearch(e.target.value)} placeholder="Buscar en la página cargada por nombre, RUT, sector o región…" /></label>
                <button className="btn btn-sm" onClick={selectLoadedTerms} disabled={!termRows.length}>Seleccionar página</button>
              </div>
              {termError ? <div className="so-inline-state"><ErrorBox error={termError} onRetry={reloadTerm} /></div>
                : termLoading ? <div className="so-inline-state"><Loading label="Cargando sujetos con término de giro…" /></div>
                : termRows.length === 0 ? <div className="so-inline-state"><Empty title="Sin resultados en esta página" /></div>
                : (
                  <div className="so-table-scroll">
                    <table className="table so-management-table">
                      <thead><tr><th></th><th>Entidad</th><th>Sector</th><th>Término SII</th><th>Capas</th><th>Estado</th><th></th></tr></thead>
                      <tbody>
                        {termRows.map((s) => {
                          const item = asTermItem(s);
                          const key = manageKey(item);
                          const status = managementStatus[key] ?? 'PENDIENTE';
                          return (
                            <tr key={s.rut} data-selected={Boolean(selected[key])}>
                              <td><input type="checkbox" checked={Boolean(selected[key])} onChange={() => toggleItem(item)} aria-label={`Seleccionar ${s.name}`} /></td>
                              <td><b>{titleCase(s.name)}</b><span className="so-cell-sub mono">{rutFormat(s.rut)}</span></td>
                              <td>{s.uaf_sector ? titleCase(s.uaf_sector) : '—'}</td>
                              <td>{s.sii_termination_date ? fecha(s.sii_termination_date) : 'fecha no disponible'}</td>
                              <td><div className="so-mini-tags">{s.sanction_evidence_count > 0 && <span data-tone="critical">Sanción</span>}{s.press_evidence_count > 0 && <span>Prensa</span>}{s.is_osfl && <span>OSFL</span>}{s.is_state_supplier && <span>Proveedor</span>}</div></td>
                              <td><StatusChip status={status} /></td>
                              <td className="right"><div className="so-row-actions"><button className="btn btn-sm" onClick={() => setContactItem(item)}>Ubicar</button>{s.entity_id && <button className="btn btn-sm" onClick={() => onOpenEntity(s.entity_id as string)}>Ficha</button>}</div></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              <div className="so-pagination">
                <span className="num">{n(Math.min(termOffset + 1, termTotal))}–{n(Math.min(termOffset + TERM_PAGE, termTotal))} de {n(termTotal)}</span>
                <div><button className="btn btn-sm" disabled={termOffset <= 0} onClick={() => setTermOffset(Math.max(0, termOffset - TERM_PAGE))}>← Anterior</button><button className="btn btn-sm" disabled={termOffset + TERM_PAGE >= termTotal} onClick={() => setTermOffset(termOffset + TERM_PAGE)}>Siguiente →</button></div>
              </div>
            </>
          ) : (
            <>
              <div className="so-management-tools">
                <label className="so-search so-search-wide"><input value={potentialSearch} onChange={(e) => setPotentialSearch(e.target.value)} placeholder="Buscar por nombre, RUT, sector o actividad…" /></label>
                <button className="btn btn-sm" onClick={selectLoadedPotentials} disabled={!potentialRows.length}>Seleccionar visibles</button>
              </div>
              {potentialError ? <div className="so-inline-state"><ErrorBox error={potentialError} /></div>
                : potentialLoading ? <div className="so-inline-state"><Loading label="Cargando potenciales SO…" /></div>
                : potentialRows.length === 0 ? <div className="so-inline-state"><Empty title="Sin potenciales para este filtro" /></div>
                : (
                  <div className="so-table-scroll">
                    <table className="table so-management-table">
                      <thead><tr><th></th><th>Entidad</th><th>Sector sugerido</th><th>Regla / actividad</th><th className="right">IVO</th><th>Estado</th><th></th></tr></thead>
                      <tbody>
                        {potentialRows.map((c) => {
                          const item = asPotentialItem(c);
                          const key = manageKey(item);
                          const status = managementStatus[key] ?? 'PENDIENTE';
                          return (
                            <tr key={c.rut} data-selected={Boolean(selected[key])}>
                              <td><input type="checkbox" checked={Boolean(selected[key])} onChange={() => toggleItem(item)} aria-label={`Seleccionar ${c.name}`} /></td>
                              <td><b>{titleCase(c.name)}</b><span className="so-cell-sub mono">{rutFormat(c.rut)}</span></td>
                              <td>{c.implied_sector ? titleCase(c.implied_sector) : '—'}</td>
                              <td className="so-activity-cell">{c.matched_activity ? titleCase(c.matched_activity) : '—'}<span className="so-cell-sub">{c.detection_tier ? `detección ${c.detection_tier.replace(/_/g, ' ').toLowerCase()}` : ''}</span></td>
                              <td className="right"><span className="so-score-pill" data-band={(c.ivo_band ?? '').toLowerCase()}><b className="num">{n1(c.ivo_score)}</b><em>{titleCase(c.ivo_band ?? '—')}</em></span></td>
                              <td><StatusChip status={status} /></td>
                              <td className="right"><div className="so-row-actions"><button className="btn btn-sm" onClick={() => setContactItem(item)}>Ubicar</button>{c.entity_id && <button className="btn btn-sm" onClick={() => onOpenEntity(c.entity_id as string)}>Ficha</button>}</div></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
            </>
          )}
        </div>

        <aside className="so-batch-panel">
          <div className="so-batch-head"><div><span className="so-eyebrow">Lote de gestión</span><h3>{n(selectedItems.length)} seleccionados</h3></div>{selectedItems.length > 0 && <button className="so-text-btn" onClick={clearSelection}>Limpiar</button>}</div>
          {selectedItems.length === 0 ? (
            <div className="so-batch-empty">Selecciona sujetos de cualquiera de las dos colas. El lote se mantiene al cambiar entre inscripción y desinscripción.</div>
          ) : (
            <div className="so-batch-list">
              {selectedItems.map((item) => {
                const key = manageKey(item);
                const status = managementStatus[key] ?? 'PENDIENTE';
                return (
                  <div className="so-batch-item" key={key}>
                    <div><span className="so-batch-kind" data-kind={item.kind}>{item.kind === 'DESINSCRIPCION' ? 'Desinscripción' : 'Inscripción'}</span><b>{titleCase(item.name)}</b><em className="mono">{rutFormat(item.rut)}</em></div>
                    <StatusChip status={status} />
                    <div className="so-batch-actions"><button onClick={() => setContactItem(item)}>Ubicar</button><button onClick={() => markStatus(item, 'LISTO_SOLICITUD')}>Marcar listo</button></div>
                  </div>
                );
              })}
            </div>
          )}
          <div className="so-batch-footer">
            <button className="btn btn-sm" onClick={copyBatch} disabled={!selectedItems.length}>Copiar lote</button>
            <button className="btn btn-sm btn-accent" onClick={exportBatch} disabled={!selectedItems.length}>Exportar CSV</button>
          </div>
          <p>Los estados de gestión se guardan sólo en este navegador. El CSV conserva acción, identidad, motivo y estado para continuar la tramitación institucional fuera de Atlas.</p>
        </aside>
      </div>
    </section>
  );
}

function ContactDrawer({
  item,
  status,
  onClose,
  onStatus,
  onOpenEntity,
}: {
  item: ManageItem;
  status: ManageStatus;
  onClose: () => void;
  onStatus: (status: ManageStatus) => void;
  onOpenEntity?: () => void;
}) {
  const links = contactLinks(item);
  return (
    <>
      <div className="so-contact-scrim" onClick={onClose} />
      <aside className="so-contact-drawer" role="dialog" aria-label={`Ubicar ${item.name}`}>
        <header>
          <div><span className="so-eyebrow">Búsqueda abierta de contacto</span><h2>{titleCase(item.name)}</h2><p><span className="mono">{rutFormat(item.rut)}</span>{item.sector ? ` · ${titleCase(item.sector)}` : ''}</p></div>
          <button className="drawer-close" onClick={onClose} aria-label="Cerrar">×</button>
        </header>

        <div className="so-contact-body">
          <div className="so-contact-intent"><span>{item.kind === 'DESINSCRIPCION' ? 'Gestión sugerida' : 'Gestión sugerida'}</span><b>{item.kind === 'DESINSCRIPCION' ? 'Ubicar para solicitar revisión de desinscripción' : 'Ubicar para solicitar revisión de inscripción'}</b><p>{item.reason}</p></div>
          <div className="so-contact-links">
            {links.map((link) => (
              <a key={link.label} href={link.href} target="_blank" rel="noreferrer"><span><b>{link.label}</b><em>{link.hint}</em></span><strong>↗</strong></a>
            ))}
          </div>
          <div className="so-contact-actions">
            <button className="btn" onClick={() => void navigator.clipboard?.writeText(`${item.name}\n${rutFormat(item.rut)}\n${item.sector ?? ''}`)}>Copiar identidad</button>
            {onOpenEntity && <button className="btn" onClick={onOpenEntity}>Abrir Entidad 360</button>}
          </div>
        </div>

        <footer>
          <div><span>Estado</span><StatusChip status={status} /></div>
          <div><button className="btn btn-sm" onClick={() => onStatus('CONTACTO_REVISADO')}>Contacto revisado</button><button className="btn btn-sm btn-accent" onClick={() => onStatus('LISTO_SOLICITUD')}>Listo para solicitud</button></div>
        </footer>
      </aside>
    </>
  );
}

function SoKpi({
  label,
  value,
  foot,
  tone,
  onClick,
}: {
  label: string;
  value: string;
  foot: string;
  tone: string;
  onClick: () => void;
}) {
  return (
    <button className="so-kpi" style={{ ['--so-tone' as string]: tone }} onClick={onClick}>
      <span>{label}</span><b className="num">{value}</b><em>{foot}</em><i />
    </button>
  );
}

function CrossCard({
  label,
  value,
  hint,
  tone,
  onClick,
}: {
  label: string;
  value: number;
  hint: string;
  tone: string;
  onClick: () => void;
}) {
  return (
    <button className="so-cross-card" style={{ ['--cross-tone' as string]: tone }} onClick={onClick}>
      <span>{label}</span><b className="num">{n(value)}</b><em>{hint}</em>
    </button>
  );
}

function StatusChip({ status }: { status: ManageStatus }) {
  const meta = STATUS_META[status];
  return <span className="so-status-chip" style={{ ['--status-tone' as string]: meta.tone }}><i />{meta.label}</span>;
}
