import { useMemo, useState } from 'react';
import type { UafPulse, UafReportingSector } from '../../lib/contracts';
import { Columns } from '../../components/charts';
import { Empty, Panel } from '../../components/primitives';
import { n, n1, titleCase } from '../../lib/format';
import type { CohortRequest } from '../../components/CohortDrawer';
import '../../styles/pulso-analysis-compact.css';

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
    lede: 'Stock de sujetos obligados inscritos publicado por la UAF: cierres anuales 2020–2025 y corte semestral al 30-06-2026. El último punto, 10.294, es el padrón vigente publicado y no una proyección.',
    accent: 'var(--unknown)' },
];

const UAF_REGISTRY_2026 = 'https://www.uaf.cl/es-cl/sujetos-obligados/sector-privado/inscritos-en-la-uaf';

export function LenteReportabilidad({ data }: { data: UafPulse; onCohort: (req: CohortRequest) => void }) {
  const [serie, setSerie] = useState(SERIES[0].key);
  const rep = data.reporting;
  const serieActiva = SERIES.find((s) => s.key === serie) ?? SERIES[0];
  const serieDatos = rep?.nacional?.[serie];
  const puntosPublicados = (serieDatos?.puntos ?? [])
    .filter((p) => /^\d{4}$/.test(p.periodo))
    .map((p) => ({ label: p.periodo, value: p.valor }));
  const tiene2026 = puntosPublicados.some((p) => p.label === '2026');
  const chartData = tiene2026
    ? puntosPublicados
    : [...puntosPublicados, { label: '2026', value: null, ghost: true, note: 'sin publicar' }];
  const sourceHref = serie === 'entidades_reportantes_total' ? UAF_REGISTRY_2026 : serieDatos?.fuente;
  const sourceLabel = serie === 'entidades_reportantes_total' ? 'Padrón UAF 30-06-2026' : 'Informe Estadístico UAF';

  if (!rep?.disponible) {
    return <Empty title="Sin corte de reportabilidad publicado" hint="El Informe Estadístico UAF no está disponible en este snapshot." />;
  }

  return (
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
      <p style={{ margin: '0 0 2px', fontSize: 11, color: 'var(--ink-2)', lineHeight: 1.45, maxWidth: '68ch' }}>
        {serieActiva.lede}
      </p>
      {chartData.length ? (
        <>
          <Columns accent={serieActiva.accent} data={chartData} height={156} />
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginTop: 8 }}>
            <span style={{ fontSize: 9.8, color: 'var(--ink-4)' }}>
              {serieActiva.unit} · corte {serieDatos?.corte ?? '—'}
            </span>
            {sourceHref && (
              <a className="ev-link" style={{ marginTop: 0, fontSize: 9.8 }}
                href={sourceHref} target="_blank" rel="noreferrer">
                {sourceLabel} →
              </a>
            )}
          </div>
        </>
      ) : (
        <Empty title="Serie no publicada en este corte" />
      )}
    </Panel>
  );
}

export function QuienSostieneReportabilidad({
  data,
  onCohort,
  compact = false,
}: {
  data: UafPulse;
  onCohort: (req: CohortRequest) => void;
  compact?: boolean;
}) {
  const [orden, setOrden] = useState<'padron' | 'intensidad' | 'volumen'>('volumen');
  const rep = data.reporting;
  const sectores = useMemo(() => ordenarSectores(rep?.sectores ?? [], orden), [rep, orden]);

  if (!rep?.disponible) {
    return <Empty title="Sin corte de reportabilidad publicado" />;
  }

  const visible = compact ? 8 : 14;

  return (
    <Panel
      title="Quién sostiene la reportabilidad"
      pad={false}
      actions={
        <div className="seg">
          <button data-on={orden === 'volumen'} onClick={() => setOrden('volumen')}>Volumen</button>
          <button data-on={orden === 'intensidad'} onClick={() => setOrden('intensidad')}>Intensidad</button>
          <button data-on={orden === 'padron'} onClick={() => setOrden('padron')}>Padrón</button>
        </div>
      }
    >
      <div style={{ padding: '4px 0 0' }}>
        <div className="rep-row rep-head">
          <span>Sector obligado</span>
          <span>ROS 2025</span>
          <span className="rep-hide">Padrón</span>
          <span className="rep-hide">Δ 25/24</span>
          <span className="rep-hide">ICR</span>
        </div>
        {sectores.slice(0, visible).map((s) => (
          <SectorReportRow
            key={s.sector_official}
            s={s}
            peak={Math.max(1, ...sectores.map((x) => x.ros_per_100_so_2025 ?? 0))}
            onPick={() =>
              s.sector_canonical
                ? onCohort({ cohort: 'SECTOR', value: s.sector_canonical, title: s.sector_canonical })
                : undefined
            }
          />
        ))}
      </div>

      {!compact && (
        <p style={{ margin: 0, padding: '12px 18px 14px', fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.55, borderTop: '1px solid var(--line-soft)' }}>
          <b style={{ color: 'var(--ink-2)' }}>Cómo leer esta tabla.</b>{' '}
          La intensidad es ROS 2025 por cada 100 inscritos y usa el padrón del Informe Estadístico al {rep.corte.padron_referencia_corte} ({n(rep.corte.padron_referencia)}). La escala de intensidad está comprimida logarítmicamente para conservar el orden entre sectores. {data.coverage.reporting_note}
        </p>
      )}
    </Panel>
  );
}

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
  const ancho = intensidad == null ? 0 : Math.min(100, (Math.log10(1 + intensidad) / Math.log10(1 + peak)) * 100);
  const silencio = s.silence_5y === true;
  const sinInscritos = s.sector_canonical == null;
  const delta = s.delta_ros_2025_vs_2024_pct;

  return (
    <button className="rep-row" onClick={onPick} disabled={!onPick} title={s.sector_official}>
      <span className="rep-name">
        <span>{titleCase(s.etiqueta)}</span>
        {silencio && <span className="motive" data-m="SECTOR_SIN_ROS"><i />sin ROS 5 años</span>}
        {sinInscritos && <span className="badge badge-absent">sin inscritos</span>}
      </span>
      <span className="num" style={{ textAlign: 'right', fontSize: 12, fontWeight: 620 }}>
        {s.ros_2025 == null ? '—' : n(s.ros_2025)}
        <em style={{ display: 'block', fontStyle: 'normal', fontSize: 10, color: 'var(--ink-4)', fontWeight: 400 }}>
          {intensidad == null ? 'sin corte' : `${n1(intensidad)} / 100 SO`}
        </em>
      </span>
      <span className="rep-hide num" style={{ textAlign: 'right', fontSize: 12, color: s.padron_sujetos == null ? 'var(--ink-4)' : 'var(--ink-2)' }}>
        {s.padron_sujetos == null ? '—' : n(s.padron_sujetos)}
      </span>
      <span
        className="rep-hide num"
        style={{
          textAlign: 'right',
          fontSize: 12,
          color: delta == null ? 'var(--ink-4)'
            : (s.ros_2025 ?? 0) < 20 ? 'var(--ink-3)'
            : delta > 0 ? 'var(--present)' : delta < 0 ? 'var(--sig-high)' : 'var(--ink-3)',
        }}
      >
        {delta == null ? '—' : `${delta > 0 ? '+' : ''}${n1(delta)}%`}
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
