import { useEffect, useState } from 'react';
import { ErrorBox, Loading } from '../components/primitives';
import { useRpc } from '../lib/rpc';
import { supabase } from '../lib/supabase';
import '../styles/reportes.css';
import '../styles/reportes-directivos-v2.css';

type Point = {
  period: string;
  value: number | null;
  unit?: string | null;
  source_url?: string | null;
  as_of_date?: string | null;
  capture_method?: string | null;
};

type SectorChange = {
  sector: string;
  registered_so_2025: number | null;
  current_subjects: number | null;
  delta: number | null;
  delta_pct: number | null;
  top_region?: string | null;
  top_region_share_pct?: number | null;
};

type BriefPayload = {
  contract: string;
  generated_at: string;
  period: { from: number; to: number };
  situation: {
    subjects_latest: number | null;
    subjects_latest_date: string | null;
    private_subjects_latest: number | null;
    public_entities_latest: number | null;
    staff_latest: number | null;
    staff_latest_date: string | null;
    activities_latest: number | null;
    activities_latest_date: string | null;
    ros_latest: number | null;
    roe_latest: number | null;
    ros_with_indicia_latest: number | null;
    iif_latest: number | null;
    mp_requests_latest: number | null;
    mp_people_latest: number | null;
    people_reported_in_ros_latest: number | null;
    supervision_actions_latest: number | null;
    people_trained_latest: number | null;
    sanction_processes_latest: number | null;
  };
  change: Record<string, number | null>;
  series: Record<string, Point[]>;
  sector_growth: SectorChange[];
  sector_decline: SectorChange[];
  methodology: { focus: string; interpretation: string; cutoffs: string; ai: string };
};

type DepthPayload = {
  contract: string;
  window: { days: number; current_from: string; previous_from: string; to: string };
  coverage: { press_media_count?: number; press_relevant_articles?: number; territory_regions?: number; sanctions_current?: number };
  press_momentum: Array<{ theme: string; current_n: number; previous_n: number; delta_pct: number | null; current_media: number; latest_date: string }>;
  regional_convergence: Array<{ region_name: string; avg_igr: number | null; max_igr: number | null; finding_n: number; sanction_n: number; alert_context: number; coverage: number | null }>;
};

type ProfileId = 'presupuesto' | 'crimen' | 'supervision' | 'ciudadania' | 'internacional' | 'ejecutivo';
type Profile = { id: ProfileId; label: string; title: string; subtitle: string };

type TrendPoint = { year: number; value: number | null };

const YEARS = [2020, 2021, 2022, 2023, 2024, 2025];
const fmt0 = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 });
const fmt1 = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 1 });

const PROFILES: Profile[] = [
  { id: 'presupuesto', label: 'Presupuesto', title: 'Situación UAF: capacidad, carga y respuesta institucional', subtitle: 'Dotación, reportabilidad, inteligencia financiera, requerimientos del Ministerio Público y expansión del universo obligado.' },
  { id: 'crimen', label: 'Crimen organizado', title: 'Situación UAF e inteligencia financiera', subtitle: 'Capacidad institucional, requerimientos del Ministerio Público y contexto territorial y público asociado a delitos complejos.' },
  { id: 'supervision', label: 'Supervisión', title: 'Situación UAF y universo obligado', subtitle: 'Evolución del padrón, actividades obligadas, reportabilidad, supervisión y cambios sectoriales.' },
  { id: 'ciudadania', label: 'Ciudadanía', title: 'Información recibida y productos de la UAF', subtitle: 'ROS, ROE, inteligencia financiera, universo obligado y alcance de las cifras públicas.' },
  { id: 'internacional', label: 'Internacional', title: 'Situación UAF y cooperación entre UIF', subtitle: 'Capacidad nacional, intercambio internacional de información financiera y evolución de la demanda institucional.' },
  { id: 'ejecutivo', label: 'Ejecutivo', title: 'Situación institucional UAF', subtitle: 'Evolución de dotación, universo obligado, información recibida, productos de inteligencia y requerimientos externos.' },
];

function valueAt(data: BriefPayload, metric: string, year: number): number | null {
  const point = data.series[metric]?.find((item) => item.period === String(year));
  return point?.value == null ? null : Number(point.value);
}

function series(data: BriefPayload, metric: string): TrendPoint[] {
  return YEARS.map((year) => ({ year, value: valueAt(data, metric, year) }));
}

function signed(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return 's/d';
  return `${value >= 0 ? '+' : ''}${fmt1.format(value)}%`;
}

function compact(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return 's/d';
  if (Math.abs(value) >= 1_000_000) return `${fmt1.format(value / 1_000_000)} M`;
  if (Math.abs(value) >= 1_000) return fmt0.format(value);
  return fmt0.format(value);
}

function TrendChart({
  title,
  subtitle,
  points,
  format = compact,
  tone = 'orange',
}: {
  title: string;
  subtitle: string;
  points: TrendPoint[];
  format?: (value: number) => string;
  tone?: 'orange' | 'graphite' | 'blue';
}) {
  const width = 560;
  const height = 210;
  const pad = { left: 28, right: 18, top: 42, bottom: 34 };
  const valid = points.filter((p): p is { year: number; value: number } => p.value != null && Number.isFinite(p.value));
  if (!valid.length) return <div className="dbv2-trend dbv2-empty"><strong>{title}</strong><span>Sin serie disponible.</span></div>;

  const minValue = Math.min(...valid.map((p) => p.value));
  const maxValue = Math.max(...valid.map((p) => p.value));
  const range = Math.max(1, maxValue - minValue);
  const low = Math.max(0, minValue - range * 0.18);
  const high = maxValue + range * 0.18;
  const span = Math.max(1, high - low);
  const x = (index: number) => pad.left + index * (width - pad.left - pad.right) / Math.max(1, points.length - 1);
  const y = (value: number) => pad.top + (high - value) * (height - pad.top - pad.bottom) / span;
  const path = points.map((p, i) => p.value == null ? null : `${x(i)},${y(p.value)}`).filter(Boolean).join(' ');

  return <figure className={`dbv2-trend dbv2-tone-${tone}`}>
    <figcaption><div><strong>{title}</strong><span>{subtitle}</span></div><em>{format(valid[valid.length - 1].value)}</em></figcaption>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
      {[0, 0.5, 1].map((p) => {
        const yy = pad.top + p * (height - pad.top - pad.bottom);
        return <line key={p} x1={pad.left} y1={yy} x2={width - pad.right} y2={yy} className="dbv2-grid" />;
      })}
      <polyline points={path} className="dbv2-line" fill="none" vectorEffect="non-scaling-stroke" />
      {points.map((p, i) => p.value == null ? null : <g key={p.year}>
        <circle cx={x(i)} cy={y(p.value)} r="3.8" className="dbv2-dot" />
        <text x={x(i)} y={Math.max(15, y(p.value) - 10)} textAnchor="middle" className="dbv2-value">{format(p.value)}</text>
      </g>)}
      {points.map((p, i) => <text key={p.year} x={x(i)} y={height - 10} textAnchor="middle" className="dbv2-year">{p.year}</text>)}
    </svg>
  </figure>;
}

function Stat({ label, value, note, highlight = false }: { label: string; value: string; note: string; highlight?: boolean }) {
  return <div className={`dbv2-stat ${highlight ? 'dbv2-stat-highlight' : ''}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></div>;
}

function Question({ title, answer, note }: { title: string; answer: string; note?: string }) {
  return <article className="dbv2-question"><h4>{title}</h4><p>{answer}</p>{note && <small>{note}</small>}</article>;
}

function buildSummary(profile: ProfileId, d: BriefPayload, depth: DepthPayload | null): string[] {
  const c = d.change;
  const base = [
    `La dotación efectiva total publicada pasa de ${fmt0.format(c.staff_start ?? 0)} personas en ${d.period.from} a ${fmt0.format(c.staff_end ?? 0)} en ${d.period.to}. El último corte público disponible de dotación es ${d.situation.staff_latest_date ?? 's/d'}.`,
    `Los ROS aumentan de ${fmt0.format(c.ros_start ?? 0)} a ${fmt0.format(c.ros_end ?? 0)} en el período, mientras los requerimientos del Ministerio Público pasan de ${fmt0.format(c.mp_requests_start ?? 0)} a ${fmt0.format(c.mp_requests_end ?? 0)}.`,
    `El universo reportante pasa de ${fmt0.format(c.subjects_start ?? 0)} inscritos en ${d.period.from} a ${fmt0.format(d.situation.subjects_latest ?? 0)} en el último corte disponible, y las actividades obligadas pasan de ${fmt0.format(c.activities_start ?? 0)} a ${fmt0.format(c.activities_end ?? 0)}.`,
  ];
  if (profile === 'supervision') return [base[2], `En 2025 se registran ${fmt0.format(d.situation.supervision_actions_latest ?? 0)} acciones de supervisión y ${fmt0.format(d.situation.sanction_processes_latest ?? 0)} procesos sancionatorios finalizados.`, base[1]];
  if (profile === 'ciudadania') return [`En 2025 la UAF recibió ${fmt0.format(d.situation.ros_latest ?? 0)} ROS y ${compact(d.situation.roe_latest)} ROE. Ambos reportes tienen naturaleza distinta y se muestran por separado.`, `En el mismo año, ${fmt0.format(d.situation.ros_with_indicia_latest ?? 0)} ROS fueron incorporados a informes con indicios y se registraron ${fmt0.format(d.situation.iif_latest ?? 0)} IIF o complementos.`, base[2]];
  if (profile === 'internacional') return [base[0], `Las consultas recibidas desde UIF extranjeras pasan de ${fmt0.format(c.international_received_start ?? 0)} a ${fmt0.format(c.international_received_end ?? 0)}, y las solicitudes enviadas por Chile de ${fmt0.format(c.international_sent_start ?? 0)} a ${fmt0.format(c.international_sent_end ?? 0)}.`, base[1]];
  if (profile === 'crimen') return [base[0], `En ${d.period.to}, el Ministerio Público formula ${fmt0.format(d.situation.mp_requests_latest ?? 0)} requerimientos que comprenden ${fmt0.format(d.situation.mp_people_latest ?? 0)} personas.`, depth?.press_momentum?.length ? `En la ventana reciente, los temas con mayor movimiento de cobertura incluyen ${depth.press_momentum.slice(0,3).map((x) => x.theme).join(', ')}. La cobertura de prensa se presenta como contexto y no como medición de incidencia criminal.` : base[2]];
  return base;
}

export function ReportesDirectivosV2() {
  const [profileId, setProfileId] = useState<ProfileId>('presupuesto');
  const [fromYear, setFromYear] = useState(2020);
  const [toYear, setToYear] = useState(2025);
  const [noveltyDays, setNoveltyDays] = useState(30);
  const [aiText, setAiText] = useState<string | null>(null);
  const [aiStatus, setAiStatus] = useState<'idle' | 'loading' | 'ready' | 'fallback'>('idle');
  const [aiMeta, setAiMeta] = useState<string | null>(null);

  const briefing = useRpc<BriefPayload>('obs_uaf_directive_brief_payload', { p_from_year: fromYear, p_to_year: toYear });
  const depth = useRpc<DepthPayload>('obs_uaf_strategic_depth_payload', { p_novelty_days: noveltyDays });
  const profile = PROFILES.find((p) => p.id === profileId) ?? PROFILES[0];

  useEffect(() => { setAiText(null); setAiStatus('idle'); setAiMeta(null); }, [profileId, fromYear, toYear, noveltyDays]);
  useEffect(() => { document.body.classList.add('atlas-report-mode'); return () => document.body.classList.remove('atlas-report-mode'); }, []);

  if (briefing.loading && !briefing.data) return <Loading label="Cargando informe institucional…" />;
  if (briefing.error) return <ErrorBox error={briefing.error} onRetry={briefing.reload} />;
  if (!briefing.data) return <ErrorBox error="Atlas no pudo construir el informe institucional." onRetry={briefing.reload} />;

  const d = briefing.data;
  const c = d.change;
  const context = depth.data;
  const baseSummary = buildSummary(profileId, d, context);
  const summary = aiText ? aiText.split(/\n\s*\n/).filter(Boolean) : baseSummary;
  const growth = d.sector_growth.slice(0, 7);
  const declines = d.sector_decline.slice(0, 4);
  const themes = context?.press_momentum?.slice(0, 5) ?? [];
  const regions = context?.regional_convergence?.slice(0, 5) ?? [];

  const validated = {
    contract: d.contract,
    profile: profileId,
    situation: d.situation,
    change: d.change,
    series: d.series,
    sector_growth: growth,
    sector_decline: declines,
    recent_context: context ? { window: context.window, press_momentum: themes, regions } : null,
    constraints: [
      'No recalcular ni introducir cifras nuevas.',
      'No inferir déficit de personal sin datos internos de carga, complejidad, backlog y tiempos de ciclo.',
      'No tratar ROS, ROE e IIF como unidades equivalentes.',
      'No presentar prensa o indicadores territoriales como medición directa de criminalidad.',
      'No recomendar una decisión presupuestaria o política.'
    ]
  };

  async function generateNarrative() {
    setAiStatus('loading'); setAiMeta(null);
    const { data, error } = await supabase.functions.invoke('atlas-report-narrative', {
      body: { profile: { id: profile.id, audience: profile.label, purpose: profile.subtitle, question: profile.title }, validated_data: validated }
    });
    if (error || !data?.narrative) {
      setAiText(null); setAiStatus('fallback'); setAiMeta(error?.message ?? data?.reason ?? 'Se mantiene la síntesis determinística.'); return;
    }
    setAiText(String(data.narrative)); setAiStatus(data.ai_used ? 'ready' : 'fallback'); setAiMeta(data.ai_used ? 'Síntesis actualizada sobre datos validados.' : String(data.reason ?? 'Se mantiene la síntesis determinística.'));
  }

  function printPdf() {
    const previous = document.title;
    document.title = `ATLAS_Situacion_UAF_${profile.label}_${fromYear}_${toYear}`;
    window.print();
    window.setTimeout(() => { document.title = previous; }, 500);
  }

  const roeSeries = series(d, 'roe_recibidos_miles');
  const roeFormat = (value: number) => `${fmt1.format(value / 1000)} M`;
  const sourceMap = new Map<string, Point>();
  ['dotacion_efectiva_total','entidades_reportantes_total','ros_recibidos','roe_recibidos_miles','ros_con_indicios_laft','informes_inteligencia_financiera','requerimientos_ministerio_publico','personas_en_requerimientos_mp','actividades_economicas_obligadas'].forEach((metric) => {
    (d.series[metric] ?? []).forEach((p) => { if (p.source_url) sourceMap.set(p.source_url, p); });
  });
  const sources = Array.from(sourceMap.values());

  return <div className="report-view dbv2-view">
    <aside className="atlas-report-controls dbv2-controls">
      <div><span className="report-kicker">ATLAS · INFORMES</span><h1>Situación UAF</h1><p>Series institucionales, tendencias y contexto reciente con trazabilidad de fuente.</p></div>
      <label><span>Enfoque</span><select value={profileId} onChange={(e) => setProfileId(e.target.value as ProfileId)}>{PROFILES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
      <div className="report-profile-card"><strong>{profile.title}</strong><p>{profile.subtitle}</p></div>
      <div className="report-year-grid">
        <label><span>Desde</span><select value={fromYear} onChange={(e) => setFromYear(Math.min(Number(e.target.value), toYear))}>{YEARS.map((y) => <option key={y}>{y}</option>)}</select></label>
        <label><span>Hasta</span><select value={toYear} onChange={(e) => setToYear(Math.max(Number(e.target.value), fromYear))}>{YEARS.map((y) => <option key={y}>{y}</option>)}</select></label>
      </div>
      <label><span>Contexto reciente</span><select value={noveltyDays} onChange={(e) => setNoveltyDays(Number(e.target.value))}><option value={7}>7 días</option><option value={30}>30 días</option><option value={60}>60 días</option><option value={90}>90 días</option></select></label>
      <button className="report-btn report-btn-ai" onClick={() => void generateNarrative()} disabled={aiStatus === 'loading'}>{aiStatus === 'loading' ? 'Actualizando síntesis…' : 'Actualizar síntesis'}</button>
      <button className="report-btn report-btn-primary" onClick={printPdf}>Generar PDF</button>
      {aiMeta && <small className="report-ai-meta">{aiMeta}</small>}
    </aside>

    <main className="report-paper-wrap"><article className="report-paper dbv2-paper">
      <header className="dbv2-cover">
        <div className="dbv2-cover-top"><span>ATLAS OBSERVATORIO</span><span>{fromYear}–{toYear}</span></div>
        <div><span className="dbv2-eyebrow">{profile.label}</span><h2>{profile.title}</h2><p>{profile.subtitle}</p></div>
        <div className="dbv2-cover-meta"><span>Último padrón: {d.situation.subjects_latest_date ?? 's/d'}</span><span>Última dotación publicada: {d.situation.staff_latest_date ?? 's/d'}</span></div>
      </header>

      <section className="report-section">
        <div className="report-section-heading"><span>01</span><div><h3>Situación UAF</h3><p>Últimos datos disponibles y fecha de corte de cada serie.</p></div></div>
        <div className="dbv2-stat-grid">
          <Stat label="Dotación efectiva" value={fmt0.format(d.situation.staff_latest ?? 0)} note={`corte ${d.situation.staff_latest_date ?? 's/d'}`} highlight />
          <Stat label="Sujetos inscritos" value={fmt0.format(d.situation.subjects_latest ?? 0)} note={`corte ${d.situation.subjects_latest_date ?? 's/d'}`} />
          <Stat label="Actividades obligadas" value={fmt0.format(d.situation.activities_latest ?? 0)} note={`corte ${d.situation.activities_latest_date ?? 's/d'}`} />
          <Stat label="ROS 2025" value={fmt0.format(d.situation.ros_latest ?? 0)} note={`${signed(c.ros_growth_pct)} desde ${fromYear}`} highlight />
          <Stat label="ROE 2025" value={compact(d.situation.roe_latest)} note="reportes de operaciones en efectivo" />
          <Stat label="ROS con indicios 2025" value={fmt0.format(d.situation.ros_with_indicia_latest ?? 0)} note="incorporados a informes con indicios" />
          <Stat label="IIF y complementos 2025" value={fmt0.format(d.situation.iif_latest ?? 0)} note={`${signed(c.iif_growth_pct)} desde ${fromYear}`} />
          <Stat label="Requerimientos MP 2025" value={fmt0.format(d.situation.mp_requests_latest ?? 0)} note={`${fmt0.format(d.situation.mp_people_latest ?? 0)} personas comprendidas`} highlight />
        </div>
        <div className="dbv2-summary">{summary.map((p, i) => <p key={i}>{p}</p>)}</div>
      </section>

      <section className="report-section report-page-break">
        <div className="report-section-heading"><span>02</span><div><h3>Evolución institucional</h3><p>Dotación, padrón y actividades económicas obligadas.</p></div></div>
        <div className="dbv2-chart-grid">
          <TrendChart title="Dotación efectiva total" subtitle="Personas" points={series(d, 'dotacion_efectiva_total')} tone="graphite" />
          <TrendChart title="Sujetos inscritos" subtitle="Personas y entidades reportantes" points={series(d, 'entidades_reportantes_total')} />
          <TrendChart title="Actividades económicas obligadas" subtitle="Número de actividades" points={series(d, 'actividades_economicas_obligadas')} tone="blue" />
        </div>
        <p className="dbv2-note">La ampliación de actividades desde 2023 corresponde a un cambio del perímetro normativo. La dotación corresponde al total institucional publicado y no a una división específica.</p>
      </section>

      <section className="report-section report-page-break">
        <div className="report-section-heading"><span>03</span><div><h3>Información recibida</h3><p>ROS y ROE se muestran por separado por su distinta naturaleza.</p></div></div>
        <div className="dbv2-chart-grid dbv2-chart-grid-2">
          <TrendChart title="Reportes de Operaciones Sospechosas" subtitle="ROS recibidos por año" points={series(d, 'ros_recibidos')} />
          <TrendChart title="Reportes de Operaciones en Efectivo" subtitle="ROE · millones de reportes" points={roeSeries} format={roeFormat} tone="graphite" />
        </div>
        <div className="dbv2-text-grid"><p>Los ROS pasan de <strong>{fmt0.format(c.ros_start ?? 0)}</strong> en {fromYear} a <strong>{fmt0.format(c.ros_end ?? 0)}</strong> en {toYear} ({signed(c.ros_growth_pct)}).</p><p>Los ROE pasan de <strong>{fmt1.format((c.roe_2021_thousands ?? 0) / 1000)} millones</strong> en 2021 a <strong>{fmt1.format((c.roe_2025_thousands ?? 0) / 1000)} millones</strong> en 2025 ({signed(c.roe_growth_2021_2025_pct)}).</p></div>
      </section>

      <section className="report-section report-page-break">
        <div className="report-section-heading"><span>04</span><div><h3>Inteligencia financiera</h3><p>ROS recibidos, ROS incorporados a informes con indicios e IIF/complementos.</p></div></div>
        <div className="dbv2-chart-grid">
          <TrendChart title="ROS recibidos" subtitle="Reportes" points={series(d, 'ros_recibidos')} />
          <TrendChart title="ROS con indicios" subtitle="ROS incorporados a informes con indicios" points={series(d, 'ros_con_indicios_laft')} tone="blue" />
          <TrendChart title="IIF y complementos" subtitle="Productos enviados" points={series(d, 'informes_inteligencia_financiera')} tone="graphite" />
        </div>
        <p className="dbv2-note">Las tres series no representan una cadena de conversión uno a uno. Un IIF puede integrar múltiples ROS, cruces y antecedentes adicionales.</p>
      </section>

      <section className="report-section report-page-break">
        <div className="report-section-heading"><span>05</span><div><h3>Requerimientos del Ministerio Público</h3><p>Requerimientos recibidos y personas comprendidas.</p></div></div>
        <div className="dbv2-chart-grid dbv2-chart-grid-2">
          <TrendChart title="Requerimientos del Ministerio Público" subtitle="Requerimientos por año" points={series(d, 'requerimientos_ministerio_publico')} />
          <TrendChart title="Personas en requerimientos" subtitle="Personas comprendidas por año" points={series(d, 'personas_en_requerimientos_mp')} tone="blue" />
        </div>
        <p className="dbv2-note">Los requerimientos pasan de {fmt0.format(c.mp_requests_start ?? 0)} en {fromYear} a {fmt0.format(c.mp_requests_end ?? 0)} en {toYear}; las personas comprendidas pasan de {fmt0.format(c.mp_people_start ?? 0)} a {fmt0.format(c.mp_people_end ?? 0)}.</p>
      </section>

      <section className="report-section report-page-break">
        <div className="report-section-heading"><span>06</span><div><h3>Expansión del universo obligado</h3><p>Variación del padrón respecto del cierre 2025.</p></div></div>
        <div className="dbv2-perimeter"><Stat label="Padrón cierre 2025" value={fmt0.format(c.subjects_end ?? 0)} note="personas y entidades" /><Stat label="Último padrón" value={fmt0.format(d.situation.subjects_latest ?? 0)} note={d.situation.subjects_latest_date ?? 's/d'} highlight /><Stat label="Actividades obligadas" value={`${fmt0.format(c.activities_start ?? 0)} → ${fmt0.format(c.activities_end ?? 0)}`} note={`${fromYear}–${toYear}`} /></div>
        <div className="report-table-wrap"><table className="report-table"><thead><tr><th>Sector</th><th>2025</th><th>Actual</th><th>Variación</th><th>Región principal</th></tr></thead><tbody>{growth.map((x) => <tr key={x.sector}><td>{x.sector}</td><td>{fmt0.format(x.registered_so_2025 ?? 0)}</td><td>{fmt0.format(x.current_subjects ?? 0)}</td><td>+{fmt0.format(x.delta ?? 0)} ({signed(x.delta_pct)})</td><td>{x.top_region ?? '—'}</td></tr>)}</tbody></table></div>
        {declines.length > 0 && <p className="dbv2-note">Sectores con disminución registral en el mismo contraste: {declines.map((x) => `${x.sector} (${fmt0.format(x.delta ?? 0)})`).join(', ')}.</p>}
      </section>

      <section className="report-section report-page-break">
        <div className="report-section-heading"><span>07</span><div><h3>Preguntas y antecedentes</h3><p>Respuestas construidas sobre las series disponibles.</p></div></div>
        <div className="dbv2-question-grid">
          <Question title="¿Cómo ha cambiado la dotación?" answer={`La dotación efectiva total publicada pasa de ${fmt0.format(c.staff_start ?? 0)} personas en ${fromYear} a ${fmt0.format(c.staff_end ?? 0)} en ${toYear} (${signed(c.staff_growth_pct)}).`} note="La serie corresponde a dotación institucional total." />
          <Question title="¿Cómo ha cambiado la reportabilidad?" answer={`Los ROS aumentan ${signed(c.ros_growth_pct)} entre ${fromYear} y ${toYear}. Los ROE disminuyen ${signed(c.roe_growth_2021_2025_pct)} entre 2021 y 2025. Ambas series representan reportes de naturaleza distinta.`} />
          <Question title="¿Por qué los IIF no siguen la misma trayectoria que los ROS?" answer={`En ${toYear} se registran ${fmt0.format(d.situation.ros_latest ?? 0)} ROS, ${fmt0.format(d.situation.ros_with_indicia_latest ?? 0)} ROS incorporados a informes con indicios y ${fmt0.format(d.situation.iif_latest ?? 0)} IIF/complementos. Un IIF puede consolidar múltiples ROS y antecedentes.`} />
          <Question title="¿Cómo ha cambiado la demanda del Ministerio Público?" answer={`Los requerimientos pasan de ${fmt0.format(c.mp_requests_start ?? 0)} a ${fmt0.format(c.mp_requests_end ?? 0)}, y las personas comprendidas de ${fmt0.format(c.mp_people_start ?? 0)} a ${fmt0.format(c.mp_people_end ?? 0)}.`} />
          <Question title="¿El universo obligado es el mismo que en 2020?" answer={`No. Las actividades obligadas pasan de ${fmt0.format(c.activities_start ?? 0)} a ${fmt0.format(c.activities_end ?? 0)}, y el padrón alcanza ${fmt0.format(d.situation.subjects_latest ?? 0)} inscritos en el último corte disponible.`} />
          <Question title="¿Estas cifras permiten estimar una brecha de personal?" answer="No por sí solas. Para estimar una brecha de dotación se requieren datos internos de carga, complejidad de casos, backlog, tiempos de ciclo, distribución de funcionarios por función y automatización." />
        </div>
      </section>

      {context && <section className="report-section report-page-break">
        <div className="report-section-heading"><span>08</span><div><h3>Contexto reciente</h3><p>Ventana {context.window.days} días · prensa, territorio y sanciones disponibles en Atlas.</p></div></div>
        <div className="dbv2-context-grid">
          <article><h4>Temas con movimiento de cobertura</h4>{themes.map((x) => <div className="dbv2-context-row" key={x.theme}><strong>{x.theme}</strong><span>{fmt0.format(x.previous_n)} → {fmt0.format(x.current_n)} notas · {x.current_media} medios</span></div>)}</article>
          <article><h4>Regiones con mayor convergencia de señales</h4>{regions.map((x) => <div className="dbv2-context-row" key={x.region_name}><strong>{x.region_name}</strong><span>{fmt0.format(x.finding_n)} hallazgos · {fmt0.format(x.sanction_n)} sanciones recientes · IGR medio {x.avg_igr == null ? 's/d' : fmt1.format(x.avg_igr)}</span></div>)}</article>
        </div>
        <p className="dbv2-note">La prensa describe agenda pública y hechos reportados; el IGR y los hallazgos territoriales son señales de contexto. Ninguna de estas capas constituye por sí sola una medición de lavado de activos o crimen organizado.</p>
      </section>}

      <section className="report-section report-page-break">
        <div className="report-section-heading"><span>09</span><div><h3>Fuentes y cortes</h3><p>Cada serie conserva fuente, fecha de corte y método de captura.</p></div></div>
        <div className="dbv2-method"><p><strong>Cálculo.</strong> Las cifras, variaciones y gráficos se construyen de forma determinística desde series trazadas.</p><p><strong>Cortes.</strong> El padrón y la dotación pueden tener fechas distintas; el informe conserva la fecha de cada serie.</p><p><strong>Redacción.</strong> La síntesis generativa, cuando se utiliza, recibe sólo cifras previamente validadas y no reemplaza los cálculos.</p></div>
        <ol className="dbv2-sources">{sources.map((p) => <li key={p.source_url ?? ''}><a href={p.source_url ?? '#'} target="_blank" rel="noreferrer">{p.source_url}</a><span>{p.as_of_date ?? 's/d'} · {p.capture_method ?? 's/d'}</span></li>)}</ol>
      </section>
    </article></main>
  </div>;
}
