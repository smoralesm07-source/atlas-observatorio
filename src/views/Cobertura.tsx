import { useMemo, useState } from 'react';
import { useRpc } from '../lib/rpc';
import { hrefFor } from '../lib/router';
import type { UafScreening, UafScreeningActeco } from '../lib/contracts';
import { GapBars, StateBar } from '../components/charts';
import { Empty, ErrorBox, Loading, Panel, Semantics } from '../components/primitives';
import { n, n1, titleCase } from '../lib/format';

/* COBERTURA DEL PADRÓN OBLIGADO
   ─────────────────────────────
   El reverso del registro. El Pulso dice quiénes están inscritos; esta vista
   dice qué entidades el SII observa haciendo actividades alcanzadas por la Ley
   19.913 sin figurar en el padrón. Es lo que permite leer el padrón como una
   cobertura y no como un total.

   Vivía comprimido en tres recuadros dentro de un panel del Pulso que trataba
   de otra cosa, y sus 34 gatillantes, su brecha por sector y su universo de
   79.449 RUT no llegaban nunca a la pantalla.

   LÍMITES QUE LA VISTA PUBLICA, NO ESCONDE:
    · Un ACTECO es una señal OSINT de screening, nunca una conclusión jurídica.
    · Ausencia del corte público UAF no equivale a no estar inscrita.
    · Toda suma entre códigos es BRUTA: un RUT con dos giros alcanzados se
      cuenta dos veces, y por eso el consolidado se publica aparte.
    · El universo consolidado es una línea base declarada por Radar_SII: no está
      materializada RUT a RUT aquí y por eso no se navega ni se filtra. */

type Orden = 'universo' | 'pureza' | 'riesgo';

const RIESGO_ORDEN: Record<string, number> = { ALTO: 0, MEDIO: 1, BAJO: 2 };

export function Cobertura({ onNavigate }: { onNavigate: (hash: string) => void }) {
  const { data, error, loading, reload } = useRpc<UafScreening>('obs_uaf_screening_block', {});
  const [orden, setOrden] = useState<Orden>('universo');

  const actecos = useMemo(() => ordenarActecos(data?.actecos ?? [], orden), [data, orden]);

  if (loading) return <Loading label="Leyendo la homologación de giros alcanzados…" />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data?.disponible) {
    return (
      <Empty
        title="Sin corte de screening publicado"
        hint="La homologación empírica UAF–SII no está disponible en este snapshot."
      />
    );
  }

  const corte = data.corte;
  const t = data.totales;
  const padron = t?.padron_total ?? 0;
  const razon = padron > 0 ? corte.universo_declarado / padron : null;

  /* El padrón se reparte en tres modos de screening. El resto no es residuo:
     son sectores cuyo ACTECO sólo pondera y nunca gatilla, y contarlos como
     cubiertos inflaría la cobertura. */
  const cubiertos = t?.inscritos_cubiertos ?? 0;
  const otroModo = t?.sujetos_otro_modo ?? 0;
  const sinGatillante = Math.max(0, padron - cubiertos - otroModo);

  return (
    <div className="fade-in">
      <header className="pulse-command cov-command">
        <div style={{ minWidth: 0 }}>
          <div className="pulse-kicker">Screening SII ↔ UAF · homologación empírica</div>
          <h1>Cobertura del padrón obligado</h1>
          <p className="view-lede">
            Qué entidades el SII observa haciendo actividades alcanzadas por la Ley 19.913 sin
            figurar en el registro de la UAF. La correspondencia entre giro y sector obligado se
            mide sobre los propios inscritos, no se escribe a mano. Un ACTECO es una señal OSINT
            de screening, nunca una conclusión jurídica: declarar un giro alcanzado no prueba que
            la entidad reúna los elementos que activan la obligación de inscribirse, ni que esté
            incumpliendo.
          </p>
        </div>
        <div className="pulse-meta">
          <span className="pulse-meta-item">
            <i />
            <b>Nómina SII</b> {corte.sii_periodo}
          </span>
          <span className="pulse-meta-item"><b>Padrón UAF</b> {corte.uaf_corte}</span>
          <span className="pulse-meta-item"><b>Política</b> {corte.fuente.split('·')[0].trim()}</span>
        </div>
        <div className="pulse-quick">
          <a className="chip" href={hrefFor({ view: 'pulso' })}>← Volver al Pulso</a>
          <a className="chip" href={corte.fuente_url} target="_blank" rel="noreferrer">
            Nómina de personas jurídicas del SII →
          </a>
        </div>
      </header>

      <div className="kpi-row cov-kpis">
        <CovKpi
          label="Universo observable"
          value={n(corte.universo_declarado)}
          tone="var(--sig-high)"
          share={razon ? `${n1(razon)}× el padrón inscrito` : undefined}
          foot="RUT distintos · línea base declarada"
        />
        <CovKpi
          label="De riesgo alto"
          value={n(t?.universo_riesgo_alto ?? 0)}
          tone="var(--sig-critical)"
          share={t?.universo_bruto ? `${n1(((t.universo_riesgo_alto ?? 0) / t.universo_bruto) * 100)}% de la suma bruta` : undefined}
          foot="códigos que arrastran entidades ajenas al sector"
        />
        <CovKpi
          label="Gatillantes ACTECO"
          value={n((t?.gatillantes ?? 0) + (t?.gatillantes_b ?? 0))}
          tone="var(--accent)"
          share={`${n(t?.gatillantes ?? 0)} de prioridad A · ${n(t?.gatillantes_b ?? 0)} B`}
          foot="medidos sobre los propios inscritos"
        />
        <CovKpi
          label="No evaluables por giro"
          value={n(otroModo)}
          tone="var(--unknown)"
          share={`${n(t?.sectores_otro_modo ?? 0)} sectores · ${n1((otroModo / Math.max(1, padron)) * 100)}% del padrón`}
          foot="su universo se construye desde registro externo"
        />
      </div>

      <div className="pulse-grid-wide" style={{ marginBottom: 16 }}>
        <Panel
          title="Brecha por sector obligado"
          meta="inscritos en el padrón contra universo observable en el SII"
          pad={false}
        >
          <div style={{ padding: '4px 18px 0' }}>
            <GapBars
              rows={data.sectores.slice(0, 14).map((s) => ({
                key: s.uaf_sector ?? s.etiqueta,
                label: titleCase(s.etiqueta),
                inscritos: s.inscritos,
                universo: s.universo_bruto,
                riesgo: s.riesgo,
                meta: `${s.gatillantes} gatillante${s.gatillantes === 1 ? '' : 's'}${
                  s.cobertura_max != null ? ` · cubre ${n1(s.cobertura_max * 100)}%` : ''
                }`,
              }))}
            />
          </div>
          <p style={{ margin: 0, padding: '14px 18px', fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.55, borderTop: '1px solid var(--line-soft)' }}>
            <b style={{ color: 'var(--ink-2)' }}>Cómo leer esta brecha.</b> La barra tenue es el
            padrón inscrito y la de color, los RUT que el SII observa con el giro característico del
            sector fuera de ese padrón. Comparten escala logarítmica porque la diferencia recorre
            tres órdenes de magnitud, de modo que la razón impresa —y no el largo de la barra— es la
            lectura. El riesgo mostrado es el de falso positivo del peor código que compone el
            agregado: un código amplio arrastra entidades ajenas al sector. La suma entre sectores es
            bruta y jamás un conteo de entidades distintas.
          </p>
        </Panel>

        <div className="grid" style={{ gap: 16, alignContent: 'start' }}>
          <Panel title="Composición del universo" meta={`nómina SII ${corte.sii_periodo}`}>
            <div className="cov-univ">
              <b className="num">{n(corte.universo_declarado)}</b>
              <span>RUT distintos con giro alcanzado fuera del padrón</span>
            </div>
            <div className="cov-rows">
              <CovRow label="Riesgo alto de falso positivo" value={t?.universo_riesgo_alto ?? 0} max={corte.universo_declarado} color="var(--sig-critical)" />
              <CovRow label="Concentrado en los 4 códigos mayores" value={t?.universo_top4 ?? 0} max={corte.universo_declarado} color="var(--sig-high)" />
              <CovRow label="Suma bruta por código" value={t?.universo_bruto ?? 0} max={corte.universo_declarado} color="var(--sig-medium)" />
              <CovRow label="Consolidado de RUT distintos" value={corte.universo_declarado} max={corte.universo_declarado} color="var(--ink-3)" />
            </div>
            <div style={{ marginTop: 12 }}>
              <span className="badge badge-unknown">{corte.universo_estado}</span>
            </div>
            <p style={{ margin: '10px 0 0', fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.55 }}>
              {corte.universo_nota}
            </p>
          </Panel>

          <Panel title="Qué parte del padrón admite screening por giro" meta={`${n(padron)} inscritos`}>
            <StateBar
              total={padron}
              rows={[
                { key: 'A', label: 'Con gatillante', value: cubiertos, color: 'var(--accent)' },
                { key: 'B', label: 'Otro modo', value: otroModo, color: 'var(--unknown)' },
                { key: 'C', label: 'Sin gatillante A', value: sinGatillante, color: 'var(--line-strong)' },
              ]}
            />
            <p style={{ margin: '12px 0 0', fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.55 }}>
              El tercer grupo no es un residuo: son sectores cuyo ACTECO sólo pondera y nunca
              gatilla. Contarlos como cubiertos inflaría la cobertura declarada.
            </p>
          </Panel>
        </div>
      </div>

      <div className="pulse-grid-wide" style={{ marginBottom: 16 }}>
        <Panel
          title="Gatillantes ACTECO"
          pad={false}
          actions={
            <div className="seg">
              <button data-on={orden === 'universo'} onClick={() => setOrden('universo')}>Universo</button>
              <button data-on={orden === 'pureza'} onClick={() => setOrden('pureza')}>Pureza</button>
              <button data-on={orden === 'riesgo'} onClick={() => setOrden('riesgo')}>Riesgo</button>
            </div>
          }
        >
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Glosa</th>
                  <th className="right">Universo</th>
                  <th className="right">Inscritos</th>
                  <th className="right">Pureza</th>
                  <th className="right">Riesgo</th>
                </tr>
              </thead>
              <tbody>
                {actecos.slice(0, 16).map((a) => (
                  <tr key={a.acteco}>
                    <td className="num" style={{ fontWeight: 600 }}>{a.acteco}</td>
                    <td style={{ fontSize: 11.5, color: 'var(--ink-2)' }}>
                      {titleCase(a.glosa)}
                      {a.sectores.length > 1 && (
                        <span style={{ display: 'block', fontSize: 10.5, color: 'var(--ink-4)', marginTop: 2 }}>
                          caracteriza {a.sectores.length} sectores
                        </span>
                      )}
                    </td>
                    <td className="right num" style={{ color: 'var(--ink)' }}>{a.universo == null ? '—' : n(a.universo)}</td>
                    <td className="right num">{a.inscritos_con_codigo == null ? '—' : n(a.inscritos_con_codigo)}</td>
                    <td className="right num">{a.pureza_max == null ? '—' : `${n1(a.pureza_max * 100)}%`}</td>
                    <td className="right">
                      <span className="gap-ratio" data-risk={a.riesgo ?? 'BAJO'}>{a.riesgo ?? '—'}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ margin: 0, padding: '12px 18px', fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.55, borderTop: '1px solid var(--line-soft)' }}>
            La <b style={{ color: 'var(--ink-2)' }}>pureza</b> es la fracción de quienes declaran el
            código que sí figuran en el padrón, y es lo que separa un gatillante útil de uno que
            arrastra ruido: dos códigos pueden abrir universos casi idénticos y significar cosas
            distintas. El riesgo ordena por esa impureza, no por el tamaño del universo. Un mismo
            código puede caracterizar a más de un sector, de modo que sumar filas cuenta RUT dos veces.
          </p>
        </Panel>

        <Panel title="Sectores que no se leen desde el giro" meta={`${n(data.modos.length)} sectores · ${n(otroModo)} inscritos`} pad={false}>
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Sector obligado</th>
                  <th>Fuente que lo define</th>
                  <th className="right">Inscritos</th>
                </tr>
              </thead>
              <tbody>
                {data.modos.map((m) => (
                  <tr key={m.uaf_sector}>
                    <td style={{ fontWeight: 550 }}>
                      {m.uaf_sector}
                      <span style={{ display: 'block', fontSize: 10.5, color: 'var(--ink-4)', marginTop: 3, fontWeight: 400, lineHeight: 1.45 }}>
                        {m.note}
                      </span>
                    </td>
                    <td style={{ fontSize: 11.5, color: 'var(--ink-2)' }}>
                      {m.external_source ?? '—'}
                      <span className="badge badge-unknown" style={{ display: 'block', marginTop: 4, width: 'fit-content' }}>
                        {m.mode === 'REGISTRO_EXTERNO' ? 'registro externo' : 'no evaluable en la nómina PJ'}
                      </span>
                    </td>
                    <td className="right num" style={{ color: 'var(--ink)' }}>{n(m.inscritos)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ margin: 0, padding: '12px 18px', fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.55, borderTop: '1px solid var(--line-soft)' }}>
            Su calidad jurídica no se deduce del giro declarado: la licencia es personal, o nace de
            una concesión o de un registro sectorial. Se declaran aparte porque aparecerían con
            brecha cero, y una brecha cero aquí sugeriría cobertura total.
          </p>
        </Panel>
      </div>

      <Semantics>
        <strong>Qué significa esta vista.</strong> {data.semantics}
      </Semantics>

      <div style={{ margin: '16px 0 0' }}>
        <button className="btn" onClick={() => onNavigate(hrefFor({ view: 'pulso' }))}>
          ← Volver al Pulso del universo obligado
        </button>
      </div>
    </div>
  );
}

function ordenarActecos(rows: UafScreeningActeco[], modo: Orden) {
  const copia = rows.slice();
  if (modo === 'pureza') {
    return copia.sort((a, b) => (b.pureza_max ?? -1) - (a.pureza_max ?? -1));
  }
  if (modo === 'riesgo') {
    /* El riesgo es una escala ordenada, no un texto: alfabéticamente ALTO iría
       antes que BAJO y que MEDIO, y la tabla quedaría al revés de su sentido. */
    return copia.sort(
      (a, b) =>
        (RIESGO_ORDEN[a.riesgo ?? 'BAJO'] ?? 9) - (RIESGO_ORDEN[b.riesgo ?? 'BAJO'] ?? 9)
        || (b.universo ?? 0) - (a.universo ?? 0),
    );
  }
  return copia.sort((a, b) => (b.universo ?? -1) - (a.universo ?? -1));
}

function CovKpi({
  label, value, share, foot, tone,
}: {
  label: string; value: string; share?: string; foot?: string; tone: string;
}) {
  return (
    <div className="kpi" style={{ ['--kpi-tone' as string]: tone, cursor: 'default' }}>
      <div className="kpi-top"><span className="kpi-label">{label}</span></div>
      <div className="kpi-value num" style={{ color: tone }}>{value}</div>
      {share && <div className="kpi-share">{share}</div>}
      {foot && <div className="kpi-foot">{foot}</div>}
    </div>
  );
}

function CovRow({
  label, value, max, color,
}: {
  label: string; value: number; max: number; color: string;
}) {
  return (
    <div className="cov-row">
      <span>{label}</span>
      <span className="cov-row-track">
        <i style={{ width: `${Math.min(100, (value / Math.max(1, max)) * 100)}%`, background: color }} />
      </span>
      <b className="num">{n(value)}</b>
    </div>
  );
}
