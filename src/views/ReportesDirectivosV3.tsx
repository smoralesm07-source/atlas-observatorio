import { useEffect, useMemo, useState } from 'react';
import { ErrorBox, Loading } from '../components/primitives';
import { useRpc } from '../lib/rpc';
import { supabase } from '../lib/supabase';
import '../styles/reportes.css';
import '../styles/reportes-directivos-v2.css';

type Point = { period: string; value: number | null };
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
  };
  change: Record<string, number | null>;
  series: Record<string, Point[]>;
  sector_growth: SectorChange[];
  sector_decline: SectorChange[];
};
type ReportingSector = {
  sector_official: string;
  sector_canonical: string | null;
  etiqueta: string;
  padron_sujetos: number | null;
  registered_so_2025: number | null;
  ros_2021: number | null;
  ros_2022: number | null;
  ros_2023: number | null;
  ros_2024: number | null;
  ros_2025: number | null;
  ros_total_2021_2025: number | null;
  ros_per_100_so_2025: number | null;
  delta_ros_2025_vs_2024_pct: number | null;
  indicios_total_2021_2025: number | null;
  icr_pct: number | null;
};
type UniversePulse = {
  universe: { total: number } | null;
  by_sector: Array<{ sector: string; sujetos: number }>;
  reporting?: {
    corte: { periodo: string; padron_referencia: number; padron_referencia_corte: string };
    sectores: ReportingSector[];
    totales: { ros_2025: number | null; ros_5y: number | null; indicios_5y: number | null } | null;
  };
};
type DepthPayload = {
  window: { days: number };
  coverage: { press_media_count?: number; press_relevant_articles?: number; territory_regions?: number; sanctions_current?: number };
  press_momentum: Array<{ theme: string; current_n: number; previous_n: number; delta_pct: number | null; current_media: number; latest_date: string }>;
  regional_convergence: Array<{ region_name: string; avg_igr: number | null; finding_n: number; sanction_n: number }>;
};
type ProfileId = 'presupuesto' | 'crimen' | 'supervision' | 'ciudadania' | 'internacional' | 'ejecutivo';
type Profile = { id: ProfileId; label: string; title: string; subtitle: string };
type TrendPoint = { year: number; value: number | null };
type AiInsights = Partial<Record<'novelties' | 'territory' | 'crime' | 'sectors' | 'capacity', string>>;
type ReportVersion = 'base' | 'ai';
type SectorAggregate = {
  name: string;
  currentSubjects: number | null;
  registered2025: number | null;
  ros2021: number | null;
  ros2022: number | null;
  ros2023: number | null;
  ros2024: number | null;
  ros2025: number | null;
  ros5y: number | null;
  indicios5y: number | null;
  rosPer100: number | null;
  icrPct: number | null;
};

const YEARS = [2020, 2021, 2022, 2023, 2024, 2025];
const SECTOR_YEARS = [2021, 2022, 2023, 2024, 2025];
const fmt0 = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 });
const fmt1 = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 1 });
const PROFILES: Profile[] = [
  { id: 'presupuesto', label: 'Presupuesto', title: 'Situación UAF: capacidad, carga y respuesta institucional', subtitle: 'Evolución de la demanda observable, capacidad institucional y universo obligado.' },
  { id: 'crimen', label: 'Crimen organizado', title: 'Situación UAF e inteligencia financiera', subtitle: 'Demanda institucional, inteligencia financiera y contexto estratégico disponible.' },
  { id: 'supervision', label: 'Supervisión', title: 'Situación UAF y universo obligado', subtitle: 'Evolución del padrón, reportabilidad y composición sectorial agregada.' },
  { id: 'ciudadania', label: 'Ciudadanía', title: 'Información recibida y productos de la UAF', subtitle: 'ROS, ROE, inteligencia financiera y universo obligado en cifras públicas.' },
  { id: 'internacional', label: 'Internacional', title: 'Situación UAF y cooperación entre UIF', subtitle: 'Capacidad nacional, intercambio internacional y evolución de la demanda institucional.' },
  { id: 'ejecutivo', label: 'Ejecutivo', title: 'Situación institucional UAF', subtitle: 'Lectura estratégica de capacidad, reportabilidad, inteligencia y universo obligado.' },
];

function n(value: unknown): number | null {
  const x = Number(value);
  return Number.isFinite(x) ? x : null;
}
function pct(part: number | null, total: number | null): number | null {
  return part == null || total == null || total === 0 ? null : part / total * 100;
}
function growth(from: number | null, to: number | null): number | null {
  return from == null || to == null || from === 0 ? null : ((to / from) - 1) * 100;
}
function signed(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? 's/d' : `${value >= 0 ? '+' : ''}${fmt1.format(value)}%`;
}
function compact(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return 's/d';
  if (Math.abs(value) >= 1_000_000) return `${fmt1.format(value / 1_000_000)} M`;
  return fmt0.format(value);
}
function valueAt(data: BriefPayload, metric: string, year: number): number | null {
  const point = data.series[metric]?.find((item) => item.period === String(year));
  return point?.value == null ? null : n(point.value);
}
function series(data: BriefPayload, metric: string): TrendPoint[] {
  return YEARS.map((year) => ({ year, value: valueAt(data, metric, year) }));
}
function sumMetric(rows: ReportingSector[], getter: (row: ReportingSector) => number | null): number | null {
  const values = rows.map(getter).filter((v): v is number => v != null && Number.isFinite(v));
  return values.length ? values.reduce((a, b) => a + b, 0) : null;
}
function aggregateSector(pulse: UniversePulse | null | undefined, name: string): SectorAggregate | null {
  if (!pulse || !name) return null;
  const rows = (pulse.reporting?.sectores ?? []).filter((row) =>
    row.sector_canonical === name || row.sector_official === name || row.etiqueta === name,
  );
  const currentSubjects = n(pulse.by_sector.find((row) => row.sector === name)?.sujetos)
    ?? sumMetric(rows, (row) => row.padron_sujetos);
  const registered2025 = sumMetric(rows, (row) => row.registered_so_2025);
  const ros2021 = sumMetric(rows, (row) => row.ros_2021);
  const ros2022 = sumMetric(rows, (row) => row.ros_2022);
  const ros2023 = sumMetric(rows, (row) => row.ros_2023);
  const ros2024 = sumMetric(rows, (row) => row.ros_2024);
  const ros2025 = sumMetric(rows, (row) => row.ros_2025);
  const ros5y = sumMetric(rows, (row) => row.ros_total_2021_2025);
  const indicios5y = sumMetric(rows, (row) => row.indicios_total_2021_2025);
  return {
    name,
    currentSubjects,
    registered2025,
    ros2021,
    ros2022,
    ros2023,
    ros2024,
    ros2025,
    ros5y,
    indicios5y,
    rosPer100: registered2025 && ros2025 != null ? ros2025 / registered2025 * 100 : null,
    icrPct: ros5y && indicios5y != null ? indicios5y / ros5y * 100 : null,
  };
}

function TrendChart({ title, subtitle, points, format = compact, tone = 'orange' }: {
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
      {[0, 0.5, 1].map((p) => <line key={p} x1={pad.left} y1={pad.top + p * (height - pad.top - pad.bottom)} x2={width - pad.right} y2={pad.top + p * (height - pad.top - pad.bottom)} className="dbv2-grid" />)}
      <polyline points={path} className="dbv2-line" fill="none" vectorEffect="non-scaling-stroke" />
      {points.map((p, i) => p.value == null ? null : <g key={p.year}><circle cx={x(i)} cy={y(p.value)} r="3.8" className="dbv2-dot" /><text x={x(i)} y={Math.max(15, y(p.value) - 10)} textAnchor="middle" className="dbv2-value">{format(p.value)}</text></g>)}
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

export function ReportesDirectivosV3() {
  const [profileId, setProfileId] = useState<ProfileId>('presupuesto');
  const [fromYear, setFromYear] = useState(2020);
  const [toYear, setToYear] = useState(2025);
  const [noveltyDays, setNoveltyDays] = useState(30);
  const [sectorScope, setSectorScope] = useState('NACIONAL');
  const [aiText, setAiText] = useState<string | null>(null);
  const [aiInsights, setAiInsights] = useState<AiInsights | null>(null);
  const [reportVersion, setReportVersion] = useState<ReportVersion>('base');
  const [aiStatus, setAiStatus] = useState<'idle' | 'loading' | 'ready' | 'fallback'>('idle');
  const [aiMeta, setAiMeta] = useState<string | null>(null);

  const briefing = useRpc<BriefPayload>('obs_uaf_directive_brief_payload', { p_from_year: fromYear, p_to_year: toYear });
  const depth = useRpc<DepthPayload>('obs_uaf_strategic_depth_payload', { p_novelty_days: noveltyDays });
  const pulse = useRpc<UniversePulse>('obs_uaf_pulse', {});
  const profile = PROFILES.find((p) => p.id === profileId) ?? PROFILES[0];

  useEffect(() => {
    setAiText(null); setAiInsights(null); setReportVersion('base'); setAiStatus('idle'); setAiMeta(null);
  }, [profileId, fromYear, toYear, noveltyDays, sectorScope]);
  useEffect(() => { document.body.classList.add('atlas-report-mode'); return () => document.body.classList.remove('atlas-report-mode'); }, []);

  const sectorOptions = useMemo(() => [...(pulse.data?.by_sector ?? [])]
    .filter((row) => row.sector && Number(row.sujetos) > 0)
    .sort((a, b) => Number(b.sujetos) - Number(a.sujetos)), [pulse.data]);
  const sector = useMemo(() => sectorScope === 'NACIONAL' ? null : aggregateSector(pulse.data, sectorScope), [pulse.data, sectorScope]);

  if (briefing.loading && !briefing.data) return <Loading label="Cargando informe institucional…" />;
  if (briefing.error) return <ErrorBox error={briefing.error} onRetry={briefing.reload} />;
  if (!briefing.data) return <ErrorBox error="Atlas no pudo construir el informe institucional." onRetry={briefing.reload} />;

  const d = briefing.data;
  const c = d.change;
  const isSector = sectorScope !== 'NACIONAL';
  const totalSubjects = n(pulse.data?.universe?.total) ?? d.situation.subjects_latest;
  const subjectShare = sector ? pct(sector.currentSubjects, totalSubjects) : null;
  const rosShare = sector ? pct(sector.ros2025, d.situation.ros_latest) : null;
  const subjectGrowth = sector ? growth(sector.registered2025, sector.currentSubjects) : null;
  const rosGrowth = sector ? growth(sector.ros2024, sector.ros2025) : null;
  const sectorRank = sector ? sectorOptions.findIndex((row) => row.sector === sector.name) + 1 : null;
  const sectorRosSeries: TrendPoint[] = sector ? SECTOR_YEARS.map((year) => ({
    year,
    value: year === 2021 ? sector.ros2021 : year === 2022 ? sector.ros2022 : year === 2023 ? sector.ros2023 : year === 2024 ? sector.ros2024 : sector.ros2025,
  })) : [];
  const sectorShareSeries: TrendPoint[] = sectorRosSeries.map((point) => ({
    year: point.year,
    value: pct(point.value, valueAt(d, 'ros_recibidos', point.year)),
  }));
  const topSectors = sectorOptions.slice(0, 5);
  const growthRows = d.sector_growth.slice(0, 7);
  const themes = depth.data?.press_momentum?.slice(0, 5) ?? [];
  const regions = depth.data?.regional_convergence?.slice(0, 5) ?? [];
  const useAiVersion = reportVersion === 'ai' && aiStatus === 'ready' && !!aiText;

  const baseSummary = isSector && sector ? [
    `${sector.name} reúne ${compact(sector.currentSubjects)} sujetos obligados, equivalentes a ${subjectShare == null ? 'una participación no disponible' : `${fmt1.format(subjectShare)}%`} del padrón vigente.`,
    `En 2025 el sector registró ${compact(sector.ros2025)} ROS, ${rosShare == null ? 'sin participación nacional calculable' : `${fmt1.format(rosShare)}% del total nacional`}. La variación frente a 2024 es ${signed(rosGrowth)}.`,
    `Entre el cierre 2025 y el padrón vigente, el número de sujetos del sector varía ${signed(subjectGrowth)}. Esta lectura describe presión y composición del sistema; no es una medida de riesgo ni de cumplimiento individual.`,
  ] : [
    `La dotación efectiva total publicada pasa de ${fmt0.format(c.staff_start ?? 0)} personas en ${fromYear} a ${fmt0.format(c.staff_end ?? 0)} en ${toYear}.`,
    `Los ROS pasan de ${fmt0.format(c.ros_start ?? 0)} a ${fmt0.format(c.ros_end ?? 0)} en el período, mientras los requerimientos del Ministerio Público pasan de ${fmt0.format(c.mp_requests_start ?? 0)} a ${fmt0.format(c.mp_requests_end ?? 0)}.`,
    `El universo obligado alcanza ${fmt0.format(d.situation.subjects_latest ?? 0)} inscritos en el último corte disponible. El informe utiliza agregados estratégicos y excluye deliberadamente la gestión operativa de sujetos obligados.`,
  ];
  const summary = useAiVersion && aiText ? aiText.split(/\n\s*\n/).filter(Boolean) : baseSummary;

  const validated = {
    contract: d.contract,
    scope: isSector && sector ? {
      type: 'SECTOR',
      sector: sector.name,
      metrics: {
        current_subjects: sector.currentSubjects,
        registered_2025: sector.registered2025,
        subject_share_pct: subjectShare,
        subject_growth_pct: subjectGrowth,
        ros_2021: sector.ros2021,
        ros_2022: sector.ros2022,
        ros_2023: sector.ros2023,
        ros_2024: sector.ros2024,
        ros_2025: sector.ros2025,
        ros_5y: sector.ros5y,
        ros_share_2025_pct: rosShare,
        ros_growth_2025_vs_2024_pct: rosGrowth,
        ros_per_100_so_2025: sector.rosPer100,
        indicios_5y: sector.indicios5y,
        icr_pct: sector.icrPct,
      },
    } : { type: 'NACIONAL', period: d.period, situation: d.situation, change: d.change },
    strategic_context: isSector ? null : {
      press: depth.data?.coverage ?? null,
      themes,
      regions,
    },
    constraints: [
      'Usar sólo las cifras incluidas en este paquete.',
      'No incorporar gestión SO ni información operacional de casos.',
      'No mencionar colas, casos, potenciales SO, términos de giro, contactos, estados de revisión, asignaciones ni prioridades operativas.',
      'En versión sectorial, no presentar cifras nacionales como si fueran cifras del sector.',
      'Volumen de ROS, silencio o intensidad no equivalen por sí solos a riesgo, incumplimiento o calidad.',
      'No inferir déficit de personal sin datos internos de carga, complejidad, backlog y tiempos de ciclo.',
    ],
  };

  async function generateNarrative() {
    setAiStatus('loading'); setAiMeta(null); setAiInsights(null);
    const { data, error } = await supabase.functions.invoke('atlas-report-narrative', {
      body: {
        profile: { id: profile.id, audience: profile.label, purpose: profile.subtitle, question: isSector ? `Lectura estratégica del sector ${sectorScope}` : profile.title },
        validated_data: validated,
      },
    });
    if (error || data?.ai_used !== true || typeof data?.narrative !== 'string' || data.narrative.trim().length < 120) {
      setAiText(null); setAiInsights(null); setReportVersion('base'); setAiStatus('fallback'); setAiMeta('Se mantiene el informe base.');
      return;
    }
    setAiText(data.narrative.trim());
    setAiInsights(data.insights && typeof data.insights === 'object' ? data.insights as AiInsights : null);
    setReportVersion('ai'); setAiStatus('ready'); setAiMeta(`Propuesta IA validada · ${String(data.model ?? 'modelo configurado')}`);
  }

  function printPdf() {
    const previous = document.title;
    const scope = isSector ? sectorScope.replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ_-]+/g, '_') : 'Nacional';
    document.title = `ATLAS_Situacion_UAF_${scope}_${profile.label}_${useAiVersion ? 'IA' : 'Base'}`;
    window.print();
    window.setTimeout(() => { document.title = previous; }, 500);
  }

  return <div className="report-view dbv2-view">
    <aside className="atlas-report-controls dbv2-controls">
      <div><span className="report-kicker">ATLAS · INFORMES</span><h1>Situación UAF</h1><p>Informe estratégico. La gestión operativa de sujetos obligados permanece exclusivamente en Atlas.</p></div>
      <label><span>Alcance</span><select value={sectorScope} onChange={(e) => setSectorScope(e.target.value)}><option value="NACIONAL">Nacional · todos los sectores</option>{sectorOptions.map((row) => <option key={row.sector} value={row.sector}>{row.sector}</option>)}</select></label>
      <label><span>Enfoque</span><select value={profileId} onChange={(e) => setProfileId(e.target.value as ProfileId)}>{PROFILES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
      <div className="report-profile-card"><strong>{isSector ? `Versión sectorial · ${sectorScope}` : profile.title}</strong><p>{isSector ? 'Sólo cifras agregadas atribuibles al sector. Las métricas institucionales no desagregables se excluyen de esta versión.' : profile.subtitle}</p></div>
      {!isSector && <><div className="report-year-grid"><label><span>Desde</span><select value={fromYear} onChange={(e) => setFromYear(Math.min(Number(e.target.value), toYear))}>{YEARS.map((y) => <option key={y}>{y}</option>)}</select></label><label><span>Hasta</span><select value={toYear} onChange={(e) => setToYear(Math.max(Number(e.target.value), fromYear))}>{YEARS.map((y) => <option key={y}>{y}</option>)}</select></label></div><label><span>Contexto reciente</span><select value={noveltyDays} onChange={(e) => setNoveltyDays(Number(e.target.value))}><option value={7}>7 días</option><option value={30}>30 días</option><option value={60}>60 días</option><option value={90}>90 días</option></select></label></>}
      <div className="report-safety-box"><strong>Regla de alcance</strong><span>El documento usa agregados estratégicos. No incorpora Gestión SO, casos, potenciales, términos de giro, contactos ni estados de revisión.</span></div>
      <div className="report-version-switch" aria-label="Versión del informe"><button className={reportVersion === 'base' ? 'is-active' : ''} onClick={() => setReportVersion('base')}>Informe base</button><button className={reportVersion === 'ai' ? 'is-active' : ''} onClick={() => setReportVersion('ai')} disabled={aiStatus !== 'ready'}>Propuesta IA</button></div>
      <button className="report-btn report-btn-ai" onClick={() => void generateNarrative()} disabled={aiStatus === 'loading' || (isSector && !sector)}>{aiStatus === 'loading' ? 'Generando propuesta…' : aiStatus === 'ready' ? 'Regenerar propuesta IA' : 'Generar propuesta IA'}</button>
      <button className="report-btn report-btn-primary" onClick={printPdf}>Generar PDF · {isSector ? 'Sector' : 'Nacional'}</button>
      {aiMeta && <small className="report-ai-meta">{aiMeta}</small>}
    </aside>

    <main className="report-paper-wrap"><article className="report-paper dbv2-paper">
      <header className="dbv2-cover">
        <div className="dbv2-cover-top"><span>ATLAS OBSERVATORIO</span><span>{isSector ? 'VERSIÓN SECTORIAL' : `${fromYear}–${toYear}`}</span></div>
        <div><span className="dbv2-eyebrow">{profile.label}</span><h2>{isSector ? `Situación estratégica · ${sectorScope}` : profile.title}</h2><p>{isSector ? 'Lectura agregada del peso del sector en el universo obligado y su contribución a la reportabilidad observada.' : profile.subtitle}</p></div>
        <div className="dbv2-cover-meta"><span>Alcance: {isSector ? sectorScope : 'Nacional'}</span><span>Último padrón: {d.situation.subjects_latest_date ?? 's/d'}</span><span>{useAiVersion ? 'PROPUESTA IA · REVERSIBLE' : 'INFORME BASE'}</span></div>
      </header>

      {isSector ? <>
        <section className="report-section">
          <div className="report-section-heading"><span>01</span><div><h3>Situación sectorial</h3><p>Cifras agregadas atribuibles al sector seleccionado.</p></div></div>
          {sector ? <div className="dbv2-stat-grid">
            <Stat label="Sujetos obligados" value={compact(sector.currentSubjects)} note={subjectShare == null ? 'participación no disponible' : `${fmt1.format(subjectShare)}% del padrón`} highlight />
            <Stat label="ROS 2025" value={compact(sector.ros2025)} note={rosShare == null ? 'participación no disponible' : `${fmt1.format(rosShare)}% del total nacional`} highlight />
            <Stat label="ROS / 100 SO" value={sector.rosPer100 == null ? 's/d' : fmt1.format(sector.rosPer100)} note="intensidad agregada 2025" />
            <Stat label="Posición por tamaño" value={sectorRank && sectorRank > 0 ? `#${sectorRank}` : 's/d'} note={`de ${sectorOptions.length} sectores con inscritos`} />
          </div> : <p className="dbv2-note">No se encontró correspondencia de reportabilidad para el sector seleccionado.</p>}
          <div className="dbv2-summary"><div className="report-narrative-label"><span>{useAiVersion ? 'Síntesis estratégica · propuesta IA' : 'Síntesis estratégica base'}</span><small>Sin gestión operativa de SO.</small></div>{summary.map((p, i) => <p key={i}>{p}</p>)}</div>
        </section>

        <section className="report-section report-page-break">
          <div className="report-section-heading"><span>02</span><div><h3>Reportabilidad del sector</h3><p>Evolución 2021–2025 y participación en los ROS nacionales.</p></div></div>
          <div className="dbv2-chart-grid dbv2-chart-grid-2">
            <TrendChart title="ROS del sector" subtitle="Reportes por año" points={sectorRosSeries} />
            <TrendChart title="Participación en ROS nacionales" subtitle="Porcentaje del total anual" points={sectorShareSeries} format={(v) => `${fmt1.format(v)}%`} tone="blue" />
          </div>
          {useAiVersion && aiInsights?.sectors && <p className="report-ai-insight"><strong>Lectura IA</strong>{aiInsights.sectors}</p>}
          <p className="dbv2-note">La reportabilidad es sectorial y agregada. El volumen de ROS no equivale por sí solo a riesgo, incumplimiento ni calidad del sector.</p>
        </section>

        <section className="report-section report-page-break">
          <div className="report-section-heading"><span>03</span><div><h3>Peso en el Universo Obligado</h3><p>Tamaño del sector y cambio respecto del cierre 2025.</p></div></div>
          <div className="dbv2-perimeter"><Stat label="Padrón cierre 2025" value={compact(sector?.registered2025)} note="referencia estadística" /><Stat label="Padrón vigente" value={compact(sector?.currentSubjects)} note={d.situation.subjects_latest_date ?? 's/d'} highlight /><Stat label="Variación" value={signed(subjectGrowth)} note="cierre 2025 → corte vigente" /></div>
          <div className="report-table-wrap"><table className="report-table"><thead><tr><th>Sector</th><th>SO actuales</th><th>% del padrón</th><th>ROS 2025</th><th>% ROS nacional</th></tr></thead><tbody><tr><td>{sectorScope}</td><td>{compact(sector?.currentSubjects)}</td><td>{subjectShare == null ? 's/d' : `${fmt1.format(subjectShare)}%`}</td><td>{compact(sector?.ros2025)}</td><td>{rosShare == null ? 's/d' : `${fmt1.format(rosShare)}%`}</td></tr></tbody></table></div>
        </section>

        <section className="report-section report-page-break">
          <div className="report-section-heading"><span>04</span><div><h3>Indicios agregados</h3><p>Relación descriptiva entre ROS del sector y ROS incorporados a informes con indicios.</p></div></div>
          <div className="dbv2-stat-grid"><Stat label="ROS 2021–2025" value={compact(sector?.ros5y)} note="acumulado sectorial" /><Stat label="ROS con indicios" value={compact(sector?.indicios5y)} note="acumulado 2021–2025" /><Stat label="ICR agregado" value={sector?.icrPct == null ? 's/d' : `${fmt1.format(sector.icrPct)}%`} note="indicios / ROS acumulados" highlight /><Stat label="Cambio ROS 2025" value={signed(rosGrowth)} note="respecto de 2024" /></div>
          <p className="dbv2-note">Esta relación no representa una cadena de conversión uno a uno: los productos de inteligencia pueden integrar múltiples ROS y antecedentes adicionales.</p>
        </section>

        <section className="report-section report-page-break">
          <div className="report-section-heading"><span>05</span><div><h3>Lectura estratégica para la UAF</h3><p>Preguntas que el recorte sectorial permite responder sin trasladar gestión operativa al informe.</p></div></div>
          <div className="dbv2-question-grid">
            <Question title="¿Qué peso tiene el sector en el padrón?" answer={subjectShare == null ? 'No existe denominador suficiente para calcular la participación.' : `${sectorScope} representa ${fmt1.format(subjectShare)}% del padrón vigente.`} />
            <Question title="¿Qué peso tiene en la reportabilidad?" answer={rosShare == null ? 'No existe denominador suficiente para calcular la participación.' : `En 2025 el sector aporta ${fmt1.format(rosShare)}% de los ROS nacionales.`} />
            <Question title="¿Está cambiando su tamaño?" answer={`Entre el cierre 2025 y el corte vigente, el padrón sectorial varía ${signed(subjectGrowth)}.`} />
            <Question title="¿Qué no debe concluirse?" answer="Ni el volumen de sujetos ni el volumen de ROS permiten por sí solos concluir riesgo, incumplimiento o prioridad de fiscalización. Este informe no contiene gestión de casos." />
          </div>
        </section>

        <section className="report-section report-page-break">
          <div className="report-section-heading"><span>06</span><div><h3>Universo Obligado · {sectorScope}</h3><p>Posición del sector dentro de la composición nacional.</p></div></div>
          <div className="report-table-wrap"><table className="report-table"><thead><tr><th>Posición</th><th>Sector</th><th>SO actuales</th><th>% padrón</th></tr></thead><tbody>{topSectors.map((row, index) => <tr key={row.sector}><td>{index + 1}</td><td>{row.sector}</td><td>{fmt0.format(row.sujetos)}</td><td>{totalSubjects ? `${fmt1.format(row.sujetos / totalSubjects * 100)}%` : 's/d'}</td></tr>)}</tbody></table></div>
          <p className="dbv2-note">La tabla se incluye como referencia estructural del sistema. No constituye una cola de atención ni un orden de prioridad operativa.</p>
        </section>
      </> : <>
        <section className="report-section">
          <div className="report-section-heading"><span>01</span><div><h3>Situación UAF</h3><p>Últimos datos disponibles y lectura institucional.</p></div></div>
          <div className="dbv2-stat-grid"><Stat label="Dotación efectiva" value={fmt0.format(d.situation.staff_latest ?? 0)} note={`corte ${d.situation.staff_latest_date ?? 's/d'}`} highlight /><Stat label="Sujetos inscritos" value={fmt0.format(d.situation.subjects_latest ?? 0)} note={`corte ${d.situation.subjects_latest_date ?? 's/d'}`} /><Stat label="Actividades obligadas" value={fmt0.format(d.situation.activities_latest ?? 0)} note={`corte ${d.situation.activities_latest_date ?? 's/d'}`} /><Stat label="ROS 2025" value={fmt0.format(d.situation.ros_latest ?? 0)} note={`${signed(c.ros_growth_pct)} desde ${fromYear}`} highlight /></div>
          <div className="dbv2-summary"><div className="report-narrative-label"><span>{useAiVersion ? 'Síntesis estratégica · propuesta IA' : 'Síntesis estratégica base'}</span><small>Agregados institucionales; Gestión SO excluida.</small></div>{summary.map((p, i) => <p key={i}>{p}</p>)}</div>
        </section>

        <section className="report-section report-page-break"><div className="report-section-heading"><span>02</span><div><h3>Evolución institucional</h3><p>Dotación, padrón y actividades económicas obligadas.</p></div></div><div className="dbv2-chart-grid"><TrendChart title="Dotación efectiva total" subtitle="Personas" points={series(d, 'dotacion_efectiva_total')} tone="graphite" /><TrendChart title="Sujetos inscritos" subtitle="Personas y entidades reportantes" points={series(d, 'entidades_reportantes_total')} /><TrendChart title="Actividades económicas obligadas" subtitle="Número de actividades" points={series(d, 'actividades_economicas_obligadas')} tone="blue" /></div></section>

        <section className="report-section report-page-break"><div className="report-section-heading"><span>03</span><div><h3>Información recibida</h3><p>ROS y ROE se muestran por separado por su distinta naturaleza.</p></div></div><div className="dbv2-chart-grid dbv2-chart-grid-2"><TrendChart title="Reportes de Operaciones Sospechosas" subtitle="ROS recibidos por año" points={series(d, 'ros_recibidos')} /><TrendChart title="Reportes de Operaciones en Efectivo" subtitle="ROE · miles de reportes" points={series(d, 'roe_recibidos_miles')} tone="graphite" /></div></section>

        <section className="report-section report-page-break"><div className="report-section-heading"><span>04</span><div><h3>Inteligencia financiera</h3><p>ROS recibidos, ROS incorporados a informes con indicios e IIF/complementos.</p></div></div><div className="dbv2-chart-grid"><TrendChart title="ROS recibidos" subtitle="Reportes" points={series(d, 'ros_recibidos')} /><TrendChart title="ROS con indicios" subtitle="Incorporados a informes con indicios" points={series(d, 'ros_con_indicios_laft')} tone="blue" /><TrendChart title="IIF y complementos" subtitle="Productos enviados" points={series(d, 'informes_inteligencia_financiera')} tone="graphite" /></div><p className="dbv2-note">Las series no representan una cadena de conversión uno a uno.</p></section>

        <section className="report-section report-page-break"><div className="report-section-heading"><span>05</span><div><h3>Requerimientos del Ministerio Público</h3><p>Demanda externa observable sobre la institución.</p></div></div><div className="dbv2-chart-grid dbv2-chart-grid-2"><TrendChart title="Requerimientos del Ministerio Público" subtitle="Requerimientos por año" points={series(d, 'requerimientos_ministerio_publico')} /><TrendChart title="Personas en requerimientos" subtitle="Personas comprendidas por año" points={series(d, 'personas_en_requerimientos_mp')} tone="blue" /></div></section>

        <section className="report-section report-page-break"><div className="report-section-heading"><span>06</span><div><h3>Universo Obligado</h3><p>Composición actual del padrón y análisis agregado de su expansión.</p></div></div><div className="dbv2-perimeter"><Stat label="Padrón cierre 2025" value={fmt0.format(c.subjects_end ?? 0)} note="personas y entidades" /><Stat label="Último padrón" value={fmt0.format(d.situation.subjects_latest ?? 0)} note={d.situation.subjects_latest_date ?? 's/d'} highlight /><Stat label="Actividades obligadas" value={`${fmt0.format(c.activities_start ?? 0)} → ${fmt0.format(c.activities_end ?? 0)}`} note={`${fromYear}–${toYear}`} /></div><p className="dbv2-note"><strong>Composición sectorial.</strong> Sectores con mayor número de sujetos obligados.</p><div className="report-table-wrap"><table className="report-table"><thead><tr><th>Sector</th><th>SO actuales</th><th>% del padrón</th></tr></thead><tbody>{topSectors.map((row) => <tr key={row.sector}><td>{row.sector}</td><td>{fmt0.format(row.sujetos)}</td><td>{totalSubjects ? `${fmt1.format(row.sujetos / totalSubjects * 100)}%` : 's/d'}</td></tr>)}</tbody></table></div><p className="dbv2-note"><strong>Expansión agregada.</strong> Sectores con mayor variación respecto del cierre 2025.</p><div className="report-table-wrap"><table className="report-table"><thead><tr><th>Sector</th><th>2025</th><th>Actual</th><th>Variación</th><th>Región principal</th></tr></thead><tbody>{growthRows.map((x) => <tr key={x.sector}><td>{x.sector}</td><td>{fmt0.format(x.registered_so_2025 ?? 0)}</td><td>{fmt0.format(x.current_subjects ?? 0)}</td><td>{signed(x.delta_pct)}</td><td>{x.top_region ?? '—'}</td></tr>)}</tbody></table></div><p className="dbv2-note">Esta sección describe estructura y presión institucional. No contiene casos, potenciales, estados de gestión ni prioridades operativas.</p></section>

        <section className="report-section report-page-break"><div className="report-section-heading"><span>07</span><div><h3>Preguntas estratégicas</h3><p>Lecturas que afectan a la UAF como institución.</p></div></div><div className="dbv2-question-grid"><Question title="¿Cómo cambia la demanda observable?" answer={`Los ROS varían ${signed(c.ros_growth_pct)} entre ${fromYear} y ${toYear}, mientras los requerimientos del Ministerio Público pasan de ${fmt0.format(c.mp_requests_start ?? 0)} a ${fmt0.format(c.mp_requests_end ?? 0)}.`} /><Question title="¿Cómo cambia el perímetro obligado?" answer={`El padrón alcanza ${fmt0.format(d.situation.subjects_latest ?? 0)} inscritos y las actividades obligadas pasan de ${fmt0.format(c.activities_start ?? 0)} a ${fmt0.format(c.activities_end ?? 0)}.`} /><Question title="¿Cómo evoluciona la capacidad publicada?" answer={`La dotación efectiva total pasa de ${fmt0.format(c.staff_start ?? 0)} a ${fmt0.format(c.staff_end ?? 0)} personas en el período seleccionado.`} /><Question title="¿Qué queda fuera del informe?" answer="La gestión de sujetos obligados: casos, potenciales, término de giro, contactos, estados de revisión y prioridades operativas permanecen exclusivamente en Atlas." /></div></section>

        {depth.data && <section className="report-section report-page-break"><div className="report-section-heading"><span>08</span><div><h3>Contexto reciente</h3><p>Ventana {depth.data.window.days} días · contexto público y territorial agregado.</p></div></div><div className="dbv2-context-grid"><article><h4>Temas con movimiento de cobertura</h4>{themes.map((x) => <div className="dbv2-context-row" key={x.theme}><strong>{x.theme}</strong><span>{fmt0.format(x.previous_n)} → {fmt0.format(x.current_n)} notas · {x.current_media} medios</span></div>)}</article><article><h4>Regiones con convergencia de señales</h4>{regions.map((x) => <div className="dbv2-context-row" key={x.region_name}><strong>{x.region_name}</strong><span>{fmt0.format(x.finding_n)} hallazgos · {fmt0.format(x.sanction_n)} sanciones · IGR medio {x.avg_igr == null ? 's/d' : fmt1.format(x.avg_igr)}</span></div>)}</article></div><p className="dbv2-note">Estas capas son contexto estratégico; no constituyen por sí solas una medición de lavado de activos o crimen organizado.</p></section>}
      </>}
    </article></main>
  </div>;
}
