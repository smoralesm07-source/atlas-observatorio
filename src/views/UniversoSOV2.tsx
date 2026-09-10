import { useCallback, useEffect, useState } from 'react';
import { useRpc } from '../lib/rpc';
import { supabase } from '../lib/supabase';
import { hrefFor, type UniversoMode, type UniversoQueue } from '../lib/router';
import type { UafPotential, UafPulse } from '../lib/contracts';
import { ErrorBox, Loading, Semantics } from '../components/primitives';
import {
  applyPatch, hydrate, isTracked,
  type CaseContact, type CaseKind, type CaseMap, type CaseRecord, type CaseSubject,
} from '../lib/casework';
import { sharedRowsToCases, type SharedCaseRow } from '../lib/sharedCasework';
import { CasosAxis, type Queue } from './universo/CasosAxis';
import { PadronAxisV2, type WorkFocus } from './universo/PadronAxisV2';
import type { CaseRow } from './universo/model';
import '../styles/universo-so.css';
import '../styles/universo-casework-compact.css';
import '../styles/universo-so-v2.css';
import '../styles/universo-so-management.css';

const queueForKind = (kind: CaseKind): Queue => (kind === 'TERMINO' ? 'termino' : 'potenciales');

export function UniversoSOV2({
  onNavigate,
  initialMode = 'padron',
  initialQueue,
}: {
  onNavigate: (hash: string) => void;
  initialMode?: UniversoMode;
  initialQueue?: UniversoQueue;
}) {
  const pulse = useRpc<UafPulse>('obs_uaf_pulse', {});
  const potential = useRpc<UafPotential>('obs_uaf_potential', {});
  const management = useRpc<SharedCaseRow[]>('obs_uaf_case_management', {});

  const [axis, setAxis] = useState<UniversoMode>(initialMode);
  const [queue, setQueue] = useState<Queue>(initialQueue ?? 'potenciales');
  const [sectorFocus, setSectorFocus] = useState<string | null>(null);
  const [cases, setCases] = useState<CaseMap>({});
  const [caseError, setCaseError] = useState<string | null>(null);

  useEffect(() => setAxis(initialMode), [initialMode]);
  useEffect(() => { if (initialQueue) setQueue(initialQueue); }, [initialQueue]);
  useEffect(() => {
    if (management.data) setCases(sharedRowsToCases(management.data));
  }, [management.data]);

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

  const onWork = useCallback((focus: WorkFocus) => {
    setSectorFocus(focus.sector ?? null);
    goto('casos', queueForKind(focus.kind));
  }, [goto]);

  const patch = useCallback((
    row: CaseRow,
    change: Partial<Pick<CaseRecord, 'state' | 'priority' | 'note'>> & { contact?: Partial<CaseContact> },
  ) => {
    const claiming = !isTracked(row.record);
    setCaseError(null);
    setCases((current) => applyPatch(current, row.kind, row.subject, change));

    void supabase.rpc('aml_uaf_case_patch', {
      p_kind: row.kind,
      p_rut: row.subject.rut,
      p_subject: row.subject,
      p_state: change.state === 'SIN_TRABAJAR' ? null : (change.state ?? null),
      p_priority: change.priority ?? null,
      p_note: change.note ?? null,
      p_contact: change.contact ?? null,
      p_claim: claiming,
    }).then(({ error }) => {
      if (error) setCaseError(error.message);
      management.reload();
    });
  }, [management.reload]);

  const bulk = useCallback((rows: CaseRow[], change: Partial<Pick<CaseRecord, 'state' | 'priority'>>) => {
    for (const row of rows) patch(row, change);
  }, [patch]);

  const onHydrate = useCallback((kind: CaseKind, subjects: CaseSubject[]) => {
    setCases((current) => hydrate(current, kind, subjects));
  }, []);

  const openEntity = useCallback(
    (entityId: string) => onNavigate(hrefFor({ view: 'ficha', entityId })),
    [onNavigate],
  );

  if (pulse.loading && !pulse.data) return <Loading label="Leyendo el universo de sujetos obligados…" />;
  if (pulse.error) return <ErrorBox error={pulse.error} onRetry={pulse.reload} />;
  if (!pulse.data?.universe) return <ErrorBox error="El corte vigente no devolvió el padrón UAF." onRetry={pulse.reload} />;

  const isPadron = axis === 'padron';

  return (
    <div className={`uso fade-in uso-mode-${axis}`}>
      <header className="uso-head uso-head-compact">
        <div className="uso-head-copy">
          <span className="uso-kicker">
            {isPadron
              ? 'Universo SO · caracterización del padrón inscrito'
              : 'Universo SO · gestión registral de potenciales y términos de giro'}
          </span>
          <h1>{isPadron ? 'Padrón SO' : 'Gestión SO'}</h1>
        </div>
      </header>

      {(caseError || management.error) && (
        <div className="uso-shared-error" role="alert">
          <span>{caseError ?? management.error}</span>
          <button onClick={() => { setCaseError(null); management.reload(); }}>Sincronizar nuevamente</button>
        </div>
      )}

      {isPadron ? (
        <PadronAxisV2
          pulse={pulse.data}
          potential={potential.data}
          onNavigate={onNavigate}
          onWork={onWork}
        />
      ) : management.loading && !management.data ? (
        <Loading label="Sincronizando Gestión SO…" />
      ) : management.error && !management.data ? (
        <ErrorBox error={management.error} onRetry={management.reload} />
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
        <strong>Cómo leer Universo SO.</strong> Padrón SO describe quién está inscrito en el corte y permite caracterizar composición,
        territorio, reportabilidad y evolución. Término de giro y potencial SO son condiciones de conciliación registral.
        Sanciones, prensa, IPF y demás marcas sirven para ordenar revisión: no concluyen por sí solas incumplimiento ni riesgo LA/FT.
        Gestión SO mantiene responsable, avance y trazabilidad del trabajo sobre potenciales y términos de giro.
      </Semantics>
    </div>
  );
}
