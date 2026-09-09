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
import '../styles/pulso.css';

/* PULSO · V4
   ──────────
   Síntesis operativa primero, profundidad después. El bloque superior adopta
   la densidad de OSFL y Sanciones: cifras pequeñas, comparaciones compactas y
   cada elemento como puerta de entrada. Las cuatro lentes conservan el trabajo
   analítico profundo sin obligar a recorrer una portada sobredimensionada.

   Compras públicas queda deliberadamente fuera de esta superficie. */

const LENSES: LensDef[] = [
  { id: 'reportabilidad', label: 'Reportabilidad', badge: '', hint: 'series publicadas y quién sostiene el volumen reportado' },
  { id: 'revision',       label: 'Revisión',       badge: '', hint: 'cola de trabajo, prioridad fiscalizadora y cruces' },
  { id: 'territorio',     label: 'Territorio',     badge: '', hint: 'dónde operan los inscritos y en qué entorno comunal' },
  { id: 'ciclo',          label: 'Ciclo',          badge: '', hint: 'altas, términos de giro, sanciones e industria real' },
];

const LENS_STORAGE = 'atlas-obs-pulso-lente';
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
  const [activa, setActiva] = useState<UafLens>(() => lente ?? leerUltima() ?? 'reportabilidad');

  useEffect(() => {
    if (lente && lente !== activa) setActiva(lente);
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

  const lectura: UafPulseReading[] = (data.reading ?? []).slice().sort((a, b) => a.orden - b.orden);

  const publishedRegistry = data.reporting?.nacional?.entidades_reportantes_total;
  const trendPoints = (publishedRegistry?.puntos ?? [])
    .filter((p) => /^\d{4}$/.test(p.periodo) && p.valor != null && Number.isFinite(Number(p.valor)))
    .map((p) => ({ label: p.periodo, value: Number(p.valor) }))
    .slice(-5);

  const topSectors = data.by_sector
    .slice()
    .sort((a, b) => b.sujetos - a.sujetos)
    .slice(0, 5);
  const maxSector = Math.max(1, ...topSectors.map((s) => s.sujetos));

  const topRegions = data.by_region
    .slice()
    .sort((a, b) => b.sujetos - a.sujetos)
    .slice(0, 5);
  const maxRegion = Math.max(1, ...topRegions.map((r) => r.sujetos));

  const status = [
    { key: 'active', label: 'Activos', value: u.activos, tone: 'var(--present)', cohort: 'ACTIVO' as const },
    { key: 'terminated', label: 'Término de giro', value: u.terminados, tone: 'var(--sig-high)', cohort: 'TERMINO_GIRO' as const },
    { key: 'unknown', label: 'Sin perfil SII', value: u.sin_perfil, tone: 'var(--unknown)', cohort: 'SIN_PERFIL_SII' as const },
  ];

  return (
    <div className="pulse-v4 fade-in">
      {/* ── 1. Encabezado compacto ────────────────────────────────────── */}
      <header className="pulse-command">
        <div style={{ minWidth: 0 }}>
          <div className="pulse-kicker">Padrón UAF · Ley 19.913 · Chile</div>
          <h1>Pulso del universo obligado</h1>
          <p className="view-lede">
            {n(u.total)} sujetos inscritos, leídos contra su ciclo de vida ante el SII,
            territorio, reportabilidad sectorial y cruces con sanciones, prensa y OSFL.
            Cada cifra abre la lista que la compone.
          </p>
        </div>

        <div className="pulse-meta">
          <span className="pulse-meta-item"><i /><b>Padrón operativo</b> 30-06-2026</span>
          <span className="pulse-meta-item"><b>Reportabilidad</b> {data.reporting?.corte.periodo ?? '—'}</span>
          {u.trabajadores != null && (
            <span className="pulse-meta-item"><b>Escala declarada</b> {n(u.trabajadores)} trabajadores</span>
          )}
          {data.snapshot && (
            <span className="pulse-meta-item"><b>Corte</b> {fecha(data.snapshot.published_at ?? data.snapshot.generated_at)}</span>
          )}
        </div>
      </header>

      {/* ── 2. Estado registral ───────────────────────────────────────── */}
      <div className="kpi-row">
        <Kpi
          label="Padrón inscrito" value={n(u.total)} tone="var(--accent)" glyph={<GlyphPadron />}
          share={`${n(u.sectores_uaf)} sectores Ley 19.913`}
          foot={`${n(u.juridicas)} jurídicas · ${n(u.naturales)} naturales · ${n(u.organismos)} organismos`}
          onClick={() => open({ cohort: 'TODOS', title: 'Padrón completo de sujetos obligados' })}
        />
        <Kpi
          label="Activos ante el SII" value={n(u.activos)} tone="var(--present)" glyph={<GlyphActivo />}
          share={`${n1(share(u.activos, u.total))}% del padrón`}
          foot={`${n1(u.antiguedad_media ?? 0)} años de actividad promedio`}
          onClick={() => open({ cohort: 'ACTIVO', title: 'Sujetos activos ante el SII' })}
        />
        <Kpi
          label="Con término de giro" value={n(u.terminados)} tone="var(--sig-high)" glyph={<GlyphTermino />}
          share={`${n1(share(u.terminados, u.total))}% del padrón`}
          foot="cerraron giro y siguen inscritos"
          onClick={() => open({ cohort: 'TERMINO_GIRO', title: 'Sujetos con término de giro', hint: 'siguen inscritos en el registro UAF' })}
        />
        <Kpi
          label="Sin perfil SII" value={n(u.sin_perfil)} tone="var(--unknown)" glyph={<GlyphSinPerfil />}
          share={`${n1(share(u.sin_perfil, u.total))}% del padrón`}
          foot="personas naturales · no es brecha registral"
          onClick={() => open({ cohort: 'SIN_PERFIL_SII', title: 'Sujetos sin perfil SII de persona jurídica', hint: 'personas naturales inscritas' })}
        />
        <Kpi
          label="Piden revisión" value={n(u.en_atencion)} tone="var(--sig-critical)" glyph={<GlyphAtencion />}
          share={`${n1(share(u.en_atencion, u.total))}% con motivo declarado`}
          foot={`${n(data.attention.motivos.length)} motivos, uno por sujeto`}
          onClick={() => open({ cohort: 'ATENCION', title: 'Sujetos que piden revisión', hint: 'ordenados por motivo de mayor precedencia' })}
        />
      </div>

      {/* ── 3. Lectura del corte ──────────────────────────────────────── */}
      {(lectura.length > 0 || (scr?.disponible && scr.corte)) && (
        <section className="pulse-summary-shell">
          <div className="pulse-summary-head">
            <h2>La lectura del corte</h2>
            <span>{data.snapshot ? fecha(data.snapshot.published_at ?? data.snapshot.generated_at) : 'corte vigente'}</span>
          </div>
          <div className="pulse-summary-grid">
            {lectura.map((r) => (
              <button
                key={r.orden}
                className="pulse-summary-item"
                style={{ ['--summary-tone' as string]: tono(r.tono) }}
                onClick={r.destino ? () => elegir(r.destino as UafLens) : undefined}
                disabled={!r.destino}
              >
                <span className="pulse-summary-figure">{r.cifra}</span>
                <span className="pulse-summary-title">{r.titulo}</span>
                <span className="pulse-summary-copy">{r.glosa}</span>
                {r.destino && <span className="pulse-summary-go">Profundizar →</span>}
              </button>
            ))}

            {scr?.disponible && scr.corte && (
              <button
                className="pulse-summary-item"
                style={{ ['--summary-tone' as string]: 'var(--sig-high)' }}
                onClick={() => onNavigate(hrefFor({ view: 'cobertura' }))}
              >
                <span className="pulse-summary-figure">{n(scr.corte.universo_declarado)}</span>
                <span className="pulse-summary-title">Universo observable fuera del padrón</span>
                <span className="pulse-summary-copy">
                  Equivale a {n1(scr.corte.universo_declarado / Math.max(1, u.total))} veces el padrón; un giro alcanzado no prueba obligación de inscripción.
                </span>
                <span className="pulse-summary-go">Abrir Cobertura →</span>
              </button>
            )}
          </div>
        </section>
      )}

      {/* ── 4. Panorama analítico compacto ───────────────────────────── */}
      <div className="pulse-overview-grid">
        <MiniPanel title="Evolución publicada del padrón" action="Serie →" onAction={() => elegir('reportabilidad')}>
          {trendPoints.length > 1 ? (
            <>
              <MiniLine points={trendPoints} />
              <p className="pulse-mini-note">
                Serie del Informe Estadístico UAF; no reconstruye altas y bajas del registro operativo.
              </p>
            </>
          ) : <div className="pulse-mini-empty">Sin serie histórica publicada en este corte.</div>}
        </MiniPanel>

        <MiniPanel title="Top 5 sectores" meta="por nº de sujetos" action="Ver análisis →" onAction={() => elegir('ciclo')}>
          <div className="pulse-rank-list">
            {topSectors.map((s) => (
              <button
                key={s.sector}
                className="pulse-rank-row"
                onClick={() => open({ cohort: 'SECTOR', value: s.sector, title: s.sector })}
                title={titleCase(s.sector)}
              >
                <span className="pulse-rank-name">{titleCase(s.sector)}</span>
                <span className="pulse-rank-track"><i style={{ width: `${(s.sujetos / maxSector) * 100}%` }} /></span>
                <span className="pulse-rank-value num">{n(s.sujetos)}</span>
              </button>
            ))}
          </div>
          <p className="pulse-mini-note">Selecciona un sector para abrir sus sujetos.</p>
        </MiniPanel>

        <MiniPanel title="Distribución por estado" action="Ciclo →" onAction={() => elegir('ciclo')}>
          <div className="pulse-status-total">{n(u.total)}</div>
          <div className="pulse-status-track" aria-label="Distribución del padrón por estado ante el SII">
            {status.map((s) => (
              <span
                key={s.key}
                className="pulse-status-segment"
                data-state={s.key}
                style={{ width: `${share(s.value, u.total)}%` }}
                title={`${s.label}: ${n(s.value)}`}
              >
                {share(s.value, u.total) >= 8 ? `${n1(share(s.value, u.total))}%` : ''}
              </span>
            ))}
          </div>
          <div className="pulse-status-legend">
            {status.map((s) => (
              <button
                key={s.key}
                onClick={() => open({ cohort: s.cohort, title: s.label === 'Activos' ? 'Sujetos activos ante el SII' : s.label === 'Término de giro' ? 'Sujetos con término de giro' : 'Sujetos sin perfil SII de persona jurídica' })}
              >
                <i style={{ background: s.tone }} />
                <span>{s.label}</span>
                <b>{n(s.value)}</b>
              </button>
            ))}
          </div>
        </MiniPanel>

        <MiniPanel title="Distribución territorial" action="Territorio →" onAction={() => elegir('territorio')}>
          <div className="pulse-rank-list">
            {topRegions.map((r) => (
              <button
                key={r.region}
                className="pulse-rank-row"
                onClick={() => open({ cohort: 'REGION', value: r.region, title: `Sujetos obligados en ${r.region}` })}
                title={r.region}
              >
                <span className="pulse-rank-name">{r.region}</span>
                <span className="pulse-rank-track"><i style={{ width: `${(r.sujetos / maxRegion) * 100}%` }} /></span>
                <span className="pulse-rank-value num">{n(r.sujetos)}</span>
              </button>
            ))}
          </div>
          <p className="pulse-mini-note">{n(u.con_territorio)} sujetos con territorio observado.</p>
        </MiniPanel>
      </div>

      {/* ── 5. Cruces relevantes, sin compras públicas ───────────────── */}
      <div className="pulse-crosscuts">
        <CrossTile
          label="Antecedentes sancionatorios"
          detail={`${n(c?.antecedentes_sancion ?? 0)} resoluciones observadas`}
          value={c?.sancionados_con_antecedente ?? 0}
          icon="S" tone="var(--sig-critical)"
          onClick={() => open({ cohort: 'SANCIONADO', title: 'Sujetos con antecedente sancionatorio', hint: 'con resumen y enlace a la resolución' })}
        />
        <CrossTile
          label="Figuran en prensa"
          detail={`${n(c?.antecedentes_prensa ?? 0)} menciones asociadas`}
          value={c?.prensa ?? 0}
          icon="P" tone="var(--sig-watch)"
          onClick={() => open({ cohort: 'PRENSA', title: 'Sujetos que figuran en prensa' })}
        />
        <CrossTile
          label="Cruce con OSFL"
          detail={`${n1(share(c?.osfl ?? 0, u.total))}% del padrón`}
          value={c?.osfl ?? 0}
          icon="O" tone="var(--accent)"
          onClick={() => open({ cohort: 'OSFL', title: 'Sujetos obligados que son OSFL' })}
        />
        <CrossTile
          label="Señales de patrón"
          detail={`${n(c?.senales_totales ?? 0)} señales activas sobre el padrón`}
          value={c?.con_senal ?? 0}
          icon="!" tone="var(--sig-medium)"
          onClick={() => open({ cohort: 'CON_SENAL', title: 'Sujetos con señales de patrón' })}
        />
      </div>

      {/* ── 6. Profundización ─────────────────────────────────────────── */}
      <div className="pulse-depth-head">
        <h2>Profundizar análisis</h2>
        <p>La síntesis no reemplaza el detalle: selecciona una lente para abrir la evidencia y sus cohortes.</p>
      </div>
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

      <button className="pulse-signal-toggle" onClick={() => setSignalsOpen((v) => !v)}>
        <span>Señales de patrón · <b className="num">{n(c?.con_senal ?? 0)}</b> sujetos con al menos una</span>
        <em>{signalsOpen ? 'Replegar ▲' : 'Desplegar ▼'}</em>
      </button>
      {signalsOpen && <div style={{ marginTop: 8 }}><SignalsPanel onNavigate={onNavigate} /></div>}

      <Semantics>
        <strong>Cómo leer este Pulso.</strong>{' '}
        {data.coverage.uaf_registration_note}{' '}
        {data.coverage.denominator_note}{' '}
        {data.coverage.sanction_note}{' '}
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

function share(value: number, total: number) {
  if (!total) return 0;
  return Math.max(0, Math.min(100, (value / total) * 100));
}

function Kpi({
  label, value, share: proportion, foot, tone, glyph, onClick,
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
      {proportion && <div className="kpi-share">{proportion}</div>}
      {foot && <div className="kpi-foot">{foot}</div>}
    </button>
  );
}

function MiniPanel({
  title, meta, action, onAction, children,
}: {
  title: string; meta?: string; action?: string; onAction?: () => void; children: ReactNode;
}) {
  return (
    <section className="pulse-mini-panel">
      <div className="pulse-mini-head">
        <h3>{title}</h3>
        {onAction && action ? (
          <button className="pulse-mini-action" onClick={onAction}>{action}</button>
        ) : meta ? <span className="pulse-mini-meta">{meta}</span> : null}
      </div>
      {meta && onAction && <div style={{ padding: '5px 10px 0', fontSize: 8.8, color: 'var(--ink-4)' }}>{meta}</div>}
      <div className="pulse-mini-body">{children}</div>
    </section>
  );
}

function MiniLine({ points }: { points: { label: string; value: number }[] }) {
  const W = 420;
  const H = 128;
  const PX = 26;
  const TOP = 22;
  const BOTTOM = 22;
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(1, max - min);
  const x = (i: number) => PX + i * ((W - PX * 2) / Math.max(1, points.length - 1));
  const y = (value: number) => TOP + (H - TOP - BOTTOM) * (1 - (value - min) / span);
  const path = points.map((p, i) => `${i ? 'L' : 'M'} ${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(' ');
  const area = `${path} L ${x(points.length - 1).toFixed(1)} ${(H - BOTTOM).toFixed(1)} L ${x(0).toFixed(1)} ${(H - BOTTOM).toFixed(1)} Z`;

  return (
    <svg className="pulse-trend-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Evolución publicada del padrón UAF">
      <line className="pulse-trend-grid" x1={PX} x2={W - PX} y1={H - BOTTOM} y2={H - BOTTOM} />
      <line className="pulse-trend-grid" x1={PX} x2={W - PX} y1={TOP + (H - TOP - BOTTOM) / 2} y2={TOP + (H - TOP - BOTTOM) / 2} />
      <path className="pulse-trend-area" d={area} />
      <path className="pulse-trend-path" d={path} />
      {points.map((p, i) => (
        <g key={`${p.label}-${i}`}>
          <circle className="pulse-trend-dot" cx={x(i)} cy={y(p.value)} r="3.5" />
          <text className="pulse-trend-value" x={x(i)} y={Math.max(10, y(p.value) - 9)}>{n(p.value)}</text>
          <text className="pulse-trend-label" x={x(i)} y={H - 5}>{p.label}</text>
        </g>
      ))}
    </svg>
  );
}

function CrossTile({
  label, detail, value, icon, tone, onClick,
}: {
  label: string; detail: string; value: number; icon: string; tone: string; onClick: () => void;
}) {
  return (
    <button className="pulse-cross-tile" style={{ ['--cross-tone' as string]: tone }} onClick={onClick}>
      <span className="pulse-cross-icon">{icon}</span>
      <span className="pulse-cross-copy"><b>{label}</b><small>{detail}</small></span>
      <span className="pulse-cross-value">{n(value)}</span>
    </button>
  );
}

/** Las señales sólo se consultan cuando el analista las pide. */
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

/* Glifos pequeños para identificar estado sin aumentar la superficie. */
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
