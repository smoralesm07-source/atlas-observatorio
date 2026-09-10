import { useEffect, useRef } from 'react';
import {
  CONTACT_FIELDS, KIND_META, PRIORITIES, STATE_FLOW, STATE_META,
  type CaseContact, type CasePriority, type CaseRecord, type CaseState,
  caseSummaryText, contactFilled, isTracked,
} from '../../lib/casework';
import { rutForms } from '../../lib/osint';
import { desde, fecha, n, n1, titleCase } from '../../lib/format';
import { CopyButton, Field, Pill, SectionHead } from './bits';
import type { CaseRow } from './model';
import { OpenContactPanel } from './OpenContactPanel';
import '../../styles/universo-case-flow.css';

/* FICHA DE GESTIÓN · FLUJO PROGRESIVO
   Antes de tomar un caso se muestra sólo lo necesario para decidir: identidad,
   motivo, prioridad/señales y disponibilidad. Al tomarlo, la superficie de
   trabajo se despliega debajo sin cambiar de pestaña ni de contexto. */

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
};

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
  const filled = contactFilled(record.contact);
  const tracked = isTracked(record);
  const released = record.state === 'DEVUELTO';
  const finalized = record.state === 'FINALIZADO';
  const locked = tracked && record.isMine === false;
  const canEdit = tracked && !locked && !finalized;
  const owner = record.assignedName || record.assignedEmail || null;
  const managementRef = useRef<HTMLDivElement>(null);
  const wasTracked = useRef(tracked);

  useEffect(() => {
    const justClaimed = tracked && !wasTracked.current && record.isMine !== false;
    wasTracked.current = tracked;
    if (!justClaimed) return;
    window.requestAnimationFrame(() => {
      managementRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, [tracked, record.isMine]);

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
          {onEntity && <button className="btn btn-sm" onClick={onEntity}>Entidad 360 ↗</button>}
        </div>
      </header>

      <div className="uso-case-body uso-case-snapshot">
        <p className="uso-case-motive">{row.subject.motive}</p>
        {row.candidate ? <PotentialSnapshot row={row} /> : <TerminationSnapshot row={row} />}
      </div>

      <div className="uso-case-assignment" data-mode={!tracked ? 'open' : locked ? 'other' : 'mine'}>
        {!tracked ? (
          <>
            <div>
              <span className="uso-kicker">{released ? 'Disponible nuevamente' : 'Disponible para gestión'}</span>
              <b>{released ? 'Devuelto al universo sin gestión activa' : 'Nadie está atendiendo este caso'}</b>
              <em>{released && owner
                ? `Revisado antes por ${owner}${record.updatedAt ? ` · devuelto ${desde(record.updatedAt)}` : ''}. La traza se conserva.`
                : 'Al tomarlo saldrá de la cola pendiente y el equipo verá que quedó asignado a ti.'}</em>
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
        <div ref={managementRef} className="uso-case-management fade-in" aria-live="polite">
          <div className="uso-case-body uso-management-state">
            <SectionHead
              title="Estado de la gestión"
              hint="Avanza el caso desde la ubicación hasta el contacto, sin abandonar esta ficha."
            />
            <div className="uso-flow" role="group" aria-label="Avance de la gestión">
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
            <div className="uso-flow-alt">
              {(['SIN_UBICAR', 'DESCARTADO'] as CaseState[]).map((key) => (
                <button
                  key={key}
                  data-on={record.state === key}
                  style={{ ['--flow-tone' as string]: STATE_META[key].tone }}
                  disabled={!canEdit}
                  onClick={() => onPatch({ state: key })}
                >
                  {STATE_META[key].label}
                </button>
              ))}
            </div>
          </div>

          <OpenContactPanel row={row} onPatch={onPatch} readOnly={!canEdit} />

          <div className="uso-case-body uso-management-capture">
            <SectionHead
              title="Datos de contacto encontrados"
              hint="Consolida aquí sólo los datos que usarás en la gestión y conserva su fuente."
            />
            <div className="uso-contact">
              {CONTACT_FIELDS.map((field) => (
                <label key={field.key} className="uso-contact-field">
                  <span>{field.label}</span>
                  <input
                    type={field.type}
                    value={record.contact[field.key]}
                    placeholder={field.placeholder}
                    disabled={!canEdit}
                    onChange={(e) => onPatch({ contact: { [field.key]: e.target.value } })}
                  />
                </label>
              ))}
            </div>
            <div className="uso-contact-foot">
              <span className="uso-contact-meter" aria-hidden>
                <i style={{ width: `${(filled / CONTACT_FIELDS.length) * 100}%` }} />
              </span>
              <em>{filled} de {CONTACT_FIELDS.length} campos capturados</em>
              {filled > 0 && (
                <button
                  className="uso-linkish"
                  disabled={!canEdit}
                  onClick={() => onPatch({ contact: { telefono: '', correo: '', sitio: '', direccion: '', persona: '', fuente: '' } })}
                >
                  Limpiar contacto
                </button>
              )}
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

              <label className="uso-note-field">
                <span>Nota de gestión</span>
                <textarea
                  value={record.note}
                  maxLength={600}
                  disabled={!canEdit}
                  placeholder="Qué se intentó, con quién se habló, qué falta."
                  onChange={(e) => onPatch({ note: e.target.value })}
                />
                <em>{record.note.length}/600 · actualizado {desde(record.updatedAt)}</em>
              </label>
            </div>

            <div className="uso-case-resolution" data-finalized={finalized ? 'true' : undefined}>
              <div>
                <span className="uso-kicker">Cierre de la gestión</span>
                <b>{finalized ? 'Gestión finalizada' : 'Resultado del caso'}</b>
                <em>{finalized
                  ? `Contacto logrado${record.contactedAt ? ` · ${fecha(record.contactedAt)}` : ''}. El caso queda cerrado en Gestión SO.`
                  : record.state === 'CONTACTADO'
                    ? 'El contacto ya fue registrado. Finaliza cuando la gestión haya concluido.'
                    : 'Finalizar se habilita después de registrar contacto. También puedes devolver el caso al universo.'}</em>
              </div>
              {!finalized && (
                <div className="uso-case-resolution-actions">
                  <button
                    className="btn btn-sm btn-primary uso-finalize"
                    disabled={!canEdit || record.state !== 'CONTACTADO'}
                    onClick={() => onPatch({ state: 'FINALIZADO' })}
                    title={record.state !== 'CONTACTADO' ? 'Primero registra el estado Contactado' : 'Cerrar la gestión como exitosa'}
                  >
                    Finalizar gestión
                  </button>
                  <button
                    className="btn btn-sm uso-release"
                    disabled={!canEdit}
                    onClick={() => {
                      if (window.confirm('El caso volverá al universo sin gestión activa. Se conservará la traza de esta revisión. ¿Continuar?')) {
                        onPatch({ state: 'DEVUELTO' });
                      }
                    }}
                  >
                    Devolver al universo
                  </button>
                </div>
              )}
            </div>

            <p className="uso-note uso-management-footnote">
              La gestión se guarda con responsable, estado y trazabilidad. El resto del equipo puede ver el avance;
              sólo el responsable del caso puede modificarlo.
            </p>
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
          <span className="uso-kicker">IVO · índice de verosimilitud de obligación</span>
          <b className="num">{n1(c.ivo_score)}</b>
          <em>
            banda {titleCase(c.ivo_band ?? '—')}
            {c.ivo_credibility_pct != null && ` · credibilidad ${n1(c.ivo_credibility_pct)}%`}
          </em>
          <span className="uso-score-track" aria-hidden>
            <i style={{ width: `${Math.min(100, c.ivo_score ?? 0)}%` }} />
          </span>
          <p>Ordena revisión. No acredita obligación ni riesgo LA/FT.</p>
        </div>
      </div>

      <div className="uso-fields uso-case-snapshot-fields">
        <Field label="Actividad coincidente" wide>{c.matched_activity ? titleCase(c.matched_activity) : '—'}</Field>
        <Field label="Nivel de detección">{TIER_LABEL[c.detection_tier ?? ''] ?? (c.detection_tier ? titleCase(c.detection_tier.replace(/_/g, ' ')) : '—')}</Field>
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
    return (
      <p className="uso-note">
        La fila del corte no está cargada en esta sesión. Abre la cola de término de giro para refrescar su caracterización.
      </p>
    );
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
          <span className="uso-score-track" aria-hidden>
            <i style={{ width: `${Math.min(100, s.ipf_score ?? 0)}%` }} />
          </span>
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
