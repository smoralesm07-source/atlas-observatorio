import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRpc } from '../lib/rpc';
import { hrefFor, type UniversoMode, type UniversoQueue } from '../lib/router';
import type { SectorOverview, UafPotential, UafPulse } from '../lib/contracts';
import { CohortDrawer, type CohortRequest } from '../components/CohortDrawer';
import { ErrorBox, Loading, Semantics } from '../components/primitives';
import { fecha, n } from '../lib/format';
import {
  applyPatch, hydrate, isTracked, loadCases, saveCases,
  type CaseContact, type CaseKind, type CaseMap, type CaseRecord, type CaseSubject,
} from '../lib/casework';
import { PadronAxis, type Focus } from './universo/PadronAxis';
import { CasosAxis, type Queue } from './universo/CasosAxis';
import type { CaseRow } from './universo/model';
import '../styles/universo-so.css';

/* UNIVERSO SO · dos ejes y una sola herramienta
   ────────────────────────────────────────────
   1. SITUACIÓN ACTUAL DEL PADRÓN INSCRITO: de qué está hecho, qué marcas de
      caracterización lleva, cómo se reparte por sector y por región. Es la
      pregunta del analista de inteligencia.
   2. LOS DOS BORDES DEL REGISTRO: quién debería estar y no está, y quién está
      con el giro terminado. Es la pregunta del fiscalizador, y se trabaja caso
      a caso: ubicar la entidad en fuentes abiertas, anotar el contacto que se
      encontró y sacar el lote en CSV.

   Los dos ejes comparten el mismo corte y la misma regla: toda cifra abre las
   entidades que la sostienen, y todo índice se imprime con lo que no es. */

const AXES: { key: UniversoMode; label: string; hint: string }[] = [
  { key: 'padron', label: 'Padrón inscrito', hint: 'Situación actual de los SO' },
  { key: 'casos', label: 'Mesa de casos', hint: 'Potenciales y término de giro' },
];

const queueForKind = (kind: CaseKind): Queue => (kind === 'TERMINO' ? 'termino' : 'potenciales');

export function UniversoSO({
  onNavigate, initialMode = 'padron', initialQueue,
}: {
  onNavigate: (hash: string) => void;
  initialMode?: UniversoMode;
  initialQueue?: UniversoQueue;
}) {
  const pulse = useRpc<UafPulse>('obs_uaf_pulse', {});
  const potential = useRpc<UafPotential>('obs_uaf_potential', {});
  const sectorOverview = useRpc<SectorOverview>('obs_sector_overview', {});

  const [axis, setAxis] = useState<UniversoMode>(initialMode);
  const [queue, setQueue] = useState<Queue>(initialQueue ?? 'potenciales');
  const [sectorFocus, setSectorFocus] = useState<string | null>(null);
  const [cohort, setCohort] = useState<CohortRequest | null>(null);
  const [cases, setCases] = useState<CaseMap>(loadCases);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => setAxis(initialMode), [initialMode]);
  useEffect(() => { if (initialQueue) setQueue(initialQueue); }, [initialQueue]);

  /* La mesa se escribe mientras se teclea una nota, así que el guardado se
     agrupa: una escritura por pausa, no una por pulsación. */
  useEffect(() => {
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => saveCases(cases), 350);
    return () => { if (persistTimer.current) clearTimeout(persistTimer.current); };
  }, [cases]);

  const goto = useCallback((mode: UniversoMode, cola?: Queue) => {
    setAxis(mode);
    if (cola) setQueue(cola);
    window.history.replaceState(null, '', hrefFor({
      view: 'universo',
      mode,
      cola: mode === 'casos' ? (cola ?? queue) : undefined,
    }));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [queue]);

  const onQueueChange = useCallback((next: Queue) => {
    setQueue(next);
    window.history.replaceState(null, '', hrefFor({ view: 'universo', mode: 'casos', cola: next }));
  }, []);

  const onWork = useCallback((focus: Focus) => {
    setSectorFocus(focus.sector ?? null);
    goto('casos', queueForKind(focus.kind));
  }, [goto]);

  const patch = useCallback((
    row: CaseRow,
    change: Partial<Pick<CaseRecord, 'state' | 'priority' | 'note'>> & { contact?: Partial<CaseContact> },
  ) => {
    setCases((current) => applyPatch(current, row.kind, row.subject, change));
  }, []);

  const bulk = useCallback((rows: CaseRow[], change: Partial<Pick<CaseRecord, 'state' | 'priority'>>) => {
    setCases((current) => rows.reduce(
      (acc, row) => applyPatch(acc, row.kind, row.subject, change),
      current,
    ));
  }, []);

  const onHydrate = useCallback((kind: CaseKind, subjects: CaseSubject[]) => {
    setCases((current) => hydrate(current, kind, subjects));
  }, []);

  const openEntity = useCallback(
    (entityId: string) => onNavigate(hrefFor({ view: 'ficha', entityId })),
    [onNavigate],
  );

  const tracked = useMemo(() => Object.values(cases).filter(isTracked).length, [cases]);

  if (pulse.loading && !pulse.data) return <Loading label="Leyendo el universo de sujetos obligados…" />;
  if (pulse.error) return <ErrorBox error={pulse.error} onRetry={pulse.reload} />;
  if (!pulse.data) return <ErrorBox error="El corte vigente no devolvió el pulso del padrón." onRetry={pulse.reload} />;

  const u = pulse.data.universe;
  const pendientes = (u?.terminados ?? 0) + (potential.data?.totales?.accionables ?? 0);
  const snapshot = pulse.data.snapshot;

  return (
    <div className="uso fade-in">
      <header className="uso-head">
        <div className="uso-head-copy">
          <span className="uso-kicker">Padrón UAF · Ley 19.913 · conciliación con el SII</span>
          <h1>Universo SO</h1>
          <p>
            Dos preguntas en una herramienta: cómo está compuesto el padrón de sujetos obligados y qué hacer con los
            dos bordes del registro —quién debería inscribirse y quién ya terminó su giro—.
          </p>
        </div>
        <dl className="uso-head-meta">
          <div>
            <dt>Corte vigente</dt>
            <dd>{snapshot ? fecha(snapshot.published_at ?? snapshot.generated_at) : 'sin fecha publicada'}</dd>
          </div>
          <div>
            <dt>Padrón</dt>
            <dd className="num">{n(u?.total)} sujetos</dd>
          </div>
          <div>
            <dt>Conciliación SII</dt>
            <dd>{potential.data?.corte.sii_periodo ?? 'corte vigente'}</dd>
          </div>
          {tracked > 0 && (
            <div>
              <dt>Tu cartera</dt>
              <dd className="num">{n(tracked)} casos</dd>
            </div>
          )}
        </dl>
      </header>

      <nav className="uso-axes" aria-label="Ejes de Universo SO">
        {AXES.map((item) => (
          <button
            key={item.key} data-on={axis === item.key} onClick={() => goto(item.key)}
            aria-current={axis === item.key}
          >
            <span>{item.label}</span>
            <b className="num">
              {item.key === 'padron'
                ? n(u?.total)
                : potential.loading && !potential.data ? '…' : n(pendientes)}
            </b>
            <em>{item.hint}</em>
          </button>
        ))}
      </nav>

      {axis === 'padron' ? (
        <PadronAxis
          pulse={pulse.data}
          potential={potential.data}
          sectorOverview={sectorOverview.data}
          onCohort={setCohort}
          onNavigate={onNavigate}
          onWork={onWork}
        />
      ) : (
        <CasosAxis
          pulse={pulse.data}
          potential={potential.data}
          potentialLoading={potential.loading}
          potentialError={potential.error}
          onReloadPotential={potential.reload}
          cases={cases}
          onPatch={patch}
          onBulk={bulk}
          onHydrate={onHydrate}
          onNavigate={onNavigate}
          onEntity={openEntity}
          initialQueue={queue}
          initialSector={sectorFocus}
          onQueueChange={onQueueChange}
        />
      )}

      <Semantics>
        <strong>Cómo leer Universo SO.</strong> El padrón describe quién está inscrito hoy; las marcas de
        caracterización —sanción, prensa, OSFL, proveedor del Estado, IPF, giro atípico— ordenan revisión y no
        concluyen incumplimiento ni riesgo LA/FT. Un potencial sujeto obligado es una hipótesis de inscripción
        construida sobre actividad económica pública, no una imputación; un término de giro es un hecho tributario
        que motiva revisar la desinscripción. Los datos de contacto provienen de fuentes abiertas y deben verificarse
        antes de usarse en una gestión formal.
      </Semantics>

      {cohort && (
        <CohortDrawer
          request={cohort}
          onClose={() => setCohort(null)}
          onOpenEntity={(entityId) => { setCohort(null); openEntity(entityId); }}
        />
      )}
    </div>
  );
}
