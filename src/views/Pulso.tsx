import { useState } from 'react';
import { useRpc } from '../lib/rpc';
import { hrefFor } from '../lib/router';
import type { Pulse, UafPulse } from '../lib/contracts';
import { Bars } from '../components/charts';
import { Empty, ErrorBox, Loading, Panel, Semantics } from '../components/primitives';
import { n, n1, titleCase } from '../lib/format';
import { AlertCard } from '../components/AlertCard';
import { CohortDrawer, type CohortRequest } from '../components/CohortDrawer';

/* El Pulso caracteriza el padrón de sujetos obligados: quiénes son, en qué
   estado están ante el SII, dónde operan, en qué industria, y cuáles cruzan
   con OSFL, compras públicas, sanción o prensa. Cada cifra es una puerta: se
   pincha y aparecen los nombres que la componen, con su antecedente.

   Las señales de patrón viven replegadas. Son un modo de trabajo distinto —
   perseguir un caso — y competían por la atención con la caracterización del
   universo, que es la pregunta de partida. */

export function Pulso({ onNavigate }: { onNavigate: (hash: string) => void }) {
  const { data, error, loading, reload } = useRpc<UafPulse>('obs_uaf_pulse', {});
  const [cohort, setCohort] = useState<CohortRequest | null>(null);
  const [signalsOpen, setSignalsOpen] = useState(false);

  if (loading) return <Loading label="Leyendo el padrón de sujetos obligados…" />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data?.universe) {
    return <Empty title="Sin padrón publicado" hint="Aún no hay un corte del universo UAF en este snapshot." />;
  }

  const u = data.universe;
  const c = data.crosscuts;
  const open = (req: CohortRequest) => setCohort(req);

  const igrAlto = data.by_region.reduce((a, r) => a + r.en_igr_alto, 0);

  return (
    <div className="fade-in">
      <header className="view-head">
        <h1 className="view-title">Universo de sujetos obligados</h1>
        <p className="view-lede">
          {n(u.total)} sujetos inscritos en el registro de la UAF, caracterizados contra
          el ciclo de vida ante el SII, el territorio donde operan y su cruce con otras
          fuentes gobernadas. Cada cifra abre la lista de quiénes la componen.
        </p>
      </header>

      {/* ── Composición del universo. Lo primero es saber de qué está hecho. */}
      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <Stat
          label="Padrón inscrito"
          value={n(u.total)}
          foot={`${n(u.juridicas)} jurídicas · ${n(u.naturales)} naturales · ${n(u.organismos)} organismos`}
          onClick={() => open({ cohort: 'TODOS', title: 'Padrón completo de sujetos obligados' })}
        />
        <Stat
          label="Activos ante el SII"
          value={n(u.activos)}
          foot={`${n1((u.activos / Math.max(1, u.total)) * 100)}% del padrón`}
          tone="var(--present)"
          onClick={() => open({ cohort: 'ACTIVO', title: 'Sujetos activos ante el SII' })}
        />
        <Stat
          label="Con término de giro"
          value={n(u.terminados)}
          foot="inscritos que ya cerraron su giro"
          tone="var(--sig-high)"
          onClick={() =>
            open({
              cohort: 'TERMINO_GIRO',
              title: 'Sujetos con término de giro',
              hint: 'siguen inscritos en el registro UAF',
            })
          }
        />
        <Stat
          label="Señales activas"
          value={n(c?.con_senal ?? 0)}
          foot={signalsOpen ? 'pincha para replegar' : 'pincha para desplegar'}
          tone={signalsOpen ? 'var(--accent)' : undefined}
          onClick={() => setSignalsOpen((v) => !v)}
        />
      </div>

      {signalsOpen && <SignalsPanel onNavigate={onNavigate} />}

      {/* ── Ciclo de vida y caracterización cruzada, uno al lado del otro. */}
      <div className="grid grid-main" style={{ marginBottom: 16 }}>
        <div className="grid" style={{ gap: 16, alignContent: 'start' }}>
          <Panel
            title="Término de giro por año"
            meta="pincha un año para ver quiénes son"
          >
            {data.lifecycle.terminated_by_year.length === 0 ? (
              <Empty title="Sin términos de giro registrados" />
            ) : (
              <>
                <Bars
                  data={data.lifecycle.terminated_by_year.map((t) => ({
                    label: String(t.ano),
                    value: t.n,
                    tone: 'high',
                  }))}
                  onPick={(label) =>
                    open({
                      cohort: 'TERMINO_ANO',
                      value: label,
                      title: `Término de giro en ${label}`,
                      hint: 'candidatos a gestión de desvinculación',
                    })
                  }
                />
                <p style={{ margin: '12px 0 0', fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.55 }}>
                  Un sujeto que cerró su giro y sigue inscrito es un candidato a contacto y
                  evaluación de desvinculación del registro. El cierre tributario no
                  extingue por sí solo la obligación de estar inscrito.
                </p>
              </>
            )}
          </Panel>

          <Panel
            title="Entorno territorial donde operan"
            meta="banda IGR de la comuna"
          >
            <Bars
              data={data.igr_mix.map((g) => ({
                label: g.banda,
                value: g.sujetos,
                tone: g.banda === 'Muy alto' ? 'high' : g.banda === 'Alto' ? 'watch' : 'none',
                sub: g.igr_medio != null ? `IGR ${n1(g.igr_medio)}` : 'sin comuna observada',
              }))}
              onPick={(label) => {
                if (label === 'Muy alto') open({ cohort: 'IGR_MUY_ALTO', title: 'Sujetos en comunas de IGR muy alto' });
                else if (label === 'Alto') open({ cohort: 'IGR_ALTO', title: 'Sujetos en comunas de IGR alto o muy alto' });
              }}
            />
            <p style={{ margin: '12px 0 0', fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.55 }}>
              La concentración en bandas altas refleja que los sujetos obligados operan
              en comunas urbanas densas, que son también las de mayor registro delictual.
              Por eso la banda ordena el contexto, pero no prioriza por sí sola.
            </p>
          </Panel>
        </div>

        <div className="grid" style={{ gap: 16, alignContent: 'start' }}>
          <Panel title="Caracterización cruzada" meta="cada marca abre su lista">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <CrossRow
                label="Con antecedente sancionatorio"
                value={c?.sancionados_con_antecedente ?? 0}
                sub={`${n(c?.antecedentes_sancion ?? 0)} resoluciones con documento`}
                tone="var(--sig-critical)"
                onClick={() =>
                  open({
                    cohort: 'SANCIONADO',
                    title: 'Sujetos con antecedente sancionatorio',
                    hint: 'con resumen y enlace a la resolución',
                  })
                }
              />
              <CrossRow
                label="Figuran en prensa"
                value={c?.prensa ?? 0}
                sub={`${n(c?.antecedentes_prensa ?? 0)} menciones · sin enlace en origen`}
                onClick={() =>
                  open({ cohort: 'PRENSA', title: 'Sujetos que figuran en prensa' })
                }
              />
              <CrossRow
                label="Proveedores del Estado"
                value={c?.proveedores ?? 0}
                sub="corte de compras públicas, cobertura parcial"
                onClick={() =>
                  open({
                    cohort: 'PROVEEDOR_ESTADO',
                    title: 'Sujetos que son proveedores del Estado',
                    hint: 'ventana de 12 meses',
                  })
                }
              />
              <CrossRow
                label="Organizaciones sin fines de lucro"
                value={c?.osfl ?? 0}
                sub="cruce con el universo OSFL"
                onClick={() => open({ cohort: 'OSFL', title: 'Sujetos obligados que son OSFL' })}
              />
              <CrossRow
                label="Sin perfil tributario de empresa"
                value={u.sin_perfil}
                sub="personas naturales · no es brecha registral"
                onClick={() =>
                  open({
                    cohort: 'SIN_PERFIL_SII',
                    title: 'Sujetos sin perfil SII de persona jurídica',
                    hint: 'personas naturales inscritas',
                  })
                }
              />
            </div>
          </Panel>

          <Panel title="Antigüedad del padrón">
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
              <span className="num" style={{ fontSize: 30, fontWeight: 650, letterSpacing: '-0.03em' }}>
                {n1(u.antiguedad_media)}
              </span>
              <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>años de actividad en promedio</span>
            </div>
            <p style={{ margin: '10px 0 0', fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.55 }}>
              Calculada sobre los {n(u.con_inicio)} sujetos con fecha de inicio de
              actividades ante el SII. El registro UAF no publica fecha de inscripción,
              de modo que el único eje temporal disponible es el tributario.
            </p>
          </Panel>
        </div>
      </div>

      {/* ── Territorio: dónde operan y en qué entorno. */}
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
                <th className="right">En IGR muy alto</th>
                <th className="right">Término de giro</th>
                <th className="right">Con sanción</th>
                <th className="right">IGR medio</th>
              </tr>
            </thead>
            <tbody>
              {data.by_region.map((r) => (
                <tr
                  key={r.region}
                  style={{ cursor: 'pointer' }}
                  onClick={() =>
                    open({
                      cohort: 'REGION',
                      value: r.region,
                      title: `Sujetos obligados en ${r.region}`,
                    })
                  }
                >
                  <td style={{ fontWeight: 550 }}>{r.region}</td>
                  <td className="right num">{n(r.sujetos)}</td>
                  <td className="right num" style={{ color: r.en_igr_muy_alto > 0 ? 'var(--sig-high)' : undefined }}>
                    {n(r.en_igr_muy_alto)}
                  </td>
                  <td className="right num">{n(r.terminados)}</td>
                  <td className="right num" style={{ color: r.sancionados > 0 ? 'var(--sig-critical)' : undefined }}>
                    {n(r.sancionados)}
                  </td>
                  <td className="right num">{n1(r.igr_medio)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p style={{ margin: 0, padding: '12px 18px', fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.55, borderTop: '1px solid var(--line-soft)' }}>
          El IGR mide la amenaza delictual de la comuna donde el sujeto opera. Describe el
          entorno, nunca al sujeto: un IGR alto no atribuye conducta a quien está allí.
          {u.con_territorio < u.total && (
            <> {n(u.total - u.con_territorio)} sujetos no tienen territorio observado y quedan fuera de este corte.</>
          )}
        </p>
      </Panel>

      {/* ── Sector obligado e industria real. Son dos preguntas distintas. */}
      <div className="grid grid-2" style={{ margin: '16px 0' }}>
        <Panel title="Sector UAF que obliga" meta={`${n(u.sectores_uaf)} sectores`}>
          <Bars
            data={data.by_sector.map((s) => ({
              label: titleCase(s.sector),
              value: s.sujetos,
              tone: s.sancionados > 0 ? 'high' : 'watch',
              sub: s.sancionados ? `${s.sancionados} con sanción` : undefined,
            }))}
            onPick={(label) => {
              const hit = data.by_sector.find((s) => titleCase(s.sector) === label);
              if (hit) open({ cohort: 'SECTOR', value: hit.sector, title: hit.sector });
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
              if (hit) open({ cohort: 'INDUSTRIA', value: hit.industria, title: hit.industria });
            }}
          />
          <p style={{ margin: '12px 0 0', fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.55 }}>
            El sector UAF dice por qué el sujeto está obligado. La industria dice a qué se
            dedica de verdad según su giro tributario. Cuando divergen, la diferencia es
            la que interesa mirar.
          </p>
        </Panel>
      </div>

      <Semantics>
        <strong>Qué significa este tablero.</strong> {data.semantics}{' '}
        {data.coverage.uaf_registration_note}{' '}
        {data.coverage.sanction_note}{' '}
        {data.coverage.supplier_cap_note}{' '}
        {data.coverage.press_note}
      </Semantics>

      {cohort && (
        <CohortDrawer
          request={cohort}
          onClose={() => setCohort(null)}
          onOpenEntity={(entityId) => {
            setCohort(null);
            onNavigate(hrefFor({ view: 'ficha', entityId }));
          }}
        />
      )}
    </div>
  );
}

/** Las señales sólo se consultan cuando el analista las pide: hasta entonces
 *  no se gasta una llamada ni espacio de pantalla en ellas. */
function SignalsPanel({ onNavigate }: { onNavigate: (hash: string) => void }) {
  const { data, error, loading, reload } = useRpc<Pulse>('obs_pulse', {});

  return (
    <Panel
      title="Señales que piden mirada"
      meta={data ? `${n(data.alerts.top.length)} de ${n(data.alerts.total)}` : undefined}
      pad={false}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 16 }}>
        {loading ? (
          <Loading label="Consultando señales de patrón…" />
        ) : error ? (
          <ErrorBox error={error} onRetry={reload} />
        ) : !data?.alerts.top.length ? (
          <Empty title="Sin señales priorizadas" />
        ) : (
          <>
            {data.alerts.top.map((a) => (
              <AlertCard key={a.alert_id} alert={a} onNavigate={onNavigate} compact />
            ))}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
              <a href={hrefFor({ view: 'senales' })} className="btn">
                Ver todas las señales
              </a>
              {data.alerts.by_family.slice(0, 4).map((f) => (
                <a key={f.family} href={hrefFor({ view: 'senales', family: f.family })} className="chip">
                  {titleCase(f.family)} · {n(f.n)}
                </a>
              ))}
            </div>
          </>
        )}
      </div>
    </Panel>
  );
}

function CrossRow({
  label,
  value,
  sub,
  tone,
  onClick,
}: {
  label: string;
  value: number;
  sub?: string;
  tone?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: '2px 12px',
        alignItems: 'baseline', border: 0, background: 'transparent',
        padding: '9px 0', textAlign: 'left', cursor: 'pointer', width: '100%',
        borderBottom: '1px solid var(--line-soft)',
      }}
    >
      <span style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>{label}</span>
      <span className="num" style={{ fontSize: 15, fontWeight: 650, color: tone }}>
        {n(value)}
      </span>
      {sub && (
        <span style={{ gridColumn: '1 / -1', fontSize: 11, color: 'var(--ink-4)' }}>{sub}</span>
      )}
    </button>
  );
}

function Stat({
  label, value, foot, tone, onClick,
}: {
  label: string; value: string; foot?: string; tone?: string; onClick?: () => void;
}) {
  const body = (
    <>
      <div className="stat-label">{label}</div>
      <div className="stat-value num" style={tone ? { color: tone } : undefined}>{value}</div>
      {foot && <div className="stat-foot">{foot}</div>}
    </>
  );
  if (!onClick) return <div className="stat">{body}</div>;
  return (
    <button className="stat" onClick={onClick} style={{ cursor: 'pointer', textAlign: 'left', font: 'inherit' }}>
      {body}
    </button>
  );
}
