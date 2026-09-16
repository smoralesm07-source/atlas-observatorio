import { useEffect, useMemo, useState } from 'react';
import { ErrorBox, Loading } from '../components/primitives';
import { useRpc } from '../lib/rpc';
import { supabase } from '../lib/supabase';
import '../styles/reportes.css';

type ReportPoint = {
  periodo: string;
  valor: number | null;
  metodo_captura: string | null;
  fuente: string | null;
  corte: string | null;
};

type ReportSeries = {
  unidad: string | null;
  categoria: string | null;
  puntos: ReportPoint[];
};

type ReportSector = {
  sector: string;
  sector_canonico: string | null;
  inscritos_2025: number | null;
  ros_2025: number | null;
  ros_2021_2025: number | null;
  ros_por_100_so_2025: number | null;
  variacion_ros_2025_2024_pct: number | null;
  silencio_5y: boolean | null;
  indicios_2021_2025: number | null;
  fuente: string | null;
  corte: string | null;
};

type ReportPayload = {
  contract: 'ATLAS_OBS_UAF_REPORT_V1';
  periodo: { desde: number; hasta: number };
  series: Record<string, ReportSeries>;
  sectores: ReportSector[];
  metodologia: {
    calculo: string;
    nivel_reportabilidad: string;
    comparabilidad: string;
  };
};

type ProfileId = 'presupuesto' | 'crimen' | 'supervision' | 'ejecutivo' | 'internacional';

type ReportProfile = {
  id: ProfileId;
  short: string;
  title: string;
  audience: string;
  purpose: string;
  question: string;
  emphasis: string[];
};

type Derived = {
  from: number;
  to: number;
  soStart: number | null;
  soEnd: number | null;
  soGrowth: number | null;
  rosStart: number | null;
  rosEnd: number | null;
  rosGrowth: number | null;
  staffStart: number | null;
  staffEnd: number | null;
  staffGrowth: number | null;
  iifStart: number | null;
  iifEnd: number | null;
  iifGrowth: number | null;
  activitiesStart: number | null;
  activitiesEnd: number | null;
  pressureIndex: number | null;
  staffIndex: number | null;
  iifIndex: number | null;
  rosPerStaffEnd: number | null;
  indicationsPerIifEnd: number | null;
  mpStart: number | null;
  mpEnd: number | null;
  mpGrowth: number | null;
  intlStart: number | null;
  intlEnd: number | null;
  intlGrowth: number | null;
  top8Share: number | null;
  silentSectors: number;
  indexedRows: Record<string, number | string | null>[];
  demandRows: Record<string, number | string | null>[];
};

const PROFILES: ReportProfile[] = [
  {
    id: 'presupuesto',
    short: 'Presupuesto',
    title: 'Capacidad institucional frente a la presión del sistema ALA/CFT',
    audience: 'Comisión legislativa de presupuesto / discusión de recursos institucionales',
    purpose: 'Contrastar la evolución de la demanda observable con la capacidad institucional disponible, sin recomendar una asignación presupuestaria específica.',
    question: '¿Cómo ha cambiado la presión que absorbe la UAF respecto de su capacidad instalada observable?',
    emphasis: ['Padrón y actividades obligadas', 'ROS e inteligencia financiera', 'Dotación efectiva', 'Demanda del Ministerio Público', 'Cooperación internacional'],
  },
  {
    id: 'crimen',
    short: 'Crimen organizado',
    title: 'Demanda de inteligencia financiera y articulación con la persecución penal',
    audience: 'Comisión o instancia de análisis sobre crimen organizado',
    purpose: 'Mostrar el flujo de información sospechosa, la detección de indicios y la interacción con el Ministerio Público. No mide por sí mismo prevalencia de crimen organizado.',
    question: '¿Qué volumen de información financiera es procesado y qué parte alimenta productos de inteligencia y requerimientos investigativos?',
    emphasis: ['ROS recibidos', 'ROS con indicios', 'IIF', 'Requerimientos del Ministerio Público', 'Personas comprendidas en requerimientos'],
  },
  {
    id: 'supervision',
    short: 'Supervisión',
    title: 'Cobertura del universo obligado y comportamiento de reportabilidad',
    audience: 'Instancias de supervisión, regulación y gestión del padrón',
    purpose: 'Caracterizar expansión del universo obligado, intensidad de reportabilidad, concentración sectorial y sectores que requieren seguimiento.',
    question: '¿Cómo crece el perímetro supervisado y dónde se concentra o debilita la reportabilidad?',
    emphasis: ['Sujetos obligados', 'Actividades económicas', 'ROS por sector', 'Concentración de reportabilidad', 'Sectores sin ROS'],
  },
  {
    id: 'ejecutivo',
    short: 'Ejecutivo',
    title: 'Síntesis ejecutiva del sistema de información financiera',
    audience: 'Dirección y comités de gestión',
    purpose: 'Entregar una lectura compacta de entradas, productos de inteligencia, cooperación y cobertura para apoyar priorización institucional.',
    question: '¿Qué cambió materialmente en el sistema y qué variables requieren atención de gestión?',
    emphasis: ['Crecimiento del padrón', 'Volumen de ROS', 'Productos de inteligencia', 'Cooperación', 'Concentración sectorial'],
  },
  {
    id: 'internacional',
    short: 'Internacional',
    title: 'Cooperación internacional e intercambio de inteligencia financiera',
    audience: 'Instancias de cooperación ALA/CFT y asuntos internacionales',
    purpose: 'Mostrar la dimensión transfronteriza de la demanda de información mediante intercambios con UIF extranjeras y su relación con la carga nacional.',
    question: '¿Qué presión adicional representa la cooperación internacional y cómo evoluciona junto con la demanda doméstica?',
    emphasis: ['Consultas recibidas de UIF', 'Solicitudes enviadas', 'ROS nacionales', 'Requerimientos del Ministerio Público', 'Trazabilidad de fuentes'],
  },
];

const PROFILE_METRICS: Record<ProfileId, string[]> = {
  presupuesto: [
    'entidades_reportantes_total', 'actividades_economicas_obligadas', 'ros_recibidos',
    'ros_con_indicios_laft', 'informes_inteligencia_financiera', 'dotacion_efectiva_total',
    'requerimientos_ministerio_publico', 'consultas_uif_extranjeras_recibidas',
    'solicitudes_uif_extranjeras_enviadas',
  ],
  crimen: [
    'ros_recibidos', 'ros_con_indicios_laft', 'informes_inteligencia_financiera',
    'requerimientos_ministerio_publico', 'personas_en_requerimientos_mp',
  ],
  supervision: ['entidades_reportantes_total', 'actividades_economicas_obligadas', 'ros_recibidos', 'acciones_supervision'],
  ejecutivo: [
    'entidades_reportantes_total', 'ros_recibidos', 'ros_con_indicios_laft',
    'informes_inteligencia_financiera', 'requerimientos_ministerio_publico',
    'consultas_uif_extranjeras_recibidas',
  ],
  internacional: [
    'consultas_uif_extranjeras_recibidas', 'solicitudes_uif_extranjeras_enviadas',
    'ros_recibidos', 'requerimientos_ministerio_publico',
  ],
};

const YEARS = [2020, 2021, 2022, 2023, 2024, 2025];
const fmt = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 1 });
const fmt0 = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 });

function pct(a: number | null, b: number | null): number | null {
  if (a == null || b == null || a === 0) return null;
  return ((b / a) - 1) * 100;
}

function ratio(n: number | null, d: number | null): number | null {
  if (n == null || d == null || d === 0) return null;
  return n / d;
}

function index(start: number | null, end: number | null): number | null {
  if (start == null || end == null || start === 0) return null;
  return end / start * 100;
}

function geometricMean(values: number[]): number | null {
  if (values.length === 0 || values.some((v) => !Number.isFinite(v) || v <= 0)) return null;
  return Math.exp(values.reduce((sum, v) => sum + Math.log(v), 0) / values.length);
}

function round1(value: number | null): number | null {
  return value == null ? null : Math.round(value * 10) / 10;
}

function signedPct(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return 's/d';
  return `${value >= 0 ? '+' : ''}${fmt.format(value)}%`;
}

function seriesValue(payload: ReportPayload, metric: string, year: number): number | null {
  const point = payload.series[metric]?.puntos.find((item) => item.periodo === String(year));
  return point?.valor == null ? null : Number(point.valor);
}

function derive(payload: ReportPayload): Derived {
  const { desde: from, hasta: to } = payload.periodo;
  const first = (metric: string) => seriesValue(payload, metric, from);
  const last = (metric: string) => seriesValue(payload, metric, to);
  const soStart = first('entidades_reportantes_total');
  const soEnd = last('entidades_reportantes_total');
  const rosStart = first('ros_recibidos');
  const rosEnd = last('ros_recibidos');
  const staffStart = first('dotacion_efectiva_total');
  const staffEnd = last('dotacion_efectiva_total');
  const iifStart = first('informes_inteligencia_financiera');
  const iifEnd = last('informes_inteligencia_financiera');
  const activitiesStart = first('actividades_economicas_obligadas');
  const activitiesEnd = last('actividades_economicas_obligadas');
  const mpStart = first('requerimientos_ministerio_publico');
  const mpEnd = last('requerimientos_ministerio_publico');
  const receivedStart = first('consultas_uif_extranjeras_recibidas');
  const receivedEnd = last('consultas_uif_extranjeras_recibidas');
  const sentStart = first('solicitudes_uif_extranjeras_enviadas');
  const sentEnd = last('solicitudes_uif_extranjeras_enviadas');
  const intlStart = receivedStart != null && sentStart != null ? receivedStart + sentStart : null;
  const intlEnd = receivedEnd != null && sentEnd != null ? receivedEnd + sentEnd : null;
  const pressureParts = [index(soStart, soEnd), index(rosStart, rosEnd), index(activitiesStart, activitiesEnd)];
  const pressureIndex = pressureParts.every((value) => value != null)
    ? geometricMean(pressureParts as number[])
    : null;
  const years = Array.from({ length: to - from + 1 }, (_, i) => from + i);
  const indexedRows = years.map((year) => {
    const localIndex = (metric: string) => index(seriesValue(payload, metric, from), seriesValue(payload, metric, year));
    const pressure = [
      localIndex('entidades_reportantes_total'),
      localIndex('ros_recibidos'),
      localIndex('actividades_economicas_obligadas'),
    ];
    return {
      year: String(year),
      pressure: pressure.every((value) => value != null) ? geometricMean(pressure as number[]) : null,
      staff: localIndex('dotacion_efectiva_total'),
      iif: localIndex('informes_inteligencia_financiera'),
    };
  });
  const demandRows = years.map((year) => {
    const received = seriesValue(payload, 'consultas_uif_extranjeras_recibidas', year);
    const sent = seriesValue(payload, 'solicitudes_uif_extranjeras_enviadas', year);
    return {
      year: String(year),
      mp: seriesValue(payload, 'requerimientos_ministerio_publico', year),
      intl: received != null && sent != null ? received + sent : null,
    };
  });
  const ros2025 = seriesValue(payload, 'ros_recibidos', 2025);
  const top8Ros = [...payload.sectores]
    .filter((sector) => sector.ros_2025 != null)
    .sort((a, b) => Number(b.ros_2025 ?? 0) - Number(a.ros_2025 ?? 0))
    .slice(0, 8)
    .reduce((sum, sector) => sum + Number(sector.ros_2025 ?? 0), 0);

  return {
    from,
    to,
    soStart,
    soEnd,
    soGrowth: pct(soStart, soEnd),
    rosStart,
    rosEnd,
    rosGrowth: pct(rosStart, rosEnd),
    staffStart,
    staffEnd,
    staffGrowth: pct(staffStart, staffEnd),
    iifStart,
    iifEnd,
    iifGrowth: pct(iifStart, iifEnd),
    activitiesStart,
    activitiesEnd,
    pressureIndex,
    staffIndex: index(staffStart, staffEnd),
    iifIndex: index(iifStart, iifEnd),
    rosPerStaffEnd: ratio(rosEnd, staffEnd),
    indicationsPerIifEnd: ratio(first('ros_con_indicios_laft') === null ? null : last('ros_con_indicios_laft'), iifEnd),
    mpStart,
    mpEnd,
    mpGrowth: pct(mpStart, mpEnd),
    intlStart,
    intlEnd,
    intlGrowth: pct(intlStart, intlEnd),
    top8Share: ros2025 && ros2025 !== 0 ? top8Ros / ros2025 * 100 : null,
    silentSectors: payload.sectores.filter((sector) => sector.silencio_5y === true).length,
    indexedRows,
    demandRows,
  };
}

function baseNarrative(profile: ProfileId, d: Derived): string[] {
  if (profile === 'presupuesto') {
    return [
      `Entre ${d.from} y ${d.to}, el universo reportante varió ${signedPct(d.soGrowth)}, mientras los ROS recibidos aumentaron ${signedPct(d.rosGrowth)}. En el mismo periodo, la dotación efectiva total varió ${signedPct(d.staffGrowth)}.`,
      `El índice experimental de presión observable alcanza ${d.pressureIndex == null ? 's/d' : fmt.format(d.pressureIndex)} puntos, con base ${d.from}=100. La dotación llega a ${d.staffIndex == null ? 's/d' : fmt.format(d.staffIndex)} y la salida en IIF a ${d.iifIndex == null ? 's/d' : fmt.format(d.iifIndex)}. El contraste muestra ritmos relativos y no define productividad ni una dotación óptima.`,
      `Los requerimientos del Ministerio Público variaron ${signedPct(d.mpGrowth)} y los intercambios con UIF extranjeras ${signedPct(d.intlGrowth)}. Estas demandas coexisten con funciones de supervisión, regulación, capacitación y coordinación que también utilizan capacidad institucional.`,
    ];
  }
  if (profile === 'crimen') {
    return [
      `Los ROS recibidos variaron ${signedPct(d.rosGrowth)} entre ${d.from} y ${d.to}. Los ROS con indicios y los IIF no siguen necesariamente la misma trayectoria porque un IIF puede integrar múltiples ROS y antecedentes adicionales.`,
      `Los requerimientos del Ministerio Público pasaron de ${fmt0.format(d.mpStart ?? 0)} a ${fmt0.format(d.mpEnd ?? 0)} (${signedPct(d.mpGrowth)}), mostrando una vía adicional de demanda analítica distinta de la generación de IIF.`,
      'Estas cifras describen carga y articulación de inteligencia financiera. No permiten inferir por sí solas la prevalencia, incidencia ni evolución del crimen organizado en Chile.',
    ];
  }
  if (profile === 'supervision') {
    return [
      `El registro reportante pasó de ${fmt0.format(d.soStart ?? 0)} a ${fmt0.format(d.soEnd ?? 0)} entidades (${signedPct(d.soGrowth)}) y las actividades económicas obligadas pasaron de ${fmt0.format(d.activitiesStart ?? 0)} a ${fmt0.format(d.activitiesEnd ?? 0)}.`,
      `En 2025, los ocho sectores con mayor volumen concentran ${d.top8Share == null ? 's/d' : `${fmt.format(d.top8Share)}%`} de los ROS del año. La concentración dimensiona dependencia de pocos sectores, pero no califica la calidad de los reportes.`,
      `Atlas identifica ${d.silentSectors} categorías con inscritos y sin ROS en el quinquenio sectorial disponible. El silencio sectorial no prueba incumplimiento: el ROS se presenta ante una operación sospechosa y no tiene periodicidad mínima.`,
    ];
  }
  if (profile === 'internacional') {
    return [
      `Los intercambios con UIF extranjeras pasaron de ${fmt0.format(d.intlStart ?? 0)} en ${d.from} a ${fmt0.format(d.intlEnd ?? 0)} en ${d.to} (${signedPct(d.intlGrowth)}), considerando consultas recibidas y solicitudes enviadas.`,
      `Esta demanda se superpone con la carga doméstica: los requerimientos del Ministerio Público variaron ${signedPct(d.mpGrowth)} y los ROS recibidos ${signedPct(d.rosGrowth)} en el mismo periodo.`,
      'El volumen de intercambios internacionales mide cooperación y demanda de información; no constituye por sí solo un indicador de riesgo país ni de criminalidad transnacional.',
    ];
  }
  return [
    `Entre ${d.from} y ${d.to}, el padrón varió ${signedPct(d.soGrowth)}, los ROS ${signedPct(d.rosGrowth)} y los IIF ${signedPct(d.iifGrowth)}.`,
    `La presión no se limita a los ROS: los requerimientos del Ministerio Público variaron ${signedPct(d.mpGrowth)} y los intercambios con UIF extranjeras ${signedPct(d.intlGrowth)}.`,
    'La lectura conjunta separa expansión del universo, demanda de análisis y productos de inteligencia, manteniendo las cautelas de comparabilidad y trazabilidad.',
  ];
}

function validatedData(profile: ProfileId, payload: ReportPayload, d: Derived) {
  return {
    contract: payload.contract,
    profile,
    period: payload.periodo,
    methodology: payload.metodologia,
    source_series: Object.fromEntries(PROFILE_METRICS[profile].map((metric) => [metric, payload.series[metric] ?? null])),
    deterministic_derivatives: {
      subject_growth_pct: round1(d.soGrowth),
      ros_growth_pct: round1(d.rosGrowth),
      staff_growth_pct: round1(d.staffGrowth),
      iif_growth_pct: round1(d.iifGrowth),
      pressure_index_base_from_100: round1(d.pressureIndex),
      staff_index_base_from_100: round1(d.staffIndex),
      iif_index_base_from_100: round1(d.iifIndex),
      ros_per_total_staff_to: round1(d.rosPerStaffEnd),
      indications_per_iif_to: round1(d.indicationsPerIifEnd),
      mp_requirements_growth_pct: round1(d.mpGrowth),
      international_exchanges_growth_pct: round1(d.intlGrowth),
      top8_ros_share_2025_pct: round1(d.top8Share),
      silent_sectors_5y: d.silentSectors,
    },
    constraints: [
      'Do not calculate or replace any figure.',
      'Do not introduce figures that are not present in this object.',
      'Do not treat total institutional staffing as staffing of the Financial Intelligence Division.',
      'Do not interpret IIF count as direct productivity because one IIF may consolidate multiple ROS.',
      'Do not infer crime prevalence from ROS volumes.',
      'For budget audiences, describe capacity pressure without recommending a vote, allocation or political decision.',
    ],
  };
}

function LineChart({
  rows,
  series,
  title,
  subtitle,
}: {
  rows: Record<string, number | string | null>[];
  series: { key: string; label: string; tone: string }[];
  title: string;
  subtitle: string;
}) {
  const width = 760;
  const height = 250;
  const pad = { left: 48, right: 18, top: 34, bottom: 38 };
  const values = series
    .flatMap((item) => rows.map((row) => typeof row[item.key] === 'number' ? Number(row[item.key]) : NaN))
    .filter(Number.isFinite);
  const max = Math.max(1, ...values);
  const min = Math.min(0, ...values);
  const span = Math.max(1, max - min);
  const x = (i: number) => pad.left + (rows.length <= 1 ? 0 : i * (width - pad.left - pad.right) / (rows.length - 1));
  const y = (value: number) => pad.top + (max - value) * (height - pad.top - pad.bottom) / span;

  return (
    <figure className="report-chart">
      <figcaption><strong>{title}</strong><span>{subtitle}</span></figcaption>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
        {[0, 0.25, 0.5, 0.75, 1].map((portion) => {
          const yy = pad.top + portion * (height - pad.top - pad.bottom);
          const tick = max - portion * span;
          return (
            <g key={portion}>
              <line x1={pad.left} y1={yy} x2={width - pad.right} y2={yy} className="report-grid" />
              <text x={pad.left - 8} y={yy + 4} textAnchor="end" className="report-axis-label">{fmt.format(tick)}</text>
            </g>
          );
        })}
        {rows.map((row, i) => (
          <text key={String(row.year)} x={x(i)} y={height - 12} textAnchor="middle" className="report-axis-label">{String(row.year)}</text>
        ))}
        {series.map((item) => {
          const points = rows.map((row, i) => {
            const value = row[item.key];
            return typeof value === 'number' ? `${x(i)},${y(value)}` : null;
          }).filter(Boolean).join(' ');
          return (
            <g key={item.key} className={`report-series ${item.tone}`}>
              <polyline points={points} fill="none" vectorEffect="non-scaling-stroke" />
              {rows.map((row, i) => {
                const value = row[item.key];
                return typeof value === 'number' ? <circle key={i} cx={x(i)} cy={y(value)} r="3.4" /> : null;
              })}
            </g>
          );
        })}
      </svg>
      <div className="report-legend">
        {series.map((item) => <span key={item.key}><i className={item.tone} />{item.label}</span>)}
      </div>
    </figure>
  );
}

export function Reportes() {
  const [fromYear, setFromYear] = useState(2020);
  const [toYear, setToYear] = useState(2025);
  const [profileId, setProfileId] = useState<ProfileId>('presupuesto');
  const [aiNarrative, setAiNarrative] = useState<string | null>(null);
  const [aiStatus, setAiStatus] = useState<'idle' | 'loading' | 'ready' | 'fallback'>('idle');
  const [aiMeta, setAiMeta] = useState<string | null>(null);
  const report = useRpc<ReportPayload>('obs_uaf_report_payload', { p_from_year: fromYear, p_to_year: toYear });
  const profile = PROFILES.find((item) => item.id === profileId) ?? PROFILES[0];
  const d = useMemo(() => report.data ? derive(report.data) : null, [report.data]);
  const deterministicNarrative = useMemo(() => d ? baseNarrative(profileId, d) : [], [profileId, d]);

  useEffect(() => {
    setAiNarrative(null);
    setAiStatus('idle');
    setAiMeta(null);
  }, [profileId, fromYear, toYear]);

  useEffect(() => {
    document.body.classList.add('atlas-report-mode');
    return () => document.body.classList.remove('atlas-report-mode');
  }, []);

  if (report.loading && !report.data) return <Loading label="Preparando series trazadas para informes…" />;
  if (report.error) return <ErrorBox error={report.error} onRetry={report.reload} />;
  if (!report.data || !d) return <ErrorBox error="Atlas no pudo construir el contrato de informe." onRetry={report.reload} />;

  const narrative = aiNarrative ? aiNarrative.split(/\n\s*\n/).filter(Boolean) : deterministicNarrative;
  const topSectors = [...report.data.sectores]
    .filter((sector) => sector.ros_2025 != null)
    .sort((a, b) => Number(b.ros_2025 ?? 0) - Number(a.ros_2025 ?? 0))
    .slice(0, profileId === 'supervision' ? 10 : 6);
  const sourceMap = new Map<string, ReportPoint>();
  for (const metric of PROFILE_METRICS[profileId]) {
    for (const point of report.data.series[metric]?.puntos ?? []) {
      if (point.fuente) sourceMap.set(point.fuente, point);
    }
  }
  const uniqueSources = Array.from(sourceMap.values());
  const indicationsTo = seriesValue(report.data, 'ros_con_indicios_laft', toYear);
  const receivedTo = seriesValue(report.data, 'consultas_uif_extranjeras_recibidas', toYear);
  const sentTo = seriesValue(report.data, 'solicitudes_uif_extranjeras_enviadas', toYear);

  const kpis: [string, string, string][] = profileId === 'presupuesto'
    ? [
        ['Universo reportante', `${fmt0.format(d.soStart ?? 0)} → ${fmt0.format(d.soEnd ?? 0)}`, signedPct(d.soGrowth)],
        ['ROS recibidos', `${fmt0.format(d.rosStart ?? 0)} → ${fmt0.format(d.rosEnd ?? 0)}`, signedPct(d.rosGrowth)],
        ['Dotación efectiva', `${fmt0.format(d.staffStart ?? 0)} → ${fmt0.format(d.staffEnd ?? 0)}`, signedPct(d.staffGrowth)],
        ['IIF y complementos', `${fmt0.format(d.iifStart ?? 0)} → ${fmt0.format(d.iifEnd ?? 0)}`, signedPct(d.iifGrowth)],
      ]
    : profileId === 'crimen'
      ? [
          ['ROS recibidos', fmt0.format(d.rosEnd ?? 0), signedPct(d.rosGrowth)],
          ['ROS con indicios', fmt0.format(indicationsTo ?? 0), 'flujo con indicios'],
          ['IIF y complementos', fmt0.format(d.iifEnd ?? 0), signedPct(d.iifGrowth)],
          ['Requerimientos MP', fmt0.format(d.mpEnd ?? 0), signedPct(d.mpGrowth)],
        ]
      : profileId === 'internacional'
        ? [
            ['Intercambios UIF', fmt0.format(d.intlEnd ?? 0), signedPct(d.intlGrowth)],
            ['Consultas recibidas', fmt0.format(receivedTo ?? 0), 'Red Egmont'],
            ['Solicitudes enviadas', fmt0.format(sentTo ?? 0), 'Red Egmont'],
            ['Requerimientos MP', fmt0.format(d.mpEnd ?? 0), signedPct(d.mpGrowth)],
          ]
        : [
            ['Universo reportante', fmt0.format(d.soEnd ?? 0), signedPct(d.soGrowth)],
            ['Actividades obligadas', fmt0.format(d.activitiesEnd ?? 0), `${fmt0.format(d.activitiesStart ?? 0)} en ${fromYear}`],
            ['ROS recibidos', fmt0.format(d.rosEnd ?? 0), signedPct(d.rosGrowth)],
            ['Top 8 sectores', d.top8Share == null ? 's/d' : `${fmt.format(d.top8Share)}%`, 'de ROS 2025'],
          ];

  async function requestAiNarrative() {
    setAiStatus('loading');
    setAiMeta(null);
    const { data, error } = await supabase.functions.invoke('atlas-report-narrative', {
      body: {
        profile: { id: profile.id, audience: profile.audience, purpose: profile.purpose, question: profile.question },
        validated_data: validatedData(profile.id, report.data as ReportPayload, d),
      },
    });
    if (error || !data?.narrative) {
      setAiNarrative(null);
      setAiStatus('fallback');
      setAiMeta(error?.message ?? data?.reason ?? 'Síntesis IA no disponible; se conserva la lectura determinística.');
      return;
    }
    setAiNarrative(String(data.narrative));
    setAiStatus(data.ai_used ? 'ready' : 'fallback');
    setAiMeta(data.ai_used ? `Síntesis interpretativa · ${String(data.model ?? 'modelo configurado')}` : String(data.reason ?? 'Se conserva síntesis determinística.'));
  }

  function printPdf() {
    const previousTitle = document.title;
    document.title = `ATLAS_${profile.short.replace(/\s+/g, '_')}_${fromYear}_${toYear}`;
    window.print();
    window.setTimeout(() => { document.title = previousTitle; }, 500);
  }

  return (
    <div className="report-view fade-in">
      <aside className="atlas-report-controls" aria-label="Configuración del informe">
        <div>
          <span className="report-kicker">ATLAS · motor de informes</span>
          <h1>Generar informe</h1>
          <p>Los números se calculan desde datos trazados. La IA sólo puede redactar la síntesis sobre el paquete validado.</p>
        </div>
        <label>
          <span>Enfoque</span>
          <select value={profileId} onChange={(event) => setProfileId(event.target.value as ProfileId)}>
            {PROFILES.map((item) => <option key={item.id} value={item.id}>{item.short}</option>)}
          </select>
        </label>
        <div className="report-profile-card">
          <strong>{profile.title}</strong>
          <small>{profile.audience}</small>
          <p>{profile.purpose}</p>
          <p>{profile.emphasis.join(' · ')}</p>
        </div>
        <div className="report-year-grid">
          <label><span>Desde</span><select value={fromYear} onChange={(event) => setFromYear(Math.min(Number(event.target.value), toYear))}>{YEARS.map((year) => <option key={year}>{year}</option>)}</select></label>
          <label><span>Hasta</span><select value={toYear} onChange={(event) => setToYear(Math.max(Number(event.target.value), fromYear))}>{YEARS.map((year) => <option key={year}>{year}</option>)}</select></label>
        </div>
        <div className="report-safety-box">
          <strong>Separación de responsabilidades</strong>
          <span>SQL / funciones determinísticas → cifras, tasas, índices y gráficos.</span>
          <span>IA → redacción interpretativa; no modifica ni recalcula datos.</span>
        </div>
        <button className="report-btn report-btn-ai" onClick={() => void requestAiNarrative()} disabled={aiStatus === 'loading'}>{aiStatus === 'loading' ? 'Generando síntesis…' : 'Generar síntesis IA'}</button>
        <button className="report-btn report-btn-primary" onClick={printPdf}>Generar PDF</button>
        {aiMeta && <small className="report-ai-meta">{aiMeta}</small>}
      </aside>

      <main className="report-paper-wrap">
        <article className="report-paper">
          <header className="report-cover">
            <div className="report-cover-top"><span>ATLAS OBSERVATORIO</span><span>INFORME TRAZABLE · {fromYear}–{toYear}</span></div>
            <div className="report-cover-body"><span className="report-eyebrow">{profile.short}</span><h2>{profile.title}</h2><p>{profile.question}</p></div>
            <div className="report-badges"><span>DATOS DETERMINÍSTICOS</span><span>{aiStatus === 'ready' ? 'SÍNTESIS IA SOBRE CIFRAS VALIDADAS' : 'SÍNTESIS BASE DETERMINÍSTICA'}</span><span>FUENTES UAF TRAZADAS</span></div>
          </header>

          <section className="report-section report-no-break">
            <div className="report-section-heading"><span>01</span><div><h3>Lectura ejecutiva</h3><p>El foco cambia; las cifras subyacentes no.</p></div></div>
            <div className="report-kpi-grid">{kpis.map(([label, value, note]) => <div className="report-kpi" key={label}><span>{label}</span><strong>{value}</strong><small>{note}</small></div>)}</div>
            <div className="report-narrative">
              <div className="report-narrative-label"><span>{aiStatus === 'ready' ? 'Síntesis interpretativa IA' : 'Síntesis interpretativa base'}</span><small>{aiStatus === 'ready' ? 'La IA recibió sólo métricas validadas y restricciones metodológicas.' : 'Texto reproducible generado por reglas de la plantilla.'}</small></div>
              {narrative.map((paragraph, i) => <p key={i}>{paragraph}</p>)}
            </div>
          </section>

          {(profileId === 'presupuesto' || profileId === 'ejecutivo') && (
            <section className="report-section report-page-break">
              <div className="report-section-heading"><span>02</span><div><h3>Presión frente a capacidad observable</h3><p>Índices normalizados con base {fromYear}=100.</p></div></div>
              <LineChart rows={d.indexedRows} series={[{ key: 'pressure', label: 'Presión observable', tone: 'tone-pressure' }, { key: 'staff', label: 'Dotación efectiva', tone: 'tone-staff' }, { key: 'iif', label: 'IIF', tone: 'tone-iif' }]} title="Trayectorias relativas" subtitle="Presión = media geométrica de índices de padrón, ROS y actividades obligadas. Es un indicador experimental, no de productividad." />
              <div className="report-callouts"><div><strong>{d.pressureIndex == null ? 's/d' : fmt.format(d.pressureIndex)}</strong><span>Índice de presión observable</span></div><div><strong>{d.rosPerStaffEnd == null ? 's/d' : fmt.format(d.rosPerStaffEnd)}</strong><span>ROS por funcionario total · {toYear}</span></div><div><strong>{d.indicationsPerIifEnd == null ? 's/d' : fmt.format(d.indicationsPerIifEnd)}</strong><span>ROS con indicios por IIF · {toYear}</span></div></div>
              <p className="report-method-note">La razón ROS/dotación es un proxy institucional deliberadamente grueso: la dotación incluye a toda la UAF y no representa carga individual ni dotación de la División de Inteligencia Financiera. Un IIF puede consolidar múltiples ROS y antecedentes.</p>
            </section>
          )}

          {(profileId === 'presupuesto' || profileId === 'crimen' || profileId === 'internacional') && (
            <section className={`report-section ${profileId !== 'presupuesto' ? 'report-page-break' : ''}`}>
              <div className="report-section-heading"><span>{profileId === 'presupuesto' ? '03' : '02'}</span><div><h3>Demanda nacional e internacional</h3><p>Requerimientos del Ministerio Público e intercambios con UIF extranjeras.</p></div></div>
              <LineChart rows={d.demandRows} series={[{ key: 'mp', label: 'Requerimientos MP', tone: 'tone-mp' }, { key: 'intl', label: 'Intercambios UIF', tone: 'tone-intl' }]} title="Canales adicionales de demanda de información" subtitle="Intercambios UIF = consultas extranjeras recibidas + solicitudes enviadas por la UAF mediante cooperación entre UIF." />
            </section>
          )}

          {(profileId === 'supervision' || profileId === 'ejecutivo' || profileId === 'presupuesto') && (
            <section className="report-section report-page-break">
              <div className="report-section-heading"><span>{profileId === 'presupuesto' ? '04' : '03'}</span><div><h3>Concentración sectorial de reportabilidad</h3><p>Principales sectores por ROS 2025.</p></div></div>
              <div className="report-table-wrap"><table className="report-table"><thead><tr><th>Sector</th><th>Inscritos 2025</th><th>ROS 2025</th><th>ROS / 100 SO</th><th>Var. anual</th></tr></thead><tbody>{topSectors.map((sector) => <tr key={sector.sector}><td>{sector.sector}</td><td>{sector.inscritos_2025 == null ? '—' : fmt0.format(sector.inscritos_2025)}</td><td>{sector.ros_2025 == null ? '—' : fmt0.format(sector.ros_2025)}</td><td>{sector.ros_por_100_so_2025 == null ? '—' : fmt.format(sector.ros_por_100_so_2025)}</td><td>{sector.variacion_ros_2025_2024_pct == null ? '—' : signedPct(sector.variacion_ros_2025_2024_pct)}</td></tr>)}</tbody></table></div>
              <p className="report-method-note">La reportabilidad disponible en Atlas es sectorial y agregada. No existe atribución de ROS a sujetos individuales en este informe. Volumen de ROS no equivale por sí solo a riesgo LA/FT ni a calidad de reporte.</p>
            </section>
          )}

          <section className="report-section report-sources report-page-break">
            <div className="report-section-heading"><span>{profileId === 'presupuesto' ? '05' : '04'}</span><div><h3>Trazabilidad y metodología</h3><p>Cada punto utilizado conserva fuente, corte y método de captura en la base de Atlas.</p></div></div>
            <div className="report-method-grid"><div><strong>Cálculo</strong><p>{report.data.metodologia.calculo}</p></div><div><strong>Reportabilidad</strong><p>{report.data.metodologia.nivel_reportabilidad}</p></div><div><strong>Comparabilidad</strong><p>{report.data.metodologia.comparabilidad}</p></div></div>
            <h4>Fuentes utilizadas por este perfil</h4>
            <ol className="report-source-list">{uniqueSources.map((point) => <li key={point.fuente ?? ''}><a href={point.fuente ?? '#'} target="_blank" rel="noreferrer">{point.fuente}</a><span>Corte registrado: {point.corte ?? 's/d'} · método: {point.metodo_captura ?? 's/d'}</span></li>)}</ol>
            <div className="report-footer-note"><strong>Regla de IA de Atlas</strong><p>La capa generativa recibe un objeto de datos ya validado. No tiene autorización para consultar tablas, modificar cifras, recalcular indicadores ni introducir números ausentes. Su función es exclusivamente redactar una interpretación compatible con el foco seleccionado y las cautelas metodológicas.</p></div>
          </section>
        </article>
      </main>
    </div>
  );
}
