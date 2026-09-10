from pathlib import Path


def must_replace(path: str, old: str, new: str, count: int = 1):
    p = Path(path)
    text = p.read_text()
    found = text.count(old)
    if found < count:
        raise SystemExit(f"{path}: anchor not found ({found} < {count}): {old[:90]!r}")
    text = text.replace(old, new, count)
    p.write_text(text)

# ---------------------------------------------------------------------------
# 1. Domain model: CONTACTADO is the terminal operational state and records can
#    carry shared assignment metadata returned by Supabase.
# ---------------------------------------------------------------------------
casework = Path('src/lib/casework.ts')
text = casework.read_text()
text = text.replace("  | 'LISTO_REQUERIMIENTO'\n", "  | 'CONTACTADO'\n")
text = text.replace("  updatedAt: string;\n}", "  updatedAt: string;\n  caseId?: string | null;\n  assignedTo?: string | null;\n  assignedEmail?: string | null;\n  assignedName?: string | null;\n  assignedAt?: string | null;\n  updatedByEmail?: string | null;\n  contactedAt?: string | null;\n  isMine?: boolean;\n}")
text = text.replace(
    "  { key: 'LISTO_REQUERIMIENTO', label: 'Listo para requerimiento', short: 'Listo', tone: 'var(--present)', step: 3 },",
    "  { key: 'CONTACTADO', label: 'Contactado', short: 'Contactado', tone: 'var(--present)', step: 3 },"
)
text = text.replace(
    "export const STATE_FLOW: CaseState[] = ['SIN_TRABAJAR', 'EN_UBICACION', 'CONTACTO_OBTENIDO', 'LISTO_REQUERIMIENTO'];",
    "export const STATE_FLOW: CaseState[] = ['SIN_TRABAJAR', 'EN_UBICACION', 'CONTACTO_OBTENIDO', 'CONTACTADO'];"
)
text = text.replace("  LISTO_SOLICITUD: 'LISTO_REQUERIMIENTO',", "  LISTO_SOLICITUD: 'CONTACTADO',")
text = text.replace("  LISTO: 'LISTO_REQUERIMIENTO',", "  LISTO: 'CONTACTADO',")
text = text.replace(
    "    'domicilio', 'persona_contacto', 'fuente_contacto', 'nota', 'actualizado',",
    "    'domicilio', 'persona_contacto', 'fuente_contacto', 'responsable', 'correo_responsable', 'asignado_el', 'contactado_el', 'nota', 'actualizado',"
)
text = text.replace(
    "    r.contact.persona,\n    r.contact.fuente,\n    r.note,",
    "    r.contact.persona,\n    r.contact.fuente,\n    r.assignedName ?? '',\n    r.assignedEmail ?? '',\n    r.assignedAt ?? '',\n    r.contactedAt ?? '',\n    r.note,"
)
casework.write_text(text)

shared = r'''import {
  EMPTY_CONTACT, caseKey,
  type CaseContact, type CaseKind, type CaseMap, type CasePriority, type CaseState,
} from './casework';

export interface SharedCaseRow {
  case_id: string;
  case_kind: CaseKind;
  rut: string;
  rut_key: string;
  entity_id: string | null;
  entity_name: string | null;
  sector: string | null;
  region: string | null;
  commune: string | null;
  motive: string | null;
  state: Exclude<CaseState, 'SIN_TRABAJAR'>;
  priority: CasePriority;
  note: string | null;
  contact: Partial<CaseContact> | null;
  assigned_to: string;
  assigned_email: string;
  assigned_name: string | null;
  assigned_at: string;
  updated_by: string;
  updated_email: string;
  contacted_at: string | null;
  updated_at: string;
  is_mine: boolean;
}

export function sharedRowsToCases(rows: SharedCaseRow[]): CaseMap {
  const out: CaseMap = {};
  for (const row of rows) {
    const kind = row.case_kind;
    const subject = {
      rut: row.rut,
      name: row.entity_name ?? '',
      sector: row.sector,
      region: row.region,
      commune: row.commune,
      entityId: row.entity_id,
      motive: row.motive ?? '',
    };
    out[caseKey(kind, row.rut)] = {
      kind,
      rut: row.rut,
      subject,
      state: row.state,
      priority: row.priority,
      note: row.note ?? '',
      contact: { ...EMPTY_CONTACT, ...(row.contact ?? {}) },
      updatedAt: row.updated_at,
      caseId: row.case_id,
      assignedTo: row.assigned_to,
      assignedEmail: row.assigned_email,
      assignedName: row.assigned_name,
      assignedAt: row.assigned_at,
      updatedByEmail: row.updated_email,
      contactedAt: row.contacted_at,
      isMine: row.is_mine,
    };
  }
  return out;
}
'''
Path('src/lib/sharedCasework.ts').write_text(shared)

# ---------------------------------------------------------------------------
# 2. UniversoSO becomes server-backed. The localStorage helpers remain only for
#    backwards-compatible domain utilities; the active board reads/writes RPC.
# ---------------------------------------------------------------------------
universo = r'''import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRpc } from '../lib/rpc';
import { supabase } from '../lib/supabase';
import { hrefFor, type UniversoMode, type UniversoQueue } from '../lib/router';
import type { SectorOverview, UafPotential, UafPulse } from '../lib/contracts';
import { CohortDrawer, type CohortRequest } from '../components/CohortDrawer';
import { ErrorBox, Loading, Semantics } from '../components/primitives';
import { fecha, n } from '../lib/format';
import {
  applyPatch, hydrate, isTracked,
  type CaseContact, type CaseKind, type CaseMap, type CaseRecord, type CaseSubject,
} from '../lib/casework';
import { sharedRowsToCases, type SharedCaseRow } from '../lib/sharedCasework';
import { PadronAxis, type Focus } from './universo/PadronAxis';
import { CasosAxis, type Queue } from './universo/CasosAxis';
import type { CaseRow } from './universo/model';
import '../styles/universo-so.css';

/* UNIVERSO SO · padrón + mesa operativa compartida
   ───────────────────────────────────────────────
   El padrón sigue siendo el contexto nacional. Los bordes del registro son
   colas pendientes hasta que un fiscalizador toma un caso. Desde ese momento
   la entidad sale de la cola de origen y vive en Gestión, con responsable,
   estado y trazabilidad visibles para todo usuario habilitado. */

const AXES: { key: UniversoMode; label: string; hint: string }[] = [
  { key: 'padron', label: 'Padrón inscrito', hint: 'Situación actual de los SO' },
  { key: 'casos', label: 'Mesa de casos', hint: 'Pendientes + gestión compartida' },
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
  const management = useRpc<SharedCaseRow[]>('obs_uaf_case_management', {});

  const [axis, setAxis] = useState<UniversoMode>(initialMode);
  const [queue, setQueue] = useState<Queue>(initialQueue ?? 'potenciales');
  const [sectorFocus, setSectorFocus] = useState<string | null>(null);
  const [cohort, setCohort] = useState<CohortRequest | null>(null);
  const [cases, setCases] = useState<CaseMap>({});
  const [caseError, setCaseError] = useState<string | null>(null);

  useEffect(() => setAxis(initialMode), [initialMode]);
  useEffect(() => { if (initialQueue) setQueue(initialQueue); }, [initialQueue]);
  useEffect(() => {
    if (management.data) setCases(sharedRowsToCases(management.data));
  }, [management.data]);

  // La mesa es compartida. Un refresco corto evita que dos fiscalizadores
  // trabajen con una fotografía vieja; el RPC de escritura además bloquea la
  // doble asignación de forma transaccional.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!document.hidden) management.reload();
    }, 12000);
    return () => window.clearInterval(timer);
  }, [management.reload]);

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
    const claiming = !isTracked(row.record);
    setCaseError(null);
    // Respuesta inmediata en pantalla; el contrato servidor manda al recargar.
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

  const trackedRows = useMemo(() => Object.values(cases).filter(isTracked), [cases]);
  const tracked = trackedRows.length;
  const mine = trackedRows.filter((record) => record.isMine).length;

  if (pulse.loading && !pulse.data) return <Loading label="Leyendo el universo de sujetos obligados…" />;
  if (pulse.error) return <ErrorBox error={pulse.error} onRetry={pulse.reload} />;
  if (!pulse.data) return <ErrorBox error="El corte vigente no devolvió el pulso del padrón." onRetry={pulse.reload} />;

  const u = pulse.data.universe;
  const rawPotential = potential.data?.totales?.accionables ?? 0;
  const rawTerm = u?.terminados ?? 0;
  const managedPotential = trackedRows.filter((record) => record.kind === 'POTENCIAL').length;
  const managedTerm = trackedRows.filter((record) => record.kind === 'TERMINO').length;
  const pendientes = Math.max(0, rawPotential - managedPotential) + Math.max(0, rawTerm - managedTerm) + tracked;
  const snapshot = pulse.data.snapshot;

  return (
    <div className="uso fade-in">
      <header className="uso-head">
        <div className="uso-head-copy">
          <span className="uso-kicker">Padrón UAF · Ley 19.913 · conciliación con el SII</span>
          <h1>Universo SO</h1>
          <p>
            El padrón entrega el contexto. Los casos pendientes se transforman en gestión cuando un fiscalizador los toma;
            desde ahí el equipo ve responsable, avance y resultado sin duplicar trabajo.
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
          <div>
            <dt>En gestión</dt>
            <dd className="num">{management.loading && !management.data ? '…' : `${n(tracked)} casos`}</dd>
          </div>
          {mine > 0 && (
            <div>
              <dt>Asignados a ti</dt>
              <dd className="num">{n(mine)} casos</dd>
            </div>
          )}
        </dl>
      </header>

      {(caseError || management.error) && (
        <div className="uso-shared-error" role="alert">
          <span>{caseError ?? management.error}</span>
          <button onClick={() => { setCaseError(null); management.reload(); }}>Sincronizar nuevamente</button>
        </div>
      )}

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
      ) : management.loading && !management.data ? (
        <Loading label="Sincronizando la mesa compartida de gestión…" />
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
        <strong>Cómo leer Universo SO.</strong> El padrón describe quién está inscrito hoy; las marcas de
        caracterización ordenan revisión y no concluyen incumplimiento ni riesgo LA/FT. Potencial y término de giro son
        colas pendientes. Al tomar un caso, éste sale de su contador de origen y pasa a Gestión con un responsable
        identificado. Los contactos de red abierta son evidencia para revisar: deben validarse antes de una gestión formal.
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
'''
Path('src/views/UniversoSO.tsx').write_text(universo)

# ---------------------------------------------------------------------------
# 3. The queues exclude anything already claimed, and Gestión becomes the
#    shared team board. Internal route name `cartera` is kept for old links.
# ---------------------------------------------------------------------------
p = Path('src/views/universo/CasosAxis.tsx')
text = p.read_text()
text = text.replace(
    "    if (queue === 'potenciales') return (potential?.candidatos ?? []).map((row) => rowFromCandidate(row, cases));\n    if (queue === 'termino') return term.rows.map((row) => rowFromTermination(row, cases));",
    "    if (queue === 'potenciales') return (potential?.candidatos ?? []).map((row) => rowFromCandidate(row, cases)).filter((row) => !isTracked(row.record));\n    if (queue === 'termino') return term.rows.map((row) => rowFromTermination(row, cases)).filter((row) => !isTracked(row.record));"
)
text = text.replace(
    "      if (gestion === 'CARTERA' && !isTracked(row.record)) return false;\n      if (gestion && gestion !== 'CARTERA' && row.record.state !== gestion) return false;",
    "      if (gestion === 'MINE' && !row.record.isMine) return false;\n      if (gestion && gestion !== 'MINE' && row.record.state !== gestion) return false;"
)
text = text.replace(
    "    setOnlyMarks(false);\n    onQueueChange(next);",
    "    setOnlyMarks(false);\n    setOnlyContact(false);\n    onQueueChange(next);"
)
text = text.replace(
    "  const potentialCount = potential?.totales?.accionables ?? 0;\n  const termTotal = term.total ?? pulse.universe?.terminados ?? 0;",
    "  const managedPotential = (potential?.candidatos ?? []).map((item) => rowFromCandidate(item, cases)).filter((row) => isTracked(row.record)).length;\n  const managedTerm = term.rows.map((item) => rowFromTermination(item, cases)).filter((row) => isTracked(row.record)).length;\n  const potentialCount = Math.max(0, (potential?.totales?.accionables ?? 0) - managedPotential);\n  const termTotal = Math.max(0, (term.total ?? pulse.universe?.terminados ?? 0) - managedTerm);"
)
text = text.replace(
    "          <em>Revisar inscripción · conciliación SII ↔ UAF</em>",
    "          <em>Pendientes sin asignar · conciliación SII ↔ UAF</em>"
)
text = text.replace(
    "          <em>Revisar desinscripción · inscritos con giro terminado</em>",
    "          <em>Pendientes sin asignar · revisar desinscripción</em>"
)
text = text.replace(
    "          <span>Mi cartera</span>\n          <b className=\"num\">{n(tracked.length)}</b>\n          <em>Casos que ya tocaste en este navegador</em>",
    "          <span>Gestión</span>\n          <b className=\"num\">{n(tracked.length)}</b>\n          <em>Casos asignados · visibles para todo el equipo</em>"
)
text = text.replace(
    "            kicker=\"Tu trabajo guardado\"\n            title=\"Cartera de gestión\"\n            hint=\"Vive en este navegador. No es un registro institucional y no se comparte: el CSV es la salida que viaja.\"",
    "            kicker=\"Trabajo compartido\"\n            title=\"Gestión de casos\"\n            hint=\"Cada caso tiene responsable y estado común para el equipo. Usa «Sólo mis casos» para ver tu carga.\""
)
text = text.replace("'atlas_universo_so_cartera'", "'atlas_universo_so_gestion'")
text = text.replace(
    "            {STATES.map((meta) => {",
    "            {STATES.filter((meta) => meta.key !== 'SIN_TRABAJAR').map((meta) => {",
    1
)
text = text.replace(
    "            { value: 'CARTERA', label: 'Sólo mi cartera', count: queueRows.filter((row) => isTracked(row.record)).length },",
    "            { value: 'MINE', label: 'Sólo mis casos', count: queueRows.filter((row) => row.record.isMine).length },"
)
text = text.replace(
    "              onPatch={(patch) => onPatch(active, patch)}",
    "              onPatch={(patch) => {\n                const claim = !isTracked(active.record) && patch.state != null && patch.state !== 'SIN_TRABAJAR';\n                onPatch(active, patch);\n                if (claim) window.requestAnimationFrame(() => changeQueue('cartera'));\n              }}"
)
text = text.replace(
    "          {openFilled > 0 && <i className=\"uso-row-contact uso-row-contact-open\" title={`${openFilled} hallazgos de contacto observados en red abierta`}>◎{openFilled}</i>}\n        </span>",
    "          {openFilled > 0 && <i className=\"uso-row-contact uso-row-contact-open\" title={`${openFilled} hallazgos de contacto observados en red abierta`}>◎{openFilled}</i>}\n          {row.record.assignedEmail && (\n            <small className=\"uso-row-owner\" title={`Responsable: ${row.record.assignedName || row.record.assignedEmail}`}>\n              {row.record.isMine ? 'Tú' : (row.record.assignedName || row.record.assignedEmail.split('@')[0])}\n            </small>\n          )}\n        </span>"
)
p.write_text(text)

# ---------------------------------------------------------------------------
# 4. Case file: explicit claim, owner/status visible, read-only for colleagues,
#    and clear path ending at Contactado.
# ---------------------------------------------------------------------------
p = Path('src/views/universo/CaseFile.tsx')
text = p.read_text()
text = text.replace(
    "  caseSummaryText, contactFilled,",
    "  caseSummaryText, contactFilled, isTracked,"
)
text = text.replace(
    "  const filled = contactFilled(record.contact);",
    "  const filled = contactFilled(record.contact);\n  const tracked = isTracked(record);\n  const locked = tracked && record.isMine === false;\n  const canEdit = tracked && !locked;\n  const owner = record.assignedName || record.assignedEmail || null;"
)
anchor = "      </header>\n\n      <nav className=\"uso-case-tabs\" aria-label=\"Secciones de la ficha\">"
replacement = """      </header>\n\n      <div className=\"uso-case-assignment\" data-mode={!tracked ? 'open' : locked ? 'other' : 'mine'}>\n        {!tracked ? (\n          <>\n            <div>\n              <span className=\"uso-kicker\">Disponible para gestión</span>\n              <b>Nadie está atendiendo este caso</b>\n              <em>Al tomarlo saldrá de la cola pendiente y el equipo verá que quedó asignado a ti.</em>\n            </div>\n            <button className=\"btn btn-sm btn-primary\" onClick={() => onPatch({ state: 'EN_UBICACION' })}>Tomar caso</button>\n          </>\n        ) : (\n          <>\n            <div className=\"uso-owner-avatar\" aria-hidden>{(owner ?? '?').slice(0, 1).toUpperCase()}</div>\n            <div>\n              <span className=\"uso-kicker\">{record.isMine ? 'Asignado a ti' : 'Caso en atención'}</span>\n              <b>{record.isMine ? 'Tú' : owner}</b>\n              <em>{STATE_META[record.state].label}{record.assignedAt ? ` · tomado ${desde(record.assignedAt)}` : ''}</em>\n            </div>\n            {locked && <span className=\"uso-readonly\">Sólo lectura</span>}\n          </>\n        )}\n      </div>\n\n      <nav className=\"uso-case-tabs\" aria-label=\"Secciones de la ficha\">"""
if anchor not in text:
    raise SystemExit('CaseFile assignment anchor missing')
text = text.replace(anchor, replacement, 1)
text = text.replace(
    "        <OpenContactPanel row={row} onPatch={onPatch} />",
    "        <OpenContactPanel row={row} onPatch={onPatch} readOnly={!canEdit} />"
)
text = text.replace(
    "                  onChange={(e) => onPatch({ contact: { [field.key]: e.target.value } })}",
    "                  disabled={!canEdit}\n                  onChange={(e) => onPatch({ contact: { [field.key]: e.target.value } })}"
)
text = text.replace(
    "                onClick={() => onPatch({ contact: { telefono: '', correo: '', sitio: '', direccion: '', persona: '', fuente: '' } })}",
    "                disabled={!canEdit}\n                onClick={() => onPatch({ contact: { telefono: '', correo: '', sitio: '', direccion: '', persona: '', fuente: '' } })}"
)
text = text.replace(
    "                  onClick={() => onPatch({ state: key })}",
    "                  disabled={!canEdit || key === 'SIN_TRABAJAR'}\n                  onClick={() => onPatch({ state: key })}"
)
text = text.replace(
    "                onClick={() => onPatch({ state: record.state === key ? 'SIN_TRABAJAR' : key })}",
    "                disabled={!canEdit}\n                onClick={() => onPatch({ state: key })}"
)
text = text.replace(
    "                  onClick={() => onPatch({ priority: p.key as CasePriority })}",
    "                  disabled={!canEdit}\n                  onClick={() => onPatch({ priority: p.key as CasePriority })}"
)
text = text.replace(
    "              value={record.note} maxLength={600}",
    "              value={record.note} maxLength={600} disabled={!canEdit}"
)
text = text.replace(
    "            La mesa vive en este navegador: no es un registro institucional ni se comparte con otras personas.\n            El CSV del lote es la salida que continúa el trámite fuera de Atlas.",
    "            La gestión se guarda en la mesa compartida de Atlas con responsable, estado y trazabilidad.\n            Los demás fiscalizadores pueden ver el avance, pero sólo el responsable del caso puede modificarlo."
)
p.write_text(text)

# ---------------------------------------------------------------------------
# 5. Contact findings get an in-app excerpt on demand. No external navigation
#    is required to evaluate the evidence. `Usar` is only available to owner.
# ---------------------------------------------------------------------------
p = Path('src/views/universo/OpenContactPanel.tsx')
text = p.read_text()
text = text.replace(
    "type ContactField = keyof Pick<CaseContact, 'telefono' | 'correo' | 'sitio' | 'direccion'>;",
    "type ContactPreview = { title: string | null; excerpt: string; source_url: string | null; fetched: boolean };\n\ntype ContactField = keyof Pick<CaseContact, 'telefono' | 'correo' | 'sitio' | 'direccion'>;"
)
text = text.replace(
    "export function OpenContactPanel({\n  row,\n  onPatch,\n}: {\n  row: CaseRow;\n  onPatch: (patch: Partial<Pick<CaseRecord, 'state' | 'priority' | 'note'>> & { contact?: Partial<CaseContact> }) => void;\n}) {",
    "export function OpenContactPanel({\n  row,\n  onPatch,\n  readOnly = false,\n}: {\n  row: CaseRow;\n  onPatch: (patch: Partial<Pick<CaseRecord, 'state' | 'priority' | 'note'>> & { contact?: Partial<CaseContact> }) => void;\n  readOnly?: boolean;\n}) {"
)
text = text.replace(
    "  const [localError, setLocalError] = useState<string | null>(null);",
    "  const [localError, setLocalError] = useState<string | null>(null);\n  const [previews, setPreviews] = useState<Record<string, ContactPreview | 'loading'>>({});"
)
status_fn = """  async function setStatus(contact: OpenContact, status: 'VERIFICADO' | 'DESCARTADO') {\n"""
preview_fn = """  async function loadPreview(contact: OpenContact) {\n    const current = previews[contact.contact_id];\n    if (current && current !== 'loading') {\n      setPreviews((all) => {\n        const next = { ...all };\n        delete next[contact.contact_id];\n        return next;\n      });\n      return;\n    }\n    setPreviews((all) => ({ ...all, [contact.contact_id]: 'loading' }));\n    const { data, error } = await supabase.functions.invoke<ContactPreview>('atlas-contact-preview', {\n      body: { contact_id: contact.contact_id },\n    });\n    if (error || !data) {\n      setPreviews((all) => ({\n        ...all,\n        [contact.contact_id]: {\n          title: contact.source_label,\n          excerpt: contact.evidence_note || 'No fue posible leer una muestra de la fuente en este momento.',\n          source_url: contact.source_url,\n          fetched: false,\n        },\n      }));\n      return;\n    }\n    setPreviews((all) => ({ ...all, [contact.contact_id]: data }));\n  }\n\n"""
if status_fn not in text:
    raise SystemExit('OpenContact status anchor missing')
text = text.replace(status_fn, preview_fn + status_fn, 1)
text = text.replace(
    "            const domain = host(contact.source_url);\n            return (",
    "            const domain = host(contact.source_url);\n            const preview = previews[contact.contact_id];\n            return ("
)
text = text.replace(
    "                  {contact.evidence_note && <em>{contact.evidence_note}</em>}\n                </div>",
    "                  {contact.evidence_note && <em>{contact.evidence_note}</em>}\n                  <div className=\"uso-open-preview\">\n                    <button onClick={() => void loadPreview(contact)}>\n                      {preview ? (preview === 'loading' ? 'Leyendo muestra…' : 'Ocultar muestra') : 'Ver muestra del hallazgo'}\n                    </button>\n                    {preview && preview !== 'loading' && (\n                      <div className=\"uso-open-preview-body\">\n                        {preview.title && <b>{preview.title}</b>}\n                        <p>{preview.excerpt}</p>\n                        <small>{preview.fetched ? 'Texto leído desde la fuente' : 'Muestra disponible en Atlas / fuente no legible automáticamente'}</small>\n                      </div>\n                    )}\n                  </div>\n                </div>"
)
text = text.replace(
    "                  {field && <button className=\"uso-open-use\" onClick={() => adopt(contact)}>Usar</button>}",
    "                  {field && !readOnly && <button className=\"uso-open-use\" onClick={() => adopt(contact)}>Usar</button>}"
)
text = text.replace(
    "          <p>Atlas conserva hallazgos de fuentes públicas con origen, fecha y confianza. Revísalos antes de incorporarlos a una gestión.</p>",
    "          <p>Atlas conserva hallazgos de fuentes públicas con origen, fecha y confianza. Abre «Ver muestra» para evaluarlos dentro de la app antes de incorporarlos.</p>"
)
p.write_text(text)

# ---------------------------------------------------------------------------
# 6. Styling for evidence preview, shared ownership and responsive cards.
# ---------------------------------------------------------------------------
css = Path('src/styles/universo-contact.css')
text = css.read_text()
text += r'''

/* ───────────────────────────────────────────── evidencia dentro de Atlas */
.uso-open-preview { margin-top: 5px; }
.uso-open-preview > button {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--accent);
  font-size: 9.5px;
  font-weight: 650;
  cursor: pointer;
}
.uso-open-preview-body {
  margin-top: 6px;
  padding: 8px 9px;
  border-left: 2px solid color-mix(in srgb, var(--accent) 42%, var(--line));
  border-radius: 0 6px 6px 0;
  background: color-mix(in srgb, var(--accent) 5%, var(--bg-panel));
}
.uso-open-preview-body b {
  display: block;
  overflow: hidden;
  color: var(--ink-2);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.uso-open-preview-body p {
  margin: 4px 0 0;
  color: var(--ink-2);
  font-size: 10px;
  line-height: 1.5;
  white-space: normal;
}
.uso-open-preview-body small { display: block; margin-top: 5px; color: var(--ink-4); font-size: 8.5px; }

/* ───────────────────────────────────────────── asignación compartida */
.uso-case-assignment {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  margin: 0 14px 10px;
  padding: 10px 11px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--bg-panel-2);
}
.uso-case-assignment[data-mode='open'] { grid-template-columns: minmax(0, 1fr) auto; border-color: color-mix(in srgb, var(--accent) 30%, var(--line)); }
.uso-case-assignment[data-mode='mine'] { border-color: color-mix(in srgb, var(--present) 34%, var(--line)); }
.uso-case-assignment > div:not(.uso-owner-avatar) { min-width: 0; }
.uso-case-assignment b { display: block; margin-top: 2px; color: var(--ink); font-size: 11.5px; }
.uso-case-assignment em { display: block; margin-top: 2px; color: var(--ink-3); font-size: 9.5px; font-style: normal; line-height: 1.4; }
.uso-owner-avatar { display: grid; place-items: center; width: 28px; height: 28px; border: 1px solid var(--line-strong); border-radius: 50%; color: var(--accent); font-size: 10px; font-weight: 750; }
.uso-readonly { padding: 4px 7px; border: 1px solid var(--line); border-radius: 999px; color: var(--ink-4); font-size: 9px; white-space: nowrap; }
.uso-row-owner { max-width: 86px; overflow: hidden; padding: 2px 5px; border: 1px solid var(--line); border-radius: 999px; color: var(--ink-3); font-size: 8.5px; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
.uso-shared-error { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 9px 12px; border: 1px solid color-mix(in srgb, var(--sig-high) 35%, var(--line)); border-radius: var(--radius-sm); background: color-mix(in srgb, var(--sig-high) 6%, var(--bg-panel)); color: var(--ink-2); font-size: 11px; }
.uso-shared-error button { border: 0; background: transparent; color: var(--accent); cursor: pointer; font: inherit; }

@media (max-width: 720px) {
  .uso-case-assignment, .uso-case-assignment[data-mode='open'] { grid-template-columns: auto minmax(0, 1fr); }
  .uso-case-assignment > .btn, .uso-case-assignment > .uso-readonly { grid-column: 2; justify-self: start; }
  .uso-open-preview-body { margin-right: 0; }
}
'''
css.write_text(text)

# ---------------------------------------------------------------------------
# 7. Version backend sources alongside the UI (DB/function are deployed by the
#    maintenance task that introduced this source file).
# ---------------------------------------------------------------------------
migration = r'''create table if not exists public.aml_uaf_case_management (
  case_id uuid primary key default gen_random_uuid(),
  case_kind text not null check (case_kind in ('POTENCIAL','TERMINO')),
  rut text not null,
  rut_key text not null,
  entity_id text,
  entity_name text,
  sector text,
  region text,
  commune text,
  motive text,
  state text not null default 'EN_UBICACION' check (state in ('EN_UBICACION','CONTACTO_OBTENIDO','CONTACTADO','SIN_UBICAR','DESCARTADO')),
  priority text not null default 'MEDIA' check (priority in ('ALTA','MEDIA','BAJA')),
  note text not null default '',
  contact jsonb not null default '{}'::jsonb,
  assigned_to uuid not null,
  assigned_email text not null,
  assigned_name text,
  assigned_at timestamptz not null default now(),
  updated_by uuid not null,
  updated_email text not null,
  contacted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint aml_uaf_case_management_kind_rut_key_uk unique(case_kind, rut_key)
);

create index if not exists aml_uaf_case_management_state_idx on public.aml_uaf_case_management(state, updated_at desc);
create index if not exists aml_uaf_case_management_owner_idx on public.aml_uaf_case_management(assigned_to, updated_at desc);

create table if not exists public.aml_uaf_case_management_event (
  event_id bigint generated always as identity primary key,
  case_id uuid not null references public.aml_uaf_case_management(case_id) on delete cascade,
  case_kind text not null,
  rut_key text not null,
  event_type text not null,
  previous_state text,
  new_state text,
  actor_id uuid not null,
  actor_email text not null,
  actor_name text,
  detail text,
  created_at timestamptz not null default now()
);
create index if not exists aml_uaf_case_management_event_case_idx on public.aml_uaf_case_management_event(case_id, created_at desc);

alter table public.aml_uaf_case_management enable row level security;
alter table public.aml_uaf_case_management_event enable row level security;
revoke all on public.aml_uaf_case_management from anon, authenticated;
revoke all on public.aml_uaf_case_management_event from anon, authenticated;

create or replace function public.obs_uaf_case_management()
returns table (
  case_id uuid, case_kind text, rut text, rut_key text, entity_id text, entity_name text,
  sector text, region text, commune text, motive text, state text, priority text, note text,
  contact jsonb, assigned_to uuid, assigned_email text, assigned_name text, assigned_at timestamptz,
  updated_by uuid, updated_email text, contacted_at timestamptz, updated_at timestamptz, is_mine boolean
)
language plpgsql stable security definer
set search_path = public, auth, extensions, pg_temp
as $$
begin
  if auth.uid() is null or not exists (select 1 from public.aml_allowed_users u where u.user_id=auth.uid() and u.enabled=true) then return; end if;
  return query
  select c.case_id,c.case_kind,c.rut,c.rut_key,c.entity_id,c.entity_name,c.sector,c.region,c.commune,c.motive,
         c.state,c.priority,c.note,c.contact,c.assigned_to,c.assigned_email,c.assigned_name,c.assigned_at,
         c.updated_by,c.updated_email,c.contacted_at,c.updated_at,(c.assigned_to=auth.uid())
  from public.aml_uaf_case_management c order by c.updated_at desc;
end $$;

create or replace function public.obs_uaf_case_management_events(p_case_id uuid)
returns table (event_id bigint,event_type text,previous_state text,new_state text,actor_email text,actor_name text,detail text,created_at timestamptz)
language plpgsql stable security definer
set search_path = public, auth, extensions, pg_temp
as $$
begin
  if auth.uid() is null or not exists (select 1 from public.aml_allowed_users u where u.user_id=auth.uid() and u.enabled=true) then return; end if;
  return query select e.event_id,e.event_type,e.previous_state,e.new_state,e.actor_email,e.actor_name,e.detail,e.created_at
  from public.aml_uaf_case_management_event e where e.case_id=p_case_id order by e.created_at desc limit 30;
end $$;

create or replace function public.aml_uaf_case_patch(
  p_kind text,p_rut text,p_subject jsonb default '{}'::jsonb,p_state text default null,p_priority text default null,
  p_note text default null,p_contact jsonb default null,p_claim boolean default false
) returns uuid
language plpgsql security definer
set search_path = public, auth, extensions, pg_temp
as $$
declare
  v_uid uuid:=auth.uid(); v_role text; v_email text; v_name text;
  v_key text:=regexp_replace(upper(coalesce(p_rut,'')),'[^0-9K]','','g');
  v_case public.aml_uaf_case_management%rowtype; v_old_state text; v_new_state text;
begin
  if v_uid is null then raise exception 'Sesión requerida'; end if;
  if p_kind not in ('POTENCIAL','TERMINO') then raise exception 'Tipo de caso no permitido'; end if;
  if nullif(v_key,'') is null then raise exception 'RUT requerido'; end if;
  if p_state is not null and p_state not in ('EN_UBICACION','CONTACTO_OBTENIDO','CONTACTADO','SIN_UBICAR','DESCARTADO') then raise exception 'Estado de gestión no permitido'; end if;
  if p_priority is not null and p_priority not in ('ALTA','MEDIA','BAJA') then raise exception 'Prioridad no permitida'; end if;
  select au.role,coalesce(nullif(au.email,''),u.email,'usuario'),
         coalesce(nullif(u.raw_user_meta_data->>'full_name',''),nullif(u.raw_user_meta_data->>'name',''),split_part(coalesce(nullif(au.email,''),u.email,'usuario'),'@',1))
    into v_role,v_email,v_name from public.aml_allowed_users au left join auth.users u on u.id=au.user_id
    where au.user_id=v_uid and au.enabled=true;
  if v_role is null then raise exception 'Cuenta no habilitada'; end if;
  select * into v_case from public.aml_uaf_case_management c where c.case_kind=p_kind and c.rut_key=v_key for update;
  if not found then
    if not p_claim then raise exception 'El caso aún no fue tomado por un fiscalizador'; end if;
    insert into public.aml_uaf_case_management(case_kind,rut,rut_key,entity_id,entity_name,sector,region,commune,motive,state,priority,note,contact,assigned_to,assigned_email,assigned_name,assigned_at,updated_by,updated_email,contacted_at,updated_at)
    values(p_kind,p_rut,v_key,nullif(p_subject->>'entityId',''),nullif(p_subject->>'name',''),nullif(p_subject->>'sector',''),nullif(p_subject->>'region',''),nullif(p_subject->>'commune',''),nullif(p_subject->>'motive',''),coalesce(p_state,'EN_UBICACION'),coalesce(p_priority,'MEDIA'),coalesce(p_note,''),coalesce(p_contact,'{}'::jsonb),v_uid,v_email,v_name,now(),v_uid,v_email,case when coalesce(p_state,'EN_UBICACION')='CONTACTADO' then now() else null end,now()) returning * into v_case;
    insert into public.aml_uaf_case_management_event(case_id,case_kind,rut_key,event_type,previous_state,new_state,actor_id,actor_email,actor_name,detail)
    values(v_case.case_id,p_kind,v_key,'CLAIM',null,v_case.state,v_uid,v_email,v_name,'Caso tomado para gestión');
    return v_case.case_id;
  end if;
  if v_case.assigned_to<>v_uid and coalesce(v_role,'viewer')<>'admin' then raise exception 'Este caso ya está siendo atendido por %',coalesce(v_case.assigned_name,v_case.assigned_email); end if;
  v_old_state:=v_case.state; v_new_state:=coalesce(p_state,v_case.state);
  update public.aml_uaf_case_management c set
    entity_id=coalesce(nullif(p_subject->>'entityId',''),c.entity_id), entity_name=coalesce(nullif(p_subject->>'name',''),c.entity_name),
    sector=coalesce(nullif(p_subject->>'sector',''),c.sector),region=coalesce(nullif(p_subject->>'region',''),c.region),commune=coalesce(nullif(p_subject->>'commune',''),c.commune),motive=coalesce(nullif(p_subject->>'motive',''),c.motive),
    state=v_new_state,priority=coalesce(p_priority,c.priority),note=case when p_note is null then c.note else left(p_note,1200) end,
    contact=case when p_contact is null then c.contact else c.contact||p_contact end,contacted_at=case when v_new_state='CONTACTADO' and c.contacted_at is null then now() else c.contacted_at end,
    updated_by=v_uid,updated_email=v_email,updated_at=now() where c.case_id=v_case.case_id returning * into v_case;
  if v_old_state is distinct from v_new_state then
    insert into public.aml_uaf_case_management_event(case_id,case_kind,rut_key,event_type,previous_state,new_state,actor_id,actor_email,actor_name,detail)
    values(v_case.case_id,p_kind,v_key,'STATE',v_old_state,v_new_state,v_uid,v_email,v_name,'Estado de gestión actualizado');
  end if;
  return v_case.case_id;
end $$;

revoke all on function public.obs_uaf_case_management() from public,anon;
revoke all on function public.obs_uaf_case_management_events(uuid) from public,anon;
revoke all on function public.aml_uaf_case_patch(text,text,jsonb,text,text,text,jsonb,boolean) from public,anon;
grant execute on function public.obs_uaf_case_management() to authenticated,service_role;
grant execute on function public.obs_uaf_case_management_events(uuid) to authenticated,service_role;
grant execute on function public.aml_uaf_case_patch(text,text,jsonb,text,text,text,jsonb,boolean) to authenticated,service_role;
'''
Path('supabase/migrations/20260910122500_universo_so_shared_case_management.sql').write_text(migration)

edge_dir = Path('supabase/functions/atlas-contact-preview')
edge_dir.mkdir(parents=True, exist_ok=True)
edge_dir.joinpath('index.ts').write_text(r'''import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
const CORS={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:CORS});
function publicUrl(raw:string){try{const u=new URL(raw);if(!/^https?:$/.test(u.protocol))return false;const h=u.hostname.toLowerCase();if(h==='localhost'||h.endsWith('.local')||h==='0.0.0.0'||h.startsWith('127.')||h.startsWith('10.')||h.startsWith('192.168.'))return false;const m=h.match(/^172\.(\d+)\./);return !(m&&Number(m[1])>=16&&Number(m[1])<=31)}catch{return false}}
const decode=(s:string)=>s.replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&nbsp;/gi,' ');
const strip=(h:string)=>decode(h.replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<(br|\/p|\/div|\/td|\/th|\/tr|\/li|\/h\d)>/gi,'\n').replace(/<[^>]+>/g,' ')).replace(/\r/g,'').replace(/[ \t]+/g,' ');
const title=(h:string)=>{const m=h.match(/<title[^>]*>([\s\S]*?)<\/title>/i);return m?decode(m[1].replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim()).slice(0,180):null};
function excerpt(text:string,value:string){const lines=text.split('\n').map(x=>x.replace(/\s+/g,' ').trim()).filter(x=>x.length>=3&&x.length<=700);const target=value.trim().toLowerCase(),digits=value.replace(/\D/g,''),needle=digits.length>=6?digits.slice(-6):'';let at=lines.findIndex(l=>l.toLowerCase().includes(target));if(at<0&&needle)at=lines.findIndex(l=>l.replace(/\D/g,'').includes(needle));if(at<0)at=lines.findIndex(l=>/(contacto|tel[eé]fono|correo|email|direcci[oó]n|domicilio|whatsapp|cont[aá]ctanos)/i.test(l));if(at<0)at=0;return lines.slice(Math.max(0,at-1),Math.min(lines.length,at+3)).join(' · ').slice(0,520)}
Deno.serve(async(req)=>{if(req.method==='OPTIONS')return new Response('ok',{headers:CORS});if(req.method!=='POST')return json({error:'method_not_allowed'},405);const auth=req.headers.get('Authorization')||'',url=Deno.env.get('SUPABASE_URL')!,anon=Deno.env.get('SUPABASE_ANON_KEY')!,service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;const uc=createClient(url,anon,{global:{headers:{Authorization:auth}}});const {data:{user},error:ue}=await uc.auth.getUser();if(ue||!user)return json({error:'unauthorized'},401);const admin=createClient(url,service,{auth:{persistSession:false}});const {data:allowed}=await admin.from('aml_allowed_users').select('user_id').eq('user_id',user.id).eq('enabled',true).maybeSingle();if(!allowed)return json({error:'forbidden'},403);const body=await req.json().catch(()=>({})),id=String(body.contact_id||'').trim();if(!id)return json({error:'contact_id_required'},400);const {data:c,error}=await admin.from('aml_uaf_candidate_contact_osint').select('contact_id,contact_value,source_label,source_url,evidence_note,last_observed_at').eq('contact_id',id).maybeSingle();if(error||!c)return json({error:'contact_not_found'},404);const fallback=String(c.evidence_note||'').trim();if(!c.source_url||!publicUrl(c.source_url))return json({title:c.source_label||'Fuente abierta',excerpt:fallback||'La fuente no permite previsualización automática. Usa la referencia del hallazgo para contrastarla.',source_url:c.source_url,fetched:false});const ac=new AbortController(),timer=setTimeout(()=>ac.abort(),8500);try{const r=await fetch(c.source_url,{signal:ac.signal,redirect:'follow',headers:{'user-agent':'Mozilla/5.0 (compatible; ATLAS-AML-Preview/1.0)','accept':'text/html,text/plain;q=0.9,*/*;q=0.1','accept-language':'es-CL,es;q=0.9,en;q=0.6'}});if(!r.ok)throw new Error(`HTTP ${r.status}`);const ct=(r.headers.get('content-type')||'').toLowerCase();if(!(ct.includes('text/html')||ct.includes('text/plain')))throw new Error('content_type');const bytes=new Uint8Array(await r.arrayBuffer()),html=new TextDecoder().decode(bytes.slice(0,360000)),txt=strip(html);return json({title:title(html)||c.source_label||'Fuente abierta',excerpt:excerpt(txt,String(c.contact_value||''))||fallback||'La página no entregó texto suficiente para una muestra.',source_url:c.source_url,fetched:true,observed_at:c.last_observed_at})}catch{return json({title:c.source_label||'Fuente abierta',excerpt:fallback||'No fue posible leer una muestra de esta fuente en este momento. El hallazgo sigue disponible para contraste manual.',source_url:c.source_url,fetched:false})}finally{clearTimeout(timer)}});
''')

print('Universo SO shared management patch applied')
