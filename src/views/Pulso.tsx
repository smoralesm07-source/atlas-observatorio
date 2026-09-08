import { useMemo, useState, type ReactNode } from 'react';
import { useRpc } from '../lib/rpc';
import { hrefFor } from '../lib/router';
import type {
  Pulse, UafAttentionRow, UafMotive, UafPulse, UafReportingSector,
} from '../lib/contracts';
import { Bars, Columns, OrderedDistribution, StateBar } from '../components/charts';
import { Empty, ErrorBox, Loading, Panel, Semantics } from '../components/primitives';
import { fecha, n, n1, titleCase } from '../lib/format';
import { AlertCard } from '../components/AlertCard';
import { CohortDrawer, type CohortRequest } from '../components/CohortDrawer';

/* EL PULSO
   ────────
   Primera pantalla del turno de un analista de inteligencia financiera o de un
   fiscalizador UAF. Responde cuatro preguntas, en el orden en que se hacen:

     1. De qué está hecho el padrón y en qué estado registral está.
     2. Cuánto reporta el universo obligado y quién sostiene ese volumen.
     3. Qué sujetos concretos piden revisión hoy, y por qué cada uno.
     4. Dónde operan, en qué industria y con qué otras fuentes cruzan.

   Cada cifra es una puerta: se pincha y aparecen los nombres que la componen,
   con su antecedente. Y cada cifra carga lo que no es —el estado ante el SII no
   mide cumplimiento, el IGR describe la comuna y no al sujeto, la reportabilidad
   es sectorial y jamás se atribuye a una entidad. */

const MOTIVE: Record<UafMotive, { label: string; hint: string }> = {
  SANCION_RECIENTE:  { label: 'Sanción últimos 5 años', hint: 'antecedente sancionatorio con resolución abrible' },
  SANCION_HISTORICA: { label: 'Sanción histórica',      hint: 'antecedente anterior a los últimos 5 años' },
  TERMINO_GIRO:      { label: 'Término de giro',        hint: 'cerró giro ante el SII y sigue inscrito en el padrón' },
  IPF_ALTA:          { label: 'IPF alta o muy alta',    hint: 'posición extrema del índice de priorización fiscalizadora' },
  SECTOR_SIN_ROS:    { label: 'Sector sin ROS 2021-2025', hint: 'su sector no registra ROS agregados en cinco años' },
  GIRO_ATIPICO:      { label: 'Giro atípico en su sector', hint: 'actividad principal poco frecuente entre sus pares' },
  SIN_TERRITORIO:    { label: 'Sin territorio observado', hint: 'persona jurídica sin comuna observable' },
};

/* Series nacionales que el Informe Estadístico publica con historia completa.
   Las de un solo punto no entran al gráfico: una columna sola no es una serie. */
const SERIES: { key: string; label: string; unit: string; lede: string; accent: string }[] = [
  { key: 'ros_recibidos', label: 'ROS', unit: 'reportes de operación sospechosa',
    lede: 'Reportes de operación sospechosa recibidos por la UAF. Se emiten ante una operación sospechosa, no con periodicidad fija.',
    accent: 'var(--accent)' },
  { key: 'roe_recibidos_miles', label: 'ROE', unit: 'miles de reportes de operación en efectivo',
    lede: 'Reportes de operación en efectivo sobre el umbral legal. Su caída sostenida convive con el alza de ROS: miden cosas distintas.',
    accent: 'var(--sig-watch)' },
  { key: 'acciones_supervision', label: 'Fiscalización', unit: 'acciones de supervisión',
    lede: 'Acciones de supervisión ejecutadas por la UAF en el año. Es capacidad desplegada, no cobertura del padrón.',
    accent: 'var(--sig-medium)' },
  { key: 'entidades_reportantes_total', label: 'Padrón', unit: 'personas y entidades inscritas',
    lede: 'Entidades reportantes inscritas al cierre de cada año, según el propio informe. No es el padrón operativo del Observatorio.',
    accent: 'var(--unknown)' },
];

export function Pulso({ onNavigate }: { onNavigate: (hash: string) => void }) {
  const { data, error, loading, reload } = useRpc<UafPulse>('obs_uaf_pulse', {});
  const [cohort, setCohort] = useState<CohortRequest | null>(null);
  const [serie, setSerie] = useState(SERIES[0].key);
  const [repOrden, setRepOrden] = useState<'padron' | 'intensidad' | 'volumen'>('padron');
  const [signalsOpen, setSignalsOpen] = useState(false);

  const rep = data?.reporting;
  const sectoresRep = useMemo(() => ordenarSectores(rep?.sectores ?? [], repOrden), [rep, repOrden]);
  const masIntenso = useMemo(
    () => ordenarSectores(rep?.sectores ?? [], 'volumen')[0] ?? null,
    [rep],
  );
  const masNumerosos = useMemo(
    () => ordenarSectores(rep?.sectores ?? [], 'padron').slice(0, 3),
    [rep],
  );

  if (loading) return <Loading label="Leyendo el padrón de sujetos obligados…" />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data?.universe) {
    return <Empty title="Sin padrón publicado" hint="Aún no hay un corte del universo UAF en este snapshot." />;
  }

  const u = data.universe;
  const c = data.crosscuts;
  const t = rep?.totales;
  const open = (req: CohortRequest) => setCohort(req);
  const igrAlto = data.by_region.reduce((a, r) => a + r.en_igr_alto, 0);
  const serieActiva = SERIES.find((s) => s.key === serie) ?? SERIES[0];
  const serieDatos = rep?.nacional?.[serie];

  /* Concentración: la cifra que cambia la lectura de todo el tablero. Tres
     sectores de cincuenta explican la mayor parte del volumen reportado, y el
     contraste con los tres sectores más numerosos del padrón es la lectura. */
  const concentracion = t?.ros_2025 ? (t.ros_top3 / t.ros_2025) * 100 : null;
  const rosDeLosNumerosos = masNumerosos.reduce((a, x) => a + (x.ros_2025 ?? 0), 0);
  const inscritosDeLosNumerosos = masNumerosos.reduce((a, x) => a + (x.padron_sujetos ?? 0), 0);

  return (
    <div className="fade-in">
      {/* ── 1. Banda de mando ─────────────────────────────────────────── */}
      <header className="pulse-command">
        <div style={{ minWidth: 0 }}>
          <div className="pulse-kicker">Padrón UAF · Ley 19.913 · Chile</div>
          <h1>Pulso del universo obligado</h1>
          <p className="view-lede">
            {n(u.total)} sujetos inscritos en el registro de la UAF, leídos contra su ciclo
            de vida ante el SII, el territorio donde operan, la reportabilidad publicada de
            su sector y su cruce con sanción, prensa, compras públicas y OSFL. Cada cifra
            abre la lista de quiénes la componen.
          </p>
        </div>

        <div className="pulse-meta">
          <span className="pulse-meta-item">
            <i />
            <b>Padrón operativo</b> 30-06-2026
          </span>
          <span className="pulse-meta-item">
            <b>Reportabilidad</b> {rep?.corte.periodo ?? '—'} · Informe Estadístico UAF
          </span>
          {data.snapshot && (
            <span className="pulse-meta-item">
              <b>Corte</b> {fecha(data.snapshot.published_at ?? data.snapshot.generated_at)}
            </span>
          )}
        </div>

        {/* Atajos de cohorte: el filtro no cambia el tablero, abre la lista.
            Cambiar el tablero entero por un filtro haría perder el encuadre. */}
        <div className="pulse-quick">
          <span style={{ fontSize: 11, color: 'var(--ink-4)', alignSelf: 'center', marginRight: 4 }}>
            Ir directo a
          </span>
          <QuickChip label="Todo el padrón" value={u.total} onClick={() => open({ cohort: 'TODOS', title: 'Padrón completo de sujetos obligados' })} />
          <QuickChip label="Con antecedente sancionatorio" value={c?.sancionados_con_antecedente ?? 0}
            onClick={() => open({ cohort: 'SANCIONADO', title: 'Sujetos con antecedente sancionatorio', hint: 'con resumen y enlace a la resolución' })} />
          <QuickChip label="Término de giro" value={u.terminados}
            onClick={() => open({ cohort: 'TERMINO_GIRO', title: 'Sujetos con término de giro', hint: 'siguen inscritos en el registro UAF' })} />
          <QuickChip label="IPF alta" value={u.ipf_alto}
            onClick={() => open({ cohort: 'IPF_ALTO', title: 'Sujetos con IPF alta o muy alta' })} />
          <QuickChip label="Sector sin ROS" value={t?.sujetos_en_silencio ?? 0}
            onClick={() => open({ cohort: 'SECTOR_SIN_ROS', title: 'Sujetos en sectores sin ROS 2021-2025', hint: 'silencio agregado del sector, nunca del sujeto' })} />
          <QuickChip label="Proveedores del Estado" value={c?.proveedores ?? 0}
            onClick={() => open({ cohort: 'PROVEEDOR_ESTADO', title: 'Sujetos que son proveedores del Estado', hint: 'ventana de 12 meses' })} />
        </div>
      </header>

      {/* ── 2. Composición del padrón ─────────────────────────────────── */}
      <div className="kpi-row">
        <Kpi
          label="Padrón inscrito" value={n(u.total)} tone="var(--accent)" glyph={<GlyphPadron />}
          share={`${n(u.sectores_uaf)} sectores de la Ley 19.913`}
          foot={`${n(u.juridicas)} jurídicas · ${n(u.naturales)} naturales · ${n(u.organismos)} organismos`}
          onClick={() => open({ cohort: 'TODOS', title: 'Padrón completo de sujetos obligados' })}
        />
        <Kpi
          label="Activos ante el SII" value={n(u.activos)} tone="var(--present)" glyph={<GlyphActivo />}
          share={`${n1((u.activos / Math.max(1, u.total)) * 100)}% del padrón`}
          foot={`${n1(u.antiguedad_media ?? 0)} años de actividad en promedio`}
          onClick={() => open({ cohort: 'ACTIVO', title: 'Sujetos activos ante el SII' })}
        />
        <Kpi
          label="Con término de giro" value={n(u.terminados)} tone="var(--sig-high)" glyph={<GlyphTermino />}
          share={`${n1((u.terminados / Math.max(1, u.total)) * 100)}% del padrón`}
          foot="cerraron giro y siguen inscritos"
          onClick={() => open({ cohort: 'TERMINO_GIRO', title: 'Sujetos con término de giro', hint: 'siguen inscritos en el registro UAF' })}
        />
        <Kpi
          label="Sin perfil SII" value={n(u.sin_perfil)} tone="var(--unknown)" glyph={<GlyphSinPerfil />}
          share={`${n1((u.sin_perfil / Math.max(1, u.total)) * 100)}% del padrón`}
          foot="personas naturales · no es brecha registral"
          onClick={() => open({ cohort: 'SIN_PERFIL_SII', title: 'Sujetos sin perfil SII de persona jurídica', hint: 'personas naturales inscritas' })}
        />
        <Kpi
          label="Piden revisión" value={n(u.en_atencion)} tone="var(--sig-critical)" glyph={<GlyphAtencion />}
          share={`${n1((u.en_atencion / Math.max(1, u.total)) * 100)}% con motivo declarado`}
          foot={`${n(data.attention.motivos.length)} motivos, uno por sujeto`}
          onClick={() => open({ cohort: 'ATENCION', title: 'Sujetos que piden revisión', hint: 'ordenados por motivo de mayor precedencia' })}
        />
      </div>

      {/* ── 3. Reportabilidad nacional + estado registral ──────────────── */}
      <div className="pulse-grid-wide" style={{ marginBottom: 16 }}>
        <Panel
          title="Lo que el universo obligado reporta"
          actions={
            <div className="seg" role="tablist" aria-label="Serie publicada">
              {SERIES.map((s) => (
                <button key={s.key} role="tab" aria-selected={s.key === serie}
                  data-on={s.key === serie} onClick={() => setSerie(s.key)}>
                  {s.label}
                </button>
              ))}
            </div>
          }
        >
          <p style={{ margin: '0 0 4px', fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.55, maxWidth: '72ch' }}>
            {serieActiva.lede}
          </p>
          {serieDatos?.puntos?.length ? (
            <>
              <Columns
                accent={serieActiva.accent}
                data={[
                  ...serieDatos.puntos
                    .filter((p) => /^\d{4}$/.test(p.periodo))
                    .map((p) => ({ label: p.periodo, value: p.valor })),
                  /* 2026 todavía no tiene informe publicado. Se dibuja el hueco
                     y se rotula: omitirlo sugeriría que la serie terminó. */
                  { label: '2026', value: null, ghost: true, note: 'sin publicar' },
                ]}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginTop: 12 }}>
                <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>
                  {serieActiva.unit} · corte {serieDatos.corte ?? '—'}
                </span>
                {serieDatos.fuente && (
                  <a className="ev-link" style={{ marginTop: 0, fontSize: 11.5 }}
                    href={serieDatos.fuente} target="_blank" rel="noreferrer">
                    Informe Estadístico UAF →
                  </a>
                )}
              </div>
            </>
          ) : (
            <Empty title="Serie no publicada en este corte" />
          )}
        </Panel>

        <Panel title="Estado registral ante el SII" meta="cada estado abre su lista">
          <StateBar
            total={u.total}
            onPick={(k) => {
              if (k === 'ACTIVO') open({ cohort: 'ACTIVO', title: 'Sujetos activos ante el SII' });
              if (k === 'TERMINO_GIRO') open({ cohort: 'TERMINO_GIRO', title: 'Sujetos con término de giro', hint: 'siguen inscritos en el registro UAF' });
              if (k === 'SIN_PERFIL_SII') open({ cohort: 'SIN_PERFIL_SII', title: 'Sujetos sin perfil SII de persona jurídica', hint: 'personas naturales inscritas' });
            }}
            rows={[
              { key: 'ACTIVO', label: 'Activos con SII', value: u.activos, color: 'var(--present)' },
              { key: 'TERMINO_GIRO', label: 'Término de giro', value: u.terminados, color: 'var(--sig-high)' },
              { key: 'SIN_PERFIL_SII', label: 'Sin perfil SII', value: u.sin_perfil, color: 'var(--unknown)' },
            ]}
          />
          <div className="callout" style={{ marginTop: 16 }}>
            <div>
              <b>El estado ante el SII no mide cumplimiento.</b>{' '}
              Un término de giro es una condición tributaria: describe el cierre del giro,
              no una conclusión LA/FT ni una baja del registro. Y {n(u.sin_perfil)} sujetos
              sin perfil de persona jurídica son personas naturales inscritas, no una brecha.
            </div>
          </div>
          <p style={{ margin: '12px 0 0', fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.55 }}>
            {data.coverage.uaf_registration_note}
          </p>
        </Panel>
      </div>

      {/* ── 4. Quién sostiene el volumen reportado ─────────────────────── */}
      {rep?.disponible && (
        <Panel
          title="Quién sostiene la reportabilidad"
          pad={false}
          actions={
            <div className="seg">
              <button data-on={repOrden === 'padron'} onClick={() => setRepOrden('padron')}>Tamaño del padrón</button>
              <button data-on={repOrden === 'intensidad'} onClick={() => setRepOrden('intensidad')}>Intensidad</button>
              <button data-on={repOrden === 'volumen'} onClick={() => setRepOrden('volumen')}>Volumen ROS</button>
            </div>
          }
        >
          <div style={{ padding: '14px 18px 4px', display: 'grid', gap: 12 }}>
            {concentracion != null && t && masIntenso && masNumerosos.length === 3 && (
              <div className="callout accent">
                <div>
                  <b>Tres sectores explican el {n1(concentracion)}% de los ROS de 2025.</b>{' '}
                  De {n(t.ros_2025)} reportes del año, {n(t.ros_top3)} vienen de los tres
                  sectores que más reportan, encabezados por {titleCase(masIntenso.etiqueta)} con{' '}
                  {n(masIntenso.padron_sujetos ?? masIntenso.registered_so_2025 ?? 0)} inscritos.
                  En el otro extremo, los tres sectores más numerosos del padrón suman{' '}
                  {n(inscritosDeLosNumerosos)} inscritos y {n(rosDeLosNumerosos)} ROS en el mismo
                  año. La intensidad de reporte no sigue al tamaño del padrón, y es esa brecha
                  —no el volumen— la que orienta dónde mirar.
                </div>
              </div>
            )}
            {t && t.sectores_silenciosos > 0 && (
              <div className="callout">
                <div>
                  <b>{n(t.sectores_silenciosos)} sectores no registran ningún ROS entre 2021 y 2025</b>,
                  con {n(t.sujetos_en_silencio)} inscritos vigentes entre todos. Otros{' '}
                  {n(t.sectores_sin_inscritos)} sectores canónicos de la ley no tienen ningún
                  inscrito en el padrón. {data.coverage.silence_note}
                </div>
              </div>
            )}
          </div>

          <div style={{ padding: '4px 0 0' }}>
            <div className="rep-row" style={{ cursor: 'default', borderBottom: '1px solid var(--line)', paddingTop: 4, paddingBottom: 8 }}>
              <span style={{ fontSize: 10.5, fontWeight: 650, letterSpacing: '.09em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>Sector obligado</span>
              <span className="rep-hide" style={{ fontSize: 10.5, fontWeight: 650, letterSpacing: '.09em', textTransform: 'uppercase', color: 'var(--ink-3)', textAlign: 'right' }}>Padrón</span>
              <span style={{ fontSize: 10.5, fontWeight: 650, letterSpacing: '.09em', textTransform: 'uppercase', color: 'var(--ink-3)', textAlign: 'right' }}>ROS 2025</span>
              <span className="rep-hide" style={{ fontSize: 10.5, fontWeight: 650, letterSpacing: '.09em', textTransform: 'uppercase', color: 'var(--ink-3)', textAlign: 'right' }}>ICR</span>
            </div>
            {sectoresRep.slice(0, 14).map((s) => (
              <SectorReportRow
                key={s.sector_official}
                s={s}
                peak={Math.max(1, ...sectoresRep.map((x) => x.ros_per_100_so_2025 ?? 0))}
                onPick={() =>
                  s.sector_canonical
                    ? open({ cohort: 'SECTOR', value: s.sector_canonical, title: s.sector_canonical })
                    : undefined
                }
              />
            ))}
          </div>

          <p style={{ margin: 0, padding: '12px 18px 14px', fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.55, borderTop: '1px solid var(--line-soft)' }}>
            <b style={{ color: 'var(--ink-2)' }}>Cómo leer esta tabla.</b>{' '}
            La intensidad es ROS 2025 por cada 100 inscritos y usa el padrón del Informe
            Estadístico al {rep.corte.padron_referencia_corte} ({n(rep.corte.padron_referencia)}),
            que es un corte distinto del padrón operativo. La barra está en escala
            logarítmica porque la intensidad recorre cinco órdenes de magnitud: conserva
            el orden entre sectores, no la proporción entre ellos. El ICR es la proporción de ROS con
            indicios LA/FT sobre los ROS enviados en 2021-2025: describe la conversión
            histórica del sector, no la calidad de un reporte ni el riesgo de una entidad.{' '}
            {data.coverage.reporting_note}
          </p>
        </Panel>
      )}

      {/* ── 5. Cola de revisión ───────────────────────────────────────── */}
      <Panel
        title="Sujetos que piden revisión"
        meta={`${n(data.attention.total)} con motivo · se muestran los ${n(Math.min(12, data.attention.top.length))} de mayor precedencia`}
        pad={false}
        actions={
          <button className="btn" style={{ padding: '6px 12px', fontSize: 12 }}
            onClick={() => open({ cohort: 'ATENCION', title: 'Sujetos que piden revisión', hint: 'ordenados por motivo de mayor precedencia' })}>
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
              onClick={() => open({
                cohort: 'MOTIVO', value: m.motivo,
                title: MOTIVE[m.motivo]?.label ?? m.motivo,
                hint: MOTIVE[m.motivo]?.hint,
              })}
            >
              <span className="motive" data-m={m.motivo} style={{ padding: 0, border: 0, background: 'none' }}>
                <i />
              </span>
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
                  <AttentionRow key={r.rut} r={r} onOpen={() => open({
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

      {/* ── 6. Señales de patrón, replegadas ──────────────────────────── */}
      <div style={{ margin: '16px 0' }}>
        <button
          className="btn"
          style={{ width: '100%', justifyContent: 'space-between' }}
          onClick={() => setSignalsOpen((v) => !v)}
        >
          <span>
            Señales de patrón sobre el padrón · <b className="num">{n(c?.con_senal ?? 0)}</b> sujetos
            con al menos una
          </span>
          <span style={{ color: 'var(--ink-4)' }}>{signalsOpen ? 'Replegar ▲' : 'Desplegar ▼'}</span>
        </button>
      </div>
      {signalsOpen && <SignalsPanel onNavigate={onNavigate} />}

      {/* ── 7. Territorio e industria ─────────────────────────────────── */}
      <div className="pulse-grid-wide" style={{ marginBottom: 16 }}>
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
                {data.by_region.map((r) => (
                  <tr
                    key={r.region}
                    style={{ cursor: 'pointer' }}
                    onClick={() => open({ cohort: 'REGION', value: r.region, title: `Sujetos obligados en ${r.region}` })}
                  >
                    <td style={{ fontWeight: 550 }}>{r.region}</td>
                    <td className="right num">{n(r.sujetos)}</td>
                    <td className="right num" style={{ color: r.en_atencion > 0 ? 'var(--sig-medium)' : undefined }}>{n(r.en_atencion)}</td>
                    <td className="right num">{n(r.terminados)}</td>
                    <td className="right num" style={{ color: r.sancionados > 0 ? 'var(--sig-critical)' : undefined }}>{n(r.sancionados)}</td>
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

        <div className="grid" style={{ gap: 16, alignContent: 'start' }}>
          <Panel title="Entorno territorial donde operan" meta="banda IGR de la comuna">
            <OrderedDistribution
              total={u.total}
              rows={data.igr_mix
                .filter((g) => g.banda !== 'Sin IGR')
                .map((g) => ({ label: g.banda, value: g.sujetos, step: igrStep(g.banda) }))}
            />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
              <button className="chip" onClick={() => open({ cohort: 'IGR_MUY_ALTO', title: 'Sujetos en comunas de IGR muy alto' })}>
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

          <Panel title="Prioridad fiscalizadora (IPF)" meta={`media ${n1(u.ipf_medio)} · P90 ${n1(u.ipf_p90)}`}>
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
                  open({ cohort: 'IPF_ALTO', title: 'Sujetos con IPF alta o muy alta' });
                }
              }}
            />
            <p style={{ margin: '12px 0 0', fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.55 }}>
              El IPF ordena revisión dentro del padrón combinando vulnerabilidad sectorial,
              historial de supervisión, coherencia registral, escala y brecha de
              observabilidad. Es prioridad comparativa, no probabilidad de LA/FT. Los{' '}
              {n(data.ipf_bands.find((b) => b.banda === 'SIN_IPF')?.sujetos ?? 0)} organismos
              públicos quedan fuera del índice porque no son comparables con el sector privado.
              La antigüedad media del padrón es de {n1(u.antiguedad_media)} años, calculada
              sobre los {n(u.con_inicio)} sujetos con inicio de actividades ante el SII.
            </p>
          </Panel>
        </div>
      </div>

      {/* ── 8. Sector obligado e industria real ───────────────────────── */}
      <div className="grid grid-2" style={{ marginBottom: 16 }}>
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
            dedica de verdad según su giro tributario. Cuando divergen, la diferencia es la
            que interesa mirar: {n(u.giro_atipico)} sujetos declaran un giro poco frecuente
            entre sus pares de sector.
          </p>
        </Panel>
      </div>

      {/* ── 9. Ciclo de vida, sanción y cruces ────────────────────────── */}
      <div className="grid grid-3" style={{ marginBottom: 16 }}>
        <Panel title="Término de giro por año" meta="pincha un año">
          {data.lifecycle.terminated_by_year.length === 0 ? (
            <Empty title="Sin términos de giro registrados" />
          ) : (
            <>
              <Bars
                data={data.lifecycle.terminated_by_year.slice(0, 8).map((y) => ({
                  label: String(y.ano), value: y.n, tone: 'high' as const,
                }))}
                onPick={(label) => open({
                  cohort: 'TERMINO_ANO', value: label,
                  title: `Término de giro en ${label}`,
                  hint: 'candidatos a gestión de desvinculación',
                })}
              />
              <p style={{ margin: '12px 0 0', fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.55 }}>
                Un sujeto que cerró su giro y sigue inscrito es un candidato a contacto y
                evaluación de desvinculación del registro. El cierre tributario no extingue
                por sí solo la obligación de estar inscrito.
              </p>
            </>
          )}
        </Panel>

        <Panel
          title="Sanciones sobre el padrón por año"
          meta={`${n(data.sanctions.eventos)} eventos · ${n(data.sanctions.con_documento)} con documento`}
        >
          {data.sanctions.by_year.length === 0 ? (
            <Empty title="Sin eventos sancionatorios fechados" />
          ) : (
            <>
              <Bars
                data={data.sanctions.by_year
                  .slice()
                  .sort((a, b) => b.ano - a.ano)
                  .slice(0, 8)
                  .map((y) => ({
                    label: String(y.ano), value: y.eventos, tone: 'critical' as const,
                    sub: `${y.sujetos} sujeto${y.sujetos === 1 ? '' : 's'}`,
                  }))}
              />
              <p style={{ margin: '12px 0 0', fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.55 }}>
                Eventos resueltos por RUT sobre el padrón, con su resolución cuando la fuente
                publica el documento. Último registrado: {fecha(data.sanctions.ultimo)}.{' '}
                {data.coverage.sanction_note}
              </p>
            </>
          )}
        </Panel>

        <Panel title="Caracterización cruzada" meta="cada marca abre su lista">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <CrossRow
              label="Con antecedente sancionatorio"
              value={c?.sancionados_con_antecedente ?? 0}
              sub={`${n(c?.antecedentes_sancion ?? 0)} resoluciones con documento`}
              tone="var(--sig-critical)"
              onClick={() => open({ cohort: 'SANCIONADO', title: 'Sujetos con antecedente sancionatorio', hint: 'con resumen y enlace a la resolución' })}
            />
            <CrossRow
              label="Figuran en prensa"
              value={c?.prensa ?? 0}
              sub={`${n(c?.antecedentes_prensa ?? 0)} menciones · sin enlace en origen`}
              onClick={() => open({ cohort: 'PRENSA', title: 'Sujetos que figuran en prensa' })}
            />
            <CrossRow
              label="Proveedores del Estado"
              value={c?.proveedores ?? 0}
              sub="corte de compras públicas, cobertura parcial"
              onClick={() => open({ cohort: 'PROVEEDOR_ESTADO', title: 'Sujetos que son proveedores del Estado', hint: 'ventana de 12 meses' })}
            />
            <CrossRow
              label="Organizaciones sin fines de lucro"
              value={c?.osfl ?? 0}
              sub="cruce con el universo OSFL"
              onClick={() => open({ cohort: 'OSFL', title: 'Sujetos obligados que son OSFL' })}
            />
            <CrossRow
              label="Cambiaron su actividad declarada"
              value={u.cambio_actividad}
              sub="cambio de giro registrado ante el SII"
              tone="var(--sig-watch)"
              onClick={() => open({ cohort: 'CAMBIO_ACTIVIDAD', title: 'Sujetos que cambiaron su actividad declarada', hint: 'cambio observado en el corte tributario' })}
            />
            <CrossRow
              label="Giro atípico en su sector"
              value={u.giro_atipico}
              sub="actividad poco frecuente entre pares del sector"
              tone="var(--sig-watch)"
              onClick={() => open({ cohort: 'GIRO_ATIPICO', title: 'Sujetos con giro atípico en su sector', hint: 'describe la distancia al giro modal, no una irregularidad' })}
            />
          </div>
        </Panel>
      </div>

      <Semantics>
        <strong>Qué significa este tablero.</strong> {data.semantics}{' '}
        {data.coverage.uaf_registration_note}{' '}
        {data.coverage.denominator_note}{' '}
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

/* ─────────────────────────────────────────────────────────── piezas */

function ordenarSectores(rows: UafReportingSector[], modo: 'padron' | 'intensidad' | 'volumen') {
  const v = (x: number | null | undefined) => (x == null ? -1 : x);
  const copia = rows.slice();
  if (modo === 'intensidad') {
    return copia.sort((a, b) => v(b.ros_per_100_so_2025) - v(a.ros_per_100_so_2025));
  }
  if (modo === 'volumen') return copia.sort((a, b) => v(b.ros_2025) - v(a.ros_2025));
  return copia.sort((a, b) => v(b.padron_sujetos) - v(a.padron_sujetos) || v(b.registered_so_2025) - v(a.registered_so_2025));
}

function SectorReportRow({
  s, peak, onPick,
}: {
  s: UafReportingSector;
  peak: number;
  onPick?: () => void;
}) {
  const intensidad = s.ros_per_100_so_2025;
  /* La intensidad recorre cinco órdenes de magnitud —de 0,25 a 82.959 ROS por
     cada 100 inscritos— y en escala lineal todo lo que no sea banca queda
     pegado al cero. La escala logarítmica conserva el orden y deja ver la
     diferencia entre 0,25 y 27, que es justamente la que interesa. La barra se
     rotula como logarítmica: una escala comprimida sin decirlo engaña. */
  const ancho =
    intensidad == null ? 0
      : Math.min(100, (Math.log10(1 + intensidad) / Math.log10(1 + peak)) * 100);
  const silencio = s.silence_5y === true;
  const sinInscritos = s.sector_canonical == null;

  return (
    <button className="rep-row" onClick={onPick} disabled={!onPick} title={s.sector_official}>
      <span className="rep-name">
        <span>{titleCase(s.etiqueta)}</span>
        {silencio && <span className="motive" data-m="SECTOR_SIN_ROS"><i />sin ROS 5 años</span>}
        {sinInscritos && <span className="badge badge-absent">sin inscritos</span>}
      </span>
      <span className="rep-hide num" style={{ textAlign: 'right', fontSize: 12, color: s.padron_sujetos == null ? 'var(--ink-4)' : 'var(--ink-2)' }}>
        {/* Un sector canónico sin inscritos no tiene cero inscritos: no tiene
            padrón que contar, y un cero lo diría al revés. */}
        {s.padron_sujetos == null ? '—' : n(s.padron_sujetos)}
      </span>
      <span className="num" style={{ textAlign: 'right', fontSize: 12, fontWeight: 620 }}>
        {s.ros_2025 == null ? '—' : n(s.ros_2025)}
        <em style={{ display: 'block', fontStyle: 'normal', fontSize: 10, color: 'var(--ink-4)', fontWeight: 400 }}>
          {intensidad == null ? 'sin corte' : `${n1(intensidad)} / 100 SO`}
        </em>
      </span>
      <span className="rep-hide num" style={{ textAlign: 'right', fontSize: 12, color: s.icr_pct != null && s.icr_pct >= 10 ? 'var(--sig-medium)' : 'var(--ink-3)' }}>
        {s.icr_pct == null ? '—' : `${n1(s.icr_pct)}%`}
      </span>
      <span className="rep-bar">
        <span style={{ width: `${ancho}%`, background: silencio ? 'var(--unknown)' : 'var(--accent)' }} />
      </span>
    </button>
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
        <span className="motive" data-m={r.motivo}>
          <i />
          {MOTIVE[r.motivo]?.label ?? r.motivo}
        </span>
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
        {r.igr_level && (
          <div style={{ fontSize: 10.5, color: 'var(--ink-4)', marginTop: 2 }}>IGR comunal {r.igr_level}</div>
        )}
      </td>
      <td className="right num" style={{ color: r.ipf_band === 'MUY_ALTA' || r.ipf_band === 'ALTA' ? 'var(--sig-medium)' : undefined }}>
        {r.ipf_score == null ? '—' : n1(r.ipf_score)}
      </td>
    </tr>
  );
}

function QuickChip({ label, value, onClick }: { label: string; value: number; onClick: () => void }) {
  return (
    <button className="chip" onClick={onClick}>
      {label} <b>{n(value)}</b>
    </button>
  );
}

function Kpi({
  label, value, share, foot, tone, glyph, onClick,
}: {
  label: string; value: string; share?: string; foot?: string;
  tone: string; glyph: ReactNode; onClick: () => void;
}) {
  return (
    <button className="kpi" style={{ ['--kpi-tone' as string]: tone }} onClick={onClick}>
      <div className="kpi-top">
        <span className="kpi-label">{label}</span>
        <span className="kpi-glyph">{glyph}</span>
      </div>
      <div className="kpi-value num" style={{ color: tone }}>{value}</div>
      {share && <div className="kpi-share">{share}</div>}
      {foot && <div className="kpi-foot">{foot}</div>}
    </button>
  );
}

function CrossRow({
  label, value, sub, tone, onClick,
}: {
  label: string; value: number; sub?: string; tone?: string; onClick: () => void;
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
      <span className="num" style={{ fontSize: 15, fontWeight: 650, color: tone }}>{n(value)}</span>
      {sub && <span style={{ gridColumn: '1 / -1', fontSize: 11, color: 'var(--ink-4)' }}>{sub}</span>}
    </button>
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
              <a href={hrefFor({ view: 'senales' })} className="btn">Ver todas las señales</a>
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

const IPF_ORDER = [
  { key: 'MUY_ALTA', label: 'Muy alta', tone: 'critical' as const },
  { key: 'ALTA',     label: 'Alta',     tone: 'high' as const },
  { key: 'MEDIA',    label: 'Media',    tone: 'medium' as const },
  { key: 'BAJA',     label: 'Baja',     tone: 'watch' as const },
  { key: 'MINIMA',   label: 'Mínima',   tone: 'none' as const },
  { key: 'SIN_IPF',  label: 'Sin IPF (organismos públicos)', tone: 'none' as const },
];

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

/* Glifos de 16px. Existen para que el ojo distinga las cinco tarjetas sin
   leerlas; ninguno codifica información que el texto no diga. */
const G = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
const GlyphPadron = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden {...G}>
    <path d="M4 20V7.5l8-3.5 8 3.5V20" /><path d="M3 20h18" /><path d="M9.5 20v-5h5v5" />
  </svg>
);
const GlyphActivo = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden {...G}>
    <circle cx="12" cy="12" r="8.4" /><path d="m8.4 12.2 2.5 2.5 4.7-5" />
  </svg>
);
const GlyphTermino = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden {...G}>
    <path d="M6 3.5h8l4 4V20.5H6z" /><path d="M14 3.5v4h4" /><path d="m9.6 12.8 4.8 4.8M14.4 12.8l-4.8 4.8" />
  </svg>
);
const GlyphSinPerfil = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden {...G}>
    <circle cx="12" cy="8.6" r="3.6" /><path d="M5.4 19.4c.9-3.4 3.5-5.2 6.6-5.2s5.7 1.8 6.6 5.2" strokeDasharray="3 2.6" />
  </svg>
);
const GlyphAtencion = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden {...G}>
    <path d="M12 4.2 21 19.4H3z" /><path d="M12 10v4.2" /><path d="M12 16.8v.1" />
  </svg>
);
