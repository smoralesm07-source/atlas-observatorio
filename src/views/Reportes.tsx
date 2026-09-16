import { useEffect, useMemo, useState } from 'react';
import { ErrorBox, Loading } from '../components/primitives';
import { useRpc } from '../lib/rpc';
import { supabase } from '../lib/supabase';
import '../styles/reportes.css';

type Point = { periodo: string; valor: number | null; fuente?: string | null; corte?: string | null; metodo_captura?: string | null };
type Series = { unidad?: string | null; categoria?: string | null; puntos: Point[] };
type BaseSector = {
  sector: string; inscritos_2025: number | null; ros_2025: number | null; ros_2021_2025: number | null;
  ros_por_100_so_2025: number | null; variacion_ros_2025_2024_pct: number | null; silencio_5y: boolean | null;
  indicios_2021_2025: number | null; fuente?: string | null; corte?: string | null;
};
type BasePayload = {
  contract: string;
  periodo: { desde: number; hasta: number };
  series: Record<string, Series>;
  sectores: BaseSector[];
  metodologia: { calculo: string; nivel_reportabilidad: string; comparabilidad: string };
};
type StrategicQuestion = {
  id: string; question: string; answer: string; caveat?: string;
  pressure_index?: number | null; staff_index?: number | null; gap_points?: number | null;
  regions?: Array<Record<string, any>>; external_alert_count?: number; strategic_press_count?: number;
  recent_uaf_sanction_count?: number; window_days?: number; top_components?: Array<Record<string, any>>;
  ros_total_2025?: number; silent_sector_count?: number;
};
type ExternalAlert = {
  alert_id: string; severity: string; urgency_score: number; event_at: string; entity_id?: string; entity_name: string;
  uaf_sector?: string | null; signal_label?: string | null; article_count?: number; source_count?: number;
  latest_title?: string | null; latest_summary?: string | null; latest_source?: string | null; latest_url?: string | null;
  ipa3_score?: number | null; ipa_gap?: string | null; alert_reason?: string | null;
};
type PressItem = {
  article_id: string; article_date: string; title: string; media: string; url: string; summary?: string | null;
  region?: string | null; commune?: string | null; theme: string; scope: 'NACIONAL' | 'INTERNACIONAL';
};
type PressTheme = { theme: string; article_count: number; source_count: number; latest_date: string };
type SanctionItem = {
  event_id: string; event_date: string; regulator: string; canonical_name: string; region?: string | null;
  uaf_sector?: string | null; reason?: string | null; document_url?: string | null; amount_uf?: number | null; amount_clp?: number | null;
};
type RegionRow = {
  region_code: string; region_name: string; commune_count: number; avg_igr: number | null; max_igr: number | null;
  avg_predicate_score: number | null; avg_criminal_economy_score: number | null; avg_criminogenic_context_score: number | null;
  sanctioned_context: number; alerted_context: number; findings_context: number; methodological_coverage: number | null; strategic_rank: number;
};
type CommuneRow = {
  region_name: string; commune_name: string; commune_code: string; igr: number | null; threat: number | null;
  vulnerability: number | null; density: number | null; gap: number | null; potential_total: number | null;
  uaf_observed: number | null; cead_year: number; cead_confidence: number | null; predicate_score: number | null;
  criminal_economy_score: number | null; criminogenic_context_score: number | null; interpretation?: string | null;
};
type CeadComponent = {
  component_id: string; component_label: string; commune_count: number; avg_score: number | null;
  avg_trend: number | null; total_2025: number | null; max_years_observed: number | null;
};
type SectorMove = {
  sector_official: string; sector_canonical?: string | null; registered_so_2025: number | null; ros_2024: number | null;
  ros_2025: number | null; ros_total_2021_2025: number | null; ros_per_100_so_2025: number | null;
  delta_ros_2025_vs_2024_pct: number | null; silence_5y: boolean | null; indicios_2025: number | null;
  indicios_total_2021_2025: number | null; source_url?: string | null; as_of_date?: string | null;
};
type StrategicPayload = {
  contract: string; generated_at: string; snapshot_hash: string;
  periodo: { desde: number; hasta: number };
  novedad: { dias: number; desde: string; hasta: string };
  base: BasePayload;
  preguntas_estrategicas: StrategicQuestion[];
  novedades: {
    alertas_externas: ExternalAlert[];
    prensa_resumen: { article_count?: number; national_count?: number; international_count?: number; media_count?: number; latest_date?: string };
    prensa_temas: PressTheme[];
    prensa_reciente: PressItem[];
    sanciones_resumen: { recent_event_count?: number; recent_entity_count?: number; regulator_count?: number; region_count?: number; latest_date?: string };
    sanciones_recientes: SanctionItem[];
    sanciones_universo: Record<string, any>;
  };
  territorio: { year: number; regiones: RegionRow[]; comunas_prioritarias: CommuneRow[]; componentes_cead: CeadComponent[]; metodologia: string };
  sectores: { movimientos: SectorMove[]; resumen: { ros_total?: number; registered_total?: number; silent_sector_count?: number } };
  reglas: { datos: string; prensa: string; ia: string };
};

type ProfileId = 'presupuesto' | 'crimen' | 'supervision' | 'territorial' | 'ciudadania' | 'internacional' | 'ejecutivo';
type Profile = { id: ProfileId; short: string; title: string; audience: string; purpose: string; lead: string };
type AiInsights = { novelties: string; territory: string; crime: string; sectors: string; capacity: string };
type AiInsightKey = keyof AiInsights;
type ReportVersion = 'base' | 'ai';
type FocusConfig = { title: string; lead: string; primary: AiInsightKey; secondary: AiInsightKey; tertiary: AiInsightKey };

const FOCUS_CONFIG: Record<ProfileId, FocusConfig> = {
  presupuesto: { title: 'Presión y capacidad institucional', lead: 'Prioriza la relación entre demanda observable, capacidad y cambios que agregan complejidad.', primary: 'capacity', secondary: 'sectors', tertiary: 'novelties' },
  crimen: { title: 'Convergencia de señales vinculadas a economías criminales', lead: 'Prioriza proxies, territorio y novedades sin convertir señales de contexto en prueba de delito.', primary: 'crime', secondary: 'territory', tertiary: 'novelties' },
  supervision: { title: 'Sectores que explican los cambios de reportabilidad', lead: 'Prioriza industrias que aumentan o reducen su aporte, concentración y señales de contexto supervisor.', primary: 'sectors', secondary: 'novelties', tertiary: 'capacity' },
  territorial: { title: 'Dónde se concentran y qué explica las señales', lead: 'Prioriza regiones, comunas y componentes que explican la lectura territorial del período.', primary: 'territory', secondary: 'crime', tertiary: 'novelties' },
  ciudadania: { title: 'Qué cambió y cómo debe interpretarse', lead: 'Traduce los principales cambios a una lectura pública clara, con límites metodológicos explícitos.', primary: 'novelties', secondary: 'capacity', tertiary: 'territory' },
  internacional: { title: 'Dimensión internacional y presión doméstica', lead: 'Relaciona novedades transfronterizas con la evolución del sistema nacional sin confundir cooperación con criminalidad.', primary: 'novelties', secondary: 'capacity', tertiary: 'territory' },
  ejecutivo: { title: 'Lectura directiva de los cambios más relevantes', lead: 'Concentra los cambios que merecen atención y los factores que explican su movimiento.', primary: 'capacity', secondary: 'sectors', tertiary: 'novelties' },
};

const PROFILES: Profile[] = [
  { id: 'presupuesto', short: 'Presupuesto', title: 'Capacidad institucional frente a una demanda ALA/CFT más compleja', audience: 'Comisión de presupuesto y autoridades con responsabilidad sobre recursos públicos', purpose: 'Mostrar cómo evoluciona la presión observable que absorbe la UAF y qué nuevas exigencias aparecen, sin convertir el análisis en una recomendación de asignación.', lead: 'Capacidad, demanda, expansión del perímetro y novedades que aumentan complejidad.' },
  { id: 'crimen', short: 'Crimen organizado', title: 'Inteligencia financiera y señales vinculadas a economías criminales', audience: 'Comisiones y autoridades que abordan crimen organizado y delitos base', purpose: 'Integrar demanda de inteligencia financiera, señales territoriales, prensa trazada y delitos base, distinguiendo hechos de proxies.', lead: 'Delitos base, territorio, señales externas y articulación con investigación penal.' },
  { id: 'supervision', short: 'Supervisión', title: 'Cobertura, reportabilidad y señales del universo obligado', audience: 'Instancias de supervisión, regulación y coordinación sectorial', purpose: 'Mostrar concentración de reportabilidad, sectores que cambian, sanciones y señales que podrían justificar revisión focalizada.', lead: 'Perímetro, comportamiento sectorial, sanciones y cobertura de supervisión.' },
  { id: 'territorial', short: 'Territorial', title: 'Dónde se concentran las señales relevantes para análisis AML', audience: 'Autoridades nacionales y regionales', purpose: 'Ordenar evidencia territorial para identificar dónde convergen delitos base, economía criminal, sanciones y alertas.', lead: 'Regiones, comunas y componentes criminógenos con mayor intensidad relativa.' },
  { id: 'ciudadania', short: 'Ciudadanía', title: 'Qué está observando la UAF y por qué importa', audience: 'Ciudadanía, rendición pública y comunicaciones institucionales', purpose: 'Explicar en lenguaje claro qué volumen absorbe el sistema, dónde aparecen señales y cuáles son los límites de interpretación.', lead: 'Transparencia, contexto y explicación no técnica de cifras verificables.' },
  { id: 'internacional', short: 'Internacional', title: 'Dimensión transfronteriza de la inteligencia financiera', audience: 'Cooperación internacional y autoridades ALA/CFT', purpose: 'Relacionar cooperación entre UIF con presión doméstica, novedades internacionales y evolución del sistema nacional.', lead: 'Intercambio entre UIF, presión internacional y señales transfronterizas.' },
  { id: 'ejecutivo', short: 'Ejecutivo', title: 'Situación estratégica del sistema ALA/CFT observado por Atlas', audience: 'Dirección y comités de gestión', purpose: 'Concentrar lo que cambió, dónde está ocurriendo y qué evidencia requiere atención directiva.', lead: 'Una lectura integral de presión, novedades, territorio, sectores y fuentes.' },
];

const YEARS = [2020, 2021, 2022, 2023, 2024, 2025];
const fmt = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 1 });
const fmt0 = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 });

function n(value: unknown): number | null { const x = Number(value); return Number.isFinite(x) ? x : null; }
function pct(a: number | null, b: number | null): number | null { return a == null || b == null || a === 0 ? null : ((b / a) - 1) * 100; }
function idx(a: number | null, b: number | null): number | null { return a == null || b == null || a === 0 ? null : (b / a) * 100; }
function signed(value: number | null): string { return value == null ? 's/d' : `${value >= 0 ? '+' : ''}${fmt.format(value)}%`; }
function val(base: BasePayload, metric: string, year: number): number | null {
  const p = base.series[metric]?.puntos.find((x) => x.periodo === String(year));
  return p?.valor == null ? null : n(p.valor);
}
function top8Share(base: BasePayload): number | null {
  const total = val(base, 'ros_recibidos', 2025);
  if (!total) return null;
  const top = [...base.sectores].sort((a, b) => Number(b.ros_2025 ?? 0) - Number(a.ros_2025 ?? 0)).slice(0, 8).reduce((s, x) => s + Number(x.ros_2025 ?? 0), 0);
  return top / total * 100;
}
function geometricMean(values: number[]): number | null {
  if (!values.length || values.some((x) => x <= 0 || !Number.isFinite(x))) return null;
  return Math.exp(values.reduce((s, x) => s + Math.log(x), 0) / values.length);
}

function structural(base: BasePayload) {
  const from = base.periodo.desde; const to = base.periodo.hasta;
  const so0 = val(base, 'entidades_reportantes_total', from); const so1 = val(base, 'entidades_reportantes_total', to);
  const ros0 = val(base, 'ros_recibidos', from); const ros1 = val(base, 'ros_recibidos', to);
  const act0 = val(base, 'actividades_economicas_obligadas', from); const act1 = val(base, 'actividades_economicas_obligadas', to);
  const staff0 = val(base, 'dotacion_efectiva_total', from); const staff1 = val(base, 'dotacion_efectiva_total', to);
  const iif0 = val(base, 'informes_inteligencia_financiera', from); const iif1 = val(base, 'informes_inteligencia_financiera', to);
  const mp0 = val(base, 'requerimientos_ministerio_publico', from); const mp1 = val(base, 'requerimientos_ministerio_publico', to);
  const rec0 = val(base, 'consultas_uif_extranjeras_recibidas', from); const rec1 = val(base, 'consultas_uif_extranjeras_recibidas', to);
  const sent0 = val(base, 'solicitudes_uif_extranjeras_enviadas', from); const sent1 = val(base, 'solicitudes_uif_extranjeras_enviadas', to);
  const pressureParts = [idx(so0, so1), idx(ros0, ros1), idx(act0, act1)];
  return {
    from, to, so0, so1, ros0, ros1, act0, act1, staff0, staff1, iif0, iif1, mp0, mp1,
    intl0: rec0 != null && sent0 != null ? rec0 + sent0 : null,
    intl1: rec1 != null && sent1 != null ? rec1 + sent1 : null,
    pressureIndex: pressureParts.every((x) => x != null) ? geometricMean(pressureParts as number[]) : null,
    staffIndex: idx(staff0, staff1), iifIndex: idx(iif0, iif1),
    soGrowth: pct(so0, so1), rosGrowth: pct(ros0, ros1), staffGrowth: pct(staff0, staff1), iifGrowth: pct(iif0, iif1), mpGrowth: pct(mp0, mp1),
  };
}

function answerQuestion(q: StrategicQuestion, s: ReturnType<typeof structural>, payload: StrategicPayload): string {
  if (q.id === 'capacity_pressure') {
    if (q.answer === 'PRESION_CRECE_MAS') return `Entre ${s.from} y ${s.to}, la presión observable crece más rápido que la dotación: índice ${fmt.format(q.pressure_index ?? 0)} versus ${fmt.format(q.staff_index ?? 0)}, una diferencia de ${fmt.format(q.gap_points ?? 0)} puntos índice.`;
    if (q.answer === 'CAPACIDAD_CRECE_MAS') return `La dotación crece a un ritmo superior al índice experimental de presión observable en el período seleccionado.`;
    return 'Las series disponibles no permiten establecer una diferencia material con la metodología actual.';
  }
  if (q.id === 'territorial_focus') {
    const regions = (q.regions ?? []).slice(0, 3).map((r) => r.region).join(', ');
    return regions ? `Las señales territoriales determinísticas priorizan actualmente ${regions}. El ranking combina delitos base, economía criminal e IGR, no una tasa de lavado.` : 'No hay suficiente cobertura territorial para priorizar regiones.';
  }
  if (q.id === 'external_novelties') return `En la ventana de ${q.window_days ?? payload.novedad.dias} días Atlas detecta ${q.external_alert_count ?? 0} alertas externas de sujetos obligados, ${q.strategic_press_count ?? 0} noticias temáticas y ${q.recent_uaf_sanction_count ?? 0} eventos sancionatorios recientes vinculados a sujetos UAF.`;
  if (q.id === 'organized_crime_proxy') {
    const comps = (q.top_components ?? []).slice(0, 3).map((c) => c.component).join(', ');
    return comps ? `Los proxies territoriales con mayor intensidad relativa incluyen ${comps}. Deben leerse como contexto criminógeno y delitos base, no como medición directa de organizaciones criminales.` : 'Atlas no dispone de una medición directa de organizaciones criminales; sólo proxies territoriales y hechos públicos trazados.';
  }
  if (q.id === 'reporting_concentration') return `La reportabilidad 2025 alcanza ${fmt0.format(q.ros_total_2025 ?? 0)} ROS y existen ${q.silent_sector_count ?? 0} categorías sin ROS en el quinquenio sectorial disponible. El silencio identifica ausencia de ROS observados en el período; por sí solo no califica la conducta del sector.`;
  return q.caveat ?? 'Pregunta disponible sin respuesta estructurada.';
}

function deterministicBrief(profile: ProfileId, p: StrategicPayload, s: ReturnType<typeof structural>): string[] {
  const topRegions = [...p.territorio.regiones].sort((a,b) => a.strategic_rank-b.strategic_rank).slice(0,3).map(x => x.region_name).join(', ');
  const alerts = p.novedades.alertas_externas.length;
  const sanctions = p.novedades.sanciones_resumen.recent_event_count ?? 0;
  const press = p.novedades.prensa_resumen.article_count ?? 0;
  if (profile === 'presupuesto') return [
    `La discusión de capacidad no se explica sólo por el volumen de ROS. Entre ${s.from} y ${s.to}, el universo reportante varió ${signed(s.soGrowth)}, los ROS ${signed(s.rosGrowth)} y la dotación efectiva ${signed(s.staffGrowth)}.`,
    `Al corte actual, Atlas agrega una segunda capa de complejidad: ${alerts} alertas externas de alta relevancia, ${sanctions} eventos sancionatorios recientes vinculados a sujetos UAF y ${press} noticias temáticas dentro de la ventana seleccionada.`,
    `Territorialmente, las señales relativas más intensas se concentran en ${topRegions || 'regiones con cobertura suficiente'}. Esto no determina una necesidad presupuestaria por sí solo, pero permite mostrar que la carga institucional combina volumen, amplitud sectorial, cooperación, supervisión y cambios del entorno.`
  ];
  if (profile === 'crimen') return [
    `La lectura de crimen organizado debe separar evidencia directa de proxies. Atlas combina ROS, requerimientos del Ministerio Público, prensa trazada y capas CEAD de delitos base, economía criminal y contexto criminógeno.`,
    `Las regiones que hoy aparecen con mayor intensidad relativa son ${topRegions || 'las de mayor cobertura territorial'}. La señal territorial no atribuye conductas a personas ni empresas y no constituye una estimación de prevalencia de organizaciones criminales.`,
    `Las novedades externas y sancionatorias se incorporan como hechos de contexto para orientar preguntas analíticas, no como prueba de ilícitos.`
  ];
  if (profile === 'territorial') return [
    `El informe territorial busca responder dónde convergen señales, no etiquetar territorios. El ranking actual prioriza ${topRegions || 'las regiones con mayor intensidad relativa'} a partir de promedios comunales comparables.`,
    `Cada región puede desagregarse en comunas y en componentes CEAD para distinguir presión por delitos base, economía criminal y contexto criminógeno.`,
    `Sanciones y alertas de prensa se muestran como contexto adicional, evitando convertir coincidencias geográficas en causalidad.`
  ];
  if (profile === 'supervision') return [
    `El universo obligado debe leerse junto con su comportamiento: crecimiento del padrón, concentración de ROS, silencios de reportabilidad y categorías sin sujetos inscritos describen dimensiones distintas de cobertura.`,
    `Atlas separa la ausencia de ROS observados de la ausencia de correspondencia en el padrón, y mantiene sanciones y señales externas como capas de contexto independientes.`,
    `El objetivo es responder qué sectores cambiaron, cuáles concentran reportabilidad, dónde aparecen silencios y qué categorías no registran sujetos inscritos en el corte analizado.`
  ];
  if (profile === 'internacional') return [
    `La dimensión internacional se superpone con la carga nacional: intercambio entre UIF, noticias transfronterizas y crecimiento del flujo doméstico ocurren simultáneamente.`,
    `Entre ${s.from} y ${s.to}, los requerimientos del Ministerio Público variaron ${signed(s.mpGrowth)}; la cooperación con UIF se presenta en paralelo para evitar confundir intercambio internacional con criminalidad transnacional.`,
    `La prensa internacional funciona sólo como radar de novedades y nunca como fuente de una cifra estructural.`
  ];
  if (profile === 'ciudadania') return [
    `Atlas permite explicar qué observa la UAF con cifras verificables y límites claros: cuántos actores reportan, cuánto flujo recibe el sistema, qué señales públicas cambian y dónde se concentra el contexto territorial.`,
    `La existencia de una noticia, sanción o señal territorial no significa que una persona o empresa haya cometido lavado de activos. Cada capa se presenta con su alcance metodológico.`,
    `El informe busca hacer comprensible la complejidad del sistema sin ocultar las limitaciones de los datos.`
  ];
  return [
    `La situación actual combina una tendencia estructural de mayor complejidad con novedades que cambian semana a semana.`,
    `Hoy Atlas integra ${alerts} alertas externas, ${sanctions} eventos sancionatorios recientes y ${press} noticias temáticas dentro de la ventana seleccionada, además de capas territoriales y sectoriales.`,
    `El valor del informe está en conectar esas capas y convertirlas en preguntas concretas para decisión directiva, manteniendo trazabilidad y cautelas metodológicas.`
  ];
}

function Bar({ value, max = 100 }: { value: number | null | undefined; max?: number }) {
  const v = value == null ? 0 : Math.max(0, Math.min(max, value));
  return <span className="sr-bar"><i style={{ width: `${max ? (v/max)*100 : 0}%` }} /></span>;
}

function IndexCard({ label, value, note }: { label: string; value: number | null; note: string }) {
  return <div className="sr-index-card"><div><span>{label}</span><strong>{value == null ? 's/d' : fmt.format(value)}</strong></div><Bar value={value} max={220} /><small>{note}</small></div>;
}

export function Reportes() {
  const [fromYear, setFromYear] = useState(2020);
  const [toYear, setToYear] = useState(2025);
  const [noveltyDays, setNoveltyDays] = useState(30);
  const [profileId, setProfileId] = useState<ProfileId>('presupuesto');
  const [aiNarrative, setAiNarrative] = useState<string | null>(null);
  const [aiInsights, setAiInsights] = useState<AiInsights | null>(null);
  const [aiStatus, setAiStatus] = useState<'idle'|'loading'|'ready'|'fallback'>('idle');
  const [aiMeta, setAiMeta] = useState<string | null>(null);
  const [reportVersion, setReportVersion] = useState<ReportVersion>('base');

  const report = useRpc<StrategicPayload>('obs_uaf_strategic_report_payload', { p_from_year: fromYear, p_to_year: toYear, p_novelty_days: noveltyDays });
  const profile = PROFILES.find(x => x.id === profileId) ?? PROFILES[0];
  const s = useMemo(() => report.data ? structural(report.data.base) : null, [report.data]);

  useEffect(() => { setAiNarrative(null); setAiInsights(null); setAiStatus('idle'); setAiMeta(null); setReportVersion('base'); }, [fromYear, toYear, noveltyDays, profileId]);
  useEffect(() => { document.body.classList.add('atlas-report-mode'); return () => document.body.classList.remove('atlas-report-mode'); }, []);

  if (report.loading && !report.data) return <Loading label="Construyendo informe estratégico trazable…" />;
  if (report.error) return <ErrorBox error={report.error} onRetry={report.reload} />;
  if (!report.data || !s) return <ErrorBox error="Atlas no pudo construir el informe estratégico." onRetry={report.reload} />;

  const p = report.data;
  const baseBrief = deterministicBrief(profileId, p, s);
  const useAiVersion = reportVersion === 'ai' && aiStatus === 'ready' && !!aiNarrative;
  const brief = useAiVersion && aiNarrative ? aiNarrative.split(/\n\s*\n/).filter(Boolean) : baseBrief;
  const focusConfig = FOCUS_CONFIG[profileId];
  const questions = p.preguntas_estrategicas;
  const regions = [...p.territorio.regiones].sort((a,b) => a.strategic_rank-b.strategic_rank).slice(0,8);
  const communes = p.territorio.comunas_prioritarias.slice(0,8);
  const components = p.territorio.componentes_cead.slice(0,7);
  const sectorMoves = p.sectores.movimientos.slice(0,10);
  const alerts = p.novedades.alertas_externas.slice(0,5);
  const sanctions = p.novedades.sanciones_recientes.slice(0,6);
  const pressItems = p.novedades.prensa_reciente.filter(x => profileId === 'internacional' ? x.scope === 'INTERNACIONAL' : true).slice(0,7);
  const t8 = top8Share(p.base);
  const qCapacity = questions.find(q => q.id === 'capacity_pressure');
  const qTerritory = questions.find(q => q.id === 'territorial_focus');
  const qNovelty = questions.find(q => q.id === 'external_novelties');
  const qCrime = questions.find(q => q.id === 'organized_crime_proxy');
  const focusPrimary = useAiVersion ? aiInsights?.[focusConfig.primary] : null;
  const focusSecondary = useAiVersion ? aiInsights?.[focusConfig.secondary] : null;
  const focusTertiary = useAiVersion ? aiInsights?.[focusConfig.tertiary] : null;

  const reportingSilence2025 = [...p.sectores.movimientos]
    .filter(x => Number(x.registered_so_2025 ?? 0) > 0 && Number(x.ros_2025 ?? 0) === 0)
    .sort((a,b) => Number(b.registered_so_2025 ?? 0) - Number(a.registered_so_2025 ?? 0));
  const reportingSilence5y = reportingSilence2025.filter(x => x.silence_5y === true);
  const sectorsWithoutRegisteredSo = [...p.sectores.movimientos]
    .filter(x => x.sector_canonical == null)
    .sort((a,b) => a.sector_official.localeCompare(b.sector_official, 'es'));

  const sectorDeltas = p.sectores.movimientos
    .filter(x => x.ros_2024 != null && x.ros_2025 != null)
    .map(x => ({
      sector: x.sector_official,
      ros_2024: Number(x.ros_2024),
      ros_2025: Number(x.ros_2025),
      delta_ros: Number(x.ros_2025) - Number(x.ros_2024),
      delta_pct: x.delta_ros_2025_vs_2024_pct,
      registered_so_2025: x.registered_so_2025,
    }));
  const chartContext = {
    sectors: {
      largest_increases: [...sectorDeltas].filter(x => x.delta_ros > 0).sort((a,b) => b.delta_ros-a.delta_ros).slice(0,5),
      largest_declines: [...sectorDeltas].filter(x => x.delta_ros < 0).sort((a,b) => a.delta_ros-b.delta_ros).slice(0,5),
      highest_ros_2025: [...p.sectores.movimientos].filter(x => x.ros_2025 != null).sort((a,b) => Number(b.ros_2025)-Number(a.ros_2025)).slice(0,5).map(x => ({ sector: x.sector_official, ros_2025: x.ros_2025, registered_so_2025: x.registered_so_2025 })),
      reporting_silence_2025: reportingSilence2025.slice(0,8).map(x => ({ sector: x.sector_official, registered_so_2025: x.registered_so_2025, ros_2025: x.ros_2025, ros_total_2021_2025: x.ros_total_2021_2025, silence_5y: x.silence_5y })),
      persistent_silence_5y: reportingSilence5y.slice(0,8).map(x => ({ sector: x.sector_official, registered_so_2025: x.registered_so_2025, ros_total_2021_2025: x.ros_total_2021_2025 })),
      without_registered_so: sectorsWithoutRegisteredSo.slice(0,12).map(x => ({ sector: x.sector_official, sector_canonical: x.sector_canonical })),
      coverage_summary: { current_silence_count: reportingSilence2025.length, persistent_silence_count: reportingSilence5y.length, without_registered_so_count: sectorsWithoutRegisteredSo.length, registered_total_2025: p.sectores.resumen.registered_total ?? null },
    },
    territory: { leaders: regions.slice(0,5), communes: communes.slice(0,5) },
    crime: { components: components.slice(0,5) },
    capacity: { from: s.from, to: s.to, subject_growth_pct: s.soGrowth, ros_growth_pct: s.rosGrowth, staff_growth_pct: s.staffGrowth, iif_growth_pct: s.iifGrowth, mp_growth_pct: s.mpGrowth, pressure_index: s.pressureIndex, staff_index: s.staffIndex },
    novelties: { external_alert_count: alerts.length, press_summary: p.novedades.prensa_resumen, recent_sanction_count: p.novedades.sanciones_resumen.recent_event_count ?? 0, press_themes: p.novedades.prensa_temas.slice(0,6) },
  };

  const generated = new Date(p.generated_at);
  const validated = {
    contract: p.contract,
    generated_context: { year: generated.getUTCFullYear(), month: generated.getUTCMonth()+1, day: generated.getUTCDate(), novelty_days: p.novedad.dias },
    profile: { id: profile.id, audience: profile.audience, purpose: profile.purpose },
    structural: { from: s.from, to: s.to, subject_growth_pct: s.soGrowth, ros_growth_pct: s.rosGrowth, staff_growth_pct: s.staffGrowth, iif_growth_pct: s.iifGrowth, mp_growth_pct: s.mpGrowth, pressure_index: s.pressureIndex, staff_index: s.staffIndex, top8_ros_share_2025_pct: t8 },
    strategic_questions: questions,
    novelties: { external_alerts: alerts, press_summary: p.novedades.prensa_resumen, press_themes: p.novedades.prensa_temas, recent_sanctions: sanctions },
    territory: { year: p.territorio.year, top_regions: regions, top_communes: communes, cead_components: components, methodology: p.territorio.metodologia },
    sectors: sectorMoves,
    chart_context: chartContext,
    rules: p.reglas,
    constraints: [
      'No recalcular ni introducir cifras nuevas.',
      'No presentar proxies territoriales como prevalencia de lavado o crimen organizado.',
      'No asumir culpabilidad a partir de prensa o sanciones administrativas.',
      'No recomendar votos, asignaciones presupuestarias ni decisiones políticas.',
      'Distinguir hechos, señales, proxies y limitaciones.',
      'Cuando no hay ROS, describir sólo ausencia de reportes observados en el período y fuente analizada.',
      'Cuando una categoría no tiene correspondencia en el padrón, describir sólo cobertura registral observada.',
      'No convertir ausencia de ROS o de inscritos en calificaciones de cumplimiento, irregularidad o deber.'
    ]
  };

  async function requestAiNarrative() {
    setAiStatus('loading'); setAiMeta(null); setAiInsights(null);
    const { data, error } = await supabase.functions.invoke('atlas-report-narrative', { body: { profile: { id: profile.id, audience: profile.audience, purpose: profile.purpose, question: profile.lead }, validated_data: validated } });
    if (error || !data?.narrative) { setAiNarrative(null); setAiInsights(null); setAiStatus('fallback'); setReportVersion('base'); setAiMeta(error?.message ?? data?.reason ?? 'Se mantiene el informe base determinístico.'); return; }
    const insights = data?.insights;
    const validInsights = insights && ['novelties','territory','crime','sectors','capacity'].every(k => typeof insights[k] === 'string');
    setAiNarrative(String(data.narrative));
    setAiInsights(validInsights ? { novelties: String(insights.novelties), territory: String(insights.territory), crime: String(insights.crime), sectors: String(insights.sectors), capacity: String(insights.capacity) } : null);
    setAiStatus(data.ai_used ? 'ready' : 'fallback');
    setReportVersion(data.ai_used ? 'ai' : 'base');
    setAiMeta(data.ai_used ? `Propuesta IA disponible · ${String(data.model ?? 'modelo configurado')}` : String(data.reason ?? 'Se mantiene el informe base determinístico.'));
  }

  function printPdf() {
    const prev = document.title; const version = useAiVersion ? 'IA' : 'Base'; document.title = `ATLAS_Informe_Estrategico_${profile.short}_${fromYear}_${toYear}_${version}`; window.print(); window.setTimeout(() => { document.title = prev; }, 500);
  }

  return <div className="report-view fade-in">
    <aside className="atlas-report-controls">
      <div><span className="report-kicker">ATLAS · INFORMES ESTRATÉGICOS</span><h1>Informe de situación</h1><p>El informe base siempre se conserva. La IA propone una versión focalizada; nunca reemplaza los datos ni cálculos de Atlas.</p></div>
      <label><span>Enfoque</span><select value={profileId} onChange={e => setProfileId(e.target.value as ProfileId)}>{PROFILES.map(x => <option key={x.id} value={x.id}>{x.short}</option>)}</select></label>
      <div className="report-profile-card"><strong>{profile.title}</strong><small>{profile.audience}</small><p>{profile.purpose}</p></div>
      <div className="report-year-grid">
        <label><span>Desde</span><select value={fromYear} onChange={e => setFromYear(Math.min(Number(e.target.value),toYear))}>{YEARS.map(y => <option key={y}>{y}</option>)}</select></label>
        <label><span>Hasta</span><select value={toYear} onChange={e => setToYear(Math.max(Number(e.target.value),fromYear))}>{YEARS.map(y => <option key={y}>{y}</option>)}</select></label>
      </div>
      <label><span>Ventana de novedades</span><select value={noveltyDays} onChange={e => setNoveltyDays(Number(e.target.value))}><option value={7}>7 días</option><option value={30}>30 días</option><option value={60}>60 días</option><option value={90}>90 días</option></select></label>
      <div className="report-safety-box"><strong>Arquitectura</strong><span>SQL / reglas → cifras, rankings, selección de novedades y preguntas.</span><span>IA → propone síntesis y una lectura focal sobre el mismo paquete validado. El informe base permanece disponible.</span></div>
      <div className="report-version-switch" aria-label="Versión del informe">
        <button className={reportVersion==='base'?'is-active':''} onClick={() => setReportVersion('base')}>Informe base</button>
        <button className={reportVersion==='ai'?'is-active':''} onClick={() => setReportVersion('ai')} disabled={aiStatus!=='ready'}>Propuesta IA</button>
      </div>
      <button className="report-btn report-btn-ai" onClick={() => void requestAiNarrative()} disabled={aiStatus==='loading'}>{aiStatus==='loading'?'Generando propuesta…':aiStatus==='ready'?'Regenerar propuesta IA':'Generar propuesta IA'}</button>
      <button className="report-btn report-btn-primary" onClick={printPdf}>Generar PDF · {useAiVersion?'IA':'Base'}</button>
      {aiMeta && <small className="report-ai-meta">{aiMeta}</small>}
    </aside>

    <main className="report-paper-wrap"><article className="report-paper strategic-report">
      <header className="report-cover strategic-cover">
        <div className="report-cover-top"><span>ATLAS OBSERVATORIO</span><span>CORTE DINÁMICO · {p.novedad.hasta}</span></div>
        <div className="report-cover-body"><span className="report-eyebrow">INFORME ESTRATÉGICO · {profile.short}</span><h2>{profile.title}</h2><p>{profile.lead}</p></div>
        <div className="report-badges"><span>DATOS TRAZABLES</span><span>NOVEDADES {p.novedad.dias} DÍAS</span><span>{useAiVersion?'PROPUESTA IA VALIDADA':'INFORME BASE DETERMINÍSTICO'}</span><span>HASH {p.snapshot_hash.slice(0,10)}</span></div>
      </header>

      <section className="report-section sr-executive report-no-break">
        <div className="report-section-heading"><span>01</span><div><h3>Qué debería saber hoy una comisión</h3><p>Lectura priorizada a partir de evidencia estructural y novedades.</p></div></div>
        <div className="sr-hero-grid">
          <div className="sr-hero"><span>Presión observable</span><strong>{qCapacity?.pressure_index==null?'s/d':fmt.format(qCapacity.pressure_index)}</strong><small>base {fromYear}=100 · dotación {qCapacity?.staff_index==null?'s/d':fmt.format(qCapacity.staff_index)}</small></div>
          <div className="sr-hero"><span>Novedades críticas</span><strong>{p.novedades.alertas_externas.length}</strong><small>alertas externas trazadas en {p.novedad.dias} días</small></div>
          <div className="sr-hero"><span>Sanciones recientes</span><strong>{fmt0.format(p.novedades.sanciones_resumen.recent_event_count ?? 0)}</strong><small>eventos vinculados a sujetos UAF</small></div>
          <div className="sr-hero"><span>Regiones priorizadas</span><strong>{qTerritory?.regions?.length ?? p.territorio.regiones.length}</strong><small>en respuesta estratégica · cobertura nacional disponible</small></div>
        </div>
        <div className="report-narrative"><div className="report-narrative-label"><span>{useAiVersion?'Síntesis estratégica · propuesta IA':'Síntesis estratégica base'}</span><small>{useAiVersion?'Versión reversible construida sobre paquete validado, sin cálculo generativo.':'Texto reproducible construido desde reglas y métricas.'}</small></div>{brief.map((x,i)=><p key={i}>{x}</p>)}</div>
      </section>

      <section className="report-section report-page-break">
        {useAiVersion ? <>
          <div className="report-section-heading"><span>02</span><div><h3>Lectura focal · {profile.short}</h3><p>{focusConfig.lead}</p></div></div>
          <div className="sr-focus-shell">
            <div className="sr-focus-head"><span>PROPUESTA IA · REVERSIBLE</span><h4>{focusConfig.title}</h4><p>Atlas selecciona el foco según el propósito del informe; la IA interpreta únicamente señales ya validadas.</p></div>
            <div className="sr-focus-grid">
              <article className="sr-focus-card is-primary"><span>HALLAZGO CENTRAL</span><p>{focusPrimary ?? brief[0]}</p></article>
              <article className="sr-focus-card"><span>QUÉ LO SOSTIENE</span><p>{focusSecondary ?? 'La propuesta IA no agregó una segunda lectura válida; se conserva la evidencia del informe base.'}</p></article>
              <article className="sr-focus-card"><span>QUÉ CONTRASTAR</span><p>{focusTertiary ?? 'La propuesta IA no agregó una tercera lectura válida; revise las preguntas determinísticas del informe base.'}</p></article>
            </div>
            <div className="sr-focus-footer"><strong>Control del usuario</strong><span>Puede volver a “Informe base” en cualquier momento. Los datos, gráficos y cálculos no cambian entre versiones.</span></div>
          </div>
        </> : <>
          <div className="report-section-heading"><span>02</span><div><h3>Preguntas que el informe puede responder</h3><p>Las respuestas cambian cuando cambian los datos, no por criterio del modelo generativo.</p></div></div>
          <div className="sr-question-grid">{questions.map(q => <article className="sr-question" key={q.id}><span>INTERROGANTE</span><h4>{q.question}</h4><p>{answerQuestion(q,s,p)}</p>{q.caveat && <small>{q.caveat}</small>}</article>)}</div>
        </>}
      </section>

      <section className="report-section report-page-break">
        <div className="report-section-heading"><span>03</span><div><h3>Qué cambió recientemente</h3><p>Alertas externas, sanciones y prensa incorporadas en cada generación.</p></div></div>
        <div className="sr-novelty-summary">
          <div><strong>{qNovelty?.external_alert_count ?? 0}</strong><span>alertas externas</span></div><div><strong>{p.novedades.prensa_resumen.article_count ?? 0}</strong><span>notas temáticas</span></div><div><strong>{p.novedades.prensa_resumen.media_count ?? 0}</strong><span>medios</span></div><div><strong>{p.novedades.sanciones_resumen.recent_entity_count ?? 0}</strong><span>entidades sancionadas recientes</span></div>
        </div>
        {useAiVersion && aiInsights?.novelties && <p className="report-ai-insight"><strong>Lectura IA</strong>{aiInsights.novelties}</p>}
        <h4 className="sr-subtitle">Alertas externas prioritarias</h4>
        <div className="sr-alert-list">{alerts.length ? alerts.map(a => <article key={a.alert_id}><div className="sr-alert-head"><span className="sr-severity">{a.severity}</span><strong>{a.entity_name}</strong><em>{a.uaf_sector ?? 'Sector no informado'}</em></div><p>{a.signal_label ?? a.alert_reason}</p><small>{a.latest_source ?? 'Fuente abierta'} · {a.event_at} · urgencia {a.urgency_score}/100</small>{a.latest_url && <a href={a.latest_url} target="_blank" rel="noreferrer">Ver antecedente</a>}</article>) : <p className="report-method-note">Sin alertas externas dentro de la ventana seleccionada.</p>}</div>
        <div className="sr-two-col">
          <div><h4 className="sr-subtitle">Temas en prensa</h4><div className="sr-theme-list">{p.novedades.prensa_temas.slice(0,6).map(t => <div key={t.theme}><span>{t.theme}</span><strong>{fmt0.format(t.article_count)}</strong><Bar value={t.article_count} max={Math.max(...p.novedades.prensa_temas.map(x=>x.article_count),1)} /><small>{t.source_count} medios</small></div>)}</div></div>
          <div><h4 className="sr-subtitle">Últimas noticias seleccionadas por regla</h4><div className="sr-news-list">{pressItems.map(x => <a key={x.article_id} href={x.url} target="_blank" rel="noreferrer"><span>{x.theme} · {x.scope}</span><strong>{x.title.replace(/<!\[CDATA\[|\]\]>/g,'')}</strong><small>{x.media} · {x.article_date}</small></a>)}</div></div>
        </div>
        <h4 className="sr-subtitle">Sanciones recientes vinculadas a sujetos UAF</h4>
        <div className="report-table-wrap"><table className="report-table"><thead><tr><th>Fecha</th><th>Entidad</th><th>Regulador</th><th>Sector</th><th>Región</th></tr></thead><tbody>{sanctions.map(x => <tr key={x.event_id}><td>{x.event_date}</td><td>{x.document_url?<a href={x.document_url} target="_blank" rel="noreferrer">{x.canonical_name}</a>:x.canonical_name}</td><td>{x.regulator}</td><td>{x.uaf_sector ?? '—'}</td><td>{x.region ?? '—'}</td></tr>)}</tbody></table></div>
      </section>

      <section className="report-section report-page-break">
        <div className="report-section-heading"><span>04</span><div><h3>Dónde están pasando cosas</h3><p>Priorización territorial determinística. Promedios regionales simples de comunas.</p></div></div>
        <div className="sr-region-grid">{regions.map(r => <article key={r.region_code}><div className="sr-rank">#{r.strategic_rank}</div><h4>{r.region_name}</h4><div className="sr-region-metric"><span>Delito base</span><strong>{r.avg_predicate_score==null?'—':fmt.format(r.avg_predicate_score)}</strong><Bar value={r.avg_predicate_score}/></div><div className="sr-region-metric"><span>Economía criminal</span><strong>{r.avg_criminal_economy_score==null?'—':fmt.format(r.avg_criminal_economy_score)}</strong><Bar value={r.avg_criminal_economy_score}/></div><small>Máx. IGR {r.max_igr==null?'—':fmt.format(r.max_igr)} · {r.alerted_context} alertas · {r.sanctioned_context} sanciones/contexto</small></article>)}</div>
        {useAiVersion && aiInsights?.territory && <p className="report-ai-insight"><strong>Lectura IA</strong>{aiInsights.territory}</p>}
        <h4 className="sr-subtitle">Comunas prioritarias por IGR</h4>
        <div className="report-table-wrap"><table className="report-table"><thead><tr><th>Comuna</th><th>Región</th><th>IGR</th><th>Delito base</th><th>Economía criminal</th><th>Brecha</th></tr></thead><tbody>{communes.map(c => <tr key={c.commune_code}><td>{c.commune_name}</td><td>{c.region_name}</td><td>{c.igr==null?'—':fmt.format(c.igr)}</td><td>{c.predicate_score==null?'—':fmt.format(c.predicate_score)}</td><td>{c.criminal_economy_score==null?'—':fmt.format(c.criminal_economy_score)}</td><td>{c.gap==null?'—':fmt.format(c.gap)}</td></tr>)}</tbody></table></div>
        <p className="report-method-note">{p.territorio.metodologia}</p>
      </section>

      <section className="report-section report-page-break">
        <div className="report-section-heading"><span>05</span><div><h3>Cómo leer la dinámica asociada a crimen organizado</h3><p>Atlas no estima organizaciones criminales: construye proxies territoriales de delitos base y economías criminales.</p></div></div>
        <div className="sr-crime-intro"><strong>{qCrime?.answer === 'PROXY_ONLY' ? 'PROXY, NO PREVALENCIA' : 'LECTURA TERRITORIAL'}</strong><p>{answerQuestion(qCrime ?? {id:'organized_crime_proxy',question:'',answer:'PROXY_ONLY'},s,p)}</p></div>
        <div className="sr-component-grid">{components.map(c => <article key={c.component_id}><span>{c.component_label}</span><strong>{c.avg_score==null?'—':fmt.format(c.avg_score)}</strong><Bar value={c.avg_score}/><small>Tendencia media {c.avg_trend==null?'—':fmt.format(c.avg_trend)} · {c.commune_count} comunas · {c.max_years_observed ?? '—'} años observados</small></article>)}</div>
        {useAiVersion && aiInsights?.crime && <p className="report-ai-insight"><strong>Lectura IA</strong>{aiInsights.crime}</p>}
        <p className="report-method-note">Estos indicadores permiten formular preguntas —por ejemplo, dónde coinciden delitos asociados a drogas, receptación, robos de vehículos u homicidios con señales económicas—, pero no deben utilizarse para afirmar que una comuna “tiene más crimen organizado”.</p>
      </section>

      <section className="report-section report-page-break">
        <div className="report-section-heading"><span>06</span><div><h3>Cobertura y dinámica de los sectores obligados</h3><p>Reportabilidad, silencios observados y categorías sin sujetos inscritos en el corte disponible.</p></div></div>
        <div className="sr-sector-kpis"><div><strong>{t8==null?'s/d':`${fmt.format(t8)}%`}</strong><span>ROS 2025 concentrados en top 8 sectores</span></div><div><strong>{reportingSilence2025.length}</strong><span>sectores con inscritos y 0 ROS en 2025</span></div><div><strong>{reportingSilence5y.length}</strong><span>silencios persistentes 2021–2025</span></div><div><strong>{sectorsWithoutRegisteredSo.length}</strong><span>categorías sin SO inscritos observados</span></div></div>
        <h4 className="sr-subtitle">Movimientos de reportabilidad</h4>
        <div className="report-table-wrap"><table className="report-table"><thead><tr><th>Sector</th><th>SO 2025</th><th>ROS 2024</th><th>ROS 2025</th><th>Var.</th><th>ROS/100 SO</th><th>Indicios 2025</th></tr></thead><tbody>{sectorMoves.map(x => <tr key={x.sector_official}><td>{x.sector_official}</td><td>{x.registered_so_2025==null?'—':fmt0.format(x.registered_so_2025)}</td><td>{x.ros_2024==null?'—':fmt0.format(x.ros_2024)}</td><td>{x.ros_2025==null?'—':fmt0.format(x.ros_2025)}</td><td>{x.delta_ros_2025_vs_2024_pct==null?'—':signed(x.delta_ros_2025_vs_2024_pct)}</td><td>{x.ros_per_100_so_2025==null?'—':fmt.format(x.ros_per_100_so_2025)}</td><td>{x.indicios_2025==null?'—':fmt0.format(x.indicios_2025)}</td></tr>)}</tbody></table></div>
        <div className="sr-two-col">
          <div><h4 className="sr-subtitle">Silencios de reportabilidad observados</h4><div className="report-table-wrap"><table className="report-table"><thead><tr><th>Sector</th><th>SO 2025</th><th>ROS 2025</th><th>Lectura</th></tr></thead><tbody>{reportingSilence2025.slice(0,8).map(x => <tr key={`silence-${x.sector_official}`}><td>{x.sector_official}</td><td>{fmt0.format(Number(x.registered_so_2025 ?? 0))}</td><td>{fmt0.format(Number(x.ros_2025 ?? 0))}</td><td>{x.silence_5y ? '0 ROS 2021–2025' : '0 ROS en 2025'}</td></tr>)}{!reportingSilence2025.length && <tr><td colSpan={4}>Sin silencios sectoriales observados en 2025.</td></tr>}</tbody></table></div></div>
          <div><h4 className="sr-subtitle">Categorías sin SO inscritos observados</h4><div className="report-table-wrap"><table className="report-table"><thead><tr><th>Categoría oficial</th><th>Cobertura registral</th></tr></thead><tbody>{sectorsWithoutRegisteredSo.slice(0,8).map(x => <tr key={`coverage-${x.sector_official}`}><td>{x.sector_official}</td><td>Sin correspondencia en padrón vigente</td></tr>)}{!sectorsWithoutRegisteredSo.length && <tr><td colSpan={2}>Todas las categorías del contrato tienen correspondencia registral en el corte.</td></tr>}</tbody></table></div></div>
        </div>
        {useAiVersion && aiInsights?.sectors && <p className="report-ai-insight"><strong>Lectura IA</strong>{aiInsights.sectors}</p>}
        <p className="report-method-note">Silencio 2025 = sector con sujetos inscritos y 0 ROS agregados observados en 2025. Silencio persistente = 0 ROS agregados entre 2021 y 2025. “Sin SO inscritos observados” identifica categorías oficiales sin correspondencia en el padrón vigente del corte. Estas señales describen cobertura y reportabilidad agregada; no califican la conducta de entidades individuales ni permiten inferir por sí solas una exigencia de inscripción o reporte.</p>
      </section>

      <section className="report-section report-page-break">
        <div className="report-section-heading"><span>07</span><div><h3>Presión del sistema y capacidad observable</h3><p>Comparación estructural, especialmente relevante para el enfoque presupuestario.</p></div></div>
        <div className="sr-index-grid"><IndexCard label="Presión observable" value={s.pressureIndex} note="media geométrica de padrón, ROS y actividades obligadas"/><IndexCard label="Dotación efectiva" value={s.staffIndex} note="índice de dotación total institucional"/><IndexCard label="IIF" value={s.iifIndex} note="índice de informes y complementos"/></div>
        <div className="sr-struct-grid"><div><span>Sujetos obligados</span><strong>{fmt0.format(s.so0 ?? 0)} → {fmt0.format(s.so1 ?? 0)}</strong><small>{signed(s.soGrowth)}</small></div><div><span>ROS</span><strong>{fmt0.format(s.ros0 ?? 0)} → {fmt0.format(s.ros1 ?? 0)}</strong><small>{signed(s.rosGrowth)}</small></div><div><span>Dotación</span><strong>{fmt0.format(s.staff0 ?? 0)} → {fmt0.format(s.staff1 ?? 0)}</strong><small>{signed(s.staffGrowth)}</small></div><div><span>IIF</span><strong>{fmt0.format(s.iif0 ?? 0)} → {fmt0.format(s.iif1 ?? 0)}</strong><small>{signed(s.iifGrowth)}</small></div><div><span>Req. Ministerio Público</span><strong>{fmt0.format(s.mp0 ?? 0)} → {fmt0.format(s.mp1 ?? 0)}</strong><small>{signed(s.mpGrowth)}</small></div></div>
        {useAiVersion && aiInsights?.capacity && <p className="report-ai-insight"><strong>Lectura IA</strong>{aiInsights.capacity}</p>}
        <p className="report-method-note">La comparación no define productividad ni dotación óptima. La dotación corresponde al total institucional y los IIF pueden consolidar múltiples ROS y otros antecedentes.</p>
      </section>

      <section className="report-section report-page-break report-sources">
        <div className="report-section-heading"><span>08</span><div><h3>Trazabilidad, reglas y límites</h3><p>El informe debe poder defenderse cifra por cifra.</p></div></div>
        <div className="report-method-grid"><div><strong>Datos</strong><p>{p.reglas.datos}</p></div><div><strong>Prensa</strong><p>{p.reglas.prensa}</p></div><div><strong>IA</strong><p>{p.reglas.ia}</p></div></div>
        <div className="sr-audit"><div><span>Contrato</span><strong>{p.contract}</strong></div><div><span>Generado</span><strong>{p.generated_at}</strong></div><div><span>Hash</span><strong>{p.snapshot_hash}</strong></div><div><span>Ventana de novedad</span><strong>{p.novedad.desde} → {p.novedad.hasta}</strong></div></div>
        <div className="report-footer-note"><strong>Principio de uso</strong><p>Atlas distingue hechos, señales, proxies y conclusiones. Las novedades sirven para elevar preguntas y contextualizar cifras; no acreditan ilícitos. Los informes para autoridades describen evidencia e implicancias posibles sin recomendar decisiones políticas, votos o asignaciones presupuestarias.</p></div>
      </section>
    </article></main>
  </div>;
}
