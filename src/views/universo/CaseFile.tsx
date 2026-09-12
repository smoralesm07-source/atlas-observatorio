import { useEffect, useRef, useState, type RefObject } from 'react';
import {
  CONTACT_FIELDS, KIND_META, PRIORITIES, STATE_FLOW, STATE_META,
  type CaseContact, type CasePriority, type CaseRecord,
  caseSummaryText, contactFilled, isTracked,
} from '../../lib/casework';
import { rutForms } from '../../lib/osint';
import { desde, fecha, n, n1, titleCase } from '../../lib/format';
import { CopyButton, Field, Pill, SectionHead } from './bits';
import type { CaseRow } from './model';
import { OpenContactPanel } from './OpenContactPanel';
import '../../styles/universo-case-flow.css';
import '../../styles/universo-case-review.css';

const REVIEW_LABEL: Record<string, string> = {
  CANDIDATO_SELECCIONADO: 'Seleccionado como candidato',
  DESCARTADO: 'Descartado en revisión',
  EN_REVISION: 'En revisión',
  PENDIENTE: 'Pendiente de revisión',
};

const TIER_LABEL: Record<string, string> = {
  A_ALTA: 'Coincidencia de giro alta',
  B_MEDIA: 'Coincidencia de giro media',
  C_BAJA: 'Coincidencia de giro baja',
  EVIDENCIA_3_MAS: '3 o más actividades coincidentes',
  EVIDENCIA_2: '2 actividades coincidentes',
  EVIDENCIA_1: '1 actividad coincidente',
};

// Consulta pública oficial del SII. Se abre fuera de Atlas porque el formulario
// exige interacción humana; Atlas sólo facilita el salto y copia el RUT.
const SII_THIRD_PARTY_URL = 'https://zeus.sii.cl/cvc/stc/stc.html';

export function CaseFile({
  row, onPatch, onEntity, onSector,
}: {
  row: CaseRow;
  onPatch: (patch: Partial<Pick<CaseRecord, 'state' | 'priority' | 'note'>> & { contact?: Partial<CaseContact> }) => void;
  onEntity?: () => void;
  onSector?: (sector: string) => void;
}) {
  const record = row.record;
  const kind = KIND_META[row.kind];
  const state = STATE_META[record.state];
  const { dotted } = rutForms(row.subject.rut);
  const tracked = isTracked(record);
  const released = record.state === 'DEVUELTO';
  const finalized = record.state === 'FINALIZADO';
  const locked = tracked && record.isMine === false;
  const canEdit = tracked && !locked && !finalized;
  const owner = record.assignedName || record.assignedEmail || null;

  const [contactDraft, setContactDraft] = useState<CaseContact>(() => ({ ...record.contact }));
  const [noteDraft, setNoteDraft] = useState(record.note);
  const [siiCopied, setSiiCopied] = useState(false);
  const locateRef = useRef<HTMLDivElement>(null);
  const registerRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setContactDraft({ ...record.contact });
    setNoteDraft(record.note);
    setSiiCopied(false);
  }, [row.key, record.contact, record.note]);

  const filled = contactFilled(contactDraft);
  const noteDirty = noteDraft !== record.note;
  const score = row.candidate?.ivo_score ?? row.termination?.ipf_score ?? null;
  const scoreLabel = row.candidate ? 'IVO' : 'IPF';
  const selectionRank = row.candidate?.selection_rank ?? null;

  const jump = (ref: RefObject<HTMLDivElement>) => {
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const saveContactField = (key: keyof CaseContact) => {
    const value = contactDraft[key];
    if (value !== record.contact[key]) onPatch({ contact: { [key]: value } });
  };

  const saveNote = () => {
    if (noteDraft !== record.note) onPatch({ note: noteDraft });
  };

  const clearContact = () => {
    const empty: CaseContact = { telefono: '', correo: '', sitio: '', direccion: '', persona: '', fuente: '' };
    setContactDraft(empty);
    onPatch({ contact: empty });
  };

  const openAtlas360 = () => {
    // Si la cola ya trae entity_id, abre directamente el expediente 360. Si no,
    // la búsqueda federada por RUT resuelve primero la identidad canónica.
    const target = row.subject.entityId
      ? `#/entidad/${encodeURIComponent(row.subject.entityId)}`
      : `#/entidades?q=${encodeURIComponent(dotted)}`;
    const opened = window.open(target, '_blank', 'noopener,noreferrer');
    // Algunos navegadores corporativos bloquean nuevas pestañas. En ese caso se
    // conserva la navegación histórica de Atlas cuando ya existe entity_id.
    if (!opened && row.subject.entityId && onEntity) onEntity();
  };

  const openSiiThirdParty = () => {
    // Abrir primero evita que el navegador bloquee la pestaña por esperar una
    // promesa del portapapeles. El analista pega el RUT y completa el CAPTCHA.
    window.open(SII_THIRD_PARTY_URL, '_blank', 'noopener,noreferrer');
    if (!navigator.clipboard?.writeText) return;
    void navigator.clipboard.writeText(dotted).then(() => {
      setSiiCopied(true);
      window.setTimeout(() => setSiiCopied(false), 2600);
    }).catch(() => undefined);
  };

  return (
    <section className="uso-case uso-case-progressive" aria-label={`Ficha de gestión de ${row.subject.name || dotted}`}>
      <header className="uso-case-head">
        <div className="uso-case-id">
          <div className="uso-case-badges">
            <Pill tone={kind.tone}>{kind.short}</Pill>
            <Pill tone={state.tone}>{state.label}</Pill>
            {record.priority !== 'MEDIA' && (
              <Pill tone={PRIORITIES.find((p) => p.key === record.priority)?.tone}>
                Prioridad {record.priority.toLowerCase()}
              </Pill>
            )}
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
          <CopyButton text={dotted} label="RUT" done="RUT copiado" small title="Copiar el RUT para pegarlo en un formulario" />
          <CopyButton text={caseSummaryText(record)} label="Ficha" done="Ficha copiada" small title="Copiar la ficha de gestión en texto" />
          <button className="btn btn-sm" onClick={openAtlas360} title={row.subject.entityId ? 'Abrir Ficha 360 en una pestaña nueva' : 'Resolver la entidad por RUT y abrir su Ficha 360'}>
            {row.subject.entityId ? 'Entidad 360 ↗' : 'Buscar 360 ↗'}
          </button>
        </div>
      </header>

      {!tracked ? (
        <div className="uso-case-body uso-case-snapshot">
          <p className="uso-case-motive">{row.subject.motive}</p>
          {row.candidate ? <PotentialSnapshot row={row} /> : <TerminationSnapshot row={row} />}
        </div>
      ) : (
        <details className="uso-case-summary">
          <summary>
            <span>
              <b>Resumen del caso</b>
              <em>{row.subject.motive}</em>
            </span>
            {score != null
              ? <strong>{scoreLabel} {n1(score)}</strong>
              : selectionRank != null ? <strong>Muestra #{n(selectionRank)}</strong> : null}
          </summary>
          <div className="uso-case-body uso-case-snapshot">
            {row.candidate ? <PotentialSnapshot row={row} /> : <TerminationSnapshot row={row} />}
          </div>
        </details>
      )}

      <div className="uso-case-review" data-mode={!tracked ? 'preclaim' : 'active'}>
        <div className="uso-case-review-copy">
          <span className="uso-kicker">{tracked ? 'Revisión complementaria' : 'Antes de tomar el caso'}</span>
          <b>
            {row.subject.entityId
              ? 'Revisa la Ficha 360 y contrasta el estado tributario actual.'
              : 'Resuelve la entidad por RUT y revisa su contexto antes de asignártela.'}
          </b>
          <em>
            La consulta SII se abre en el sitio oficial. Atlas copia el RUT para pegarlo allí; la validación del formulario se completa manualmente.
          </em>
        </div>
        <div className="uso-case-review-actions">
          <button className="btn btn-sm uso-case-review-360" onClick={openAtlas360}>
            {row.subject.entityId ? 'Abrir Ficha 360 ↗' : 'Buscar Ficha 360 ↗'}
          </button>
          <button
            className="btn btn-sm uso-case-review-sii"
            data-copied={siiCopied ? 'true' : undefined}
            onClick={openSiiThirdParty}
            title="Abrir Consulta situación tributaria de terceros del SII"
          >
            {siiCopied ? 'SII abierto · RUT copiado' : 'Consulta SII ↗'}
          </button>
        </div>
      </div>

      <div className="uso-case-assignment" data-mode={!tracked ? 'open' : locked ? 'other' : 'mine'}>
        {!tracked ? (
          <>
            <div>
              <span className="uso-kicker">{released ? 'Disponible nuevamente' : 'Disponible para gestión'}</span>
              <b>{released ? 'Devuelto al universo sin gestión activa' : 'Nadie está atendiendo este caso'}</b>
              <em>{released && owner
                ? `Revisado antes por ${owner}${record.updatedAt ? ` · devuelto ${desde(record.updatedAt)}` : ''}. La traza se conserva.`
                : 'Revisa primero la Ficha 360 y, si necesitas un contraste actualizado, la consulta del SII. Tómalo sólo cuando vayas a trabajarlo; quedará asignado a ti y saldrá de la cola pendiente.'}</em>
            </div>
            <button className="btn btn-sm btn-primary" onClick={() => onPatch({ state: 'EN_UBICACION' })}>
              {released ? 'Retomar caso' : 'Tomar caso'}
            </button>
          </>
        ) : (
          <>
            <div className="uso-owner-avatar" aria-hidden>{(owner ?? '?').slice(0, 1).toUpperCase()}</div>
            <div>
              <span className="uso-kicker">{record.isMine ? 'Asignado a ti' : 'Caso en atención'}</span>
              <b>{record.isMine ? 'Tú' : owner}</b>
              <em>{STATE_META[record.state].label}{record.assignedAt ? ` · tomado ${desde(record.assignedAt)}` : ''}</em>
            </div>
            {locked && <span className="uso-readonly">Sólo lectura</span>}
          </>
        )}
      </div>

      {tracked && (
        <div className="uso-case-management" aria-live="polite">
          <nav className="uso-case-jumpbar" aria-label="Navegación de la gestión">
            <button onClick={() => jump(locateRef)}><i>1</i><span>Ubicar</span></button>
            <button onClick={() => jump(registerRef)}><i>2</i><span>Registrar</span></button>
            <button onClick={() => jump(closeRef)}><i>3</i><span>Cerrar</span></button>
            <strong>{STATE_META[record.state].label}</strong>
          </nav>

          <div className="uso-case-body uso-management-state">
            <div className="uso-flow uso-flow-compact" role="group" aria-label="Avance de la gestión">
              {STATE_FLOW.map((key, index) => {
                const meta = STATE_META[key];
                const done = meta.step <= state.step && record.state !== 'DESCARTADO' && record.state !== 'SIN_UBICAR' && record.state !== 'DEVUELTO';
                return (
                  <button
                    key={key}
                    data-on={record.state === key}
                    data-done={done ? 'true' : undefined}
                    style={{ ['--flow-tone' as string]: meta.tone }}
                    disabled={!canEdit || key === 'SIN_TRABAJAR'}
                    onClick={() => onPatch({ state: key })}
                  >
                    <i>{index + 1}</i>
                    <span>{meta.short}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div ref={locateRef} className="uso-case-anchor">
            <OpenContactPanel row={row} onPatch={onPatch} readOnly={!canEdit} />
          </div>

          <div ref={registerRef} className="uso-case-body uso-management-capture uso-case-anchor">
            <SectionHead
              title="Registrar gestión"
              hint="Completa sólo lo útil para contactar o dejar traza. Los campos se guardan al salir de ellos."
            />
            <div className="uso-contact">
              {CONTACT_FIELDS.map((field) => (
                <label key={field.key} className="uso-contact-field">
                  <span>{field.label}</span>
                  <input
                    type={field.type}
                    value={contactDraft[field.key]}
                    placeholder={field.placeholder}
                    disabled={!canEdit}
                    onChange={(e) => setContactDraft((current) => ({ ...current, [field.key]: e.target.value }))}
                    onBlur={() => saveContactField(field.key)}
                  />
                </label>
              ))}
            </div>
            <div className="uso-contact-foot">
              <span className="uso-contact-meter" aria-hidden><i style={{ width: `${(filled / CONTACT_FIELDS.length) * 100}%` }} /></span>
              <em>{filled} de {CONTACT_FIELDS.length} campos con dato</em>
              {filled > 0 && <button className="uso-linkish" disabled={!canEdit} onClick={clearContact}>Limpiar contacto</button>}
            </div>

            <div className="uso-management-meta">
              <div className="uso-priority" role="group" aria-label="Prioridad del caso">
                <span>Prioridad</span>
                <div className="seg seg-sm">
                  {PRIORITIES.map((p) => (
                    <button
                      key={p.key}
                      data-on={record.priority === p.key}
                      disabled={!canEdit}
                      onClick={() => onPatch({ priority: p.key as CasePriority })}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              <label className="uso-note-field uso-note-draft">
                <span>Nota de gestión</span>
                <textarea
                  value={noteDraft}
                  maxLength={600}
                  disabled={!canEdit}
                  placeholder="Qué se intentó, con quién se habló y qué falta."
                  onChange={(e) => setNoteDraft(e.target.value)}
                  onBlur={saveNote}
                />
                <div className="uso-note-foot">
                  <em>{noteDraft.length}/600 · {noteDirty ? 'cambios sin guardar' : `guardado ${desde(record.updatedAt)}`}</em>
                  <button className="btn btn-sm" disabled={!canEdit || !noteDirty} onClick={saveNote}>Guardar nota</button>
                </div>
              </label>
            </div>
          </div>

          <div ref={closeRef} className="uso-case-body uso-management-close uso-case-anchor">
            <SectionHead title="Cerrar o devolver" hint="Resuelve la gestión cuando ya tengas un resultado suficiente." />
            <div className="uso-case-resolution" data-finalized={finalized ? 'true' : undefined}>
              <div>
                <span className="uso-kicker">Resultado del caso</span>
                <b>{finalized ? 'Gestión finalizada' : STATE_META[record.state].label}</b>
                <em>{finalized
                  ? `Contacto logrado${record.contactedAt ? ` · ${fecha(record.contactedAt)}` : ''}. El caso queda cerrado en Gestión SO.`
                  : record.state === 'CONTACTADO'
                    ? 'El contacto está registrado. Puedes finalizar la gestión.'
                    : 'Si no corresponde continuar, puedes marcar no ubicable, descartar o devolver el caso.'}</em>
              </div>
              {!finalized && (
                <div className="uso-case-resolution-actions">
                  <button className="btn btn-sm btn-primary uso-finalize" disabled={!canEdit || record.state !== 'CONTACTADO'} onClick={() => onPatch({ state: 'FINALIZADO' })}>
                    Finalizar gestión
                  </button>
                  <button className="btn btn-sm" disabled={!canEdit} onClick={() => onPatch({ state: 'SIN_UBICAR' })}>No ubicable</button>
                  <button className="btn btn-sm" disabled={!canEdit} onClick={() => onPatch({ state: 'DESCARTADO' })}>Descartar</button>
                  <button
                    className="btn btn-sm uso-release"
                    disabled={!canEdit}
                    onClick={() => {
                      if (window.confirm('El caso volverá al universo sin gestión activa. Se conservará la traza de esta revisión. ¿Continuar?')) onPatch({ state: 'DEVUELTO' });
                    }}
                  >
                    Devolver al universo
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function PotentialSnapshot({ row }: { row: CaseRow }) {
  const c = row.candidate;
  if (!c) return <p className="uso-note">El detalle del candidato no está cargado en esta sesión.</p>;

  return (
    <>
      <div className="uso-score uso-case-snapshot-score">
        <div className="uso-score-main">
          {c.ivo_score != null ? (
            <>
              <span className="uso-kicker">IVO · índice de verosimilitud de obligación</span>
              <b className="num">{n1(c.ivo_score)}</b>
              <em>
                banda {titleCase(c.ivo_band ?? '—')}
                {c.ivo_credibility_pct != null && ` · credibilidad ${n1(c.ivo_credibility_pct)}%`}
              </em>
              <span className="uso-score-track" aria-hidden><i style={{ width: `${Math.min(100, c.ivo_score)}%` }} /></span>
              <p>Ordena revisión cuando existe evidencia suficiente para calcularlo. No acredita obligación ni riesgo LA/FT.</p>
            </>
          ) : (
            <>
              <span className="uso-kicker">Prioridad metodológica · muestra Gestión SO</span>
              <b className="num">#{n(c.selection_rank)}</b>
              <em>{c.selection_basis ? titleCase(c.selection_basis.replace(/_/g, ' ')) : 'selección estratificada'}</em>
              <p>{c.selection_reason ?? 'Seleccionado por la regla reproducible de la muestra operativa.'}</p>
              <p className="uso-note">No se muestra IVO porque esta entidad no cuenta con evidencia suficiente para calcularlo de forma independiente.</p>
            </>
          )}
        </div>
      </div>

      <div className="uso-fields uso-case-snapshot-fields">
        <Field label="Actividad coincidente" wide>{c.matched_activity ? titleCase(c.matched_activity) : '—'}</Field>
        <Field label="Nivel de evidencia">{TIER_LABEL[c.detection_tier ?? ''] ?? (c.detection_tier ? titleCase(c.detection_tier.replace(/_/g, ' ')) : '—')}</Field>
        <Field label="Materialidad">{n1(c.materiality_score)}</Field>
        <Field label="Estado SII">{c.sii_status === 'ACTIVE_AS_PUBLISHED' ? 'Activo' : titleCase((c.sii_status ?? '—').replace(/_/g, ' '))}</Field>
        <Field label="Tamaño">{c.sales_band_uf ?? '—'}{c.workers != null && <em className="uso-field-sub">{n(c.workers)} trabajadores</em>}</Field>
      </div>

      <div className="uso-chips uso-case-snapshot-chips">
        {c.res_available && <Pill tone="var(--class-official)">Constitución RES verificable</Pill>}
        {c.uaf_sanction_events > 0 && <Pill tone="var(--sig-critical)">{n(c.uaf_sanction_events)} evento(s) sancionatorio(s)</Pill>}
        {(c.flags ?? []).slice(0, 3).map((flag) => <Pill key={flag} tone="var(--ink-3)">{titleCase(flag.replace(/_/g, ' '))}</Pill>)}
      </div>

      {c.review_state && (
        <p className="uso-note uso-case-snapshot-note">
          Revisión registrada: <b>{REVIEW_LABEL[c.review_state] ?? titleCase(c.review_state.replace(/_/g, ' '))}</b>
          {c.reviewed_at && ` · ${fecha(c.reviewed_at)}`}
        </p>
      )}
    </>
  );
}

function TerminationSnapshot({ row }: { row: CaseRow }) {
  const s = row.termination;
  if (!s) {
    return <p className="uso-note">La fila del corte no está cargada en esta sesión. Abre la cola de término de giro para refrescar su caracterización.</p>;
  }

  return (
    <>
      <div className="uso-score uso-case-snapshot-score">
        <div className="uso-score-main">
          <span className="uso-kicker">IPF · prioridad fiscalizadora</span>
          <b className="num">{n1(s.ipf_score)}</b>
          <em>
            {s.ipf_band ? `banda ${titleCase(s.ipf_band.replace(/_/g, ' '))}` : 'sin banda'}
            {s.ipf_percentile != null && ` · percentil ${n1(s.ipf_percentile)} del padrón`}
          </em>
          <span className="uso-score-track" aria-hidden><i style={{ width: `${Math.min(100, s.ipf_score ?? 0)}%` }} /></span>
          <p>Ordena esfuerzo de fiscalización. No es probabilidad de LA/FT.</p>
        </div>
        <div className="uso-score-parts uso-score-marks">
          <div><span>Antecedentes de sanción</span><b className="num">{n(s.sanction_evidence_count)}</b><em>{s.sanction_last_date ? `último ${fecha(s.sanction_last_date)}` : 'sin fecha'}</em></div>
          <div><span>Menciones en prensa</span><b className="num">{n(s.press_evidence_count)}</b><em>{s.has_press ? 'coincidencia por identidad' : 'sin coincidencia'}</em></div>
          <div><span>Señales abiertas</span><b className="num">{n(s.alert_count)}</b><em>{n(s.evidence_count)} antecedentes en total</em></div>
        </div>
      </div>

      {(s.is_osfl || s.is_state_supplier || s.sanction_count > 0) && (
        <div className="uso-chips uso-case-snapshot-chips">
          {s.is_osfl && <Pill tone="var(--unknown)">También OSFL</Pill>}
          {s.is_state_supplier && <Pill tone="var(--class-official)">Proveedor del Estado</Pill>}
          {s.sanction_count > 0 && <Pill tone="var(--sig-critical)">Sanción atribuida en padrón</Pill>}
        </div>
      )}
    </>
  );
}
