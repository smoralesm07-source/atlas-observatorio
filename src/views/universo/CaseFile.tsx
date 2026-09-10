import { useState } from 'react';
import type { UafIvoComponent } from '../../lib/contracts';
import {
  CONTACT_FIELDS, KIND_META, PRIORITIES, STATE_FLOW, STATE_META,
  type CaseContact, type CasePriority, type CaseRecord, type CaseState,
  caseSummaryText, contactFilled,
} from '../../lib/casework';
import { LOCATE_FIRST_PASS, LOCATE_LIMIT, locateGroups, locateQueriesText, rutForms } from '../../lib/osint';
import { desde, fecha, n, n1, titleCase } from '../../lib/format';
import { CopyButton, Field, Pill, SectionHead } from './bits';
import type { CaseRow } from './model';

/* LA FICHA DE GESTIÓN
   ──────────────────
   Un caso se trabaja en tres movimientos y la ficha los pone en ese orden:
   por qué está en la mesa, cómo se ubica a la entidad, y qué se hizo con ella.
   Nada de lo que aparece aquí sale de Atlas por su cuenta: la ficha prepara el
   trabajo, la tramitación ocurre en el sistema institucional. */

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

const COHERENCE_LABEL: Record<string, string> = {
  COHERENTE: 'Tipo societario coherente con el sector',
  RARO: 'Tipo societario infrecuente en el sector',
  SIN_REFERENCIA_DE_TIPO: 'Sin referencia de tipo en el sector',
};

export function CaseFile({
  row, onPatch, onEntity, onSector,
}: {
  row: CaseRow;
  onPatch: (patch: Partial<Pick<CaseRecord, 'state' | 'priority' | 'note'>> & { contact?: Partial<CaseContact> }) => void;
  onEntity?: () => void;
  onSector?: (sector: string) => void;
}) {
  const [tab, setTab] = useState<'motivo' | 'ubicar' | 'gestion'>('motivo');
  const record = row.record;
  const kind = KIND_META[row.kind];
  const state = STATE_META[record.state];
  const { dotted } = rutForms(row.subject.rut);
  const filled = contactFilled(record.contact);

  return (
    <section className="uso-case" aria-label={`Ficha de gestión de ${row.subject.name || dotted}`}>
      <header className="uso-case-head">
        <div className="uso-case-id">
          <div className="uso-case-badges">
            <Pill tone={kind.tone}>{kind.short}</Pill>
            <Pill tone={state.tone}>{state.label}</Pill>
            {row.record.priority !== 'MEDIA' && (
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

      <nav className="uso-case-tabs" aria-label="Secciones de la ficha">
        <button data-on={tab === 'motivo'} onClick={() => setTab('motivo')}>Por qué es caso</button>
        <button data-on={tab === 'ubicar'} onClick={() => setTab('ubicar')}>Ubicar</button>
        <button data-on={tab === 'gestion'} onClick={() => setTab('gestion')}>
          Gestión
          {filled > 0 && <em>{filled}/{CONTACT_FIELDS.length}</em>}
        </button>
      </nav>

      {tab === 'motivo' && (
        <div className="uso-case-body fade-in">
          <p className="uso-case-motive">{row.subject.motive}</p>
          {row.candidate ? <PotentialWhy row={row} /> : <TerminationWhy row={row} />}
        </div>
      )}

      {tab === 'ubicar' && (
        <div className="uso-case-body fade-in">
          <SectionHead
            title="Ubicar en fuentes abiertas"
            hint="Consultas armadas con la razón social y el RUT de este caso. Se abren en una pestaña nueva."
            actions={(
              <CopyButton
                text={locateQueriesText({
                  rut: row.subject.rut, name: row.subject.name,
                  region: row.subject.region, commune: row.subject.commune, sector: row.subject.sector,
                })}
                label="Copiar consultas" done="Consultas copiadas" small
              />
            )}
          />
          {locateGroups({
            rut: row.subject.rut, name: row.subject.name,
            region: row.subject.region, commune: row.subject.commune, sector: row.subject.sector,
          }).map((group) => (
            <div className="uso-locate-group" key={group.id}>
              <div className="uso-locate-head">
                <b>{group.title}</b>
                <em>{group.purpose}</em>
              </div>
              <div className="uso-locate-links">
                {group.links.map((link) => (
                  <a
                    key={link.id} href={link.url} target="_blank" rel="noreferrer"
                    data-first={(LOCATE_FIRST_PASS as readonly string[]).includes(link.id) ? 'true' : undefined}
                    data-kind={link.kind}
                  >
                    <span>
                      <b>{link.label}</b>
                      {link.manual && <em className="uso-tag" data-tone="watch">pide el RUT</em>}
                    </span>
                    <em>{link.hint}</em>
                    <i aria-hidden>↗</i>
                  </a>
                ))}
              </div>
            </div>
          ))}
          <p className="uso-note">{LOCATE_LIMIT}</p>
        </div>
      )}

      {tab === 'gestion' && (
        <div className="uso-case-body fade-in">
          <SectionHead
            title="Datos de contacto encontrados"
            hint="Lo que se anota aquí viaja al CSV del lote. Es una propuesta de fuentes abiertas, no un dato acreditado."
          />
          <div className="uso-contact">
            {CONTACT_FIELDS.map((field) => (
              <label key={field.key} className="uso-contact-field">
                <span>{field.label}</span>
                <input
                  type={field.type}
                  value={record.contact[field.key]}
                  placeholder={field.placeholder}
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
                onClick={() => onPatch({ contact: { telefono: '', correo: '', sitio: '', direccion: '', persona: '', fuente: '' } })}
              >
                Limpiar contacto
              </button>
            )}
          </div>

          <SectionHead title="Estado de la gestión" hint="Describe el avance de la ubicación, no una decisión sobre el registro." />
          <div className="uso-flow" role="group" aria-label="Avance de la gestión">
            {STATE_FLOW.map((key, index) => {
              const meta = STATE_META[key];
              const done = meta.step <= state.step && record.state !== 'DESCARTADO' && record.state !== 'SIN_UBICAR';
              return (
                <button
                  key={key} data-on={record.state === key} data-done={done ? 'true' : undefined}
                  style={{ ['--flow-tone' as string]: meta.tone }}
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
                key={key} data-on={record.state === key}
                style={{ ['--flow-tone' as string]: STATE_META[key].tone }}
                onClick={() => onPatch({ state: record.state === key ? 'SIN_TRABAJAR' : key })}
              >
                {STATE_META[key].label}
              </button>
            ))}
          </div>

          <div className="uso-priority" role="group" aria-label="Prioridad del caso">
            <span>Prioridad</span>
            <div className="seg seg-sm">
              {PRIORITIES.map((p) => (
                <button
                  key={p.key} data-on={record.priority === p.key}
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
              value={record.note} maxLength={600}
              placeholder="Qué se intentó, con quién se habló, qué falta."
              onChange={(e) => onPatch({ note: e.target.value })}
            />
            <em>{record.note.length}/600 · actualizado {desde(record.updatedAt)}</em>
          </label>

          <p className="uso-note">
            La mesa vive en este navegador: no es un registro institucional ni se comparte con otras personas.
            El CSV del lote es la salida que continúa el trámite fuera de Atlas.
          </p>
        </div>
      )}
    </section>
  );
}

function PotentialWhy({ row }: { row: CaseRow }) {
  const c = row.candidate;
  if (!c) return null;
  const concentration = c.activity_concentration == null ? null : c.activity_concentration * 100;
  return (
    <>
      <div className="uso-score">
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
          <p>Ordena revisión. No es probabilidad de obligación ni de LA/FT.</p>
        </div>
        <div className="uso-score-parts">
          {(c.ivo_components ?? []).map((part: UafIvoComponent) => (
            <div key={part.code}>
              <span>{part.label}</span>
              <b className="num">{n1(part.value)}</b>
              <i aria-hidden><u style={{ width: `${Math.min(100, part.value)}%` }} /></i>
              <em>pesa {n(part.weight)} puntos del índice</em>
            </div>
          ))}
          {!(c.ivo_components ?? []).length && <p className="uso-note">El corte no publica el desglose del índice.</p>}
        </div>
      </div>

      <div className="uso-fields">
        <Field label="Actividad coincidente" wide>{c.matched_activity ? titleCase(c.matched_activity) : '—'}</Field>
        <Field label="Concentración del giro">
          {concentration == null ? '—' : `${n1(concentration)}%`}
          {c.activity_registered_n != null && c.activity_universe_n != null && (
            <em className="uso-field-sub">
              {n(c.activity_registered_n)} inscritos declaran este giro sobre {n(c.activity_universe_n)} RUT observados
            </em>
          )}
        </Field>
        <Field label="Nivel de detección">{TIER_LABEL[c.detection_tier ?? ''] ?? (c.detection_tier ? titleCase(c.detection_tier.replace(/_/g, ' ')) : '—')}</Field>
        <Field label="Tipo societario">{COHERENCE_LABEL[c.type_coherence_class ?? ''] ?? '—'}</Field>
        <Field label="Materialidad">
          {n1(c.materiality_score)}
          <em className="uso-field-sub">costo de incorporar al padrón; no mide gravedad</em>
        </Field>
        <Field label="Constitución verificable">
          {c.res_available ? `RES · ${fecha(c.res_constitution_date)}` : 'sin registro en el RES'}
        </Field>
        <Field label="Estado ante el SII">{c.sii_status === 'ACTIVE_AS_PUBLISHED' ? 'Activo' : titleCase((c.sii_status ?? '—').replace(/_/g, ' '))}</Field>
        <Field label="Antigüedad">{c.activity_years == null ? '—' : `${n(c.activity_years)} años`}</Field>
        <Field label="Tamaño">
          {c.sales_band_uf ?? '—'}
          {c.sales_band_size && <em className="uso-field-sub">{c.sales_band_size}</em>}
        </Field>
        <Field label="Personal">{c.workers == null ? '—' : `${n(c.workers)} trabajadores`}</Field>
        <Field label="Estructura">
          {c.ownership_edge_count == null ? '—' : `${n(c.ownership_edge_count)} vínculos`}
          {c.legal_entity_partner_count != null && <em className="uso-field-sub">{n(c.legal_entity_partner_count)} socios persona jurídica</em>}
        </Field>
        <Field label="Sanción UAF">
          {c.uaf_sanction_events > 0
            ? `${n(c.uaf_sanction_events)} evento(s) · último ${fecha(c.uaf_sanction_last_date)}`
            : 'sin evento en el corte'}
        </Field>
      </div>

      {(c.flags ?? []).length > 0 && (
        <div className="uso-chips">
          {(c.flags ?? []).map((flag) => <Pill key={flag} tone="var(--ink-3)">{titleCase(flag.replace(/_/g, ' '))}</Pill>)}
        </div>
      )}

      {c.review_state && (
        <p className="uso-note">
          Revisión registrada en Atlas: <b>{REVIEW_LABEL[c.review_state] ?? titleCase(c.review_state.replace(/_/g, ' '))}</b>
          {c.reviewed_at && ` · ${fecha(c.reviewed_at)}`}
          {c.reviewed_by_email && ` · ${c.reviewed_by_email}`}
          {c.review_rationale && ` · «${c.review_rationale}»`}
        </p>
      )}
      <p className="uso-note">
        Un giro compatible es una señal de screening: no acredita que la entidad reúna los elementos que la ley exige
        para inscribirse. La revisión la resuelve el fiscalizador con el antecedente en mano.
      </p>
    </>
  );
}

function TerminationWhy({ row }: { row: CaseRow }) {
  const s = row.termination;
  if (!s) {
    return (
      <p className="uso-note">
        Este caso viene de la cartera guardada en el navegador y su fila del corte no está cargada en esta sesión.
        Abre la cola de término de giro para volver a caracterizarlo.
      </p>
    );
  }
  return (
    <>
      <div className="uso-score">
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

      <div className="uso-fields">
        <Field label="Término de giro">{fecha(s.sii_termination_date)}</Field>
        <Field label="Inicio de actividades">{fecha(s.sii_activity_start_date)}</Field>
        <Field label="Años de actividad">{s.activity_years == null ? '—' : n(s.activity_years)}</Field>
        <Field label="Naturaleza">{titleCase((s.subject_nature ?? '—').replace(/_/g, ' '))}</Field>
        <Field label="Actividad declarada" wide>{s.main_activity ? titleCase(s.main_activity) : '—'}</Field>
        <Field label="Industria SII" wide>{s.economic_sector ? titleCase(s.economic_sector) : '—'}</Field>
        <Field label="Tramo de ventas">{s.sales_band ?? '—'}</Field>
        <Field label="Personal">{s.workers == null ? '—' : `${n(s.workers)} trabajadores`}</Field>
        <Field label="Entorno comunal (IGR)">
          {s.igr_level ?? 'sin nivel'}
          {s.igr_score != null && <em className="uso-field-sub">{n1(s.igr_score)} · describe la comuna, no al sujeto</em>}
        </Field>
        <Field label="Motivo de precedencia">{s.attention_motive ? titleCase(s.attention_motive.replace(/_/g, ' ')) : 'sin motivo asignado'}</Field>
      </div>

      <div className="uso-chips">
        {s.is_osfl && <Pill tone="var(--unknown)">También OSFL</Pill>}
        {s.is_state_supplier && (
          <Pill tone="var(--class-official)">
            Proveedor del Estado{s.supplier_amount_12m != null ? ` · ${n(Math.round(s.supplier_amount_12m / 1_000_000))} MM CLP 12m` : ''}
          </Pill>
        )}
        {s.sanction_count > 0 && <Pill tone="var(--sig-critical)">Sanción atribuida en el padrón</Pill>}
      </div>

      <p className="uso-note">
        El término de giro es un hecho tributario publicado por el SII: motiva revisar la desinscripción del padrón y no
        supone incumplimiento. La entidad puede seguir existiendo y la gestión sirve para confirmarlo.
      </p>
    </>
  );
}
