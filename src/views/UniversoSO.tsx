import { useEffect, useMemo, useState } from 'react';
import { useRpc } from '../lib/rpc';
import { hrefFor } from '../lib/router';
import type {
  SectorOverview,
  UafPotential,
  UafPotentialCandidate,
  UafPulse,
  UafSubjectRow,
} from '../lib/contracts';
import { CohortDrawer, type CohortRequest } from '../components/CohortDrawer';
import { Empty, ErrorBox, Loading, Panel, Semantics } from '../components/primitives';
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

const TERM_PAGE = 200;
const STORAGE_KEY = 'atlas-observatorio-universo-so-management-v1';

const STATUS: Record<ManageStatus, { label: string; tone: string }> = {
  PENDIENTE: { label: 'Pendiente', tone: 'var(--ink-4)' },
  CONTACTO_REVISADO: { label: 'Contacto revisado', tone: 'var(--sig-watch)' },
  LISTO_SOLICITUD: { label: 'Listo para solicitud', tone: 'var(--present)' },
};

function readStatuses(): Record<string, ManageStatus> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) as Record<string, ManageStatus> : {};
  } catch {
    return {};
  }
}

const managementKey = (item: Pick<ManageItem, 'kind' | 'rut'>) => `${item.kind}|${item.rut}`;
const share = (part: number, total: number) => total > 0 ? (part / total) * 100 : 0;
const webSearch = (query: string) => `https://www.google.com/search?q=${encodeURIComponent(query)}`;

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

export function UniversoSO({
  onNavigate,
  initialMode = 'padron',
}: {
  onNavigate: (hash: string) => void;
  initialMode?: Mode;
}) {
  const pulse = useRpc<UafPulse>('obs_uaf_pulse', {});
  const potential = useRpc<UafPotential>('obs_uaf_potential', {});
  const sectors = useRpc<SectorOverview>('obs_sector_overview', {});

  const [mode, setMode] = useState<Mode>(initialMode);
  const [cohort, setCohort] = useState<CohortRequest | null>(null);
  const [sectorSearch, setSectorSearch] = useState('');
  const [sectorFilter, setSectorFilter] = useState<'todos' | 'termino' | 'sancion' | 'potencial'>('todos');
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

  const sectorRows = useMemo(() => {
    const bySector = pulse.data?.by_sector ?? [];
    const detail = new Map((sectors.data?.sectores ?? []).map((row) => [row.uaf_sector_canonical, row]));
    const gaps = new Map((potential.data?.sectores ?? []).map((row) => [row.sector, row]));
    const query = sectorSearch.trim().toLowerCase();
    return bySector
      .map((row) => {
        const d = detail.get(row.sector);
        const g = gaps.get(row.sector);
        return {
          ...row,
          siiCoverage: d?.sii_coverage_pct ?? null,
          potential: g?.accionables ?? 0,
        };
      })
      .filter((row) => {
        if (query && !row.sector.toLowerCase().includes(query)) return false;
        if (sectorFilter === 'termino') return row.terminados > 0;
        if (sectorFilter === 'sancion') return row.sancionados > 0;
        if (sectorFilter === 'potencial') return row.potential > 0;
        return true;
      })
      .sort((a, b) => b.sujetos - a.sujetos);
  }, [pulse.data, sectors.data, potential.data, sectorSearch, sectorFilter]);

  const candidates = useMemo(() => {
    const query = candidateSearch.trim().toLowerCase();
    return (potential.data?.candidatos ?? [])
      .filter((c) => {
        if (onlyPending && c.review_state) return false;
        if (!query) return true;
        return c.name.toLowerCase().includes(query)
          || c.rut.toLowerCase().includes(query)
          || (c.implied_sector ?? '').toLowerCase().includes(query)
          || (c.matched_activity ?? '').toLowerCase().includes(query);
      })
      .slice()
      .sort((a, b) => (b.ivo_score ?? -1) - (a.ivo_score ?? -1));
  }, [potential.data, candidateSearch, onlyPending]);

  const termRows = useMemo(() => {
    const query = termSearch.trim().toLowerCase();
    return (termQueue.data ?? []).filter((s) => !query
      || s.name.toLowerCase().includes(query)
      || s.rut.toLowerCase().includes(query)
      || (s.uaf_sector ?? '').toLowerCase().includes(query)
      || (s.region ?? '').toLowerCase().includes(query));
  }, [termQueue.data, termSearch]);

  const potentialQueueRows = useMemo(() => {
    const query = potentialSearch.trim().toLowerCase();
    return (potential.data?.candidatos ?? []).filter((c) => !query
      || c.name.toLowerCase().includes(query)
      || c.rut.toLowerCase().includes(query)
      || (c.implied_sector ?? '').toLowerCase().includes(query)
      || (c.matched_activity ?? '').toLowerCase().includes(query));
  }, [potential.data, potentialSearch]);

  const selectedItems = useMemo(() => Object.values(selected), [selected]);

  if (pulse.loading) return <Loading label="Leyendo el universo de sujetos obligados…" />;
  if (pulse.error) return <ErrorBox error={pulse.error} onRetry={pulse.reload} />;
  if (!pulse.data?.universe) {
    return <Empty title="Sin padrón UAF publicado" hint="El snapshot vigente no trae el universo de sujetos obligados." />;
  }

  const u = pulse.data.universe;
  const cross = pulse.data.crosscuts;
  const maxSector = Math.max(1, ...sectorRows.map((row) => row.sujetos));

  const changeMode = (next: Mode) => {
    setMode(next);
    window.history.replaceState(null, '', hrefFor({ view: 'universo', mode: next }));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

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

  const openEntity = (entityId: string) => onNavigate(hrefFor({ view: 'ficha', entityId }));
  const openCohort = (request: CohortRequest) => setCohort(request);

  return (
    <div className="so-view fade-in">
      <header className="so-command">
        <div className="so-command-copy">
          <div className="pulse-kicker">Padrón UAF + conciliación SII · Ley 19.913</div>
          <h1>Universo SO</h1>
          <p className="view-lede">
            Composición del padrón, entidades por sector, cruces de caracterización y brechas de inscripción o
            desinscripción en una sola superficie de trabajo.
          </p>
        </div>
        <div className="so-command-meta">
          <span><b>Padrón</b> {n(u.total)} sujetos</span>
          <span><b>Sectores</b> {n(u.sectores_uaf)}</span>
          <span><b>Conciliación</b> {potential.data?.corte.sii_periodo ?? 'corte vigente'}</span>
        </div>
      </header>

      <nav className="so-modebar" aria-label="Vistas de Universo SO">
        <button data-on={mode === 'padron'} onClick={() => changeMode('padron')}><span>Padrón</span><em>{n(u.total)}</em></button>
        <button data-on={mode === 'brechas'} onClick={() => changeMode('brechas')}><span>Brechas</span><em>{potential.loading ? '…' : n(actionable)}</em></button>
        <button data-on={mode === 'gestion'} onClick={() => changeMode('gestion')}><span>Gestión</span><em>{n(selectedItems.length)}</em></button>
      </nav>

      <div className="so-kpi-grid">
        <Kpi label="Padrón inscrito" value={n(u.total)} foot={`${n(u.sectores_uaf)} sectores`} tone="var(--accent)" onClick={() => openCohort({ cohort: 'TODOS', title: 'Padrón completo de sujetos obligados' })} />
        <Kpi label="Activos ante el SII" value={n(u.activos)} foot={`${n1(share(u.activos, u.total))}% del padrón`} tone="var(--present)" onClick={() => openCohort({ cohort: 'ACTIVO', title: 'Sujetos activos ante el SII' })} />
        <Kpi label="Término de giro" value={n(u.terminados)} foot="revisión de desinscripción" tone="var(--sig-high)" onClick={() => openCohort({ cohort: 'TERMINO_GIRO', title: 'Sujetos con término de giro' })} />
        <Kpi label="Potenciales SO" value={potential.loading ? '…' : n(actionable)} foot="hipótesis accionables SII ↔ UAF" tone="var(--sig-medium)" onClick={() => changeMode('brechas')} />
        <Kpi label="Con señales externas" value={cross ? n(cross.con_senal) : '—'} foot="capas de caracterización" tone="var(--unknown)" onClick={() => openCohort({ cohort: 'CON_SENAL', title: 'Sujetos con señales externas' })} />
      </div>

      {mode === 'padron' && (
        <section className="so-section fade-in">
          <div className="so-status-card">
            <div className="so-status-head"><div><span className="so-eyebrow">Estado tributario del padrón</span><strong>{n(u.total)} sujetos inscritos</strong></div><span className="so-status-note">cada franja abre sus entidades</span></div>
            <div className="so-status-track">
              <button data-tone="active" style={{ width: `${share(u.activos, u.total)}%` }} onClick={() => openCohort({ cohort: 'ACTIVO', title: 'Sujetos activos ante el SII' })} />
              <button data-tone="terminated" style={{ width: `${share(u.terminados, u.total)}%` }} onClick={() => openCohort({ cohort: 'TERMINO_GIRO', title: 'Sujetos con término de giro' })} />
              <button data-tone="unknown" style={{ width: `${share(u.sin_perfil, u.total)}%` }} onClick={() => openCohort({ cohort: 'SIN_PERFIL_SII', title: 'Sujetos sin perfil SII' })} />
            </div>
            <div className="so-status-legend">
              <button onClick={() => openCohort({ cohort: 'ACTIVO', title: 'Sujetos activos ante el SII' })}><i data-tone="active" />Activos <b className="num">{n(u.activos)}</b></button>
              <button onClick={() => openCohort({ cohort: 'TERMINO_GIRO', title: 'Sujetos con término de giro' })}><i data-tone="terminated" />Término de giro <b className="num">{n(u.terminados)}</b></button>
              <button onClick={() => openCohort({ cohort: 'SIN_PERFIL_SII', title: 'Sujetos sin perfil SII' })}><i data-tone="unknown" />Sin perfil SII <b className="num">{n(u.sin_perfil)}</b></button>
            </div>
          </div>

          <div className="so-cross-grid">
            <Cross label="Con antecedente sancionatorio" value={cross?.sancionados_con_antecedente ?? 0} hint="resolución o antecedente abrible" tone="var(--sig-critical)" onClick={() => openCohort({ cohort: 'SANCIONADO', title: 'Sujetos con antecedente sancionatorio' })} />
            <Cross label="Con prensa" value={cross?.prensa ?? 0} hint="menciones coincidentes" tone="var(--sig-watch)" onClick={() => openCohort({ cohort: 'PRENSA', title: 'Sujetos con presencia en prensa' })} />
            <Cross label="OSFL" value={cross?.osfl ?? 0} hint="intersección con universo OSFL" tone="var(--unknown)" onClick={() => openCohort({ cohort: 'OSFL', title: 'Sujetos obligados que además son OSFL' })} />
            <Cross label="Proveedor del Estado" value={cross?.proveedores ?? 0} hint="corte de compras públicas" tone="var(--accent)" onClick={() => openCohort({ cohort: 'PROVEEDOR_ESTADO', title: 'Sujetos obligados proveedores del Estado' })} />
            <button className="so-cross-card so-cross-gap" onClick={() => changeMode('brechas')}><span>Potenciales SO</span><b className="num">{potential.loading ? '…' : n(actionable)}</b><em>abrir conciliación SII ↔ UAF →</em></button>
          </div>

          <Panel title="Composición del padrón por sector" meta="selecciona un sector para conocer sus entidades" pad={false}>
            <div className="so-sector-tools">
              <label className="so-search"><input value={sectorSearch} onChange={(e) => setSectorSearch(e.target.value)} placeholder="Buscar sector…" /></label>
              <div className="seg seg-sm">
                <button data-on={sectorFilter === 'todos'} onClick={() => setSectorFilter('todos')}>Todos</button>
                <button data-on={sectorFilter === 'termino'} onClick={() => setSectorFilter('termino')}>Con término</button>
                <button data-on={sectorFilter === 'sancion'} onClick={() => setSectorFilter('sancion')}>Con sanción</button>
                <button data-on={sectorFilter === 'potencial'} onClick={() => setSectorFilter('potencial')}>Con potenciales</button>
              </div>
            </div>
            {sectors.error ? <div className="so-inline-state"><ErrorBox error={sectors.error} onRetry={sectors.reload} /></div> : (
              <div className="so-table-scroll">
                <table className="table so-sector-table"><thead><tr><th>Sector</th><th className="right">SO UAF</th><th className="right">Término</th><th className="right">Sancionados</th><th className="right">Potenciales</th><th className="right">Cobertura SII</th><th className="right">IPF medio</th><th /></tr></thead>
                  <tbody>{sectorRows.map((row) => <tr key={row.sector}>
                    <td className="so-sector-name"><button onClick={() => openCohort({ cohort: 'SECTOR', value: row.sector, title: titleCase(row.sector) })}><span>{titleCase(row.sector)}</span><span className="so-sector-bar"><i style={{ width: `${row.sujetos / maxSector * 100}%` }} /></span></button></td>
                    <td className="right num"><b>{n(row.sujetos)}</b></td><td className="right num">{n(row.terminados)}</td><td className="right num">{n(row.sancionados)}</td><td className="right num">{n(row.potential)}</td><td className="right num">{row.siiCoverage == null ? '—' : `${n1(row.siiCoverage)}%`}</td><td className="right num">{n1(row.ipf_medio)}</td>
                    <td className="right"><button className="btn btn-sm" onClick={() => openCohort({ cohort: 'SECTOR', value: row.sector, title: titleCase(row.sector) })}>Ver entidades →</button></td>
                  </tr>)}</tbody></table>
              </div>
            )}
          </Panel>
        </section>
      )}

      {mode === 'brechas' && (
        <section className="so-section fade-in">
          <div className="so-section-intro"><div><span className="so-eyebrow">Conciliación SII ↔ UAF</span><h2>De la brecha sectorial al RUT revisable</h2><p>Una actividad compatible es una señal de screening; no acredita por sí sola la obligación de inscripción.</p></div></div>
          {potential.error ? <ErrorBox error={potential.error} onRetry={potential.reload} /> : potential.loading && !potential.data ? <Loading label="Conciliando SII y padrón UAF…" /> : !potential.data?.disponible ? <Empty title="Sin conciliación materializada" /> : <>
            <div className="so-funnel">{potential.data.embudo.map((step, index) => {
              const max = Math.max(1, ...potential.data!.embudo.map((s) => s.n));
              return <div className="so-funnel-step" data-last={index === potential.data!.embudo.length - 1} key={step.orden}><div className="so-funnel-top"><b className="num">{n(step.n)}</b><span>{step.etiqueta}</span></div><div className="so-funnel-track"><i style={{ width: `${Math.log10(1 + step.n) / Math.log10(1 + max) * 100}%` }} /></div><p>{step.glosa}</p></div>;
            })}</div>
            <Panel title="Potenciales sujetos obligados" meta={`${n(candidates.length)} en el filtro actual`} pad={false}>
              <div className="so-candidate-tools"><label className="so-search so-search-wide"><input value={candidateSearch} onChange={(e) => setCandidateSearch(e.target.value)} placeholder="Razón social, RUT, sector o actividad…" /></label><button className="chip" data-on={onlyPending} onClick={() => setOnlyPending(!onlyPending)}>Sólo sin revisar</button></div>
              <div className="so-table-scroll"><table className="table so-candidate-table"><thead><tr><th>Entidad</th><th>Sector sugerido</th><th>Actividad coincidente</th><th className="right">IVO</th><th className="right">Materialidad</th><th>Contexto</th><th /></tr></thead><tbody>{candidates.map((c) => <tr key={c.rut}>
                <td><b>{titleCase(c.name)}</b><span className="so-cell-sub mono">{rutFormat(c.rut)}</span></td><td>{c.implied_sector ? titleCase(c.implied_sector) : '—'}</td><td className="so-activity-cell">{c.matched_activity ? titleCase(c.matched_activity) : '—'}<span className="so-cell-sub">{c.region ?? 'sin región observada'}</span></td><td className="right"><span className="so-score-pill" data-band={(c.ivo_band ?? '').toLowerCase()}><b className="num">{n1(c.ivo_score)}</b><em>{titleCase(c.ivo_band ?? '—')}</em></span></td><td className="right num">{n1(c.materiality_score)}</td><td><div className="so-mini-tags">{c.res_available && <span>RES</span>}{c.uaf_sanction_events > 0 && <span data-tone="critical">Sanción {n(c.uaf_sanction_events)}</span>}{c.review_state && <span data-tone="review">{titleCase(c.review_state.replace(/_/g, ' '))}</span>}</div></td><td className="right"><div className="so-row-actions">{c.entity_id && <button className="btn btn-sm" onClick={() => openEntity(c.entity_id as string)}>Ficha</button>}<button className="btn btn-sm btn-accent" onClick={() => manage(potentialItem(c))}>Gestionar →</button></div></td>
              </tr>)}</tbody></table></div>
            </Panel>
          </>}
        </section>
      )}

      {mode === 'gestion' && (
        <section className="so-section fade-in">
          <div className="so-section-intro"><div><span className="so-eyebrow">Mesa operativa</span><h2>Detectar → ubicar → preparar gestión</h2><p>Selecciona casos y usa fuentes abiertas para ubicar contactos. Atlas prepara el trabajo; no envía solicitudes ni modifica el padrón.</p></div></div>
          <div className="so-queue-cards">
            <button data-on={queue === 'desinscripcion'} onClick={() => setQueue('desinscripcion')}><span>Revisión de desinscripción</span><b className="num">{n(u.terminados)}</b><em>SO con término de giro</em></button>
            <button data-on={queue === 'inscripcion'} onClick={() => setQueue('inscripcion')}><span>Revisión de inscripción</span><b className="num">{n(actionable)}</b><em>potenciales SO accionables</em></button>
            <div className="so-queue-selection"><span>Lote actual</span><b className="num">{n(selectedItems.length)}</b><em>seleccionados</em></div>
          </div>
          <div className="so-management-grid">
            <div className="panel so-management-main">
              <div className="panel-head"><h3>{queue === 'desinscripcion' ? 'SO con término de giro' : 'Potenciales SO para revisar inscripción'}</h3><div className="meta">selecciona y ubica</div></div>
              {queue === 'desinscripcion' ? <>
                <div className="so-management-tools"><label className="so-search so-search-wide"><input value={termSearch} onChange={(e) => setTermSearch(e.target.value)} placeholder="Buscar en la página por nombre, RUT, sector o región…" /></label></div>
                {termQueue.error ? <div className="so-inline-state"><ErrorBox error={termQueue.error} onRetry={termQueue.reload} /></div> : termQueue.loading ? <div className="so-inline-state"><Loading /></div> : <ManagementTable rows={termRows.map(termItem)} selected={selected} statuses={statuses} onToggle={toggle} onContact={setContact} onEntity={openEntity} />}
                <div className="so-pagination"><span className="num">{n(termOffset + 1)}–{n(Math.min(termOffset + TERM_PAGE, termQueue.data?.[0]?.total_count ?? u.terminados))} de {n(termQueue.data?.[0]?.total_count ?? u.terminados)}</span><div><button className="btn btn-sm" disabled={termOffset === 0} onClick={() => setTermOffset(Math.max(0, termOffset - TERM_PAGE))}>← Anterior</button><button className="btn btn-sm" disabled={termOffset + TERM_PAGE >= (termQueue.data?.[0]?.total_count ?? u.terminados)} onClick={() => setTermOffset(termOffset + TERM_PAGE)}>Siguiente →</button></div></div>
              </> : <>
                <div className="so-management-tools"><label className="so-search so-search-wide"><input value={potentialSearch} onChange={(e) => setPotentialSearch(e.target.value)} placeholder="Buscar por nombre, RUT, sector o actividad…" /></label></div>
                {potential.error ? <div className="so-inline-state"><ErrorBox error={potential.error} onRetry={potential.reload} /></div> : potential.loading ? <div className="so-inline-state"><Loading /></div> : <ManagementTable rows={potentialQueueRows.map(potentialItem)} selected={selected} statuses={statuses} onToggle={toggle} onContact={setContact} onEntity={openEntity} />}
              </>}
            </div>
            <aside className="so-batch-panel"><div className="so-batch-head"><div><span className="so-eyebrow">Lote de gestión</span><h3>{n(selectedItems.length)} seleccionados</h3></div>{selectedItems.length > 0 && <button className="so-text-btn" onClick={() => setSelected({})}>Limpiar</button>}</div>
              {selectedItems.length === 0 ? <div className="so-batch-empty">Selecciona entidades de cualquiera de las dos colas.</div> : <div className="so-batch-list">{selectedItems.map((item) => <div className="so-batch-item" key={managementKey(item)}><div><span className="so-batch-kind" data-kind={item.kind}>{item.kind === 'DESINSCRIPCION' ? 'Desinscripción' : 'Inscripción'}</span><b>{titleCase(item.name)}</b><em className="mono">{rutFormat(item.rut)}</em></div><StatusChip status={statuses[managementKey(item)] ?? 'PENDIENTE'} /><div className="so-batch-actions"><button onClick={() => setContact(item)}>Ubicar</button><button onClick={() => setStatus(item, 'LISTO_SOLICITUD')}>Marcar listo</button></div></div>)}</div>}
              <div className="so-batch-footer"><button className="btn btn-sm btn-accent" onClick={exportBatch} disabled={!selectedItems.length}>Exportar CSV</button></div><p>Los estados quedan en este navegador; el CSV permite continuar la tramitación institucional fuera de Atlas.</p>
            </aside>
          </div>
        </section>
      )}

      <Semantics><strong>Cómo leer Universo SO.</strong> Término de giro y potenciales SO son motivos de revisión, no decisiones automáticas. Sanciones, prensa, OSFL y proveedor del Estado son capas de caracterización y no una conclusión de incumplimiento o riesgo LA/FT.</Semantics>

      {cohort && <CohortDrawer request={cohort} onClose={() => setCohort(null)} onOpenEntity={(entityId) => { setCohort(null); openEntity(entityId); }} />}
      {contact && <ContactDrawer item={contact} status={statuses[managementKey(contact)] ?? 'PENDIENTE'} onClose={() => setContact(null)} onStatus={(status) => setStatus(contact, status)} onOpenEntity={contact.entityId ? () => openEntity(contact.entityId as string) : undefined} />}
    </div>
  );
}

function ManagementTable({ rows, selected, statuses, onToggle, onContact, onEntity }: {
  rows: ManageItem[];
  selected: Record<string, ManageItem>;
  statuses: Record<string, ManageStatus>;
  onToggle: (item: ManageItem) => void;
  onContact: (item: ManageItem) => void;
  onEntity: (id: string) => void;
}) {
  if (!rows.length) return <div className="so-inline-state"><Empty title="Sin resultados para este filtro" /></div>;
  return <div className="so-table-scroll"><table className="table so-management-table"><thead><tr><th /><th>Entidad</th><th>Sector</th><th>Motivo</th><th>Estado</th><th /></tr></thead><tbody>{rows.map((item) => {
    const key = managementKey(item);
    return <tr key={key} data-selected={Boolean(selected[key])}><td><input type="checkbox" checked={Boolean(selected[key])} onChange={() => onToggle(item)} /></td><td><b>{titleCase(item.name)}</b><span className="so-cell-sub mono">{rutFormat(item.rut)}</span></td><td>{item.sector ? titleCase(item.sector) : '—'}</td><td className="so-activity-cell">{item.reason}</td><td><StatusChip status={statuses[key] ?? 'PENDIENTE'} /></td><td className="right"><div className="so-row-actions"><button className="btn btn-sm" onClick={() => onContact(item)}>Ubicar</button>{item.entityId && <button className="btn btn-sm" onClick={() => onEntity(item.entityId as string)}>Ficha</button>}</div></td></tr>;
  })}</tbody></table></div>;
}

function ContactDrawer({ item, status, onClose, onStatus, onOpenEntity }: {
  item: ManageItem;
  status: ManageStatus;
  onClose: () => void;
  onStatus: (status: ManageStatus) => void;
  onOpenEntity?: () => void;
}) {
  return <><div className="so-contact-scrim" onClick={onClose} /><aside className="so-contact-drawer" role="dialog" aria-label={`Ubicar ${item.name}`}><header><div><span className="so-eyebrow">Búsqueda abierta de contacto</span><h2>{titleCase(item.name)}</h2><p><span className="mono">{rutFormat(item.rut)}</span>{item.sector ? ` · ${titleCase(item.sector)}` : ''}</p></div><button className="drawer-close" onClick={onClose}>×</button></header><div className="so-contact-body"><div className="so-contact-intent"><span>Gestión sugerida</span><b>{item.kind === 'DESINSCRIPCION' ? 'Ubicar para solicitar revisión de desinscripción' : 'Ubicar para solicitar revisión de inscripción'}</b><p>{item.reason}</p></div><div className="so-contact-links">{contactSources(item).map(([label, hint, href]) => <a key={label} href={href} target="_blank" rel="noreferrer"><span><b>{label}</b><em>{hint}</em></span><strong>↗</strong></a>)}</div><div className="so-contact-actions">{onOpenEntity && <button className="btn" onClick={onOpenEntity}>Abrir Entidad 360</button>}</div></div><footer><div><span>Estado</span><StatusChip status={status} /></div><div><button className="btn btn-sm" onClick={() => onStatus('CONTACTO_REVISADO')}>Contacto revisado</button><button className="btn btn-sm btn-accent" onClick={() => onStatus('LISTO_SOLICITUD')}>Listo para solicitud</button></div></footer></aside></>;
}

function Kpi({ label, value, foot, tone, onClick }: { label: string; value: string; foot: string; tone: string; onClick: () => void }) {
  return <button className="so-kpi" style={{ ['--so-tone' as string]: tone }} onClick={onClick}><span>{label}</span><b className="num">{value}</b><em>{foot}</em><i /></button>;
}

function Cross({ label, value, hint, tone, onClick }: { label: string; value: number; hint: string; tone: string; onClick: () => void }) {
  return <button className="so-cross-card" style={{ ['--cross-tone' as string]: tone }} onClick={onClick}><span>{label}</span><b className="num">{n(value)}</b><em>{hint}</em></button>;
}

function StatusChip({ status }: { status: ManageStatus }) {
  const meta = STATUS[status];
  return <span className="so-status-chip" style={{ ['--status-tone' as string]: meta.tone }}><i />{meta.label}</span>;
}
