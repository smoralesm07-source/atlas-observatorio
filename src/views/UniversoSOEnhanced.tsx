import { useEffect, useMemo, useState } from 'react';
import { useRpc } from '../lib/rpc';
import { hrefFor } from '../lib/router';
import type { SectorOverview, UafPotential, UafPotentialCandidate, UafPulse, UafReportingSector, UafSubjectRow } from '../lib/contracts';
import { Empty, ErrorBox, Loading, Semantics } from '../components/primitives';
import { fecha, n, n1, rutFormat, titleCase } from '../lib/format';
import '../styles/universo-so-enhanced.css';

type Mode = 'padron' | 'brechas' | 'gestion';
type Queue = 'termino' | 'potenciales';
type CaseStatus = 'PENDIENTE' | 'REVISADO' | 'LISTO';

type SectorRow = UafPulse['by_sector'][number] & {
  potential: number;
  reportingRate: number | null;
  ros2025: number | null;
  icr: number | null;
  siiCoverage: number | null;
};

type CaseItem = {
  kind: Queue;
  rut: string;
  name: string;
  sector: string | null;
  region: string | null;
  entityId: string | null;
  motive: string;
  date: string | null;
  press: number;
  sanctions: number;
  osfl: boolean;
  supplier: boolean;
  ipf: number | null;
  ivo: number | null;
  materiality: number | null;
};

const CASE_STATUS_KEY = 'atlas-universo-so-case-status-v3';
const clamp = (v: number) => Math.max(0, Math.min(100, v));
const share = (part: number, total: number) => total > 0 ? (part / total) * 100 : 0;
const short = (value: string, max = 24) => value.length > max ? `${value.slice(0, max - 1)}…` : value;
const webSearch = (query: string) => `https://www.google.com/search?q=${encodeURIComponent(query)}`;

function readStatuses(): Record<string, CaseStatus> {
  try {
    const raw = localStorage.getItem(CASE_STATUS_KEY);
    return raw ? JSON.parse(raw) as Record<string, CaseStatus> : {};
  } catch {
    return {};
  }
}

function termCase(row: UafSubjectRow): CaseItem {
  return {
    kind: 'termino', rut: row.rut, name: row.name, sector: row.uaf_sector, region: row.region, entityId: row.entity_id,
    motive: row.sii_termination_date ? `Término de giro SII · ${fecha(row.sii_termination_date)}` : 'Término de giro observado ante SII',
    date: row.sii_termination_date, press: row.press_evidence_count, sanctions: row.sanction_evidence_count,
    osfl: row.is_osfl, supplier: row.is_state_supplier, ipf: row.ipf_score, ivo: null, materiality: null,
  };
}

function potentialCase(row: UafPotentialCandidate): CaseItem {
  return {
    kind: 'potenciales', rut: row.rut, name: row.name, sector: row.implied_sector, region: row.region, entityId: row.entity_id,
    motive: row.matched_activity ? `Actividad coincidente: ${titleCase(row.matched_activity)}` : 'Hipótesis de inscripción por conciliación SII ↔ UAF',
    date: row.reviewed_at, press: 0, sanctions: row.uaf_sanction_events, osfl: false, supplier: false,
    ipf: null, ivo: row.ivo_score, materiality: row.materiality_score,
  };
}

function contactSources(item: CaseItem) {
  const name = item.name.replace(/\s+/g, ' ').trim();
  const rut = rutFormat(item.rut);
  return [
    ['Web', webSearch(`"${name}" "${rut}" contacto`)],
    ['Correo / teléfono', webSearch(`"${name}" (correo OR email OR teléfono OR contacto)`) ],
    ['LinkedIn', webSearch(`site:linkedin.com/company "${name}" Chile`)],
    ['Mercado Público', webSearch(`site:mercadopublico.cl "${item.rut}" "${name}"`)],
    ['RES', webSearch(`site:registrodeempresasysociedades.cl "${item.rut}"`)],
    ['SII', webSearch(`site:sii.cl "${item.rut}" "${name}"`)],
  ] as const;
}

export function UniversoSOEnhanced({ onNavigate, initialMode = 'padron' }: { onNavigate: (hash: string) => void; initialMode?: Mode }) {
  const pulse = useRpc<UafPulse>('obs_uaf_pulse', {});
  const potential = useRpc<UafPotential>('obs_uaf_potential', {});
  const sectorOverview = useRpc<SectorOverview>('obs_sector_overview', {});

  const [selectedSector, setSelectedSector] = useState<string | null>(null);
  const [queue, setQueue] = useState<Queue>(initialMode === 'brechas' ? 'potenciales' : 'termino');
  const [caseSearch, setCaseSearch] = useState('');
  const [selectedCase, setSelectedCase] = useState<CaseItem | null>(null);
  const [statuses, setStatuses] = useState<Record<string, CaseStatus>>(readStatuses);
  const [note, setNote] = useState('');
  const [regionMetric, setRegionMetric] = useState<'sujetos' | 'atencion'>('sujetos');

  useEffect(() => {
    try { localStorage.setItem(CASE_STATUS_KEY, JSON.stringify(statuses)); } catch { /* private mode */ }
  }, [statuses]);

  const sectors = useMemo<SectorRow[]>(() => {
    const potentialBySector = new Map((potential.data?.sectores ?? []).map((row) => [row.sector, row]));
    const detail = new Map((sectorOverview.data?.sectores ?? []).map((row) => [row.uaf_sector_canonical, row]));
    const reporting = new Map(
      (pulse.data?.reporting?.sectores ?? [])
        .filter((row): row is UafReportingSector & { sector_canonical: string } => Boolean(row.sector_canonical))
        .map((row) => [row.sector_canonical, row]),
    );
    return (pulse.data?.by_sector ?? []).map((row) => {
      const p = potentialBySector.get(row.sector);
      const d = detail.get(row.sector);
      const r = reporting.get(row.sector);
      return {
        ...row,
        potential: p?.accionables ?? 0,
        reportingRate: r?.ros_per_100_so_2025 ?? null,
        ros2025: r?.ros_2025 ?? null,
        icr: r?.icr_pct ?? null,
        siiCoverage: d?.sii_coverage_pct ?? null,
      };
    }).sort((a, b) => b.sujetos - a.sujetos);
  }, [pulse.data, potential.data, sectorOverview.data]);

  const activeSector = selectedSector ?? sectors[0]?.sector ?? null;
  const sectorSubjects = useRpc<UafSubjectRow[]>('obs_uaf_cohort', {
    p_cohort: 'SECTOR', p_value: activeSector, p_limit: 8, p_offset: 0,
  }, { skip: !activeSector });

  const termQueue = useRpc<UafSubjectRow[]>('obs_uaf_cohort', {
    p_cohort: 'TERMINO_GIRO', p_value: null, p_limit: 80, p_offset: 0,
  });

  const activeSectorRow = sectors.find((row) => row.sector === activeSector) ?? null;
  const potentialCount = potential.data?.totales?.accionables ?? 0;
  const cross = pulse.data?.crosscuts;

  const cases = useMemo<CaseItem[]>(() => {
    const query = caseSearch.trim().toLowerCase();
    const rows = queue === 'termino'
      ? (termQueue.data ?? []).map(termCase)
      : (potential.data?.candidatos ?? []).map(potentialCase).sort((a, b) => (b.ivo ?? -1) - (a.ivo ?? -1));
    return rows.filter((row) => !query
      || row.name.toLowerCase().includes(query)
      || row.rut.toLowerCase().includes(query)
      || (row.sector ?? '').toLowerCase().includes(query)
      || (row.region ?? '').toLowerCase().includes(query));
  }, [queue, termQueue.data, potential.data, caseSearch]);

  useEffect(() => {
    const first = cases[0];
    if (!first) { setSelectedCase(null); return; }
    if (!selectedCase || selectedCase.kind !== queue || !cases.some((item) => item.rut === selectedCase.rut)) {
      setSelectedCase(first);
      setNote('');
    }
  }, [cases, queue, selectedCase]);

  if (pulse.loading) return <Loading label="Leyendo Universo SO…" />;
  if (pulse.error) return <ErrorBox error={pulse.error} onRetry={pulse.reload} />;
  if (!pulse.data?.universe) return <Empty title="Sin padrón UAF publicado" />;

  const u = pulse.data.universe;
  const reportingTotals = pulse.data.reporting.totales;
  const topRegions = pulse.data.by_region.slice().sort((a, b) => b.sujetos - a.sujetos).slice(0, 7);
  const maxRegion = Math.max(1, ...topRegions.map((r) => regionMetric === 'sujetos' ? r.sujetos : r.en_atencion));
  const maxSector = Math.max(1, ...sectors.slice(0, 7).map((row) => row.sujetos));
  const maxTerm = Math.max(1, ...sectors.slice(0, 8).map((row) => row.terminados));
  const maxPotential = Math.max(1, ...sectors.slice(0, 8).map((row) => row.potential));
  const openEntity = (entityId: string) => onNavigate(hrefFor({ view: 'ficha', entityId }));
  const statusKey = selectedCase ? `${selectedCase.kind}|${selectedCase.rut}` : '';
  const selectedStatus = statusKey ? statuses[statusKey] ?? 'PENDIENTE' : 'PENDIENTE';

  const signalCards = [
    { label: 'SO inscritos', value: n(u.total), sub: `${n(u.sectores_uaf)} sectores`, tone: 'cyan' },
    { label: 'ROS 2025', value: reportingTotals?.ros_2025 == null ? '—' : n(reportingTotals.ros_2025), sub: 'reportabilidad sectorial', tone: 'blue' },
    { label: 'Prensa', value: cross ? n(cross.prensa) : '—', sub: cross ? `${n1(share(cross.prensa, u.total))}% del padrón` : 'sin corte', tone: 'green' },
    { label: 'Término de giro', value: n(u.terminados), sub: `${n1(share(u.terminados, u.total))}% del padrón`, tone: 'red' },
    { label: 'OSFL', value: cross ? n(cross.osfl) : '—', sub: 'coincidencia abierta', tone: 'purple' },
    { label: 'Proveedor Estado', value: cross ? n(cross.proveedores) : '—', sub: 'capa de contexto', tone: 'emerald' },
    { label: 'Sanción', value: cross ? n(cross.sancionados_con_antecedente) : '—', sub: 'con antecedente', tone: 'amber' },
    { label: 'Potenciales', value: potential.loading ? '…' : n(potentialCount), sub: 'screening SII ↔ UAF', tone: 'orange' },
  ];

  return (
    <div className="uso3 fade-in">
      <header className="uso3-titlebar">
        <div><span>PADRÓN UAF · CONCILIACIÓN SII · FUENTES ABIERTAS</span><h1>Universo SO <em>· Radar territorial y operativo</em></h1><p>Una mirada integrada para entender el padrón, profundizar por sector y atender brechas.</p></div>
        <div className="uso3-cut"><span>Actualizado</span><b>{pulse.data.snapshot ? fecha(pulse.data.snapshot.published_at ?? pulse.data.snapshot.generated_at) : 'corte vigente'}</b></div>
      </header>

      <section className="uso3-signal-strip" aria-label="Situación actual del padrón">
        <div className="uso3-strip-label"><b>Situación actual</b><span>señales Atlas</span></div>
        {signalCards.map((card) => <SignalCard key={card.label} {...card} />)}
      </section>

      <div className="uso3-workspace">
        <aside className="uso3-regional panel-like">
          <SectionHead title="Análisis regional de SO" sub="Distribución y foco territorial" />
          <div className="uso3-region-switch"><button data-on={regionMetric === 'sujetos'} onClick={() => setRegionMetric('sujetos')}>Inscritos</button><button data-on={regionMetric === 'atencion'} onClick={() => setRegionMetric('atencion')}>En atención</button></div>
          <div className="uso3-chile"><svg viewBox="0 0 80 360" aria-hidden="true"><path d="M46 5 54 18 48 31 55 44 47 58 54 73 45 90 49 108 40 126 44 144 36 164 39 184 31 204 35 226 27 247 31 267 25 287 30 307 22 326 27 344 20 355" fill="none" stroke="currentColor" strokeWidth="10" strokeLinecap="round" opacity=".35"/><path d="M46 5 54 18 48 31 55 44 47 58 54 73 45 90 49 108 40 126 44 144 36 164 39 184 31 204 35 226 27 247 31 267 25 287 30 307 22 326 27 344" fill="none" stroke="var(--accent)" strokeWidth="4" strokeLinecap="round" opacity=".9"/></svg><div><b>{n(u.total)}</b><span>total nacional</span><em>{n(u.regiones)} regiones</em></div></div>
          <div className="uso3-region-bars">{topRegions.map((row, index) => { const value = regionMetric === 'sujetos' ? row.sujetos : row.en_atencion; return <button key={row.region} onClick={() => onNavigate(hrefFor({ view: 'entidades', region: row.region }))}><i>{index + 1}</i><span>{short(titleCase(row.region), 18)}</span><u><b style={{ width: `${value / maxRegion * 100}%` }} /></u><strong className="num">{n(value)}</strong></button>; })}</div>
          {topRegions[0] && <div className="uso3-region-focus"><span>Mayor concentración</span><b>{titleCase(topRegions[0].region)}</b><div><em>{n(topRegions[0].sujetos)} SO</em><em>{n(topRegions[0].terminados)} término</em><em>{n(topRegions[0].en_atencion)} atención</em></div></div>}
        </aside>

        <main className="uso3-center">
          <section className="uso3-priority panel-like">
            <SectionHead title="Sectores más representativos" sub="Selecciona un sector para caracterizar sus sujetos" />
            <div className="uso3-sector-layout">
              <div className="uso3-sector-rank">{sectors.slice(0, 7).map((row, index) => <button key={row.sector} data-on={row.sector === activeSector} onClick={() => setSelectedSector(row.sector)}><i>{index + 1}</i><span>{short(titleCase(row.sector), 27)}</span><u><b style={{ width: `${row.sujetos / maxSector * 100}%` }} /></u><strong className="num">{n(row.sujetos)}</strong><em>{n1(share(row.sujetos, u.total))}%</em></button>)}</div>
              {activeSectorRow && <div className="uso3-sector-focus"><span>Sector seleccionado</span><h3>{titleCase(activeSectorRow.sector)}</h3><b>{n(activeSectorRow.sujetos)} <em>SO</em></b><div className="uso3-focus-meter"><i><u style={{ width: `${clamp(share(activeSectorRow.en_atencion, activeSectorRow.sujetos))}%` }} /></i><span>{n1(share(activeSectorRow.en_atencion, activeSectorRow.sujetos))}% en atención</span></div><dl><div><dt>Término</dt><dd>{n(activeSectorRow.terminados)}</dd></div><div><dt>Potenciales</dt><dd>{n(activeSectorRow.potential)}</dd></div><div><dt>Sancionados</dt><dd>{n(activeSectorRow.sancionados)}</dd></div><div><dt>ROS 2025</dt><dd>{activeSectorRow.ros2025 == null ? '—' : n(activeSectorRow.ros2025)}</dd></div><div><dt>ROS / 100 SO</dt><dd>{activeSectorRow.reportingRate == null ? '—' : n1(activeSectorRow.reportingRate)}</dd></div><div><dt>ICR</dt><dd>{activeSectorRow.icr == null ? '—' : `${n1(activeSectorRow.icr)}%`}</dd></div></dl></div>}
            </div>
          </section>

          <section className="uso3-subjects panel-like">
            <div className="uso3-subject-head"><SectionHead title={`SO caracterizados · ${activeSector ? titleCase(activeSector) : 'sector'}`} sub="Señales críticas disponibles en Atlas" /><span>{sectorSubjects.data?.[0]?.total_count ? `${n(sectorSubjects.data[0].total_count)} entidades` : ''}</span></div>
            {sectorSubjects.loading ? <div className="uso3-inline"><Loading /></div> : sectorSubjects.error ? <ErrorBox error={sectorSubjects.error} onRetry={sectorSubjects.reload} /> : <SubjectRows rows={sectorSubjects.data ?? []} onEntity={openEntity} />}
          </section>

          <div className="uso3-dualcharts">
            <SectorBars title="Dónde están los términos de giro" rows={sectors.slice(0, 8).map((row) => ({ label: row.sector, value: row.terminados }))} max={maxTerm} tone="red" />
            <SectorBars title="Dónde están los potenciales" rows={sectors.slice(0, 8).map((row) => ({ label: row.sector, value: row.potential }))} max={maxPotential} tone="purple" />
          </div>

          <section className="uso3-insights panel-like">
            <SectionHead title="Lectura analítica" sub="Claves para decidir dónde mirar primero" />
            <div>{sectors.slice(0, 3).map((row, index) => <article key={row.sector}><i>{index + 1}</i><p><b>{titleCase(row.sector)}</b><span>{index === 0 ? ` concentra ${n1(share(row.sujetos, u.total))}% del padrón y reúne ${n(row.terminados)} términos de giro.` : index === 1 ? ` aporta ${n(row.potential)} potenciales y ${n(row.en_atencion)} casos en atención.` : ` registra ${n(row.sancionados)} sujetos sancionados y ${row.reportingRate == null ? 'sin tasa comparable' : `${n1(row.reportingRate)} ROS por 100 SO`}.`}</span></p></article>)}</div>
          </section>
        </main>

        <aside className="uso3-cases panel-like">
          <SectionHead title="Mesa de atención" sub="Término de giro y potenciales" />
          <div className="uso3-case-tabs"><button data-on={queue === 'termino'} onClick={() => { setQueue('termino'); setCaseSearch(''); }}>Término de giro <b>{n(u.terminados)}</b></button><button data-on={queue === 'potenciales'} onClick={() => { setQueue('potenciales'); setCaseSearch(''); }}>Potenciales <b>{n(potentialCount)}</b></button></div>
          <label className="uso3-case-search"><span>⌕</span><input value={caseSearch} onChange={(e) => setCaseSearch(e.target.value)} placeholder="RUT, razón social, sector o región…" /></label>
          <div className="uso3-case-list">{cases.slice(0, 6).map((item) => { const key = `${item.kind}|${item.rut}`; const status = statuses[key] ?? 'PENDIENTE'; return <button key={key} data-on={selectedCase?.rut === item.rut && selectedCase.kind === item.kind} onClick={() => { setSelectedCase(item); setNote(''); }}><span><b>{short(titleCase(item.name), 27)}</b><em>{rutFormat(item.rut)} · {item.sector ? short(titleCase(item.sector), 17) : 'Sin sector'}</em></span><i data-status={status}>{status === 'PENDIENTE' ? 'Pendiente' : status === 'REVISADO' ? 'Revisado' : 'Listo'}</i></button>; })}</div>

          {selectedCase && <LightCaseCard item={selectedCase} status={selectedStatus} note={note} onNote={setNote} onStatus={(status) => setStatuses((current) => ({ ...current, [statusKey]: status }))} onEntity={selectedCase.entityId ? () => openEntity(selectedCase.entityId as string) : undefined} />}
        </aside>
      </div>

      <Semantics><strong>Lectura.</strong> Las señales de Atlas ordenan revisión y caracterización. No constituyen por sí mismas incumplimiento ni riesgo LA/FT. Los potenciales SO son hipótesis de inscripción y la reportabilidad se presenta a nivel sectorial.</Semantics>
    </div>
  );
}

function SectionHead({ title, sub }: { title: string; sub: string }) {
  return <header className="uso3-section-head"><i /><div><h2>{title}</h2><p>{sub}</p></div></header>;
}

function SignalCard({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: string }) {
  return <div className="uso3-signal" data-tone={tone}><span>{label}</span><b className="num">{value}</b><em>{sub}</em><i><u /></i></div>;
}

function SubjectRows({ rows, onEntity }: { rows: UafSubjectRow[]; onEntity: (id: string) => void }) {
  if (!rows.length) return <div className="uso3-empty">Sin sujetos para este sector.</div>;
  return <div className="uso3-subject-list"><div className="uso3-subject-header"><span>RUT</span><span>Razón social</span><span>Región</span><span>Señales Atlas</span><span /></div>{rows.slice(0, 7).map((row) => <div className="uso3-subject-row" key={row.rut}><span className="mono">{rutFormat(row.rut)}</span><b title={titleCase(row.name)}>{short(titleCase(row.name), 31)}</b><span>{row.region ? short(titleCase(row.region), 17) : '—'}</span><div className="uso3-tags">{row.sii_termination_date && <i data-tone="red">Término</i>}{row.has_press && <i data-tone="orange">Prensa</i>}{row.is_osfl && <i data-tone="purple">OSFL</i>}{row.is_state_supplier && <i data-tone="blue">Proveedor</i>}{row.sanction_evidence_count > 0 && <i data-tone="red">Sanción</i>}{row.ipf_band && <i data-tone="amber">IPF {titleCase(row.ipf_band.replace(/_/g, ' '))}</i>}</div>{row.entity_id ? <button onClick={() => onEntity(row.entity_id as string)} title="Abrir Entidad 360">↗</button> : <span />}</div>)}</div>;
}

function SectorBars({ title, rows, max, tone }: { title: string; rows: { label: string; value: number }[]; max: number; tone: string }) {
  return <section className="uso3-sector-chart panel-like" data-tone={tone}><SectionHead title={title} sub="Principales sectores · N° de entidades" /><div>{rows.filter((row) => row.value > 0).slice(0, 6).map((row) => <span key={row.label}><em>{short(titleCase(row.label), 21)}</em><i><u style={{ width: `${row.value / max * 100}%` }} /></i><b className="num">{n(row.value)}</b></span>)}</div></section>;
}

function LightCaseCard({ item, status, note, onNote, onStatus, onEntity }: { item: CaseItem; status: CaseStatus; note: string; onNote: (v: string) => void; onStatus: (s: CaseStatus) => void; onEntity?: () => void }) {
  return <section className="uso3-light-card"><header><div><span>{item.kind === 'termino' ? 'Término de giro' : 'Potencial SO'}</span><h3>{titleCase(item.name)}</h3><em className="mono">{rutFormat(item.rut)}</em></div>{onEntity && <button onClick={onEntity} title="Abrir Entidad 360">Ficha 360 ↗</button>}</header><div className="uso3-critical-grid"><div><span>Sector</span><b>{item.sector ? titleCase(item.sector) : '—'}</b></div><div><span>Región</span><b>{item.region ? titleCase(item.region) : '—'}</b></div><div className="uso3-critical-wide"><span>Motivo</span><b>{item.motive}</b></div>{item.kind === 'termino' ? <><div><span>Prensa</span><b>{n(item.press)}</b></div><div><span>Sanciones</span><b>{n(item.sanctions)}</b></div></> : <><div><span>IVO</span><b>{item.ivo == null ? '—' : n1(item.ivo)}</b></div><div><span>Materialidad</span><b>{item.materiality == null ? '—' : n1(item.materiality)}</b></div></>}</div><div className="uso3-case-flags">{item.osfl && <span>OSFL</span>}{item.supplier && <span>Proveedor Estado</span>}{item.ipf != null && <span>IPF {n1(item.ipf)}</span>}{item.sanctions > 0 && <span>Sanción</span>}</div><div className="uso3-contact"><span>Ubicar contacto</span><div>{contactSources(item).map(([label, href]) => <a key={label} href={href} target="_blank" rel="noreferrer">{label}<b>↗</b></a>)}</div></div><div className="uso3-status"><button data-on={status === 'PENDIENTE'} onClick={() => onStatus('PENDIENTE')}><i>1</i><span>Pendiente</span></button><u /><button data-on={status === 'REVISADO'} onClick={() => onStatus('REVISADO')}><i>2</i><span>Revisado</span></button><u /><button data-on={status === 'LISTO'} onClick={() => onStatus('LISTO')}><i>3</i><span>Solicitud</span></button></div><textarea value={note} onChange={(e) => onNote(e.target.value)} maxLength={240} placeholder="Nota breve de gestión…" /><button className="uso3-primary" onClick={() => onStatus(status === 'PENDIENTE' ? 'REVISADO' : 'LISTO')}>{status === 'PENDIENTE' ? 'Marcar contacto revisado' : status === 'REVISADO' ? 'Listo para solicitud' : 'Gestión preparada ✓'}</button></section>;
}
