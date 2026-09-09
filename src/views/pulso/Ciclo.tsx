import { useMemo } from 'react';
import type { UafPulse } from '../../lib/contracts';
import { Bars } from '../../components/charts';
import { Empty, Panel } from '../../components/primitives';
import { fecha, n, n1, titleCase } from '../../lib/format';
import type { CohortRequest } from '../../components/CohortDrawer';

/* LENTE · CICLO
   ─────────────
   El padrón en el tiempo: quién entra a la actividad, quién la cierra y sigue
   inscrito, y qué sanciones se han cursado sobre él. Debajo, el contraste entre
   el sector que obliga y la industria real declarada ante el SII.

   Las altas de actividad ya venían en el contrato y nunca se habían dibujado.
   Sin ellas la serie de términos no se podía leer: una subida de cierres dice
   una cosa si las aperturas suben y otra distinta si están cayendo. */

/** Años que se muestran en el ciclo de vida. Antes de eso la serie de términos
 *  es tan rala que el par no compara nada. */
const DESDE = 2016;

export function LenteCiclo({
  data,
  onCohort,
}: {
  data: UafPulse;
  onCohort: (req: CohortRequest) => void;
}) {
  const u = data.universe;

  /* Las dos series del ciclo de vida comparten eje: se dibujan sobre el mismo
     máximo o la comparación mentiría. */
  const ciclo = useMemo(() => {
    const altas = new Map(data.lifecycle.started_by_year.map((x) => [x.ano, x.n]));
    const fines = new Map(data.lifecycle.terminated_by_year.map((x) => [x.ano, x.n]));
    const anos = [...new Set([...altas.keys(), ...fines.keys()])]
      .filter((a) => a >= DESDE)
      .sort((a, b) => a - b);
    return anos.map((ano) => ({ ano, altas: altas.get(ano) ?? 0, fines: fines.get(ano) ?? 0 }));
  }, [data.lifecycle]);
  const cicloMax = Math.max(1, ...ciclo.flatMap((c) => [c.altas, c.fines]));
  const ultimo = ciclo[ciclo.length - 1];

  const sanciones = useMemo(
    () => data.sanctions.by_year.slice().sort((a, b) => a.ano - b.ano),
    [data.sanctions.by_year],
  );
  const sancMax = Math.max(1, ...sanciones.map((s) => s.eventos));
  const montoMax = Math.max(1, ...sanciones.map((s) => s.monto_uf ?? 0));
  const conMonto = sanciones.filter((s) => s.monto_uf != null && s.monto_uf > 0);

  if (!u) return <Empty title="Sin padrón publicado" />;

  return (
    <>
      <div className="grid grid-2" style={{ marginBottom: 16 }}>
        <Panel
          title="Altas de actividad contra términos de giro"
          meta={ultimo ? `${n(ultimo.altas)} altas · ${n(ultimo.fines)} términos en ${ultimo.ano}` : undefined}
        >
          {ciclo.length === 0 ? (
            <Empty title="Sin ciclo de vida registrado" />
          ) : (
            <>
              <div className="life">
                {ciclo.map((c) => (
                  <div className="life-year" key={c.ano}>
                    <span className="life-pair">
                      <i
                        style={{ height: `${(c.altas / cicloMax) * 100}%`, background: 'var(--accent)' }}
                        title={`${n(c.altas)} inicios de actividad en ${c.ano}`}
                      />
                      <i
                        style={{ height: `${(c.fines / cicloMax) * 100}%`, background: 'var(--sig-high)' }}
                        title={`${n(c.fines)} términos de giro en ${c.ano}`}
                      />
                    </span>
                    <em>{String(c.ano).slice(2)}</em>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                <span className="chip" style={{ cursor: 'default' }}>
                  <i style={{ width: 7, height: 7, borderRadius: 2, background: 'var(--accent)' }} />
                  Inicio de actividades
                </span>
                <button
                  className="chip"
                  onClick={() => onCohort({ cohort: 'TERMINO_GIRO', title: 'Sujetos con término de giro', hint: 'siguen inscritos en el registro UAF' })}
                >
                  <i style={{ width: 7, height: 7, borderRadius: 2, background: 'var(--sig-high)' }} />
                  Término de giro
                  <b className="num" style={{ color: 'var(--ink)' }}>{n(u.terminados)}</b>
                </button>
              </div>
              <p style={{ margin: '12px 0 0', fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.55 }}>
                Ambas series describen el ciclo de vida ante el SII de quienes hoy están
                inscritos: no son altas ni bajas del registro UAF, que no publica fecha de
                inscripción. Un sujeto que cerró su giro y sigue inscrito es candidato a contacto
                y evaluación de desvinculación del registro; el cierre tributario no extingue por
                sí solo la obligación de estar inscrito.
              </p>
            </>
          )}
        </Panel>

        <Panel
          title="Sanciones sobre el padrón"
          meta={`${n(data.sanctions.eventos)} eventos · ${n(data.sanctions.con_documento)} con documento`}
        >
          {sanciones.length === 0 ? (
            <Empty title="Sin eventos sancionatorios fechados" />
          ) : (
            <>
              <div className="life">
                {sanciones.map((s) => (
                  <div className="life-year" key={s.ano}>
                    <span className="life-pair">
                      <i
                        style={{ height: `${(s.eventos / sancMax) * 100}%`, background: 'var(--sig-critical)' }}
                        title={`${n(s.eventos)} eventos sobre ${n(s.sujetos)} sujeto${s.sujetos === 1 ? '' : 's'} en ${s.ano}`}
                      />
                    </span>
                    <em>{String(s.ano).slice(2)}</em>
                  </div>
                ))}
              </div>
              {/* El monto cursado ya venía por año en el contrato y el Pulso sólo
                  contaba eventos. Un año sin monto publicado no dibuja barra:
                  un cero diría que no hubo multa, y lo que hay es un dato ausente. */}
              {conMonto.length > 0 && (
                <>
                  <div className="panel-sub" style={{ marginTop: 16 }}>
                    Monto cursado, en UF · {n(data.sanctions.monto_uf ?? 0)} en total
                  </div>
                  <Bars
                    height={0}
                    data={conMonto.map((s) => ({
                      label: String(s.ano),
                      value: s.monto_uf ?? 0,
                      tone: 'medium' as const,
                    }))}
                    max={montoMax}
                  />
                </>
              )}
              <p style={{ margin: '12px 0 0', fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.55 }}>
                Eventos resueltos por RUT sobre el padrón, con su resolución cuando la fuente
                publica el documento. Último registrado: {fecha(data.sanctions.ultimo)}.
                {conMonto.length < sanciones.length && (
                  <> {n(sanciones.length - conMonto.length)} año{sanciones.length - conMonto.length === 1 ? '' : 's'} sin monto publicado en la fuente no dibujan barra.</>
                )}{' '}
                {data.coverage.sanction_note}
              </p>
            </>
          )}
        </Panel>
      </div>

      <div className="grid grid-2">
        <Panel title="Sector UAF que obliga" meta={`${n(u.sectores_uaf)} sectores`}>
          <Bars
            data={data.by_sector.slice(0, 12).map((s) => ({
              label: titleCase(s.sector),
              value: s.sujetos,
              tone: s.sancionados > 0 ? 'high' : 'watch',
              sub: s.sancionados ? `${s.sancionados} con sanción` : undefined,
            }))}
            onPick={(label) => {
              const hit = data.by_sector.find((s) => titleCase(s.sector) === label);
              if (hit) onCohort({ cohort: 'SECTOR', value: hit.sector, title: hit.sector });
            }}
          />
        </Panel>

        <Panel title="Industria según el SII" meta={`${n(u.industrias)} rubros económicos`}>
          <Bars
            data={data.by_industry.map((i) => ({
              label: titleCase(i.industria),
              value: i.sujetos,
              tone: i.sancionados > 0 ? 'high' : 'watch',
              sub: i.sancionados ? `${i.sancionados} con sanción` : undefined,
            }))}
            onPick={(label) => {
              const hit = data.by_industry.find((i) => titleCase(i.industria) === label);
              if (hit) onCohort({ cohort: 'INDUSTRIA', value: hit.industria, title: hit.industria });
            }}
          />
          <p style={{ margin: '12px 0 0', fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.55 }}>
            El sector UAF dice por qué el sujeto está obligado. La industria dice a qué se
            dedica de verdad según su giro tributario. Cuando divergen, la diferencia es la
            que interesa mirar: {n(u.giro_atipico)} sujetos declaran un giro poco frecuente
            entre sus pares de sector. La antigüedad media del padrón es de{' '}
            {n1(u.antiguedad_media ?? 0)} años, calculada sobre los {n(u.con_inicio)} sujetos
            con inicio de actividades ante el SII.
          </p>
        </Panel>
      </div>
    </>
  );
}
