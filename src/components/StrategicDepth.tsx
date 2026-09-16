import { useMemo, useState } from 'react';
import { ErrorBox, Loading } from './primitives';
import { useRpc } from '../lib/rpc';
import '../styles/strategic-depth.css';

type RegionConvergence = {
  region_name: string;
  convergence_index: number | null;
  avg_igr: number | null;
  max_igr: number | null;
  finding_n: number;
  sanction_n: number;
  press_n: number;
  coverage: number | null;
};

type SectorConvergence = {
  sector: string;
  attention_index: number | null;
  vulnerability_index: number | null;
  sanction_rate_per_100: number | null;
  ipf_mean: number | null;
  delta_ros_2025_vs_2024_pct: number | null;
  ros_2025: number | null;
  subject_count: number | null;
  top_region: string | null;
};

type PressMomentum = {
  theme: string;
  current_n: number;
  previous_n: number;
  delta_pct: number | null;
  current_media: number;
  latest_date: string | null;
};

type DeepQuestion = {
  id: string;
  question: string;
  answer: string;
  caveat?: string;
  top_regions?: Array<{ region: string; indice: number; igr: number; hallazgos: number; sanciones: number; prensa: number }>;
  top_sectors?: Array<{ sector: string; indice: number; vulnerabilidad: number | null; tasa_sancion: number | null; ipf: number | null; var_ros: number | null }>;
  themes?: PressMomentum[];
  coverage?: Record<string, number | null>;
};

type DepthPayload = {
  contract: string;
  generated_at: string;
  window: { days: number; current_from: string; previous_from: string; to: string };
  regional_convergence: RegionConvergence[];
  sector_convergence: SectorConvergence[];
  press_momentum: PressMomentum[];
  alert_mix: Array<{ family: string; n: number; max_strength: number | null }>;
  coverage: {
    press_relevant_articles: number;
    press_geocoded_articles: number;
    press_geocoded_pct: number | null;
    press_media_count: number;
    sanctions_current: number;
    sanctions_previous: number;
    sanctions_documented: number;
    sanction_regulators: number;
    territory_regions: number;
    territory_avg_coverage: number | null;
    finding_regions: number;
  };
  preguntas_profundas: DeepQuestion[];
  methodology: {
    regional_index: string;
    sector_index: string;
    momentum: string;
    interpretation: string;
  };
};

const fmt = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 1 });
const fmt0 = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 });

function signed(value: number | null) {
  if (value == null || !Number.isFinite(value)) return 's/d';
  return `${value >= 0 ? '+' : ''}${fmt.format(value)}%`;
}

function meter(value: number | null) {
  return Math.max(0, Math.min(100, Number(value ?? 0)));
}

function questionAnswer(q: DeepQuestion): string {
  if (q.id === 'regional_convergence') {
    const top = q.top_regions?.slice(0, 3) ?? [];
    if (!top.length) return 'No hay cobertura suficiente para construir una convergencia territorial.';
    return `La mayor convergencia observable se concentra hoy en ${top.map((x) => x.region).join(', ')}. El resultado combina territorio, hallazgos, sanciones recientes y prensa georreferenciada cuando esa última capa tiene cobertura.`;
  }
  if (q.id === 'sector_convergence') {
    const top = q.top_sectors?.slice(0, 3) ?? [];
    if (!top.length) return 'No hay suficiente cobertura sectorial para construir una priorización agregada.';
    return `Los sectores que reúnen más señales agregadas para revisión son ${top.map((x) => x.sector).join(', ')}. La lectura es de prioridad analítica, no de incumplimiento.`;
  }
  if (q.id === 'novelty_momentum') {
    const top = q.themes?.slice(0, 3) ?? [];
    if (!top.length) return 'No hay novedades temáticas suficientes en la ventana seleccionada.';
    return `En cobertura de prensa aumentan con mayor fuerza ${top.map((x) => `${x.theme} (${signed(x.delta_pct)})`).join(', ')} respecto de la ventana inmediatamente anterior.`;
  }
  if (q.id === 'evidence_coverage') {
    const c = q.coverage ?? {};
    return `La cobertura territorial alcanza ${fmt0.format(Number(c.territory_regions ?? 0))} regiones; la prensa temática proviene de ${fmt0.format(Number(c.press_media_count ?? 0))} medios. La georreferenciación de prensa alcanza ${fmt.format(Number(c.press_geocoded_pct ?? 0))}%, por lo que esa capa no debe pesar en conclusiones regionales mientras no mejore.`;
  }
  return 'Respuesta construida desde el contrato determinístico de profundización estratégica.';
}

export function StrategicDepth() {
  const [days, setDays] = useState(30);
  const depth = useRpc<DepthPayload>('obs_uaf_strategic_depth_payload', { p_novelty_days: days });
  const topRegions = useMemo(() => depth.data?.regional_convergence.slice(0, 6) ?? [], [depth.data]);
  const topSectors = useMemo(() => depth.data?.sector_convergence.filter((x) => x.attention_index != null).slice(0, 8) ?? [], [depth.data]);

  if (depth.loading && !depth.data) return <div className="strategic-depth-shell"><Loading label="Construyendo profundización estratégica…" /></div>;
  if (depth.error) return <div className="strategic-depth-shell"><ErrorBox error={depth.error} onRetry={depth.reload} /></div>;
  if (!depth.data) return null;

  const p = depth.data;
  const pressGeoWarning = Number(p.coverage.press_geocoded_pct ?? 0) < 25;

  return (
    <section className="strategic-depth-shell">
      <div className="strategic-depth-toolbar no-print">
        <div>
          <span>PROFUNDIZACIÓN ESTRATÉGICA</span>
          <strong>Convergencia, momentum y cobertura de evidencia</strong>
        </div>
        <label>
          Ventana de novedad
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={7}>7 días</option>
            <option value={30}>30 días</option>
            <option value={60}>60 días</option>
            <option value={90}>90 días</option>
          </select>
        </label>
      </div>

      <article className="strategic-depth-paper">
        <header className="sd-header">
          <div>
            <span className="sd-kicker">ATLAS · CAPA DE PROFUNDIZACIÓN</span>
            <h2>Lo que una lectura simple no muestra</h2>
            <p>Esta capa cruza señales territoriales, hallazgos, sanciones, comportamiento sectorial y agenda pública para transformar datos dispersos en preguntas estratégicas defendibles.</p>
          </div>
          <div className="sd-window">
            <span>Ventana analizada</span>
            <strong>{p.window.current_from} → {p.window.to}</strong>
            <small>comparada con {p.window.previous_from} → {p.window.current_from}</small>
          </div>
        </header>

        <section className="sd-section report-page-break">
          <div className="sd-title"><span>09</span><div><h3>Dónde convergen varias señales</h3><p>No se prioriza una región por una sola variable: se observa coincidencia entre capas.</p></div></div>
          <div className="sd-region-grid">
            {topRegions.map((r, i) => (
              <article key={r.region_name}>
                <div className="sd-rank">#{i + 1}</div>
                <h4>{r.region_name}</h4>
                <strong className="sd-big">{r.convergence_index == null ? '—' : fmt.format(r.convergence_index)}</strong>
                <span>índice de convergencia</span>
                <div className="sd-meter"><i style={{ width: `${meter(r.convergence_index)}%` }} /></div>
                <dl>
                  <div><dt>IGR medio</dt><dd>{r.avg_igr == null ? '—' : fmt.format(r.avg_igr)}</dd></div>
                  <div><dt>Hallazgos</dt><dd>{fmt0.format(r.finding_n)}</dd></div>
                  <div><dt>Sanciones recientes</dt><dd>{fmt0.format(r.sanction_n)}</dd></div>
                  <div><dt>Prensa georreferenciada</dt><dd>{fmt0.format(r.press_n)}</dd></div>
                </dl>
              </article>
            ))}
          </div>
          <p className="sd-method">{p.methodology.regional_index}</p>
        </section>

        <section className="sd-section report-page-break">
          <div className="sd-title"><span>10</span><div><h3>Qué sectores merecen preguntas más profundas</h3><p>Se combinan vulnerabilidad estructural, sanciones, IPF y cambio de reportabilidad.</p></div></div>
          <div className="sd-sector-list">
            {topSectors.map((s, i) => (
              <article key={s.sector}>
                <span className="sd-rank">#{i + 1}</span>
                <div className="sd-sector-main"><h4>{s.sector}</h4><small>{s.top_region ? `Mayor presencia: ${s.top_region}` : 'Sin región principal informada'}</small></div>
                <div><span>Atención</span><strong>{s.attention_index == null ? '—' : fmt.format(s.attention_index)}</strong></div>
                <div><span>Vulnerabilidad</span><strong>{s.vulnerability_index == null ? 's/d' : fmt.format(s.vulnerability_index)}</strong></div>
                <div><span>Tasa sanción/100</span><strong>{s.sanction_rate_per_100 == null ? 's/d' : fmt.format(s.sanction_rate_per_100)}</strong></div>
                <div><span>Var. ROS</span><strong>{signed(s.delta_ros_2025_vs_2024_pct)}</strong></div>
              </article>
            ))}
          </div>
          <p className="sd-method">{p.methodology.sector_index}</p>
        </section>

        <section className="sd-section report-page-break">
          <div className="sd-title"><span>11</span><div><h3>Qué está cambiando en la agenda pública</h3><p>Comparación automática entre ventanas equivalentes de prensa temática.</p></div></div>
          <div className="sd-momentum-grid">
            {p.press_momentum.map((m) => (
              <article key={m.theme}>
                <span>{m.theme}</span>
                <strong>{signed(m.delta_pct)}</strong>
                <p>{fmt0.format(m.current_n)} notas actuales vs {fmt0.format(m.previous_n)} previas</p>
                <small>{fmt0.format(m.current_media)} medios · última {m.latest_date ?? 's/d'}</small>
              </article>
            ))}
          </div>
          <p className="sd-method">{p.methodology.momentum} El aumento de cobertura periodística no equivale a un aumento de incidencia delictual.</p>
        </section>

        <section className="sd-section report-page-break">
          <div className="sd-title"><span>12</span><div><h3>Preguntas difíciles que una comisión podría formular</h3><p>Respuestas generadas desde reglas y métricas, con el límite metodológico visible.</p></div></div>
          <div className="sd-question-grid">
            {p.preguntas_profundas.map((q) => (
              <article key={q.id}>
                <span>PREGUNTA</span>
                <h4>{q.question}</h4>
                <p>{questionAnswer(q)}</p>
                {q.caveat && <small>{q.caveat}</small>}
              </article>
            ))}
          </div>
        </section>

        <section className="sd-section report-page-break">
          <div className="sd-title"><span>13</span><div><h3>Qué tan defendible es la evidencia</h3><p>El informe muestra sus vacíos en vez de rellenarlos con inferencias.</p></div></div>
          <div className="sd-coverage-grid">
            <article><strong>{fmt0.format(p.coverage.territory_regions)}</strong><span>regiones con capa territorial</span><small>Cobertura metodológica media {fmt.format(p.coverage.territory_avg_coverage ?? 0)}%</small></article>
            <article><strong>{fmt0.format(p.coverage.finding_regions)}</strong><span>regiones con hallazgos Atlas</span><small>Hallazgos contextualizados territorialmente</small></article>
            <article><strong>{fmt0.format(p.coverage.press_relevant_articles)}</strong><span>notas temáticas recientes</span><small>{fmt0.format(p.coverage.press_media_count)} medios</small></article>
            <article className={pressGeoWarning ? 'sd-warning' : ''}><strong>{fmt.format(p.coverage.press_geocoded_pct ?? 0)}%</strong><span>prensa con región estructurada</span><small>{pressGeoWarning ? 'No se usa como señal regional sustantiva mientras siga baja.' : 'Cobertura suficiente para complementar lectura regional.'}</small></article>
            <article><strong>{fmt0.format(p.coverage.sanctions_current)}</strong><span>sanciones en ventana actual</span><small>{fmt0.format(p.coverage.sanctions_documented)} con documento disponible</small></article>
            <article><strong>{fmt0.format(p.coverage.sanction_regulators)}</strong><span>reguladores con eventos recientes</span><small>Comparar con ventana anterior: {fmt0.format(p.coverage.sanctions_previous)}</small></article>
          </div>
          <div className="sd-methodology-box">
            <strong>Regla metodológica central</strong>
            <p>{p.methodology.interpretation}</p>
            <p>Cuando una capa carece de cobertura, Atlas la muestra como ausencia de evidencia y le asigna aporte cero en el índice, evitando convertir falta de datos en una señal positiva o negativa.</p>
          </div>
        </section>
      </article>
    </section>
  );
}
