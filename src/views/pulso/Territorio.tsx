import { useState } from 'react';
import type { UafPulse } from '../../lib/contracts';
import { OrderedDistribution, StateBar } from '../../components/charts';
import { Empty, Panel } from '../../components/primitives';
import { n, n1 } from '../../lib/format';
import type { CohortRequest } from '../../components/CohortDrawer';

/* LENTE · TERRITORIO
   ──────────────────
   Dónde operan los inscritos y en qué entorno. El IGR describe la comuna, nunca
   al sujeto: un IGR alto no atribuye conducta a quien está allí.

   La tabla se abre acotada a las regiones que concentran el padrón. El corte
   trae más filas que regiones tiene el país porque la región llega sin
   normalizar desde el origen; eso se arregla aguas arriba, y mientras tanto la
   vista muestra todas las filas cuando se piden, sin fusionarlas por su cuenta:
   fusionar aquí inventaría un dato que el read model no afirma. */

const VISIBLES = 8;

export function LenteTerritorio({
  data,
  onCohort,
}: {
  data: UafPulse;
  onCohort: (req: CohortRequest) => void;
}) {
  const [todas, setTodas] = useState(false);
  const u = data.universe;
  if (!u) return <Empty title="Sin padrón publicado" />;

  const igrAlto = data.by_region.reduce((a, r) => a + r.en_igr_alto, 0);
  const filas = todas ? data.by_region : data.by_region.slice(0, VISIBLES);
  const ocultas = data.by_region.length - filas.length;
  const cubiertos = data.by_region.slice(0, VISIBLES).reduce((a, r) => a + r.sujetos, 0);
  const sinTerritorio = u.total - u.con_territorio;

  return (
    <div className="pulse-grid-wide">
      <Panel
        title="Sujetos obligados por región"
        meta={`${n(igrAlto)} en comunas de IGR alto o muy alto`}
        pad={false}
      >
        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Región</th>
                <th className="right">Sujetos</th>
                <th className="right">Piden revisión</th>
                <th className="right">Término de giro</th>
                <th className="right">Con sanción</th>
                <th className="right">IGR medio</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((r) => (
                <tr
                  key={r.region}
                  style={{ cursor: 'pointer' }}
                  onClick={() => onCohort({ cohort: 'REGION', value: r.region, title: `Sujetos obligados en ${r.region}` })}
                >
                  <td style={{ fontWeight: 550 }}>{r.region}</td>
                  <td className="right num">{n(r.sujetos)}</td>
                  <td className="right num" style={{ color: r.en_atencion > 0 ? 'var(--sig-medium)' : undefined }}>{n(r.en_atencion)}</td>
                  <td className="right num">{n(r.terminados)}</td>
                  <td className="right num" style={{ color: r.sancionados > 0 ? 'var(--sig-critical)' : undefined }}>{n(r.sancionados)}</td>
                  <td className="right num">{r.igr_medio == null ? '—' : n1(r.igr_medio)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {ocultas > 0 && (
          <div style={{ padding: '12px 18px 0' }}>
            <button className="chip" onClick={() => setTodas(true)}>
              Ver las {n(data.by_region.length)} filas del corte
              <b className="num">+{n(ocultas)}</b>
            </button>
          </div>
        )}
        <p style={{ margin: 0, padding: '12px 18px', fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.55, borderTop: '1px solid var(--line-soft)' }}>
          El IGR mide la amenaza delictual de la comuna donde el sujeto opera. Describe el
          entorno, nunca al sujeto: un IGR alto no atribuye conducta a quien está allí.
          {!todas && ocultas > 0 && (
            <> Las {VISIBLES} filas visibles reúnen {n(cubiertos)} de {n(u.con_territorio)} sujetos con territorio observado.</>
          )}
          {sinTerritorio > 0 && (
            <> {n(sinTerritorio)} sujetos no tienen territorio observado y quedan fuera de este corte.</>
          )}
        </p>
      </Panel>

      <div className="grid" style={{ gap: 16, alignContent: 'start' }}>
        <Panel title="Entorno territorial donde operan" meta="banda IGR de la comuna">
          <OrderedDistribution
            total={u.total}
            rows={data.igr_mix
              .filter((g) => g.banda !== 'Sin IGR')
              .map((g) => ({ label: g.banda, value: g.sujetos, step: igrStep(g.banda) }))}
          />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
            <button className="chip" onClick={() => onCohort({ cohort: 'IGR_MUY_ALTO', title: 'Sujetos en comunas de IGR muy alto' })}>
              Ver comunas de IGR muy alto
            </button>
          </div>
          <p style={{ margin: '12px 0 0', fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.55 }}>
            La concentración en bandas altas refleja que los sujetos obligados operan en
            comunas urbanas densas, que son también las de mayor registro delictual. Por eso
            la banda ordena el contexto, pero no prioriza por sí sola.
            {(data.igr_mix.find((g) => g.banda === 'Sin IGR')?.sujetos ?? 0) > 0 && (
              <> {n(data.igr_mix.find((g) => g.banda === 'Sin IGR')?.sujetos ?? 0)} sujetos quedan sin banda por no tener comuna observada.</>
            )}
          </p>
        </Panel>

        {/* La cobertura territorial condiciona todo lo anterior y hasta ahora
            era una frase al pie. Uno de cada cinco inscritos no tiene comuna
            observable: la lente lo dice antes de que se lea el resto. */}
        <Panel title="Cobertura territorial del padrón" meta={`${n(u.regiones)} regiones en el corte`}>
          <StateBar
            total={u.total}
            rows={[
              { key: 'CON', label: 'Con territorio observado', value: u.con_territorio, color: 'var(--present)' },
              { key: 'SIN', label: 'Sin comuna observable', value: sinTerritorio, color: 'var(--absent)' },
            ]}
          />
          <p style={{ margin: '12px 0 0', fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.55 }}>
            La lectura territorial se hace sobre {n1((u.con_territorio / Math.max(1, u.total)) * 100)}%
            del padrón. El resto no está en ninguna región de la tabla, y no por vivir fuera de
            Chile: simplemente no tiene comuna observable en las fuentes del corte.
          </p>
        </Panel>
      </div>
    </div>
  );
}

/* La rampa IGR es secuencial y ordenada: el paso lo fija el nivel, no el
   tamaño del grupo. */
function igrStep(banda: string): number {
  switch (banda) {
    case 'Muy alto': return 5;
    case 'Alto': return 4;
    case 'Medio': return 3;
    case 'Bajo': return 2;
    default: return 1;
  }
}
