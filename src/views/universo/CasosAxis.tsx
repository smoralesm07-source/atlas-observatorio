import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { UafPotential, UafPulse, UafSubjectRow } from '../../lib/contracts';
import { useRpc, useRpcPaged } from '../../lib/rpc';
import { Empty, ErrorBox, Loading } from '../../components/primitives';
import { fecha, n, n1, rutFormat, titleCase } from '../../lib/format';
import {
  KIND_META, PRIORITIES, STATES, STATE_META,
  type CaseContact, type CaseKind, type CaseMap, type CaseRecord, type CasePriority,
  type CaseState, type CaseSubject,
  caseKey, casesToCsv, contactFilled, downloadCsv, isTracked,
  subjectFromCandidate, subjectFromTermination,
} from '../../lib/casework';
import { CopyButton, SectionHead, Select } from './bits';
import { CaseFile } from './CaseFile';
import { bandRank, markCount, rowFromCandidate, rowFromRecord, rowFromTermination, type CaseRow } from './model';

/* EJE 2 · POTENCIALES SUJETOS OBLIGADOS Y TÉRMINOS DE GIRO
   ──────────────────────────────────────────────────────
   Las dos brechas del registro, trabajadas como casos. La pantalla existe para
   que un fiscalizador haga tres cosas seguidas sin cambiar de herramienta:
   elegir a quién atender, ubicarlo en fuentes abiertas y dejar registrado qué
   encontró. Lo que sale de aquí es un CSV: Atlas no envía requerimientos ni
   modifica el padrón. */

export type Queue = 'potenciales' | 'termino' | 'cartera';

type SortField = 'score' | 'nombre' | 'sector' | 'region' | 'fecha' | 'marcas' | 'gestion' | 'contacto' | 'materialidad';

type OpenContactCoverage = {
  rut_key: string;
  finding_count: number;
  channel_count: number;
  verified_count: number;
  probable_count: number;
  last_observed_at: string | null;
};

const contactRutKey = (rut: string) => rut.replace(/[^0-9kK]/g, '').toUpperCase();

const SORTS: { value: SortField; label: string }[] = [
  { value: 'score', label: 'Índice, mayor primero' },
  { value: 'materialidad', label: 'Materialidad' },
  { value: 'marcas', label: 'Marcas observadas' },
  { value: 'fecha', label: 'Fecha' },
  { value: 'nombre', label: 'Razón social' },
  { value: 'sector', label: 'Sector' },
  { value: 'region', label: 'Región' },
  { value: 'gestion', label: 'Estado de gestión' },
  { value: 'contacto', label: 'Contacto disponible' },
];

const TERM_PAGE = 200;
const totalOfRow = (row: UafSubjectRow) => row.total_count;

export function CasosAxis({
  pulse, potential, potentialLoading, potentialError, onReloadPotential,
  cases, onPatch, onBulk, onHydrate, onNavigate, onEntity,
  initialQueue, initialSector, onQueueChange,
}: {
  pulse: UafPulse;
  potential: UafPotential | null;
  potentialLoading: boolean;
  potentialError: string | null;
  onReloadPotential: () => void;
  cases: CaseMap;
  onPatch: (row: CaseRow, patch: Partial<Pick<CaseRecord, 'state' | 'priority' | 'note'>> & { contact?: Partial<CaseContact> }) => void;
  onBulk: (rows: CaseRow[], patch: Partial<Pick<CaseRecord, 'state' | 'priority'>>) => void;
  onHydrate: (kind: CaseKind, subjects: CaseSubject[]) => void;
  onNavigate: (hash: string) => void;
  onEntity: (entityId: string) => void;
  initialQueue: Queue;
  initialSector: string | null;
  onQueueChange: (queue: Queue) => void;
}) {
  const [queue, setQueue] = useState<Queue>(initialQueue);
  const [query, setQuery] = useState('');
  const [sector, setSector] = useState(initialSector ?? '');
  const [region, setRegion] = useState('');
  const [gestion, setGestion] = useState('');
  const [prioridad, setPrioridad] = useState('');
  const [banda, setBanda] = useState('');
  const [year, setYear] = useState('');
  const [onlyMarks, setOnlyMarks] = useState(false);
  const [onlyRes, setOnlyRes] = useState(false);
  const [onlyContact, setOnlyContact] = useState(false);
  const [sort, setSort] = useState<SortField>('score');
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [lote, setLote] = useState<Set<string>>(() => new Set());
  const listRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);

  const term = useRpcPaged<UafSubjectRow>(
    'obs_uaf_cohort',
    { p_cohort: 'TERMINO_GIRO', p_value: null },
    { pageSize: TERM_PAGE, maxPages: 6, totalOf: totalOfRow },
  );

  useEffect(() => setQueue(initialQueue), [initialQueue]);
  useEffect(() => { if (initialSector) setSector(initialSector); }, [initialSector]);

  /* La cartera guarda una copia de la identidad para seguir siendo legible sin
     red. Cuando la cola vuelve a traer al sujeto, esa copia se refresca con el
     corte vigente: un sector que cambió no se queda congelado en la mesa. */
  useEffect(() => {
    if (term.rows.length) onHydrate('TERMINO', term.rows.map(subjectFromTermination));
  }, [term.rows, onHydrate]);
  useEffect(() => {
    const list = potential?.candidatos ?? [];
    if (list.length) onHydrate('POTENCIAL', list.map(subjectFromCandidate));
  }, [potential, onHydrate]);

  const queueRows = useMemo<CaseRow[]>(() => {
    if (queue === 'potenciales') return (potential?.candidatos ?? []).map((row) => rowFromCandidate(row, cases)).filter((row) => !isTracked(row.record));
    if (queue === 'termino') return term.rows.map((row) => rowFromTermination(row, cases)).filter((row) => !isTracked(row.record));
    const loaded = new Map<string, CaseRow>();
    for (const row of (potential?.candidatos ?? []).map((item) => rowFromCandidate(item, cases))) loaded.set(row.key, row);
    for (const row of term.rows.map((item) => rowFromTermination(item, cases))) loaded.set(row.key, row);
    return Object.values(cases)
      .filter(isTracked)
      .map((record) => {
        const live = loaded.get(caseKey(record.kind, record.rut));
        return live ? { ...live, record } : rowFromRecord(record);
      });
  }, [queue, potential, term.rows, cases]);

  const contactCoverage = useRpc<OpenContactCoverage[]>('obs_uaf_contact_osint_coverage', {
    p_ruts: queueRows.map((row) => row.subject.rut),
  });
  const contactByRut = useMemo(() => new Map(
    (contactCoverage.data ?? []).map((item) => [item.rut_key, item] as const),
  ), [contactCoverage.data]);

  const options = useMemo(() => {
    const sectors = new Map<string, number>();
    const regions = new Map<string, number>();
    const years = new Map<string, number>();
    const bands = new Map<string, number>();
    for (const row of queueRows) {
      const s = row.subject.sector;
      if (s) sectors.set(s, (sectors.get(s) ?? 0) + 1);
      const r = row.subject.region ?? 'Sin territorio observado';
      regions.set(r, (regions.get(r) ?? 0) + 1);
      if (row.year) years.set(String(row.year), (years.get(String(row.year)) ?? 0) + 1);
      if (row.band) bands.set(row.band, (bands.get(row.band) ?? 0) + 1);
    }
    const sorted = (map: Map<string, number>) => [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([value, count]) => ({ value, label: titleCase(value), count }));
    /* Un filtro traído de la otra cola —o del eje del padrón— puede no existir
       en esta: se mantiene visible con cero casos en vez de desaparecer del
       selector y dejar una lista vacía sin explicación. */
    const withPicked = (rows: { value: string; label: string; count: number }[], picked: string) =>
      picked && !rows.some((row) => row.value === picked)
        ? [{ value: picked, label: titleCase(picked), count: 0 }, ...rows]
        : rows;
    return {
      sectors: withPicked(sorted(sectors), sector),
      regions: withPicked(sorted(regions), region),
      years: [...years.entries()].sort((a, b) => Number(b[0]) - Number(a[0]))
        .map(([value, count]) => ({ value, label: value, count })),
      bands: [...bands.entries()].sort((a, b) => bandRank(b[0]) - bandRank(a[0]))
        .map(([value, count]) => ({ value, label: titleCase(value.replace(/_/g, ' ')), count })),
    };
  }, [queueRows, sector, region]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = queueRows.filter((row) => {
      if (q && !row.haystack.includes(q)) return false;
      if (sector && row.subject.sector !== sector) return false;
      if (region && (row.subject.region ?? 'Sin territorio observado') !== region) return false;
      if (gestion === 'MINE' && !row.record.isMine) return false;
      if (gestion && gestion !== 'MINE' && row.record.state !== gestion) return false;
      if (prioridad && row.record.priority !== prioridad) return false;
      if (banda && row.band !== banda) return false;
      if (year && String(row.year ?? '') !== year) return false;
      if (onlyMarks && markCount(row.marks) === 0) return false;
      if (onlyRes && !row.res) return false;
      if (onlyContact) {
        const observed = contactByRut.get(contactRutKey(row.subject.rut));
        if (contactFilled(row.record.contact) === 0 && Number(observed?.finding_count ?? 0) === 0) return false;
      }
      return true;
    });
    const dir = sort === 'nombre' || sort === 'sector' || sort === 'region' ? 1 : -1;
    return filtered.sort((a, b) => {
      switch (sort) {
        case 'nombre': return a.subject.name.localeCompare(b.subject.name, 'es');
        case 'sector': return (a.subject.sector ?? '').localeCompare(b.subject.sector ?? '', 'es');
        case 'region': return (a.subject.region ?? '').localeCompare(b.subject.region ?? '', 'es');
        case 'fecha': return dir * ((a.date ?? '').localeCompare(b.date ?? ''));
        case 'marcas': return dir * (markCount(a.marks) - markCount(b.marks));
        case 'materialidad': return dir * ((a.materiality ?? -1) - (b.materiality ?? -1));
        case 'gestion': return dir * (STATE_META[a.record.state].step - STATE_META[b.record.state].step);
        case 'contacto': {
          const ca = contactByRut.get(contactRutKey(a.subject.rut));
          const cb = contactByRut.get(contactRutKey(b.subject.rut));
          const wa = contactFilled(a.record.contact) * 100 + Number(ca?.verified_count ?? 0) * 10 + Number(ca?.channel_count ?? 0) * 2 + Number(ca?.finding_count ?? 0);
          const wb = contactFilled(b.record.contact) * 100 + Number(cb?.verified_count ?? 0) * 10 + Number(cb?.channel_count ?? 0) * 2 + Number(cb?.finding_count ?? 0);
          return dir * (wa - wb);
        }
        default: return dir * ((a.score ?? -1) - (b.score ?? -1));
      }
    });
  }, [queueRows, query, sector, region, gestion, prioridad, banda, year, onlyMarks, onlyRes, onlyContact, sort, contactByRut]);

  // El caso abierto sigue a la lista: si el filtro lo deja fuera, se abre el
  // primero de lo que quedó en pantalla en vez de mostrar una ficha huérfana.
  const active = useMemo(
    () => rows.find((row) => row.key === activeKey) ?? rows[0] ?? null,
    [rows, activeKey],
  );

  useEffect(() => {
    if (active && active.key !== activeKey) setActiveKey(active.key);
  }, [active, activeKey]);

  const loteRows = useMemo(() => queueRows.filter((row) => lote.has(row.key)), [queueRows, lote]);
  const tracked = useMemo(() => Object.values(cases).filter(isTracked), [cases]);

  const changeQueue = (next: Queue) => {
    setQueue(next);
    setBanda('');
    setYear('');
    setOnlyRes(false);
    setOnlyMarks(false);
    setOnlyContact(false);
    onQueueChange(next);
  };

  /* En pantalla angosta la ficha vive debajo de la lista: abrir un caso sin
     llevar la vista hasta ella parecería no hacer nada. */
  const openCase = (key: string) => {
    setActiveKey(key);
    if (window.innerWidth <= 1080) {
      window.requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
  };

  const backToList = () => listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const toggleLote = (key: string) => setLote((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const onListKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'x') return;
    const buttons = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('[data-caserow]') ?? []);
    if (!buttons.length) return;
    const current = buttons.findIndex((el) => el === document.activeElement);
    if (event.key === 'x') {
      if (current >= 0) {
        event.preventDefault();
        const key = buttons[current].dataset.caserow;
        if (key) toggleLote(key);
      }
      return;
    }
    event.preventDefault();
    const step = event.key === 'ArrowDown' ? 1 : -1;
    const next = buttons[Math.max(0, Math.min(buttons.length - 1, (current < 0 ? 0 : current + step)))];
    next?.focus();
    if (next?.dataset.caserow) setActiveKey(next.dataset.caserow);
  };

  const exportRows = (records: CaseRecord[], name: string) => {
    if (!records.length) return;
    downloadCsv(casesToCsv(records), `${name}_${new Date().toISOString().slice(0, 10)}.csv`);
  };

  const managedPotential = (potential?.candidatos ?? []).map((item) => rowFromCandidate(item, cases)).filter((row) => isTracked(row.record)).length;
  const managedTerm = term.rows.map((item) => rowFromTermination(item, cases)).filter((row) => isTracked(row.record)).length;
  const potentialCount = Math.max(0, (potential?.totales?.accionables ?? 0) - managedPotential);
  const termTotal = Math.max(0, (term.total ?? pulse.universe?.terminados ?? 0) - managedTerm);
  const loading = queue === 'potenciales' ? potentialLoading && !potential : queue === 'termino' ? term.loading : false;
  const error = queue === 'potenciales' ? potentialError : queue === 'termino' ? term.error : null;

  return (
    <div className="uso-axis-body fade-in">
      <section className="uso-queues" aria-label="Colas de trabajo">
        <button data-on={queue === 'potenciales'} onClick={() => changeQueue('potenciales')}>
          <span>Potenciales SO</span>
          <b className="num">{potentialLoading && !potential ? '…' : n(potentialCount)}</b>
          <em>Pendientes sin asignar · conciliación SII ↔ UAF</em>
        </button>
        <button data-on={queue === 'termino'} onClick={() => changeQueue('termino')}>
          <span>Término de giro</span>
          <b className="num">{n(termTotal)}</b>
          <em>Pendientes sin asignar · revisar desinscripción</em>
        </button>
        <button data-on={queue === 'cartera'} onClick={() => changeQueue('cartera')}>
          <span>Gestión</span>
          <b className="num">{n(tracked.length)}</b>
          <em>Casos asignados · visibles para todo el equipo</em>
        </button>
      </section>

      {queue === 'potenciales' && potential?.disponible && (
        <ContextPanel
          title="Conciliación SII ↔ UAF"
          hint={`Corte SII ${potential.corte.sii_periodo ?? '—'} · padrón ${potential.corte.uaf_corte ?? '—'} · índice ${potential.corte.index_version ?? '—'}`}
        >
          <div className="uso-funnel">
            {potential.embudo.map((step) => {
              const peak = Math.max(1, ...potential.embudo.map((s) => s.n));
              // Se destaca el paso del que sale la cola de trabajo, no el
              // último: lo revisado ya no es trabajo pendiente.
              const isQueue = potential.totales != null && step.n === potential.totales.accionables;
              return (
                <div className="uso-funnel-step" key={step.orden} data-last={isQueue}>
                  <div className="uso-funnel-top"><b className="num">{n(step.n)}</b><span>{step.etiqueta}</span></div>
                  <div className="uso-funnel-track" aria-hidden>
                    <i style={{ width: `${(Math.log10(1 + step.n) / Math.log10(1 + peak)) * 100}%` }} />
                  </div>
                  <p>{step.glosa}</p>
                </div>
              );
            })}
          </div>
          <div className="uso-funnel-facts">
            <span>Sin revisar <b className="num">{n(potential.totales?.sin_revisar)}</b></span>
            <span>Con revisión registrada <b className="num">{n(potential.totales?.revisados)}</b></span>
            <span>IVO medio <b className="num">{n1(potential.totales?.ivo_medio)}</b></span>
            <span>Materialidad media <b className="num">{n1(potential.totales?.materialidad_media)}</b></span>
            <span>Sectores con brecha <b className="num">{n(potential.totales?.sectores)}</b></span>
            <em>Escala logarítmica: el embudo cae tres órdenes de magnitud y en escala lineal el último paso desaparecería.</em>
          </div>
        </ContextPanel>
      )}

      {queue === 'termino' && (
        <ContextPanel
          title="Inscritos con término de giro ante el SII"
          hint="El hecho tributario lo publica el SII. Motiva revisar la desinscripción del padrón y no supone incumplimiento."
        >
          <div className="uso-funnel-facts">
            <span>En el corte <b className="num">{n(termTotal)}</b></span>
            <span>Cargados en pantalla <b className="num">{n(term.rows.length)}</b></span>
            <span>Con antecedente de sanción <b className="num">{n(term.rows.filter((row) => row.sanction_evidence_count > 0).length)}</b></span>
            <span>Con prensa <b className="num">{n(term.rows.filter((row) => row.press_evidence_count > 0).length)}</b></span>
            <span>También OSFL <b className="num">{n(term.rows.filter((row) => row.is_osfl).length)}</b></span>
            {term.loadingMore && <em>Trayendo el resto del corte para que los filtros operen sobre la cola completa…</em>}
            {term.capped && (
              <button className="btn btn-sm" onClick={term.loadMore}>
                Cargar más allá de {n(term.rows.length)} filas
              </button>
            )}
          </div>
        </ContextPanel>
      )}

      {queue === 'cartera' && (
        <section className="uso-panel uso-cartera-context">
          <SectionHead
            kicker="Trabajo compartido"
            title="Gestión de casos"
            hint="Cada caso tiene responsable y estado común para el equipo. Usa «Sólo mis casos» para ver tu carga."
            actions={(
              <button className="btn btn-sm btn-primary" onClick={() => exportRows(tracked, 'atlas_universo_so_gestion')} disabled={!tracked.length}>
                Exportar cartera ({n(tracked.length)})
              </button>
            )}
          />
          <div className="uso-state-counts">
            {STATES.filter((meta) => meta.key !== 'SIN_TRABAJAR').map((meta) => {
              const count = tracked.filter((record) => record.state === meta.key).length;
              return (
                <button
                  key={meta.key} style={{ ['--state-tone' as string]: meta.tone }}
                  data-on={gestion === meta.key}
                  onClick={() => setGestion(gestion === meta.key ? '' : meta.key)}
                >
                  <i />
                  <span>{meta.label}</span>
                  <b className="num">{n(count)}</b>
                </button>
              );
            })}
          </div>
        </section>
      )}

      <section className="uso-toolbar" aria-label="Filtros de la cola">
        <label className="uso-search uso-search-wide">
          <i aria-hidden>⌕</i>
          <input
            value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="RUT, razón social, sector, actividad, comuna…"
            aria-label="Buscar en la cola"
          />
          {query && <button className="uso-search-clear" onClick={() => setQuery('')} aria-label="Limpiar búsqueda">×</button>}
        </label>
        <Select label="Sector" value={sector} onChange={setSector} options={options.sectors} allLabel="Todos los sectores" />
        <Select label="Región" value={region} onChange={setRegion} options={options.regions} allLabel="Todas las regiones" />
        <Select
          label="Gestión" value={gestion} onChange={setGestion} allLabel="Cualquier estado"
          options={[
            { value: 'MINE', label: 'Sólo mis casos', count: queueRows.filter((row) => row.record.isMine).length },
            ...STATES.map((meta) => ({
              value: meta.key,
              label: meta.label,
              count: queueRows.filter((row) => row.record.state === meta.key).length,
            })),
          ]}
        />
        <Select
          label="Prioridad" value={prioridad} onChange={setPrioridad} allLabel="Cualquiera"
          options={PRIORITIES.map((p) => ({ value: p.key, label: p.label }))}
        />
        {queue === 'potenciales' && (
          <Select label="Banda IVO" value={banda} onChange={setBanda} options={options.bands} allLabel="Todas" />
        )}
        {queue === 'termino' && (
          <Select label="Año de término" value={year} onChange={setYear} options={options.years} allLabel="Todos" />
        )}
        <Select
          label="Orden" value={sort} onChange={(v) => setSort(v as SortField)} allLabel="Relevancia"
          options={SORTS.map((s) => ({ value: s.value, label: s.label }))}
        />
        <div className="uso-toolbar-chips">
          <button className="chip" data-on={onlyMarks} onClick={() => setOnlyMarks(!onlyMarks)}>Con marcas</button>
          <button className="chip" data-on={onlyContact} onClick={() => setOnlyContact(!onlyContact)}>
            Contacto abierto {contactCoverage.loading && !contactCoverage.data ? '…' : n(contactCoverage.data?.length ?? 0)}
          </button>
          {queue === 'potenciales' && (
            <button className="chip" data-on={onlyRes} onClick={() => setOnlyRes(!onlyRes)}>Con RES</button>
          )}
          {(query || sector || region || gestion || prioridad || banda || year || onlyMarks || onlyRes || onlyContact) && (
            <button
              className="chip uso-chip-reset"
              onClick={() => {
                setQuery(''); setSector(''); setRegion(''); setGestion('');
                setPrioridad(''); setBanda(''); setYear(''); setOnlyMarks(false); setOnlyRes(false); setOnlyContact(false);
              }}
            >
              Limpiar filtros
            </button>
          )}
        </div>
      </section>

      <div className="uso-work">
        <div className="uso-list-panel">
          <div className="uso-list-head">
            <div>
              <b className="num">{n(rows.length)}</b>
              <span>
                {rows.length === queueRows.length ? 'casos en la cola' : `de ${n(queueRows.length)} casos`}
              </span>
            </div>
            <div className="uso-list-head-actions">
              <button
                className="uso-linkish"
                onClick={() => setLote((current) => {
                  const next = new Set(current);
                  const all = rows.every((row) => next.has(row.key));
                  for (const row of rows) { if (all) next.delete(row.key); else next.add(row.key); }
                  return next;
                })}
                disabled={!rows.length}
              >
                {rows.length && rows.every((row) => lote.has(row.key)) ? 'Quitar del lote' : 'Añadir todo al lote'}
              </button>
              <em className="uso-kbd-hint">↑↓ recorre · x añade al lote</em>
            </div>
          </div>

          {loading ? (
            <div className="uso-inline"><Loading label="Armando la cola de casos…" /></div>
          ) : error ? (
            <div className="uso-inline">
              <ErrorBox error={error} onRetry={queue === 'potenciales' ? onReloadPotential : term.reload} />
            </div>
          ) : !rows.length ? (
            <div className="uso-inline">
              <Empty
                title={queue === 'cartera' ? 'Tu cartera está vacía' : 'Ningún caso cumple el filtro'}
                hint={queue === 'cartera'
                  ? 'Abre una de las dos colas, ubica una entidad y su avance queda guardado aquí.'
                  : 'Cambia el filtro o limpia la búsqueda para volver a ver la cola completa.'}
              />
            </div>
          ) : (
            <div className="uso-list" ref={listRef} onKeyDown={onListKey}>
              {rows.map((row) => (
                <CaseListRow
                  key={row.key} row={row} active={active?.key === row.key}
                  inLote={lote.has(row.key)} onOpen={() => openCase(row.key)}
                  onLote={() => toggleLote(row.key)}
                  openContact={contactByRut.get(contactRutKey(row.subject.rut)) ?? null}
                />
              ))}
            </div>
          )}
        </div>

        <div className="uso-detail" ref={detailRef}>
          <button className="uso-back" onClick={backToList}>↑ Volver a la lista</button>
          {active ? (
            <CaseFile
              row={active}
              onPatch={(patch) => {
                const claim = !isTracked(active.record) && patch.state != null && patch.state !== 'SIN_TRABAJAR';
                onPatch(active, patch);
                if (claim) window.requestAnimationFrame(() => changeQueue('cartera'));
              }}
              onEntity={active.subject.entityId ? () => onEntity(active.subject.entityId as string) : undefined}
              onSector={(value) => { setSector(value); setActiveKey(active.key); }}
            />
          ) : (
            <div className="uso-detail-empty">
              <Empty title="Sin caso abierto" hint="Elige un caso de la lista para ver por qué está en la mesa y cómo ubicarlo." />
            </div>
          )}
        </div>
      </div>

      {loteRows.length > 0 && (
        <div className="uso-batch" role="region" aria-label="Lote de trabajo">
          <div className="uso-batch-count">
            <b className="num">{n(loteRows.length)}</b>
            <span>en el lote</span>
            <em>{n(loteRows.filter((row) => contactFilled(row.record.contact) > 0).length)} con contacto capturado</em>
          </div>
          <div className="uso-batch-actions">
            <label className="uso-select">
              <span>Marcar estado</span>
              <select
                value="" onChange={(e) => {
                  if (e.target.value) onBulk(loteRows, { state: e.target.value as CaseState });
                }}
              >
                <option value="">Elegir…</option>
                {STATES.map((meta) => <option key={meta.key} value={meta.key}>{meta.label}</option>)}
              </select>
            </label>
            <label className="uso-select">
              <span>Prioridad</span>
              <select
                value="" onChange={(e) => {
                  if (e.target.value) onBulk(loteRows, { priority: e.target.value as CasePriority });
                }}
              >
                <option value="">Elegir…</option>
                {PRIORITIES.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
            </label>
            <CopyButton
              small label="Copiar RUT del lote" done="RUT copiados"
              text={loteRows.map((row) => rutFormat(row.subject.rut)).join('\n')}
            />
            <button className="btn btn-sm btn-primary" onClick={() => exportRows(loteRows.map((row) => row.record), 'atlas_universo_so_lote')}>
              Exportar CSV
            </button>
            <button className="uso-linkish" onClick={() => setLote(new Set())}>Vaciar</button>
          </div>
        </div>
      )}

      <p className="uso-note uso-note-wide">
        {potential?.semantics ?? 'Los potenciales sujetos obligados son hipótesis de inscripción construidas sobre actividad económica pública.'}
        {' '}
        <button className="uso-linkish" onClick={() => onNavigate('#/metodologia')}>Ver la metodología →</button>
      </p>
    </div>
  );
}

/* El encuadre de la cola importa —de dónde salen estos casos— pero en una
   pantalla angosta no puede empujar la lista fuera de la vista. Se pliega:
   abierto donde hay espacio, recogido donde no lo hay. */
function ContextPanel({
  title, hint, children,
}: {
  title: string;
  hint: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(() => typeof window === 'undefined' || window.innerWidth > 760);
  return (
    <details className="uso-panel uso-context" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        <span className="uso-kicker">De dónde sale la cola</span>
        <b>{title}</b>
        <em>{hint}</em>
      </summary>
      <div className="uso-context-body">{children}</div>
    </details>
  );
}

function CaseListRow({
  row, active, inLote, onOpen, onLote, openContact,
}: {
  row: CaseRow;
  active: boolean;
  inLote: boolean;
  onOpen: () => void;
  onLote: () => void;
  openContact?: OpenContactCoverage | null;
}) {
  const state = STATE_META[row.record.state];
  const filled = contactFilled(row.record.contact);
  const openFilled = Number(openContact?.finding_count ?? 0);
  const kind = KIND_META[row.kind];
  return (
    <div className="uso-row" data-on={active} data-lote={inLote ? 'true' : undefined}>
      <label className="uso-row-check" title="Añadir al lote de trabajo">
        <input type="checkbox" checked={inLote} onChange={onLote} aria-label={`Añadir ${row.subject.name} al lote`} />
      </label>
      <button className="uso-row-main" data-caserow={row.key} onClick={onOpen} aria-current={active}>
        <span className="uso-row-state" style={{ ['--state-tone' as string]: state.tone }} title={state.label} aria-hidden />
        <span className="uso-row-id">
          <b>{titleCase(row.subject.name) || rutFormat(row.subject.rut)}</b>
          <em className="mono">{rutFormat(row.subject.rut)}</em>
        </span>
        <span className="uso-row-place">
          <span>{row.subject.sector ? titleCase(row.subject.sector) : 'Sin sector'}</span>
          <em>{row.subject.region ? titleCase(row.subject.region) : 'Sin territorio'}</em>
        </span>
        <span className="uso-row-score">
          {row.score == null ? (
            <em>{kind.short}</em>
          ) : (
            <>
              <b className="num">{n1(row.score)}</b>
              <em>{row.scoreLabel}{row.band ? ` ${titleCase(row.band.replace(/_/g, ' '))}` : ''}</em>
            </>
          )}
        </span>
        <span className="uso-row-marks">
          {row.marks.sanction > 0 && <i data-tone="critical" title={`${row.marks.sanction} antecedente(s) de sanción`}>S</i>}
          {row.marks.press > 0 && <i data-tone="osint" title={`${row.marks.press} mención(es) en prensa`}>P</i>}
          {row.marks.osfl && <i data-tone="unknown" title="También OSFL">O</i>}
          {row.marks.supplier && <i data-tone="official" title="Proveedor del Estado">E</i>}
          {row.res && <i data-tone="present" title="Constitución verificable en el RES">R</i>}
          {row.date && <em>{fecha(row.date)}</em>}
        </span>
        <span className="uso-row-work">
          <em style={{ color: state.tone }}>{state.short}</em>
          {filled > 0 && <i className="uso-row-contact" title={`${filled} datos de contacto incorporados a la gestión`}>✆{filled}</i>}
          {openFilled > 0 && <i className="uso-row-contact uso-row-contact-open" title={`${openFilled} hallazgos de contacto observados en red abierta`}>◎{openFilled}</i>}
          {row.record.assignedEmail && (
            <small className="uso-row-owner" title={`Responsable: ${row.record.assignedName || row.record.assignedEmail}`}>
              {row.record.isMine ? 'Tú' : (row.record.assignedName || row.record.assignedEmail.split('@')[0])}
            </small>
          )}
        </span>
      </button>
    </div>
  );
}
