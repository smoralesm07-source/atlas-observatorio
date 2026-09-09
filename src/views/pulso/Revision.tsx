import type { UafAttentionRow, UafMotive, UafPulse } from '../../lib/contracts';
import { Bars } from '../../components/charts';
import { Empty, Panel } from '../../components/primitives';
import { fecha, n, n1, titleCase } from '../../lib/format';
import type { CohortRequest } from '../../components/CohortDrawer';

/* LENTE · REVISIÓN
   ────────────────
   La cola de trabajo del turno y todo lo que la ordena, junto: el motivo por el
   que cada sujeto entra, el índice que los prioriza, el cruce entre ambos y la
   caracterización que abre listas.

   El motivo ordena trabajo de fiscalización. No imputa incumplimiento,
   irregularidad ni riesgo LA/FT, y ninguna posición dentro del IPF lo hace. */

export const MOTIVE: Record<UafMotive, { label: string; hint: string }> = {
  SANCION_RECIENTE:  { label: 'Sanción últimos 5 años', hint: 'antecedente sancionatorio con resolución abrible' },
  SANCION_HISTORICA: { label: 'Sanción histórica',      hint: 'antecedente anterior a los últimos 5 años' },
  TERMINO_GIRO:      { label: 'Término de giro',        hint: 'cerró giro ante el SII y sigue inscrito en el padrón' },
  IPF_ALTA:          { label: 'IPF alta o muy alta',    hint: 'posición extrema del índice de priorización fiscalizadora' },
  SECTOR_SIN_ROS:    { label: 'Sector sin ROS 2021-2025', hint: 'su sector no registra ROS agregados en cinco años' },
  GIRO_ATIPICO:      { label: 'Giro atípico en su sector', hint: 'actividad principal poco frecuente entre sus pares' },
  SIN_TERRITORIO:    { label: 'Sin territorio observado', hint: 'persona jurídica sin comuna observable' },
};

const IPF_ORDER = [
  { key: 'MUY_ALTA', label: 'Muy alta', tone: 'critical' as const },
  { key: 'ALTA',     label: 'Alta',     tone: 'high' as const },
  { key: 'MEDIA',    label: 'Media',    tone: 'medium' as const },
  { key: 'BAJA',     label: 'Baja',     tone: 'watch' as const },
  { key: 'MINIMA',   label: 'Mínima',   tone: 'none' as const },
  { key: 'SIN_IPF',  label: 'Sin IPF (organismos públicos)', tone: 'none' as const },
];

export function LenteRevision({
  data,
  onCohort,
}: {
  data: UafPulse;
  onCohort: (req: CohortRequest) => void;
}) {
  const u = data.universe;
  const c = data.crosscuts;
  if (!u) return <Empty title="Sin padrón publicado" />;

  const cruce = data.attention.motivos
    .filter((m) => m.sujetos > 0)
    .slice()
    .sort((a, b) => b.con_ipf_alto - a.con_ipf_alto || b.sujetos - a.sujetos);
  const cruceMax = Math.max(1, ...cruce.map((m) => m.sujetos));

  return (
    <>
      <Panel
        title="Sujetos que piden revisión"
        meta={`${n(data.attention.total)} con motivo · se muestran los ${n(Math.min(12, data.attention.top.length))} de mayor precedencia`}
        pad={false}
        actions={
          <button className="btn" style={{ padding: '6px 12px', fontSize: 12 }}
            onClick={() => onCohort({ cohort: 'ATENCION', title: 'Sujetos que piden revisión', hint: 'ordenados por motivo de mayor precedencia' })}>
            Ver los {n(data.attention.total)}
          </button>
        }
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, padding: '14px 18px 10px' }}>
          {data.attention.motivos.map((m) => (
            <button
              key={m.motivo}
              className="chip"
              title={MOTIVE[m.motivo]?.hint}
              onClick={() => onCohort({
                cohort: 'MOTIVO', value: m.motivo,
                title: MOTIVE[m.motivo]?.label ?? m.motivo,
                hint: MOTIVE[m.motivo]?.hint,
              })}
            >
              <span className="motive" data-m={m.motivo} style={{ padding: 0, border: 0, background: 'none' }}><i /></span>
              {MOTIVE[m.motivo]?.label ?? m.motivo}
              <b className="num" style={{ color: 'var(--ink)' }}>{n(m.sujetos)}</b>
            </button>
          ))}
        </div>

        {data.attention.top.length === 0 ? (
          <Empty title="Ningún sujeto con motivo de revisión en este corte" />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Razón social</th>
                  <th>Sector obligado</th>
                  <th>Motivo de revisión</th>
                  <th>Territorio</th>
                  <th className="right">IPF</th>
                </tr>
              </thead>
              <tbody>
                {data.attention.top.slice(0, 12).map((r) => (
                  <AttentionRow key={r.rut} r={r} onOpen={() => onCohort({
                    cohort: 'MOTIVO', value: r.motivo,
                    title: MOTIVE[r.motivo]?.label ?? r.motivo,
                    hint: MOTIVE[r.motivo]?.hint,
                  })} />
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p style={{ margin: 0, padding: '12px 18px', fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.55, borderTop: '1px solid var(--line-soft)' }}>
          Un sujeto puede cumplir varias condiciones a la vez; se publica la de mayor
          precedencia para que la cola no repita al mismo nombre. El motivo ordena trabajo
          de fiscalización: no imputa incumplimiento, irregularidad ni riesgo LA/FT.
        </p>
      </Panel>

      <div className="pulse-grid-wide" style={{ margin: '16px 0' }}>
        <Panel title="Qué motivo concentra prioridad" meta="motivo × IPF alto o muy alto">
          <div className="cross-ipf">
            {cruce.map((m) => (
              <button
                key={m.motivo}
                className="cross-ipf-row"
                onClick={() => onCohort({
                  cohort: 'MOTIVO', value: m.motivo,
                  title: MOTIVE[m.motivo]?.label ?? m.motivo,
                  hint: MOTIVE[m.motivo]?.hint,
                })}
              >
                <span className="cross-ipf-label">{MOTIVE[m.motivo]?.label ?? m.motivo}</span>
                <span className="cross-ipf-track">
                  <i style={{ width: `${(m.sujetos / cruceMax) * 100}%`, background: 'var(--bg-raised)' }} />
                  <i style={{ width: `${(m.con_ipf_alto / cruceMax) * 100}%`, background: 'var(--sig-critical)' }} />
                </span>
                <span className="cross-ipf-num num">{n(m.con_ipf_alto)}<em>/{n(m.sujetos)}</em></span>
              </button>
            ))}
          </div>
          <p style={{ margin: '12px 0 0', fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.55 }}>
            La barra completa son los sujetos con ese motivo; la roja, los que además caen en
            la banda alta del IPF. Las dos condiciones se miden por separado y coincidir en
            ambas no agrava nada: sólo indica dónde una cola corta concentra prioridad.
          </p>
        </Panel>

        <Panel title="Prioridad fiscalizadora (IPF)" meta={`media ${n1(u.ipf_medio ?? 0)} · P90 ${n1(u.ipf_p90 ?? 0)}`}>
          <Bars
            data={IPF_ORDER.filter((b) => data.ipf_bands.some((x) => x.banda === b.key)).map((b) => {
              const hit = data.ipf_bands.find((x) => x.banda === b.key)!;
              return {
                label: b.label,
                value: hit.sujetos,
                tone: b.tone,
                sub: hit.ipf_medio != null ? `IPF ${n1(hit.ipf_medio)}` : 'sin puntaje',
              };
            })}
            onPick={(label) => {
              if (label === 'Muy alta' || label === 'Alta') {
                onCohort({ cohort: 'IPF_ALTO', title: 'Sujetos con IPF alta o muy alta' });
              }
            }}
          />
          <p style={{ margin: '12px 0 0', fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.55 }}>
            El IPF ordena revisión dentro del padrón combinando vulnerabilidad sectorial,
            historial de supervisión, coherencia registral, escala y brecha de
            observabilidad. Es prioridad comparativa, no probabilidad de LA/FT. Los{' '}
            {n(data.ipf_bands.find((b) => b.banda === 'SIN_IPF')?.sujetos ?? 0)} organismos
            públicos quedan fuera del índice porque no son comparables con el sector privado.
          </p>
        </Panel>
      </div>

      <Panel title="Caracterización cruzada" meta="cada marca abre su lista">
        <div className="cross-grid">
          <CrossCard
            label="Con antecedente sancionatorio"
            value={c?.sancionados_con_antecedente ?? 0}
            sub={`${n(c?.antecedentes_sancion ?? 0)} resoluciones con documento`}
            tone="var(--sig-critical)"
            onClick={() => onCohort({ cohort: 'SANCIONADO', title: 'Sujetos con antecedente sancionatorio', hint: 'con resumen y enlace a la resolución' })}
          />
          <CrossCard
            label="Giro atípico en su sector"
            value={u.giro_atipico}
            sub="actividad poco frecuente entre pares del sector"
            tone="var(--sig-watch)"
            onClick={() => onCohort({ cohort: 'GIRO_ATIPICO', title: 'Sujetos con giro atípico en su sector', hint: 'describe la distancia al giro modal, no una irregularidad' })}
          />
          <CrossCard
            label="Cambiaron su actividad declarada"
            value={u.cambio_actividad}
            sub="cambio de giro registrado ante el SII"
            tone="var(--sig-watch)"
            onClick={() => onCohort({ cohort: 'CAMBIO_ACTIVIDAD', title: 'Sujetos que cambiaron su actividad declarada', hint: 'cambio observado en el corte tributario' })}
          />
          <CrossCard
            label="Estructura societaria amplia"
            value={u.estructura_amplia}
            sub="describe la forma societaria, no una irregularidad"
            tone="var(--unknown)"
            onClick={() => onCohort({ cohort: 'TODOS', title: 'Padrón completo de sujetos obligados' })}
          />
          <CrossCard
            label="Figuran en prensa"
            value={c?.prensa ?? 0}
            sub={`${n(c?.antecedentes_prensa ?? 0)} menciones · sin enlace en origen`}
            onClick={() => onCohort({ cohort: 'PRENSA', title: 'Sujetos que figuran en prensa' })}
          />
          <CrossCard
            label="Organizaciones sin fines de lucro"
            value={c?.osfl ?? 0}
            sub="cruce con el universo OSFL"
            onClick={() => onCohort({ cohort: 'OSFL', title: 'Sujetos obligados que son OSFL' })}
          />
        </div>
        <p style={{ margin: '12px 0 0', fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.55 }}>
          La ausencia de marca no acredita ausencia del hecho. {data.coverage.press_note}
        </p>
      </Panel>
    </>
  );
}

function AttentionRow({ r, onOpen }: { r: UafAttentionRow; onOpen: () => void }) {
  return (
    <tr style={{ cursor: 'pointer' }} onClick={onOpen}>
      <td style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 570, letterSpacing: '-0.01em' }}>{titleCase(r.name)}</div>
        <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 2 }}>
          {r.main_activity ? titleCase(r.main_activity) : 'sin giro observado'}
        </div>
      </td>
      <td style={{ fontSize: 12, color: 'var(--ink-2)' }}>{r.uaf_sector ?? '—'}</td>
      <td>
        <span className="motive" data-m={r.motivo}><i />{MOTIVE[r.motivo]?.label ?? r.motivo}</span>
        {r.motivo === 'TERMINO_GIRO' && r.sii_termination_date && (
          <div style={{ fontSize: 10.5, color: 'var(--ink-4)', marginTop: 3 }}>{fecha(r.sii_termination_date)}</div>
        )}
        {r.motivo.startsWith('SANCION') && r.sanction_last_date && (
          <div style={{ fontSize: 10.5, color: 'var(--ink-4)', marginTop: 3 }}>
            {n(r.sanction_evidence_count)} antecedente{r.sanction_evidence_count === 1 ? '' : 's'} · {fecha(r.sanction_last_date)}
          </div>
        )}
      </td>
      <td style={{ fontSize: 12, color: 'var(--ink-2)' }}>
        {r.region ? (r.commune ? `${r.commune}, ${r.region}` : r.region) : <em style={{ color: 'var(--ink-4)' }}>sin territorio</em>}
        {r.igr_level && <div style={{ fontSize: 10.5, color: 'var(--ink-4)', marginTop: 2 }}>IGR comunal {r.igr_level}</div>}
      </td>
      <td className="right num" style={{ color: r.ipf_band === 'MUY_ALTA' || r.ipf_band === 'ALTA' ? 'var(--sig-medium)' : undefined }}>
        {r.ipf_score == null ? '—' : n1(r.ipf_score)}
      </td>
    </tr>
  );
}

function CrossCard({
  label, value, sub, tone, onClick,
}: {
  label: string; value: number; sub?: string; tone?: string; onClick: () => void;
}) {
  return (
    <button className="cross-card" onClick={onClick}>
      <span className="num" style={{ fontSize: 20, fontWeight: 700, color: tone ?? 'var(--ink)' }}>{n(value)}</span>
      <span className="cross-card-label">{label}</span>
      {sub && <span className="cross-card-sub">{sub}</span>}
    </button>
  );
}
