import { useEffect, useState } from 'react';
import { useRpc } from '../lib/rpc';
import { fecha, n, rutFormat } from '../lib/format';
import { Empty, ErrorBox, Loading } from './primitives';
import type { UafCohort, UafDossier, UafSubjectRow } from '../lib/contracts';

export interface CohortRequest {
  cohort: UafCohort;
  value?: string | null;
  title: string;
  hint?: string;
}

const PAGE = 40;

/** El productor entrega el método de resolución en clave. Un antecedente que
 *  llegó por criterio conservador puede venir emitido bajo otra razón social
 *  del mismo RUT, así que la advertencia va en español y junto al hecho. */
function identityNote(status: string): string {
  switch (status) {
    case 'RESOLVED_CONSERVATIVE':
      return 'Vinculado por RUT con criterio conservador: el documento puede estar emitido bajo otra razón social del mismo contribuyente. Verifica la identidad antes de concluir.';
    case 'RESOLVED_EXACT_NAME':
      return 'Vinculado por coincidencia exacta de nombre, no por RUT. Verifica la identidad antes de concluir.';
    default:
      return 'Vínculo de identidad establecido por el productor. Verifica antes de concluir.';
  }
}

/** El tablero da cifras; esto da nombres. Una cohorte se abre sobre la vista
 *  para que el analista pueda pasar del cuánto al quiénes sin perder el
 *  encuadre, y de ahí al antecedente que sostiene cada marca. */
export function CohortDrawer({
  request,
  onClose,
  onOpenEntity,
}: {
  request: CohortRequest;
  onClose: () => void;
  onOpenEntity?: (entityId: string) => void;
}) {
  const [limit, setLimit] = useState(PAGE);
  const [openRut, setOpenRut] = useState<string | null>(null);

  const { data, error, loading, reload } = useRpc<UafSubjectRow[]>('obs_uaf_cohort', {
    p_cohort: request.cohort,
    p_value: request.value ?? null,
    p_limit: limit,
    p_offset: 0,
  });

  useEffect(() => {
    setLimit(PAGE);
    setOpenRut(null);
  }, [request.cohort, request.value]);

  // Cerrar con Escape es lo que espera cualquiera que abra una capa encima.
  // El fondo se congela mientras tanto: si sigue desplazandose bajo el velo, el
  // analista pierde el punto del tablero desde donde abrio la lista.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const previo = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previo;
    };
  }, [onClose]);

  const total = data?.[0]?.total_count ?? 0;

  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label={request.title}>
        <header className="drawer-head">
          <div style={{ minWidth: 0 }}>
            <h2>{request.title}</h2>
            <p>
              {loading && !data ? 'Consultando el padrón…' : `${n(total)} sujeto${total === 1 ? '' : 's'} obligado${total === 1 ? '' : 's'}`}
              {request.hint && ` · ${request.hint}`}
            </p>
          </div>
          <button className="drawer-close" onClick={onClose} aria-label="Cerrar">
            ×
          </button>
        </header>

        <div className="drawer-body">
          {error ? (
            <ErrorBox error={error} onRetry={reload} />
          ) : loading && !data ? (
            <Loading label="Leyendo el padrón…" />
          ) : !data?.length ? (
            <Empty
              title="Sin sujetos en este corte"
              hint="Ningún sujeto obligado cumple esta condición en el snapshot vigente."
            />
          ) : (
            <>
              <div className="rows">
                {data.map((s) => (
                  <SubjectRow
                    key={s.rut}
                    subject={s}
                    open={openRut === s.rut}
                    onToggle={() => setOpenRut(openRut === s.rut ? null : s.rut)}
                    onOpenEntity={onOpenEntity}
                  />
                ))}
              </div>
              {data.length < total && (
                <div style={{ padding: 16, display: 'flex', justifyContent: 'center' }}>
                  <button className="btn" onClick={() => setLimit((v) => Math.min(200, v + PAGE))}>
                    {limit >= 200
                      ? 'Máximo de 200 en pantalla · afina el corte'
                      : `Ver más · ${n(total - data.length)} restantes`}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </aside>
    </>
  );
}

function SubjectRow({
  subject: s,
  open,
  onToggle,
  onOpenEntity,
}: {
  subject: UafSubjectRow;
  open: boolean;
  onToggle: () => void;
  onOpenEntity?: (entityId: string) => void;
}) {
  const marks: string[] = [];
  if (s.sii_termination_date) marks.push(`término de giro ${fecha(s.sii_termination_date)}`);
  if (s.is_osfl) marks.push('OSFL');
  if (s.is_state_supplier) marks.push('proveedor del Estado');
  if (s.sanction_evidence_count > 0) marks.push(`${s.sanction_evidence_count} sanción${s.sanction_evidence_count === 1 ? '' : 'es'}`);
  if (s.press_evidence_count > 0) marks.push(`${s.press_evidence_count} en prensa`);

  return (
    <div style={{ borderBottom: '1px solid var(--line-soft)' }}>
      <button className="row-entity" style={{ borderBottom: 0 }} onClick={onToggle}>
        <div style={{ minWidth: 0 }}>
          <div className="row-name">{s.name}</div>
          <div className="row-meta">
            <span className="rut">{rutFormat(s.rut)}</span>
            {s.uaf_sector && <span>{s.uaf_sector}</span>}
            {s.region && <span>{s.commune ? `${s.commune}, ${s.region}` : s.region}</span>}
            {s.igr_level && <span>IGR comunal {s.igr_level}</span>}
          </div>
          {marks.length > 0 && (
            <div className="row-meta" style={{ color: 'var(--ink-4)' }}>
              {marks.map((m) => (
                <span key={m}>{m}</span>
              ))}
            </div>
          )}
        </div>
        <div className="row-right">
          {s.ipf_band && (
            <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>
              IPF {s.ipf_band}
            </span>
          )}
          <span style={{ color: 'var(--ink-4)', fontSize: 12 }}>{open ? '▲' : '▼'}</span>
        </div>
      </button>
      {open && <SubjectDossier rut={s.rut} entityId={s.entity_id} onOpenEntity={onOpenEntity} />}
    </div>
  );
}

/** El antecedente, tal como lo publica su fuente. Cuando la fuente no entrega
 *  enlace, se dice: ofrecer un link inexistente seria peor que no ofrecerlo. */
function SubjectDossier({
  rut,
  entityId,
  onOpenEntity,
}: {
  rut: string;
  entityId: string | null;
  onOpenEntity?: (entityId: string) => void;
}) {
  const { data, error, loading } = useRpc<UafDossier>('obs_uaf_subject_dossier', { p_rut: rut });

  if (loading) return <div style={{ padding: '4px 18px 16px' }}><Loading label="Buscando antecedentes…" /></div>;
  if (error) return <div style={{ padding: '4px 18px 16px' }}><ErrorBox error={error} /></div>;

  const ev = data?.evidence ?? [];
  const s = data?.subject;

  return (
    <div style={{ padding: '2px 18px 16px', background: 'var(--bg-panel-2)' }}>
      {s && (
        <div className="row-meta" style={{ marginBottom: 12 }}>
          {s.sii_activity_start_date && <span>Inicio de actividades {fecha(s.sii_activity_start_date)}</span>}
          {s.activity_years != null && <span>{s.activity_years} años de actividad</span>}
          {s.economic_sector && <span>{s.economic_sector}</span>}
          {s.sales_band && <span>Ventas {s.sales_band}</span>}
          {s.workers != null && <span>{n(s.workers)} trabajadores</span>}
        </div>
      )}

      {ev.length === 0 ? (
        <p style={{ fontSize: 12, color: 'var(--ink-4)', margin: '4px 0 0' }}>
          Sin antecedentes de sanción ni de prensa en el corte vigente.
        </p>
      ) : (
        ev.map((e, i) => (
          <div className="ev-item" data-kind={e.kind} key={i}>
            <div className="ev-head">
              <span className="ev-src">{e.kind === 'SANCION' ? e.source_label ?? 'Sanción' : 'Prensa'}</span>
              <span className="ev-date">{fecha(e.event_date)}</span>
              {e.amount_uf != null && (
                <span className="ev-date">{n(e.amount_uf)} UF</span>
              )}
            </div>
            {e.headline && <p className="ev-title">{e.headline}</p>}
            {e.summary && e.summary !== e.headline && <p className="ev-sum">{e.summary}</p>}
            {/* La resolución por RUT puede traer un registro emitido bajo otra
                razón social: mismo contribuyente, nombre anterior, o un empate
                que hay que revisar. Callarlo dejaría al analista sin el dato
                que necesita para descartar. */}
            {e.identity_status && e.identity_status !== 'RESOLVED_SOURCE' && (
              <p className="ev-sum" style={{ color: 'var(--ink-4)' }}>
                {identityNote(e.identity_status)}
              </p>
            )}
            {e.has_link && e.document_url ? (
              <a className="ev-link" href={e.document_url} target="_blank" rel="noreferrer">
                Abrir documento original →
              </a>
            ) : (
              <span className="ev-nolink">
                La fuente no publica enlace para este registro.
              </span>
            )}
          </div>
        ))
      )}

      {entityId && onOpenEntity && (
        <button
          className="btn"
          style={{ marginTop: 10 }}
          onClick={() => onOpenEntity(entityId)}
        >
          Ver ficha completa de la entidad
        </button>
      )}
    </div>
  );
}
