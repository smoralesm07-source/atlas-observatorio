import { useEffect, useMemo, useState } from 'react';
import { ErrorBox, Loading } from '../components/primitives';
import { useRpc } from '../lib/rpc';
import { supabase } from '../lib/supabase';
import '../styles/reportes.css';
import '../styles/reportes-directivos.css';

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
    subjects_source?: string | null;
    private_subjects_latest: number | null;
    public_entities_latest: number | null;
    staff_latest: number | null;
    staff_latest_date: string | null;
    staff_source?: string | null;
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
  questions: Array<{ id: string; question: string; answer: Record<string, number | string | null>; caveat: string }>;
  methodology: { focus: string; interpretation: string; cutoffs: string; ai: string };
};

type DepthPayload = {
  contract: string;
  generated_at: string;
  window: { days: number; current_from: string; previous_from: string; to: string };
  coverage: {
    press_media_count?: number;
    press_relevant_articles?: number;
    press_geocoded_pct?: number;
    territory_regions?: number;
    territory_avg_coverage?: number;
    sanctions_current?: number;
  };
  press_momentum: Array<{ theme: string; current_n: number; previous_n: number; delta_pct: number | null; current_media: number; latest_date: string }>;
  regional_convergence: Array<{
    region_name: string;
    avg_igr: number | null;
    max_igr: number | null;
    finding_n: number;
    sanction_n: number;
    alert_context: number;
    coverage: number | null;
  }>;
  sector_convergence: Array<{
    sector: string;
    subject_count: number | null;
    ros_2025: number | null;
    delta_ros_2025_vs_2024_pct: number | null;
    vulnerability_index: number | null;
    sanction_events: number | null;
    sanction_rate_per_100: number | null;
  }>;
};

type ProfileId = 'presupuesto' | 'crimen' | 'supervision' | 'ciudadania' | 'internacional' | 'ejecutivo';
type Profile = { id: ProfileId; label: string; title: string; audience: string; lens: string };

const PROFILES: Profile[] = [
  { id: 'presupuesto', label: 'Presupuesto', title: 'Situación UAF: capacidad instalada, carga y respuesta institucional', audience: 'Comisión de presupuesto y autoridades que requieren comprender la evolución estructural de la UAF', lens: 'Qué ha crecido, qué se mantiene relativamente estable y qué nuevas exigencias debe absorber la institución.' },
  { id: 'crimen', label: 'Crimen organizado', title: 'Situación UAF frente a una demanda de inteligencia financiera más compleja', audience: 'Comisiones e instancias que abordan crimen organizado y delitos base', lens: 'Partir por la capacidad y producción UAF, y luego explicar qué señales territoriales y públicas están cambiando.' },
  { id: 'supervision', label: 'Supervisión', title: 'Situación UAF y expansión del universo supervisado', audience: 'Autoridades de supervisión, regulación y coordinación sectorial', lens: 'Cómo cambia el padrón, qué sectores incorporan más sujetos y qué implica para supervisión, reportabilidad y fiscalización.' },
  { id: 'ciudadania', label: 'Ciudadanía', title: 'Qué recibe, analiza y produce la UAF', audience: 'Rendición pública y comunicación institucional', lens: 'Explicar con cifras simples qué información recibe la UAF, qué productos genera y qué no debe inferirse de esos datos.' },
  { id: 'internacional', label: 'Internacional', title: 'Situación UAF y cooperación de inteligencia financiera', audience: 'Cooperación ALA/CFT e interlocutores internacionales', lens: 'Capacidad nacional primero; cooperación entre UIF y evolución de la demanda transfronteriza como segunda capa.' },
  { id: 'ejecutivo', label: 'Ejecutivo', title: 'Briefing institucional UAF', audience: 'Dirección y comités de gestión', lens: 'Una lectura integral para responder con dominio sobre dotación, información recibida, inteligencia producida y expansión institucional.' },
];

const YEARS = [2020, 2021, 2022, 2023, 2024, 2025];
const fmt0 = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 });
const fmt1 = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 1 });

function signed(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v)) return 's/d';
  return `${v >= 0 ? '+' : ''}${fmt1.format(v)}%`;
}

function compact(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v)) return 's/d';
  if (Math.abs(v) >= 1_000_000) return `${fmt1.format(v / 1_000_000)} millones`;
  if (Math.abs(v) >= 1000) return fmt0.format(v);
  return fmt0.format(v);
}

function valueAt(data: BriefPayload, metric: string, year: number): number | null {
  const p = data.series[metric]?.find((x) => x.period === String(year));
  return p?.value == null ? null : Number(p.value);
}

function annualRows(data: BriefPayload) {
  return YEARS.map((year) => ({
    year,
    staff: valueAt(data, 'dotacion_efectiva_total', year),
    subjects: valueAt(data, 'entidades_reportantes_total', year),
    ros: valueAt(data, 'ros_recibidos', year),
    indicia: valueAt(data, 'ros_con_indicios_laft', year),
    iif: valueAt(data, 'informes_inteligencia_financiera', year),
    mp: valueAt(data, 'requerimientos_ministerio_publico', year),
    mpPeople: valueAt(data, 'personas_en_requerimientos_mp', year),
    activities: valueAt(data, 'actividades_economicas_obligadas', year),
  }));
}

function deterministicBrief(profile: ProfileId, d: BriefPayload, depth: DepthPayload | null) {
  const c = d.change;
  const common = [
    `La última dotación efectiva total publicada es de ${fmt0.format(d.situation.staff_latest ?? 0)} personas, con corte ${d.situation.staff_latest_date ?? 's/d'}. En ${d.period.from} la dotación era de ${fmt0.format(c.staff_start ?? 0)}: la variación del período es ${signed(c.staff_growth_pct)}.`,
    `En paralelo, los ROS pasaron de ${fmt0.format(c.ros_start ?? 0)} a ${fmt0.format(c.ros_end ?? 0)} (${signed(c.ros_growth_pct)}), y los requerimientos del Ministerio Público de ${fmt0.format(c.mp_requests_start ?? 0)} a ${fmt0.format(c.mp_requests_end ?? 0)} (${signed(c.mp_requests_growth_pct)}). La comparación describe escala institucional; no equivale a productividad individual ni a una estimación automática de dotación óptima.`,
    `El universo obligado también cambió: las actividades alcanzaron ${fmt0.format(d.situation.activities_latest ?? 0)} frente a ${fmt0.format(c.activities_start ?? 0)} al inicio del período, y el padrón llega a ${fmt0.format(d.situation.subjects_latest ?? 0)} inscritos al ${d.situation.subjects_latest_date ?? 'último corte'}, ${fmt0.format((d.situation.subjects_latest ?? 0) - (c.subjects_end ?? 0))} más que al cierre de ${d.period.to}.`,
  ];

  if (profile === 'presupuesto') return common;
  if (profile === 'crimen') return [
    common[0],
    `La demanda de inteligencia no se limita a los ROS: en ${d.period.to} hubo ${fmt0.format(d.situation.mp_requests_latest ?? 0)} requerimientos del Ministerio Público que involucraron ${fmt0.format(d.situation.mp_people_latest ?? 0)} personas. Ese canal de trabajo creció de forma marcada respecto de ${d.period.from}.`,
    depth?.press_momentum?.length ? `Como contexto externo, Atlas observa mayor cobertura reciente en ${depth.press_momentum.slice(0,3).map((x) => x.theme).join(', ')}. Es una señal de agenda pública, no una medición de incidencia criminal.` : common[2],
  ];
  if (profile === 'supervision') return [
    common[2],
    `El aumento del padrón desde 2025 se concentra especialmente en ${d.sector_growth.slice(0,3).map((x) => `${x.sector} (+${fmt0.format(x.delta ?? 0)})`).join(', ')}. La lectura es de expansión registral y no de riesgo sectorial.`,
    `En 2025 la UAF informó ${fmt0.format(d.situation.supervision_actions_latest ?? 0)} acciones de supervisión y ${fmt0.format(d.situation.sanction_processes_latest ?? 0)} procesos sancionatorios finalizados, antecedentes que deben leerse junto con el crecimiento del universo obligado.`,
  ];
  if (profile === 'ciudadania') return [
    `En 2025 la UAF recibió ${fmt0.format(d.situation.ros_latest ?? 0)} reportes de operaciones sospechosas y ${compact(d.situation.roe_latest)} reportes de operaciones en efectivo. Son reportes de distinta naturaleza y no se suman para medir “casos”.`,
    `Ese año, ${fmt0.format(d.situation.ros_with_indicia_latest ?? 0)} ROS fueron incorporados a informes con indicios y se enviaron ${fmt0.format(d.situation.iif_latest ?? 0)} informes o complementos de inteligencia financiera. Un informe puede reunir varios ROS y otras fuentes de información.`,
    common[2],
  ];
  if (profile === 'internacional') return [
    common[0],
    `La cooperación entre UIF se suma a la carga doméstica: las consultas recibidas desde UIF extranjeras pasaron de ${fmt0.format(c.international_received_start ?? 0)} a ${fmt0.format(c.international_received_end ?? 0)}, mientras las solicitudes enviadas por Chile pasaron de ${fmt0.format(c.international_sent_start ?? 0)} a ${fmt0.format(c.international_sent_end ?? 0)}.`,
    common[2],
  ];
  return common;
}

function QABlock({ title, answer, note }: { title: string; answer: string; note?: string }) {
  return <article className="db-qa"><span>PREGUNTA POSIBLE</span><h4>{title}</h4><p>{answer}</p>{note && <small>{note}</small>}</article>;
}

function DataCard({ label, value, note, emphasis }: { label: string; value: string; note: string; emphasis?: boolean }) {
  return <div className={`db-card ${emphasis ? 'db-card-emphasis' : ''}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></div>;
}

function SeriesStrip({ label, points, unit }: { label: string; points: Array<number | null>; unit?: string }) {
  const nums = points.filter((x): x is number => x != null);
  const max = Math.max(1, ...nums);
  return <div className="db-strip"><div className="db-strip-head"><strong>{label}</strong><span>{unit}</span></div><div className="db-strip-values">{points.map((v, i) => <div key={YEARS[i]}><i style={{ height: `${v == null ? 0 : Math.max(8, (v / max) * 48)}px` }} /><b>{v == null ? '—' : compact(v)}</b><small>{YEARS[i]}</small></div>)}</div></div>;
}

export function ReportesDirectivos() {
  const [profileId, setProfileId] = useState<ProfileId>('presupuesto');
  const [fromYear, setFromYear] = useState(2020);
  const [toYear, setToYear] = useState(2025);
  const [noveltyDays, setNoveltyDays] = useState(30);
  const [aiText, setAiText] = useState<string | null>(null);
  const [aiStatus, setAiStatus] = useState<'idle' | 'loading' | 'ready' | 'fallback'>('idle');
  const [aiMeta, setAiMeta] = useState<string | null>(null);

  const briefing = useRpc<BriefPayload>('obs_uaf_directive_brief_payload', { p_from_year: fromYear, p_to_year: toYear });
  const depth = useRpc<DepthPayload>('obs_uaf_strategic_depth_payload', { p_novelty_days: noveltyDays });
  const profile = PROFILES.find((x) => x.id === profileId) ?? PROFILES[0];

  useEffect(() => { setAiText(null); setAiStatus('idle'); setAiMeta(null); }, [profileId, fromYear, toYear, noveltyDays]);
  useEffect(() => { document.body.classList.add('atlas-report-mode'); return () => document.body.classList.remove('atlas-report-mode'); }, []);

  const rows = useMemo(() => briefing.data ? annualRows(briefing.data) : [], [briefing.data]);

  if (briefing.loading && !briefing.data) return <Loading label="Construyendo briefing institucional UAF…" />;
  if (briefing.error) return <ErrorBox error={briefing.error} onRetry={briefing.reload} />;
  if (!briefing.data) return <ErrorBox error="Atlas no pudo construir el briefing institucional." onRetry={briefing.reload} />;

  const d = briefing.data;
  const c = d.change;
  const context = depth.data;
  const baseBrief = deterministicBrief(profileId, d, context);
  const narrative = aiText ? aiText.split(/\n\s*\n/).filter(Boolean) : baseBrief;
  const latestGrowth = d.sector_growth.slice(0, 6);
  const latestDecline = d.sector_decline.slice(0, 4);
  const pressThemes = context?.press_momentum?.slice(0, 5) ?? [];
  const regions = context?.regional_convergence?.slice(0, 5) ?? [];

  const validatedData = {
    contract: d.contract,
    profile: profileId,
    situation: d.situation,
    change: d.change,
    questions: d.questions,
    sector_growth: latestGrowth,
    sector_decline: latestDecline,
    context: context ? { coverage: context.coverage, press_momentum: pressThemes, regions } : null,
    methodology: d.methodology,
    constraints: [
      'No calcular ni inventar cifras nuevas.',
      'La situación UAF debe ser el eje principal; territorio, sanciones y prensa son contexto secundario.',
      'No usar índices compuestos de presión como argumento central.',
      'No confundir ROE con ROS ni sumar ambos como carga homogénea.',
      'No interpretar el número de IIF como conversión uno a uno desde ROS.',
      'No presentar prensa como incidencia delictual ni proxies territoriales como prevalencia criminal.',
      'No recomendar votos, montos presupuestarios ni decisiones políticas.',
    ],
  };

  async function requestAi() {
    setAiStatus('loading'); setAiMeta(null);
    const { data, error } = await supabase.functions.invoke('atlas-report-narrative', {
      body: { profile: { id: profile.id, audience: profile.audience, purpose: profile.lens, question: 'Explicar la situación institucional UAF con dominio y cautela metodológica.' }, validated_data: validatedData },
    });
    if (error || !data?.narrative) {
      setAiText(null); setAiStatus('fallback'); setAiMeta(error?.message ?? data?.reason ?? 'Se mantiene síntesis determinística.');
      return;
    }
    setAiText(String(data.narrative)); setAiStatus(data.ai_used ? 'ready' : 'fallback');
    setAiMeta(data.ai_used ? `Síntesis IA · ${String(data.model ?? 'modelo configurado')}` : String(data.reason ?? 'Se mantiene síntesis determinística.'));
  }

  function printPdf() {
    const prev = document.title;
    document.title = `ATLAS_Briefing_UAF_${profile.label}_${fromYear}_${toYear}`;
    window.print();
    window.setTimeout(() => { document.title = prev; }, 500);
  }

  const staffPoints = rows.map((r) => r.staff);
  const subjectPoints = rows.map((r) => r.subjects);
  const rosPoints = rows.map((r) => r.ros);
  const indiciaPoints = rows.map((r) => r.indicia);
  const iifPoints = rows.map((r) => r.iif);
  const mpPoints = rows.map((r) => r.mp);

  return <div className="report-view directive-report fade-in">
    <aside className="atlas-report-controls">
      <div><span className="report-kicker">ATLAS · BRIEFING INSTITUCIONAL</span><h1>Situación UAF</h1><p>Primero la institución: capacidad, información recibida, productos de inteligencia y expansión del universo obligado.</p></div>
      <label><span>Enfoque de presentación</span><select value={profileId} onChange={(e) => setProfileId(e.target.value as ProfileId)}>{PROFILES.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select></label>
      <div className="report-profile-card"><strong>{profile.title}</strong><small>{profile.audience}</small><p>{profile.lens}</p></div>
      <div className="report-year-grid">
        <label><span>Serie desde</span><select value={fromYear} onChange={(e) => setFromYear(Math.min(Number(e.target.value), toYear))}>{YEARS.map((y) => <option key={y}>{y}</option>)}</select></label>
        <label><span>Serie hasta</span><select value={toYear} onChange={(e) => setToYear(Math.max(Number(e.target.value), fromYear))}>{YEARS.map((y) => <option key={y}>{y}</option>)}</select></label>
      </div>
      <label><span>Contexto reciente</span><select value={noveltyDays} onChange={(e) => setNoveltyDays(Number(e.target.value))}><option value={7}>7 días</option><option value={30}>30 días</option><option value={60}>60 días</option><option value={90}>90 días</option></select></label>
      <div className="report-safety-box"><strong>Regla del informe</strong><span>Las cifras provienen de contratos determinísticos y mantienen su fecha de corte.</span><span>La IA sólo redacta; no decide qué número usar ni recalcula resultados.</span></div>
      <button className="report-btn report-btn-ai" onClick={() => void requestAi()} disabled={aiStatus === 'loading'}>{aiStatus === 'loading' ? 'Redactando…' : 'Redactar síntesis IA'}</button>
      <button className="report-btn report-btn-primary" onClick={printPdf}>Generar PDF</button>
      {aiMeta && <small className="report-ai-meta">{aiMeta}</small>}
    </aside>

    <main className="report-paper-wrap"><article className="report-paper directive-paper">
      <header className="report-cover directive-cover">
        <div className="report-cover-top"><span>ATLAS OBSERVATORIO</span><span>BRIEFING UAF · {d.situation.subjects_latest_date ?? d.period.to}</span></div>
        <div className="report-cover-body"><span className="report-eyebrow">{profile.label}</span><h2>{profile.title}</h2><p>{profile.lens}</p></div>
        <div className="report-badges"><span>SITUACIÓN UAF PRIMERO</span><span>CORTES TRAZADOS</span><span>{aiStatus === 'ready' ? 'SÍNTESIS IA VALIDADA' : 'SÍNTESIS DETERMINÍSTICA'}</span></div>
      </header>

      <section className="report-section db-opening report-no-break">
        <div className="report-section-heading"><span>01</span><div><h3>La UAF en una página</h3><p>Magnitudes que un directivo debería tener disponibles antes de cualquier comparecencia.</p></div></div>
        <div className="db-card-grid">
          <DataCard label="Sujetos inscritos" value={fmt0.format(d.situation.subjects_latest ?? 0)} note={`corte ${d.situation.subjects_latest_date ?? 's/d'} · ${fmt0.format(d.situation.private_subjects_latest ?? 0)} privados + ${fmt0.format(d.situation.public_entities_latest ?? 0)} públicos`} emphasis />
          <DataCard label="Dotación efectiva" value={fmt0.format(d.situation.staff_latest ?? 0)} note={`última cifra pública disponible · ${d.situation.staff_latest_date ?? 's/d'}`} emphasis />
          <DataCard label="ROS recibidos" value={fmt0.format(d.situation.ros_latest ?? 0)} note={`${toYear} · ${signed(c.ros_growth_pct)} desde ${fromYear}`} emphasis />
          <DataCard label="ROE recibidos" value={compact(d.situation.roe_latest)} note={`2025 · serie comparable desde 2021: ${signed(c.roe_growth_2021_2025_pct)}`} />
          <DataCard label="ROS con indicios" value={fmt0.format(d.situation.ros_with_indicia_latest ?? 0)} note={`2025 · incorporados a informes con indicios`} />
          <DataCard label="IIF y complementos" value={fmt0.format(d.situation.iif_latest ?? 0)} note={`2025 · no existe relación 1:1 con ROS`} />
          <DataCard label="Requerimientos MP" value={fmt0.format(d.situation.mp_requests_latest ?? 0)} note={`${fmt0.format(d.situation.mp_people_latest ?? 0)} personas comprendidas · 2025`} />
          <DataCard label="Actividades obligadas" value={fmt0.format(d.situation.activities_latest ?? 0)} note={`${fmt0.format((c.activities_end ?? 0) - (c.activities_start ?? 0))} más que en ${fromYear}`} />
        </div>
        <div className="report-narrative db-narrative"><div className="report-narrative-label"><span>{aiStatus === 'ready' ? 'Lectura ejecutiva IA' : 'Lectura ejecutiva base'}</span><small>La interpretación usa únicamente cifras validadas y conserva sus cortes.</small></div>{narrative.map((p, i) => <p key={i}>{p}</p>)}</div>
      </section>

      <section className="report-section report-page-break">
        <div className="report-section-heading"><span>02</span><div><h3>Qué ha cambiado realmente desde {fromYear}</h3><p>Series observables, sin convertirlas en un índice sintético.</p></div></div>
        <div className="db-series-grid">
          <SeriesStrip label="Dotación efectiva" points={staffPoints} unit="personas" />
          <SeriesStrip label="Sujetos inscritos" points={subjectPoints} unit="personas y entidades" />
          <SeriesStrip label="ROS recibidos" points={rosPoints} unit="reportes" />
          <SeriesStrip label="ROS con indicios" points={indiciaPoints} unit="reportes" />
          <SeriesStrip label="IIF y complementos" points={iifPoints} unit="productos" />
          <SeriesStrip label="Requerimientos MP" points={mpPoints} unit="requerimientos" />
        </div>
        <div className="db-comparison-grid">
          <div><span>Dotación</span><strong>{fmt0.format(c.staff_start ?? 0)} → {fmt0.format(c.staff_end ?? 0)}</strong><small>{signed(c.staff_growth_pct)}</small></div>
          <div><span>ROS</span><strong>{fmt0.format(c.ros_start ?? 0)} → {fmt0.format(c.ros_end ?? 0)}</strong><small>{signed(c.ros_growth_pct)}</small></div>
          <div><span>Requerimientos MP</span><strong>{fmt0.format(c.mp_requests_start ?? 0)} → {fmt0.format(c.mp_requests_end ?? 0)}</strong><small>{signed(c.mp_requests_growth_pct)}</small></div>
          <div><span>ROS con indicios</span><strong>{fmt0.format(c.indicia_start ?? 0)} → {fmt0.format(c.indicia_end ?? 0)}</strong><small>{signed(c.indicia_growth_pct)}</small></div>
          <div><span>IIF</span><strong>{fmt0.format(c.iif_start ?? 0)} → {fmt0.format(c.iif_end ?? 0)}</strong><small>{signed(c.iif_growth_pct)}</small></div>
          <div><span>Sujetos</span><strong>{fmt0.format(c.subjects_start ?? 0)} → {fmt0.format(c.subjects_end ?? 0)}</strong><small>{signed(c.subjects_growth_pct)}</small></div>
        </div>
        <p className="report-method-note">La comparación no supone que todas las funciones utilicen la misma dotación ni que cada ROS tenga igual complejidad. Su objetivo es dimensionar cómo cambió el tamaño de la institución y de los flujos que administra.</p>
      </section>

      <section className="report-section report-page-break">
        <div className="report-section-heading"><span>03</span><div><h3>La información que entra cambió de composición</h3><p>ROE y ROS deben explicarse por separado.</p></div></div>
        <div className="db-story-split">
          <article><span>REPORTABILIDAD MASIVA</span><h4>ROE</h4><strong>{fmt0.format(c.roe_2021_thousands ?? 0)} mil → {fmt0.format(c.roe_2025_thousands ?? 0)} mil</strong><p>Entre 2021 y 2025 la serie de ROE disminuye {signed(c.roe_growth_2021_2025_pct)}. Es un flujo de reporte objetivo y masivo, de naturaleza distinta al ROS.</p></article>
          <article><span>REPORTABILIDAD SOSPECHOSA</span><h4>ROS</h4><strong>{fmt0.format(c.ros_start ?? 0)} → {fmt0.format(c.ros_end ?? 0)}</strong><p>Los ROS crecen {signed(c.ros_growth_pct)} entre {fromYear} y {toYear}. La combinación ROE a la baja / ROS al alza muestra un cambio en la mezcla de información recibida, no una simple variación del volumen total.</p></article>
        </div>
        <div className="db-fact-note"><strong>Dato útil para explicar</strong><p>En 2025 los ROS informaron a ${fmt0.format(d.situation.people_reported_in_ros_latest ?? 0)} personas. Esa cifra no equivale a personas investigadas, imputadas ni condenadas: corresponde a personas informadas en reportes.</p></div>
      </section>

      <section className="report-section report-page-break">
        <div className="report-section-heading"><span>04</span><div><h3>Cómo se transforma la información en inteligencia</h3><p>La cadena no es ROS → IIF de manera uno a uno.</p></div></div>
        <div className="db-flow">
          <div><span>ROS recibidos</span><strong>{fmt0.format(d.situation.ros_latest ?? 0)}</strong><small>2025</small></div><b>→</b>
          <div><span>ROS incorporados a informes con indicios</span><strong>{fmt0.format(d.situation.ros_with_indicia_latest ?? 0)}</strong><small>2025</small></div><b>→</b>
          <div><span>IIF y complementos</span><strong>{fmt0.format(d.situation.iif_latest ?? 0)}</strong><small>2025</small></div>
        </div>
        <div className="db-explain-grid">
          <p><strong>Qué sí se puede decir.</strong> Los ROS con indicios pasan de {fmt0.format(c.indicia_start ?? 0)} en {fromYear} a {fmt0.format(c.indicia_end ?? 0)} en {toYear}, mientras los IIF/complementos pasan de {fmt0.format(c.iif_start ?? 0)} a {fmt0.format(c.iif_end ?? 0)}.</p>
          <p><strong>Qué no se debe decir.</strong> No corresponde dividir IIF por ROS y llamarlo “tasa de conversión”: un IIF puede consolidar múltiples ROS, cruces y antecedentes.</p>
          <p><strong>Qué falta para medir capacidad máxima.</strong> Dotación específica de inteligencia, complejidad de casos, horas de análisis, backlog, tiempos de ciclo y automatización interna.</p>
        </div>
      </section>

      <section className="report-section report-page-break">
        <div className="report-section-heading"><span>05</span><div><h3>El Ministerio Público demanda más información</h3><p>Una línea de trabajo que debe explicarse separadamente de los IIF.</p></div></div>
        <div className="db-mp-grid">
          <DataCard label={`${fromYear} · requerimientos`} value={fmt0.format(c.mp_requests_start ?? 0)} note={`${fmt0.format(c.mp_people_start ?? 0)} personas comprendidas`} />
          <DataCard label={`${toYear} · requerimientos`} value={fmt0.format(c.mp_requests_end ?? 0)} note={`${fmt0.format(c.mp_people_end ?? 0)} personas comprendidas`} emphasis />
          <DataCard label="Cambio en requerimientos" value={signed(c.mp_requests_growth_pct)} note={`${fromYear}–${toYear}`} />
          <DataCard label="Cambio en personas" value={signed(c.mp_people_growth_pct)} note={`${fromYear}–${toYear}`} />
        </div>
        <p className="db-interpretation">Para una autoridad, el punto relevante no es sólo que suban los ROS. También crece una demanda externa directa del sistema penal hacia la UAF: en 2025 se registran {fmt0.format(d.situation.mp_requests_latest ?? 0)} requerimientos que abarcan {fmt0.format(d.situation.mp_people_latest ?? 0)} personas.</p>
      </section>

      <section className="report-section report-page-break">
        <div className="report-section-heading"><span>06</span><div><h3>El perímetro institucional es mayor</h3><p>Nuevos sectores y nuevos sujetos cambian la escala de supervisión y recepción de información.</p></div></div>
        <div className="db-perimeter-grid">
          <div><span>Actividades obligadas</span><strong>{fmt0.format(c.activities_start ?? 0)} → {fmt0.format(c.activities_end ?? 0)}</strong><small>+{fmt0.format((c.activities_end ?? 0) - (c.activities_start ?? 0))} actividades</small></div>
          <div><span>Sujetos a cierre 2025</span><strong>{fmt0.format(c.subjects_end ?? 0)}</strong><small>{signed(c.subjects_growth_pct)} desde {fromYear}</small></div>
          <div><span>Padrón más reciente</span><strong>{fmt0.format(d.situation.subjects_latest ?? 0)}</strong><small>{d.situation.subjects_latest_date} · +{fmt0.format((d.situation.subjects_latest ?? 0) - (c.subjects_end ?? 0))} desde cierre 2025</small></div>
        </div>
        <h4 className="db-subtitle">Sectores que más agregan sujetos respecto del cierre 2025</h4>
        <div className="report-table-wrap"><table className="report-table"><thead><tr><th>Sector</th><th>2025</th><th>Actual</th><th>Cambio</th><th>Región principal</th></tr></thead><tbody>{latestGrowth.map((x) => <tr key={x.sector}><td>{x.sector}</td><td>{fmt0.format(x.registered_so_2025 ?? 0)}</td><td>{fmt0.format(x.current_subjects ?? 0)}</td><td>+{fmt0.format(x.delta ?? 0)} ({signed(x.delta_pct)})</td><td>{x.top_region ?? '—'}</td></tr>)}</tbody></table></div>
        {latestDecline.length > 0 && <p className="report-method-note">También hay sectores que reducen inscritos en el mismo contraste: {latestDecline.map((x) => `${x.sector} (${fmt0.format(x.delta ?? 0)})`).join(', ')}. Variación registral no implica entrada o salida efectiva de actividad económica sin revisar el caso.</p>}
      </section>

      <section className="report-section report-page-break">
        <div className="report-section-heading"><span>07</span><div><h3>Preguntas que una autoridad puede hacer</h3><p>Respuestas preparadas para explicar la institución sin sobrerreaccionar a una cifra aislada.</p></div></div>
        <div className="db-qa-grid">
          <QABlock title="¿La UAF tiene hoy más funcionarios que en 2020?" answer={`Sí en la última serie pública: ${fmt0.format(c.staff_start ?? 0)} en ${fromYear} y ${fmt0.format(c.staff_end ?? 0)} en ${toYear}. La última dotación publicada es ${fmt0.format(d.situation.staff_latest ?? 0)} con corte ${d.situation.staff_latest_date}.`} note="No atribuir esa dotación completa a Inteligencia Financiera." />
          <QABlock title="¿Por qué los IIF no crecen al mismo ritmo que los ROS?" answer={`Porque no son unidades equivalentes. En ${toYear} hubo ${fmt0.format(d.situation.ros_latest ?? 0)} ROS, ${fmt0.format(d.situation.ros_with_indicia_latest ?? 0)} ROS incorporados a informes con indicios y ${fmt0.format(d.situation.iif_latest ?? 0)} IIF/complementos. Un IIF puede agrupar varios ROS y otras fuentes.`} />
          <QABlock title="¿La UAF recibe más o menos reportes?" answer={`Depende del tipo. La serie ROE cae ${signed(c.roe_growth_2021_2025_pct)} entre 2021 y 2025, mientras los ROS aumentan ${signed(c.ros_growth_pct)} entre ${fromYear} y ${toYear}. Por eso debe hablarse de composición de la reportabilidad, no de un único volumen.`} />
          <QABlock title="¿El universo que debe atender la UAF es el mismo de 2020?" answer={`No. Las actividades obligadas pasan de ${fmt0.format(c.activities_start ?? 0)} a ${fmt0.format(c.activities_end ?? 0)}, y los inscritos pasan de ${fmt0.format(c.subjects_start ?? 0)} en ${fromYear} a ${fmt0.format(d.situation.subjects_latest ?? 0)} en el último corte disponible.`} />
          <QABlock title="¿Ha aumentado la interacción con el Ministerio Público?" answer={`Sí en la serie publicada: ${fmt0.format(c.mp_requests_start ?? 0)} requerimientos en ${fromYear} frente a ${fmt0.format(c.mp_requests_end ?? 0)} en ${toYear}; las personas comprendidas pasan de ${fmt0.format(c.mp_people_start ?? 0)} a ${fmt0.format(c.mp_people_end ?? 0)}.`} />
          <QABlock title="¿Con estas cifras se puede afirmar que falta personal?" answer="No por sí solas. Las cifras permiten mostrar que cambiaron la escala y la composición de las obligaciones institucionales. Para estimar brecha de dotación se requieren datos internos de carga, complejidad, tiempos, backlog y dotación por función." />
        </div>
      </section>

      <section className="report-section report-page-break">
        <div className="report-section-heading"><span>08</span><div><h3>Contexto que puede cambiar el briefing</h3><p>Prensa, territorio y sanciones entran después de explicar la situación UAF.</p></div></div>
        {depth.loading && !context ? <p className="report-method-note">Cargando contexto reciente…</p> : <>
          <div className="db-context-grid">
            <article><span>AGENDA PÚBLICA</span><h4>Temas que más cambian</h4>{pressThemes.slice(0,4).map((x) => <div className="db-context-row" key={x.theme}><strong>{x.theme}</strong><span>{fmt0.format(x.previous_n)} → {fmt0.format(x.current_n)} notas · {x.current_media} medios</span></div>)}</article>
            <article><span>TERRITORIO</span><h4>Regiones que requieren contexto</h4>{regions.slice(0,4).map((x) => <div className="db-context-row" key={x.region_name}><strong>{x.region_name}</strong><span>{fmt0.format(x.finding_n)} hallazgos Atlas · {fmt0.format(x.sanction_n)} sanciones recientes · IGR medio {x.avg_igr == null ? 's/d' : fmt1.format(x.avg_igr)}</span></div>)}</article>
          </div>
          <p className="report-method-note">La cobertura de prensa georreferenciada disponible es {context?.coverage?.press_geocoded_pct ?? 0}%. Por ello Atlas no usa actualmente prensa para afirmar concentración regional; se muestra como agenda temática nacional/internacional hasta mejorar esa cobertura.</p>
        </>}
      </section>

      <section className="report-section report-page-break report-sources">
        <div className="report-section-heading"><span>09</span><div><h3>Qué otras funciones también consumen capacidad</h3><p>La lectura institucional no termina en inteligencia financiera.</p></div></div>
        <div className="db-secondary-grid">
          <DataCard label="Acciones de supervisión" value={fmt0.format(d.situation.supervision_actions_latest ?? 0)} note="2025" />
          <DataCard label="Procesos sancionatorios finalizados" value={fmt0.format(d.situation.sanction_processes_latest ?? 0)} note="2025" />
          <DataCard label="Personas capacitadas" value={fmt0.format(d.situation.people_trained_latest ?? 0)} note="2025" />
          <DataCard label="Consultas UIF extranjeras" value={fmt0.format(c.international_received_end ?? 0)} note={`${toYear} · recibidas`} />
          <DataCard label="Solicitudes a UIF extranjeras" value={fmt0.format(c.international_sent_end ?? 0)} note={`${toYear} · enviadas`} />
        </div>
        <div className="report-method-grid"><div><strong>Cortes</strong><p>{d.methodology.cutoffs}</p></div><div><strong>Interpretación</strong><p>{d.methodology.interpretation}</p></div><div><strong>IA</strong><p>{d.methodology.ai}</p></div></div>
        <div className="report-footer-note"><strong>Lectura institucional recomendada</strong><p>Este briefing describe qué ha cambiado en la UAF y qué información debe poder explicar una autoridad. No estima dotación óptima, culpabilidad, prevalencia criminal ni recomienda decisiones políticas. Las capas externas sirven para contextualizar la situación institucional, no para desplazarla.</p></div>
      </section>
    </article></main>
  </div>;
}
