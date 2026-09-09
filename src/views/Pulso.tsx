import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useRpc } from '../lib/rpc';
import { hrefFor } from '../lib/router';
import type { Pulse, UafLens, UafPulse, UafPulseReading } from '../lib/contracts';
import { Empty, ErrorBox, Loading, Panel, Semantics } from '../components/primitives';
import { fecha, n, n1, titleCase } from '../lib/format';
import { AlertCard } from '../components/AlertCard';
import { CohortDrawer, type CohortRequest } from '../components/CohortDrawer';
import { LensBar, LensPanel, type LensDef } from '../components/LensBar';
import { LenteReportabilidad } from './pulso/Reportabilidad';
import { LenteRevision } from './pulso/Revision';
import { LenteTerritorio } from './pulso/Territorio';
import { LenteCiclo } from './pulso/Ciclo';

/* EL PULSO
   ────────
   Primera pantalla del turno de un analista de inteligencia financiera o de un
   fiscalizador UAF. La zona fija responde siempre lo mismo —de qué está hecho
   el padrón y en qué estado registral está— y debajo el analista elige cuál de
   las cuatro preguntas siguientes se está haciendo:

     · Reportabilidad · cuánto reporta el universo obligado y quién lo sostiene.
     · Revisión       · qué sujetos piden mirada hoy, y por qué cada uno.
     · Territorio     · dónde operan y en qué entorno.
     · Ciclo          · cómo entra y sale el padrón, y qué se ha sancionado.

   La cobertura del padrón —quiénes deberían estar y no están— dejó de ser un
   recuadro comprimido aquí y vive en su propia vista: esta pantalla sólo
   publica su cifra ancla y la puerta.

   Cada cifra es una puerta: se pincha y aparecen los nombres que la componen,
   con su antecedente. Y cada cifra carga lo que no es —el estado ante el SII no
   mide cumplimiento, el IGR describe la comuna y no al sujeto, la reportabilidad
   es sectorial y jamás se atribuye a una entidad. */

const LENSES: LensDef[] = [
  { id: 'reportabilidad', label: 'Reportabilidad', badge: '', hint: 'series publicadas y quién sostiene el volumen reportado' },
  { id: 'revision',       label: 'Revisión',       badge: '', hint: 'cola de trabajo, prioridad fiscalizadora y cruces' },
  { id: 'territorio',     label: 'Territorio',     badge: '', hint: 'dónde operan los inscritos y en qué entorno comunal' },
  { id: 'ciclo',          label: 'Ciclo',          badge: '', hint: 'altas, términos de giro, sanciones e industria real' },
];

const LENS_STORAGE = 'atlas-obs-pulso-lente';

/* El tono de un hallazgo curado llega como nombre de token, nunca como color.
   Un valor fuera de esta lista se dibuja neutro en vez de inyectarse tal cual
   en el estilo. */
const TONOS = new Set([
  'accent', 'present', 'unknown', 'absent',
  'sig-critical', 'sig-high', 'sig-medium', 'sig-watch',
]);
const tono = (t: string | null | undefined) =>
  t && TONOS.has(t) ? `var(--${t})` : 'var(--ink)';

export function Pulso({
  onNavigate,
  lente,
}: {
  onNavigate: (hash: string) => void;
  lente?: UafLens;
}) {
  const { data, error, loading, reload } = useRpc<UafPulse>('obs_uaf_pulse', {});
  const [cohort, setCohort] = useState<CohortRequest | null>(null);
  const [signalsOpen, setSignalsOpen] = useState(false);

  /* La lente viaja en la URL para que un enlace abra la misma pantalla, y se
     recuerda entre visitas. El cambio usa replaceState y no el hash: navegar
     dispararía el scroll al tope y perdería el sitio donde se estaba leyendo. */
  const [activa, setActiva] = useState<UafLens>(() => lente ?? leerUltima() ?? 'reportabilidad');

  useEffect(() => {
    if (lente && lente !== activa) setActiva(lente);
    // Sólo reacciona a la lente que trae la ruta, no a la elegida aquí.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lente]);

  const elegir = useCallback((id: UafLens) => {
    setActiva(id);
    try { localStorage.setItem(LENS_STORAGE, id); } catch { /* navegación privada */ }
    window.history.replaceState(null, '', hrefFor({ view: 'pulso', lente: id }));
  }, []);

  if (loading) return <Loading label="Leyendo el padrón de sujetos obligados…" />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data?.universe) {
    return <Empty title="Sin padrón publicado" hint="Aún no hay un corte del universo UAF en este snapshot." />;
  }

  const u = data.universe;
  const c = data.crosscuts;
  const t = data.reporting?.totales;
  const scr = data.screening;
  const open = (req: CohortRequest) => setCohort(req);

  const lenses: LensDef[] = LENSES.map((l) => ({
    ...l,
    badge:
      l.id === 'reportabilidad' ? n(t?.ros_2025 ?? 0)
      : l.id === 'revision' ? n(u.en_atencion)
      : l.id === 'territorio' ? n(u.con_territorio)
      : n(data.sanctions.eventos),
  }));

  /* La lectura del corte se escribe, no se deduce. Si el snapshot no la trae,
     la franja no se dibuja: un hallazgo automático de relleno diría con el
     mismo énfasis algo que nadie revisó. */
  const lectura: UafPulseReading[] = (data.reading ?? []).slice().sort((a, b) => a.orden - b.orden);

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
            <b>Reportabilidad</b> {data.reporting?.corte.periodo ?? '—'} · Informe Estadístico UAF
          </span>
          {u.trabajadores != null && (
            <span className="pulse-meta-item">
              <b>Escala declarada</b> {n(u.trabajadores)} trabajadores
            </span>
          )}
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

      {/* ── 3. La lectura del corte, escrita a mano ───────────────────── */}
      {lectura.length > 0 && (
        <>
          <div className="pulse-reads-head">
            <h2>La lectura del corte</h2>
            <span>
              texto curado
              {data.snapshot && <> · {fecha(data.snapshot.published_at ?? data.snapshot.generated_at)}</>}
            </span>
          </div>
          <div className="pulse-reads">
            {lectura.map((r) => (
              <button
                key={r.orden}
                className="pulse-read"
                style={{ ['--read-tone' as string]: tono(r.tono) }}
                onClick={r.destino ? () => elegir(r.destino as UafLens) : undefined}
                disabled={!r.destino}
              >
                <span className="pulse-read-big num">{r.cifra}</span>
                <span className="pulse-read-title">{r.titulo}</span>
                <span className="pulse-read-glosa">{r.glosa}</span>
                {r.destino && (
                  <span className="pulse-read-go">
                    Ir a {LENSES.find((l) => l.id === r.destino)?.label ?? r.destino} →
                  </span>
                )}
              </button>
            ))}
          </div>
        </>
      )}

      {/* ── 4. Puerta a la cobertura del padrón ───────────────────────── */}
      {scr?.disponible && scr.corte && (
        <button className="cov-gate" onClick={() => onNavigate(hrefFor({ view: 'cobertura' }))}>
          <span className="cov-gate-fig">
            <b className="num">{n(scr.corte.universo_declarado)}</b>
            <em>fuera del padrón</em>
          </span>
          <span className="cov-gate-body">
            <span className="cov-gate-title">
              El universo observable supera al padrón por{' '}
              {n1(scr.corte.universo_declarado / Math.max(1, u.total))} veces
            </span>
            <span className="cov-gate-lede">
              RUT que el SII observa con un giro alcanzado por la Ley 19.913 y que no figuran
              en el registro de la UAF. Declarar un giro alcanzado no prueba que la entidad
              reúna los elementos que activan la obligación de inscribirse.
            </span>
            {scr.totales && (
              <span className="cov-gate-mini">
                <span><b className="num">{n(scr.totales.universo_riesgo_alto ?? 0)}</b> de códigos con riesgo alto de falso positivo</span>
                <span><b className="num">{n(scr.totales.sectores)}</b> sectores con brecha medida</span>
                <span><b className="num">{n(scr.totales.sujetos_otro_modo)}</b> inscritos que no admiten screening por giro</span>
              </span>
            )}
          </span>
          <span className="cov-gate-cta">Abrir Cobertura →</span>
        </button>
      )}

      {/* ── 5. Las cuatro lentes ──────────────────────────────────────── */}
      <LensBar lenses={lenses} active={activa} onPick={elegir} />

      <LensPanel id="reportabilidad" active={activa}>
        <LenteReportabilidad data={data} onCohort={open} />
      </LensPanel>
      <LensPanel id="revision" active={activa}>
        <LenteRevision data={data} onCohort={open} />
      </LensPanel>
      <LensPanel id="territorio" active={activa}>
        <LenteTerritorio data={data} onCohort={open} />
      </LensPanel>
      <LensPanel id="ciclo" active={activa}>
        <LenteCiclo data={data} onCohort={open} />
      </LensPanel>

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

function leerUltima(): UafLens | null {
  try {
    const v = localStorage.getItem(LENS_STORAGE);
    return LENSES.some((l) => l.id === v) ? (v as UafLens) : null;
  } catch {
    return null;
  }
}

/* ─────────────────────────────────────────────────────────── piezas */

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
