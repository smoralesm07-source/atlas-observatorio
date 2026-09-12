import { useEffect, useState } from 'react';
import {
  CONTACT_FIELDS, KIND_META, PRIORITIES, RESULT_LABEL, STATE_META,
  type CaseContact, type CasePatch, type CasePriority, type ManagementResult,
  caseSummaryText, contactFilled, isTracked,
} from '../../lib/casework';
import { rutForms } from '../../lib/osint';
import { supabase } from '../../lib/supabase';
import { desde, fecha, n, n1, titleCase } from '../../lib/format';
import { CopyButton, Field, Pill, SectionHead } from './bits';
import type { CaseRow } from './model';
import { OpenContactPanel } from './OpenContactPanel';
import { PotentialIntakePreview } from './PotentialIntakePreview';
import { TerminationIntakePreview } from './TerminationIntakePreview';
import '../../styles/universo-case-flow.css';
import '../../styles/universo-case-review.css';
import '../../styles/universo-potential-intake.css';

const SII_THIRD_PARTY_URL = 'https://www2.sii.cl/stc/noauthz/';
const compactRut = (value: string | null | undefined) => String(value ?? '').toUpperCase().replace(/[^0-9K]/g, '');

type EntitySearchHit = { entity_id?: string | null; rut?: string | null; openable?: boolean };
type EntitySearchResponse = { items?: EntitySearchHit[] };

export function CaseFile({
  row, onPatch, onEntity, onSector,
}: {
  row: CaseRow;
  onPatch: (patch: CasePatch) => void;
  onEntity?: () => void;
  onSector?: (sector: string) => void;
}) {
  const record = row.record;
  const kind = KIND_META[row.kind];
  const state = STATE_META[record.state];
  const { dotted } = rutForms(row.subject.rut);
  const tracked = isTracked(record);
  const locked = tracked && record.isMine === false;
  const canEdit = tracked && !locked;
  const owner = record.assignedName || record.assignedEmail || null;
  const terminal = record.state === 'DAR_DE_BAJA' || record.state === 'CANDIDATO';

  const [contactDraft, setContactDraft] = useState<CaseContact>(() => ({ ...record.contact }));
  const [noteDraft, setNoteDraft] = useState(record.note);
  const [viewStep, setViewStep] = useState<1 | 2>(record.workflowStep ?? 1);
  const [siiCopied, setSiiCopied] = useState(false);
  const [resolving360, setResolving360] = useState(false);

  useEffect(() => {
    setContactDraft({ ...record.contact });
    setNoteDraft(record.note);
    setViewStep(record.workflowStep ?? 1);
    setSiiCopied(false);
  }, [row.key]);

  useEffect(() => setContactDraft({ ...record.contact }), [record.contact]);
  useEffect(() => setNoteDraft(record.note), [record.note]);

  const filled = contactFilled(contactDraft);
  const contactReady = filled > 0 || record.noContact;
  const noteDirty = noteDraft !== record.note;
  const step2Reached = record.workflowStep === 2 || terminal;

  const saveContact = () => {
    onPatch({ contact: contactDraft, noContact: filled > 0 ? false : record.noContact });
  };

  const saveNote = () => {
    if (noteDirty) onPatch({ note: noteDraft });
  };

  const setNoContact = () => {
    if (filled > 0) return;
    onPatch({ noContact: !record.noContact });
  };

  const advanceToRegister = () => {
    if (!contactReady) return;
    onPatch({
      contact: contactDraft,
      workflowStep: 2,
      noContact: filled === 0,
      state: terminal ? record.state : 'GESTIONANDO',
    });
    setViewStep(2);
  };

  const pause = () => {
    saveNote();
    onPatch({
      contact: contactDraft,
      workflowStep: viewStep,
      noContact: filled === 0 ? record.noContact : false,
      state: 'PENDIENTE_GESTION',
    });
  };

  const cancel = () => {
    const message = row.kind === 'TERMINO'
      ? 'Se eliminará esta gestión y la entidad volverá a su estado original dentro de Término de giro. ¿Continuar?'
      : 'Se eliminará esta gestión y la entidad volverá al universo de Potenciales SO. ¿Continuar?';
    if (window.confirm(message)) onPatch({ state: 'SIN_TRABAJAR' });
  };

  const discardPotential = () => {
    if (!window.confirm('La entidad quedará marcada como Descartado y saldrá del flujo activo de Potenciales SO. ¿Continuar?')) return;
    onPatch({
      contact: contactDraft,
      workflowStep: 1,
      noContact: filled === 0 ? record.noContact : false,
      state: 'DESCARTADO',
    });
  };

  const chooseResult = (result: ManagementResult) => {
    onPatch({
      workflowStep: 2,
      managementResult: result,
      state: terminal ? record.state : 'GESTIONANDO',
    });
  };

  const finish = () => {
    if (!record.managementResult) return;
    saveNote();
    onPatch({
      workflowStep: 2,
      managementResult: record.managementResult,
      note: noteDraft,
      state: row.kind === 'TERMINO' ? 'DAR_DE_BAJA' : 'CANDIDATO',
    });
  };

  const resolveEntity360 = async (): Promise<string | null> => {
    const embedded = row.subject.entityId ?? row.candidate?.entity_id ?? row.termination?.entity_id ?? null;
    if (embedded) return embedded;
    const { data, error } = await supabase.rpc('atlas_v2_entity_search_cascade', {
      p_request: {
        kind: 'results', search: dotted, limit: 10, offset: 0,
        region: '', entity_type: '', uaf: false, sanctioned: false, min_sources: 0,
      },
    });
    if (error) throw error;
    const items = ((data as EntitySearchResponse | null)?.items ?? []);
    const targetRut = compactRut(row.subject.rut);
    const exact = items.find((item) => item.entity_id && compactRut(item.rut) === targetRut)
      ?? items.find((item) => item.entity_id && item.openable !== false)
      ?? items.find((item) => item.entity_id);
    return exact?.entity_id ?? null;
  };

  const openAtlas360 = () => {
    if (resolving360) return;
    setResolving360(true);
    const opened = window.open('about:blank', '_blank');
    if (opened) opened.opener = null;
    void resolveEntity360()
      .then((entityId) => {
        if (!entityId) {
          const fallback = `#/entidades?q=${encodeURIComponent(dotted)}`;
          if (opened) opened.location.replace(`${window.location.origin}${window.location.pathname}${fallback}`);
          else window.location.hash = fallback;
          return;
        }
        const target = `#/entidad/${encodeURIComponent(entityId)}`;
        if (opened) opened.location.replace(`${window.location.origin}${window.location.pathname}${target}`);
        else if (row.subject.entityId && onEntity) onEntity();
        else window.location.hash = target;
      })
      .catch(() => {
        const fallback = `#/entidades?q=${encodeURIComponent(dotted)}`;
        if (opened) opened.location.replace(`${window.location.origin}${window.location.pathname}${fallback}`);
        else window.location.hash = fallback;
      })
      .finally(() => setResolving360(false));
  };

  const openSiiThirdParty = () => {
    window.open(SII_THIRD_PARTY_URL, '_blank', 'noopener,noreferrer');
    if (!navigator.clipboard?.writeText) return;
    void navigator.clipboard.writeText(dotted).then(() => {
      setSiiCopied(true);
      window.setTimeout(() => setSiiCopied(false), 2600);
    }).catch(() => undefined);
  };

  return (
    <section className={`uso-case uso-case-progressive uso-case-two-step uso-case-${row.kind.toLowerCase()}`} aria-label={`Ficha de gestión de ${row.subject.name || dotted}`}>
      <header className="uso-case-head">
        <div className="uso-case-id">
          <div className="uso-case-badges">
            <Pill tone={kind.tone}>{kind.short}</Pill>
            <Pill tone={state.tone}>{state.label}</Pill>
            {terminal && <Pill tone="var(--present)">Editable</Pill>}
          </div>
          <h3>{titleCase(row.subject.name) || dotted}</h3>
          <p>
            <span className="mono">{dotted}</span>
            {row.subject.sector && (
              <>
                {' · '}
                {onSector
                  ? <button className="uso-linkish" onClick={() => onSector(row.subject.sector as string)}>{titleCase(row.subject.sector)}</button>
                  : titleCase(row.subject.sector)}
              </>
            )}
            {(row.subject.commune || row.subject.region) && ` · ${titleCase([row.subject.commune, row.subject.region].filter(Boolean).join(', '))}`}
          </p>
        </div>
        <div className="uso-case-tools">
          <CopyButton text={dotted} label="RUT" done="RUT copiado" small />
          <CopyButton text={caseSummaryText(record)} label="Ficha" done="Ficha copiada" small />
          <button className="btn btn-sm" onClick={openAtlas360} disabled={resolving360}>{resolving360 ? 'Abriendo…' : 'Entidad 360 ↗'}</button>
          <button className="btn btn-sm" onClick={openSiiThirdParty}>{siiCopied ? 'SII · RUT copiado' : 'Consulta SII ↗'}</button>
        </div>
      </header>

      {!tracked ? (
        row.kind === 'POTENCIAL' ? (
          <PotentialIntakePreview
            row={row}
            onTake={() => onPatch({ state: 'GESTIONANDO', workflowStep: 1, managementResult: null, noContact: false })}
          />
        ) : (
          <TerminationIntakePreview
            row={row}
            onTake={() => onPatch({ state: 'GESTIONANDO', workflowStep: 1, managementResult: null, noContact: false })}
          />
        )
      ) : (
        <>
          <div className="uso-case-assignment" data-mode={locked ? 'other' : 'mine'}>
            <div className="uso-owner-avatar" aria-hidden>{(owner ?? '?').slice(0, 1).toUpperCase()}</div>
            <div>
              <span className="uso-kicker">{record.isMine ? 'Asignado a ti' : 'Caso en atención'}</span>
              <b>{record.isMine ? 'Tú' : owner}</b>
              <em>{STATE_META[record.state].label}{record.assignedAt ? ` · tomado ${desde(record.assignedAt)}` : ''}</em>
            </div>
            {locked && <span className="uso-readonly">Sólo lectura</span>}
          </div>

          <nav className="uso-case-stepper" aria-label="Flujo de gestión">
            <button data-on={viewStep === 1} data-done={step2Reached ? 'true' : undefined} onClick={() => setViewStep(1)}>
              <i>1</i><span><b>Ubicar entidad</b><em>Contacto y contexto</em></span>
            </button>
            <button data-on={viewStep === 2} disabled={!step2Reached} onClick={() => setViewStep(2)}>
              <i>2</i><span><b>Registro de gestión</b><em>Resultado y cierre</em></span>
            </button>
            <strong style={{ ['--state-tone' as string]: state.tone }}>{state.label}</strong>
          </nav>

          {viewStep === 1 ? (
            <div className="uso-case-step uso-case-step-locate">
              <div className="uso-case-body uso-step-intro">
                <SectionHead
                  kicker="Paso 1 de 2"
                  title="Ubicar entidad"
                  hint="Busca un canal de contacto confiable, adopta sólo lo que te sirva o marca Sin contacto para continuar."
                />
                {row.kind === 'POTENCIAL' && <PotentialContext row={row} />}
                {row.kind === 'TERMINO' && (
                  <div className="uso-flow-context uso-flow-context-term">
                    <span className="uso-kicker">Motivo de gestión</span>
                    <b>{row.subject.motive}</b>
                    <p>La señal tributaria motiva revisar el registro UAF; no concluye por sí sola el resultado de la gestión.</p>
                  </div>
                )}
              </div>

              <OpenContactPanel row={row} onPatch={onPatch} readOnly={!canEdit} />

              <div className="uso-case-body uso-contact-manual-capture">
                <SectionHead title="Datos de contacto" hint="Puedes escribirlos manualmente o adoptar propuestas de la búsqueda anterior." />
                <div className="uso-contact uso-contact-core">
                  {CONTACT_FIELDS.map((field) => (
                    <label key={field.key} className="uso-contact-field">
                      <span>{field.label}</span>
                      <input
                        type={field.type}
                        value={contactDraft[field.key]}
                        placeholder={field.placeholder}
                        disabled={!canEdit}
                        onChange={(e) => setContactDraft((current) => ({ ...current, [field.key]: e.target.value }))}
                        onBlur={saveContact}
                      />
                    </label>
                  ))}
                </div>
                <div className="uso-contact-foot uso-contact-foot-actions">
                  <span><b>{filled}</b> campos con dato</span>
                  <button
                    className="btn btn-sm uso-no-contact"
                    data-on={record.noContact ? 'true' : undefined}
                    disabled={!canEdit || filled > 0}
                    onClick={setNoContact}
                  >
                    {record.noContact ? '✓ Sin contacto' : 'Marcar sin contacto'}
                  </button>
                  {!contactReady && <em>Incorpora al menos un dato o marca Sin contacto para avanzar.</em>}
                </div>
              </div>

              <div className="uso-case-body uso-step-actions">
                <div>
                  <span className="uso-kicker">Decisión del paso</span>
                  <b>{contactReady ? 'Puedes continuar al registro de gestión' : 'Falta resolver el contacto'}</b>
                </div>
                <div className="uso-step-action-buttons">
                  <button className="btn btn-primary" disabled={!canEdit || !contactReady} onClick={advanceToRegister}>Registro de gestión</button>
                  <button className="btn" disabled={!canEdit} onClick={pause}>Pendiente</button>
                  {row.kind === 'TERMINO' ? (
                    <button className="btn uso-release" disabled={!canEdit} onClick={cancel}>Anular gestión</button>
                  ) : (
                    <button className="btn uso-release" disabled={!canEdit} onClick={discardPotential}>Descartar</button>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="uso-case-step uso-case-step-register">
              <div className="uso-case-body">
                <SectionHead
                  kicker="Paso 2 de 2"
                  title="Registro de gestión"
                  hint="Registra el resultado de ubicación, agrega el comentario útil y define el destino del caso."
                />

                <div className="uso-result-picker" role="group" aria-label="Resultado de la ubicación">
                  <span>Resultado de ubicación</span>
                  <div>
                    <button data-on={record.managementResult === 'UBICABLE'} disabled={!canEdit} onClick={() => chooseResult('UBICABLE')}>Ubicable</button>
                    <button data-on={record.managementResult === 'NO_UBICABLE'} disabled={!canEdit} onClick={() => chooseResult('NO_UBICABLE')}>No ubicable</button>
                    {row.kind === 'TERMINO' && (
                      <button data-on={record.managementResult === 'BAJA_OFICIO'} disabled={!canEdit} onClick={() => chooseResult('BAJA_OFICIO')}>Baja de oficio</button>
                    )}
                  </div>
                  {record.managementResult && <em>Seleccionado: {RESULT_LABEL[record.managementResult]}</em>}
                </div>

                <label className="uso-note-field uso-note-draft">
                  <span>Comentario de la gestión</span>
                  <textarea
                    value={noteDraft}
                    maxLength={1200}
                    disabled={!canEdit}
                    placeholder="Resume qué se encontró, qué fuente se revisó, intentos de ubicación y cualquier antecedente útil para Fiscalización."
                    onChange={(e) => setNoteDraft(e.target.value)}
                    onBlur={saveNote}
                  />
                  <div className="uso-note-foot">
                    <em>{noteDraft.length}/1200 · {noteDirty ? 'cambios sin guardar' : `guardado ${desde(record.updatedAt)}`}</em>
                    <button className="btn btn-sm" disabled={!canEdit || !noteDirty} onClick={saveNote}>Guardar comentario</button>
                  </div>
                </label>

                <div className="uso-management-meta uso-management-meta-compact">
                  <div className="uso-priority" role="group" aria-label="Prioridad del caso">
                    <span>Prioridad</span>
                    <div className="seg seg-sm">
                      {PRIORITIES.map((p) => (
                        <button key={p.key} data-on={record.priority === p.key} disabled={!canEdit} onClick={() => onPatch({ priority: p.key as CasePriority })}>
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="uso-case-body uso-step-outcome">
                <div>
                  <span className="uso-kicker">Destino</span>
                  <b>{row.kind === 'TERMINO' ? 'Fiscalización regularizará la baja fuera de Atlas' : 'Fiscalización tramitará el candidato fuera de Atlas'}</b>
                  <p>
                    {row.kind === 'TERMINO'
                      ? 'Al finalizar, el estado quedará Dar de baja. Podrás volver a abrir la ficha y corregir datos o comentarios.'
                      : 'Al marcar candidato, el flujo analítico termina y el estado quedará Candidato. La ficha seguirá editable.'}
                  </p>
                </div>
                <div className="uso-step-action-buttons">
                  <button className="btn btn-primary" disabled={!canEdit || !record.managementResult} onClick={finish}>
                    {terminal ? 'Guardar modificaciones' : row.kind === 'TERMINO' ? 'Finalizar gestión' : 'Marcar como candidato'}
                  </button>
                  <button className="btn" disabled={!canEdit} onClick={pause}>Pendiente</button>
                  <button className="btn uso-release" disabled={!canEdit} onClick={cancel}>Anular gestión</button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function PotentialContext({ row, compact = false }: { row: CaseRow; compact?: boolean }) {
  const c = row.candidate;
  return (
    <div className={`uso-flow-context uso-potential-context${compact ? ' uso-potential-context-compact' : ''}`}>
      <div>
        <span className="uso-kicker">Por qué aparece como Potencial SO</span>
        <b>{row.subject.motive}</b>
        <p>Es una señal para revisión registral, no una conclusión de obligación ni de incumplimiento.</p>
      </div>
      {c && !compact && (
        <div className="uso-fields uso-case-snapshot-fields">
          <Field label="Actividad coincidente" wide>{c.matched_activity ? titleCase(c.matched_activity) : '—'}</Field>
          <Field label="Sector sugerido">{c.implied_sector ? titleCase(c.implied_sector) : '—'}</Field>
          <Field label="Estado SII">{c.sii_status === 'ACTIVE_AS_PUBLISHED' ? 'Activo' : titleCase((c.sii_status ?? '—').replace(/_/g, ' '))}</Field>
          <Field label="Inicio de actividades">{c.sii_activity_start_date ? fecha(c.sii_activity_start_date) : '—'}</Field>
          <Field label="IVO / prioridad">{c.ivo_score != null ? n1(c.ivo_score) : c.selection_rank != null ? `Muestra #${n(c.selection_rank)}` : '—'}</Field>
          <Field label="Trabajadores">{c.workers != null ? n(c.workers) : '—'}</Field>
        </div>
      )}
    </div>
  );
}
