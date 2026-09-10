import { useEffect, useMemo, useState } from 'react';
import type { TerritoryDetail } from '../lib/contracts';
import { useDebounced, useRpc } from '../lib/rpc';
import { hrefFor } from '../lib/router';
import { n, n1, rutFormat, titleCase } from '../lib/format';
import '../styles/territory-commune-workspace.css';

const PAGE = 80;
const MATRIX_VISIBLE = 7;

type Segment = 'UNIVERSE' | 'ALL' | 'SO' | 'POTENTIAL' | 'SANCTIONED' | 'PRESS' | 'OSFL' | 'FINTECH';
type SortMode = 'relevance' | 'score' | 'signals' | 'name';
type UniverseStatus = 'ALL' | 'ACTIVE' | 'TERMINATED';

type MatrixRow = {
  sector: string;
  so_count: number;
  potential_count: number;
  sanctioned_count: number;
  press_count: number;
  osfl_count: number;
  fintech_count: number;
  total_count: number;
};

type CommuneContext = {
  contract: 'ATLAS_OBS_TERRITORY_COMMUNE_CONTEXT_V2';
  territory_id: string;
  commune_name: string;
  region_name: string;
  metrics: {
    entities: number;
    uaf: number;
    potential: number;
    sanctioned: number;
    press: number;
    osfl: number;
    fintech: number;
  };
  sectors: {
    sector: string;
    so_count: number;
    potential_count: number;
    total_count: number;
  }[];
  matrix?: MatrixRow[];
  semantics: string;
};

type TerritoryUniverse = {
  contract: 'ATLAS_OBS_TERRITORY_UNIVERSE_V1';
  territory_id: string;
  commune_name: string;
  region_name: string;
  metrics: {
    universe_total: number;
    sii_total: number;
    sii_active: number;
    sii_terminated: number;
    res_total: number;
    atlas_observed: number;
    uaf_observed: number;
    osfl_observed: number;
    potential_observed: number;
    fintech_observed: number;
    atlas_coverage_pct: number | null;
  };
  semantics: string;
  refreshed_at: string;
};

type UniverseEntity = {
  rut: string;
  name: string;
  entity_type: string;
  region: string | null;
  commune: string | null;
  geo_source: string;
  sii_status: string | null;
  in_res: boolean;
  in_sii: boolean;
  in_atlas: boolean;
  in_uaf: boolean;
  in_osfl: boolean;
  in_potential: boolean;
  in_fintech: boolean;
  atlas_entity_id: string | null;
  source_count: number;
  total_count: number;
};

type CommuneEntity = {
  entity_id: string;
  rut: string | null;
  name: string;
  entity_type: string | null;
  uaf_sector: string | null;
  potential_sector: string | null;
  economic_sector: string | null;
  main_activity: string | null;
  region: string | null;
  commune: string | null;
  sii_status: string | null;
  sii_termination_date: string | null;
  is_uaf_observed: boolean;
  is_potential: boolean;
  is_osfl: boolean;
  is_fintech: boolean;
  fintech_vertical: string | null;
  is_state_supplier: boolean;
  sanction_count: number;
  press_evidence_count: number;
  alert_count: number;
  finding_count: number;
  priority_score: number | null;
  priority_band: string | null;
  priority_metric: string | null;
  attention_motive: string | null;
  source_count: number;
  total_count: number;
};

type CommunePotential = {
  rut: string;
  entity_id: string | null;
  name: string;
  implied_sector: string | null;
  matched_activity: string | null;
  economic_sector: string | null;
  region: string | null;
  commune: string | null;
  sales_band_size: string | null;
  sales_band_uf: string | null;
  detection_tier: string | null;
  evidence_class: string | null;
  ivo_score: number | null;
  ivo_band: string | null;
  res_available: boolean;
  uaf_sanction_events: number | null;
  flags: string[] | null;
  total_count: number;
};

const SEGMENTS: { key: Segment; label: string; short: string; helper: string }[] = [
  { key: 'UNIVERSE', label: 'Universo territorial', short: 'Universo', helper: 'base amplia SII + RES' },
  { key: 'ALL', label: 'Entidades observadas por Atlas', short: 'Atlas', helper: 'con señales analíticas' },
  { key: 'SO', label: 'Sujetos obligados UAF', short: 'SO UAF', helper: 'inscritos en la comuna' },
  { key: 'POTENTIAL', label: 'Potenciales sujetos obligados', short: 'Potenciales', helper: 'candidatos por giro' },
  { key: 'SANCTIONED', label: 'Entidades con sanción', short: 'Sancionadas', helper: 'evidencia sancionatoria' },
  { key: 'PRESS', label: 'Entidades con prensa', short: 'Prensa', helper: 'identidad resuelta' },
  { key: 'OSFL', label: 'Organizaciones sin fines de lucro', short: 'OSFL', helper: 'reconocidas en fuentes' },
  { key: 'FINTECH', label: 'Entidades fintech', short: 'Fintech', helper: 'ecosistema identificado' },
];

const MATRIX_COLUMNS: { key: Exclude<Segment, 'ALL' | 'UNIVERSE'>; label: string; field: keyof MatrixRow }[] = [
  { key: 'SO', label: 'SO UAF', field: 'so_count' },
  { key: 'POTENTIAL', label: 'Potenciales', field: 'potential_count' },
  { key: 'SANCTIONED', label: 'Sancionadas', field: 'sanctioned_count' },
  { key: 'PRESS', label: 'Prensa', field: 'press_count' },
  { key: 'OSFL', label: 'OSFL', field: 'osfl_count' },
  { key: 'FINTECH', label: 'Fintech', field: 'fintech_count' },
];

const levelStep = (level: string | null | undefined) => {
  const map: Record<string, number> = { 'Muy bajo': 1, Bajo: 2, Moderado: 2, Medio: 3, Alto: 4, 'Muy alto': 5 };
  return map[level ?? ''] ?? 1;
};

const clamp = (value: number) => Math.max(0, Math.min(100, value));

export function TerritoryCommuneWorkspace({
  data,
  onBack,
  onNavigate,
}: {
  data: TerritoryDetail;
  onBack: () => void;
  onNavigate: (hash: string) => void;
}) {
  const t = data.territorio;
  const p = data.posicion;
  const layers = useMemo(() => Object.entries(t.layers ?? {}), [t.layers]);
  const [selectedLayer, setSelectedLayer] = useState<string | null>(null);
  const [segment, setSegment] = useState<Segment>('UNIVERSE');
  const [universeStatus, setUniverseStatus] = useState<UniverseStatus>('ALL');
  const [sector, setSector] = useState<string | null>(null);
  const [matrixExpanded, setMatrixExpanded] = useState(false);
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounced(query, 220);
  const [sort, setSort] = useState<SortMode>('relevance');
  const [page, setPage] = useState(0);

  const context = useRpc<CommuneContext | null>('obs_territory_commune_context_v2', {
    p_territory_id: t.territory_id,
  });

  const universeSummary = useRpc<TerritoryUniverse | null>('obs_territory_universe_summary', {
    p_territory_id: t.territory_id,
  });

  const universeDirectory = useRpc<UniverseEntity[]>('obs_territory_universe_directory', {
    p_territory_id: t.territory_id,
    p_q: debouncedQuery.trim() || null,
    p_status: universeStatus,
    p_order: sort === 'name' ? 'name' : 'coverage',
    p_limit: PAGE,
    p_offset: page * PAGE,
  }, { skip: segment !== 'UNIVERSE' });

  const entityDirectory = useRpc<CommuneEntity[]>('obs_territory_entity_directory_v2', {
    p_territory_id: t.territory_id,
    p_segment: segment,
    p_q: debouncedQuery.trim() || null,
    p_sector: sector,
    p_order: sort,
    p_limit: PAGE,
    p_offset: page * PAGE,
  }, { skip: segment === 'POTENTIAL' || segment === 'UNIVERSE' });

  const potentialDirectory = useRpc<CommunePotential[]>('obs_territory_potential_directory_v2', {
    p_territory_id: t.territory_id,
    p_q: debouncedQuery.trim() || null,
    p_sector: sector,
    p_order: sort,
    p_limit: PAGE,
    p_offset: page * PAGE,
  }, { skip: segment !== 'POTENTIAL' });

  useEffect(() => setPage(0), [segment, universeStatus, sector, debouncedQuery, sort]);

  const drivers = useMemo(() => layers.flatMap(([layerKey, layer]) =>
    (layer.components ?? []).map((component) => ({ layerKey, layerLabel: layer.label, component })),
  ).sort((a, b) => Number(b.component.score ?? 0) - Number(a.component.score ?? 0)), [layers]);

  const anomalies = useMemo(() => drivers.slice().sort((a, b) =>
    Number(b.component.temporal_anomaly ?? b.component.anomaly ?? 0)
      - Number(a.component.temporal_anomaly ?? a.component.anomaly ?? 0),
  ).slice(0, 3), [drivers]);

  const dynamics = useMemo(() => drivers.slice().sort((a, b) =>
    Number(b.component.trend ?? 0) - Number(a.component.trend ?? 0),
  ).slice(0, 3), [drivers]);

  const matrix = useMemo<MatrixRow[]>(() => {
    if (context.data?.matrix?.length) return context.data.matrix;
    return (context.data?.sectors ?? []).map((row) => ({
      sector: row.sector,
      so_count: row.so_count,
      potential_count: row.potential_count,
      sanctioned_count: 0,
      press_count: 0,
      osfl_count: 0,
      fintech_count: 0,
      total_count: row.total_count,
    }));
  }, [context.data]);

  const visibleMatrix = matrixExpanded ? matrix : matrix.slice(0, MATRIX_VISIBLE);
  const matrixMax = Math.max(1, ...matrix.flatMap((row) => MATRIX_COLUMNS.map((column) => Number(row[column.field] ?? 0))));
  const metrics = context.data?.metrics;
  const broad = universeSummary.data?.metrics;
  const activeRows = segment === 'UNIVERSE'
    ? (universeDirectory.data ?? [])
    : segment === 'POTENTIAL'
      ? (potentialDirectory.data ?? [])
      : (entityDirectory.data ?? []);
  const activeRpc = segment === 'UNIVERSE' ? universeDirectory : segment === 'POTENTIAL' ? potentialDirectory : entityDirectory;
  const total = activeRows[0]?.total_count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE));
  const start = total ? page * PAGE + 1 : 0;
  const end = Math.min(total, (page + 1) * PAGE);
  const selectedLayerData = selectedLayer ? t.layers?.[selectedLayer] : null;

  const metricFor = (key: Segment) => {
    if (key === 'UNIVERSE') return broad?.universe_total ?? null;
    if (!metrics) return null;
    if (key === 'ALL') return metrics.entities;
    if (key === 'SO') return metrics.uaf;
    if (key === 'POTENTIAL') return metrics.potential;
    if (key === 'SANCTIONED') return metrics.sanctioned;
    if (key === 'PRESS') return metrics.press;
    if (key === 'OSFL') return metrics.osfl;
    return metrics.fintech;
  };

  const chooseSegment = (next: Segment) => {
    setSegment(next);
    setSector(null);
    if (next === 'UNIVERSE') setUniverseStatus('ALL');
    setPage(0);
  };

  const chooseUniverse = (status: UniverseStatus) => {
    setSegment('UNIVERSE');
    setUniverseStatus(status);
    setSector(null);
    setSort('relevance');
    setPage(0);
    requestAnimationFrame(() => document.getElementById('tcw-directory')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const chooseMatrixCell = (nextSegment: Exclude<Segment, 'ALL' | 'UNIVERSE'>, nextSector: string) => {
    setSegment(nextSegment);
    setSector(nextSector);
    setPage(0);
    requestAnimationFrame(() => document.getElementById('tcw-directory')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  return (
    <div className="fade-in territory-commune-workspace tcw2">
      <nav className="tcw2-back" aria-label="Volver a Territorio">
        <button type="button" onClick={onBack}>← Territorio</button>
        <span>›</span><span>{t.region_name}</span><span>›</span><b>{t.commune_name}</b>
      </nav>

      <header className="tcw2-hero">
        <div className="tcw2-hero-copy">
          <span className="tcw2-eyebrow">Lectura territorial comunal</span>
          <h1>{t.commune_name}</h1>
          <h2>{t.region_name}</h2>
          <p>{t.interpretation ?? 'Lectura comunal construida a partir de la evidencia territorial disponible.'}</p>
          <div className="tcw2-meta">
            {t.commune_code && <span>CUT <b className="mono">{t.commune_code}</b></span>}
            <span>Año <b>{t.year ?? '—'}</b></span>
            <span>Cobertura <b>{t.igr_methodological_coverage == null ? '—' : `${n1(t.igr_methodological_coverage)}%`}</b></span>
          </div>
        </div>

        <div className="tcw2-hero-kpis" aria-label="Síntesis IGR">
          <HeroKpi label="IGR comunal" value={n1(t.igr_score)} foot={t.igr_level ?? 'sin banda'} tone={`var(--igr-${levelStep(t.igr_level)})`} />
          <HeroKpi label="Percentil nacional" value={t.igr_percentile == null ? '—' : `P${n1(t.igr_percentile)}`} foot={`${n(p.posicion_nacional)} de ${n(p.comunas_pais)}`} />
          <HeroKpi label="Confianza" value={t.igr_confidence == null ? '—' : `${n1(t.igr_confidence)}%`} foot={t.igr_confidence_level ?? 'sin clasificación'} />
          <HeroKpi label="Posición regional" value={`${n(p.posicion_en_region)}°`} foot={`de ${n(p.comunas_region)} comunas`} />
        </div>
      </header>

      <section className="tcw2-panel tcw2-layers" aria-labelledby="tcw2-layers-title">
        <div className="tcw2-section-head">
          <div>
            <span className="tcw2-kicker">Evidencia CEAD</span>
            <h2 id="tcw2-layers-title">Capas CEAD</h2>
            <p>Puntajes normalizados y lectura sintética. El detalle técnico aparece sólo cuando se solicita.</p>
          </div>
          <span className="tcw2-section-note">3 capas · índice territorial</span>
        </div>

        <div className="tcw2-layer-grid">
          {layers.map(([key, layer], index) => {
            const score = Number(layer.score ?? 0);
            const active = selectedLayer === key;
            return (
              <button
                type="button"
                key={key}
                className="tcw2-layer-card"
                data-active={active}
                onClick={() => setSelectedLayer(active ? null : key)}
              >
                <span className="tcw2-layer-index">0{index + 1}</span>
                <div className="tcw2-layer-copy">
                  <span className="tcw2-layer-name">{layer.label}</span>
                  <div className="tcw2-layer-score"><strong className="num">{n1(score)}</strong><span>/100</span></div>
                  <DotScale value={score} />
                  <p>{layerDescription(index)}</p>
                </div>
                <div className="tcw2-layer-side">
                  <span>peso {n1(layer.configured_weight * 100)}%</span>
                  <span>cobertura {n1(layer.coverage * 100)}%</span>
                  <b>{active ? 'Cerrar' : 'Ver detalle'} →</b>
                </div>
              </button>
            );
          })}
        </div>

        {selectedLayerData && (
          <div className="tcw2-layer-detail">
            <div className="tcw2-layer-detail-head">
              <div><span className="tcw2-kicker">Detalle técnico</span><h3>{selectedLayerData.label}</h3></div>
              <button type="button" onClick={() => setSelectedLayer(null)}>Cerrar ×</button>
            </div>
            <div className="tcw2-layer-table-wrap">
              <table className="tcw2-layer-table">
                <thead><tr><th>Componente</th><th>Puntaje</th><th>Intensidad</th><th>Persistencia</th><th>Tendencia</th><th>Anomalía</th><th>Años</th></tr></thead>
                <tbody>
                  {(selectedLayerData.components ?? []).map((component) => (
                    <tr key={component.id}>
                      <td><b>{titleCase(component.label)}</b></td>
                      <td className="num"><strong>{n1(component.score)}</strong></td>
                      <td className="num">{n1(component.intensity)}</td>
                      <td className="num">{n1(component.persistence)}</td>
                      <td className="num">{n1(component.trend)}</td>
                      <td className="num">{n1(component.temporal_anomaly ?? component.anomaly)}</td>
                      <td className="num">{n(component.years_observed)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      <section className="tcw2-panel tcw2-findings" aria-labelledby="tcw2-findings-title">
        <div className="tcw2-section-head">
          <div>
            <span className="tcw2-kicker">Lectura analítica</span>
            <h2 id="tcw2-findings-title">Hallazgos territoriales</h2>
            <p>Impulsores, anomalías y dinámica relativa de los componentes que sostienen el IGR.</p>
          </div>
          <span className="tcw2-section-note">CEAD · sin atribución individual</span>
        </div>

        <div className="tcw2-findings-grid">
          <article className="tcw2-insight-card">
            <div className="tcw2-card-head"><h3>Principales impulsores</h3><span>puntaje</span></div>
            <div className="tcw2-rank-list">
              {drivers.slice(0, 4).map(({ layerKey, layerLabel, component }, index) => (
                <button type="button" key={`${layerKey}-${component.id}`} onClick={() => setSelectedLayer(layerKey)}>
                  <span className="tcw2-rank">{index + 1}</span>
                  <span className="tcw2-rank-copy"><b>{titleCase(component.label)}</b><small>{layerLabel}</small></span>
                  <span className="tcw2-rank-meter"><i style={{ width: `${clamp(Number(component.score ?? 0))}%` }} /></span>
                  <strong className="num">{n1(component.score)}</strong>
                </button>
              ))}
            </div>
          </article>

          <article className="tcw2-insight-card">
            <div className="tcw2-card-head"><h3>Señales y anomalías</h3><span>anomalía temporal</span></div>
            <div className="tcw2-anomaly-list">
              {anomalies.map(({ layerKey, layerLabel, component }) => {
                const anomaly = Number(component.temporal_anomaly ?? component.anomaly ?? 0);
                return (
                  <button type="button" key={`${layerKey}-${component.id}`} onClick={() => setSelectedLayer(layerKey)}>
                    <i data-level={anomalyLevel(anomaly)} />
                    <span><b>{titleCase(component.label)}</b><small>{layerLabel}</small></span>
                    <em data-level={anomalyLevel(anomaly)}>{anomalyLabel(anomaly)}</em>
                    <strong className="num">{n1(anomaly)}</strong>
                  </button>
                );
              })}
            </div>
          </article>

          <article className="tcw2-insight-card tcw2-dynamics">
            <div className="tcw2-card-head"><h3>Perfil de tendencia</h3><span>escala 0–100</span></div>
            <div className="tcw2-dynamic-list">
              {dynamics.map(({ layerKey, component }) => {
                const trend = Number(component.trend ?? 0);
                return (
                  <button type="button" key={`${layerKey}-${component.id}`} onClick={() => setSelectedLayer(layerKey)}>
                    <span><b>{titleCase(component.label)}</b><small>{trendLabel(trend)}</small></span>
                    <div className="tcw2-dynamic-track"><i className="tcw2-midline" /><b style={{ width: `${clamp(trend)}%` }} /></div>
                    <strong className="num">{n1(trend)}</strong>
                  </button>
                );
              })}
            </div>
            <p className="tcw2-dynamic-note">La tendencia es el componente metodológico publicado por el IGR; no representa una serie mensual.</p>
          </article>
        </div>
      </section>

      <section className="tcw2-panel tcw2-universe" aria-labelledby="tcw2-universe-title">
        <div className="tcw2-section-head">
          <div>
            <span className="tcw2-kicker">Base territorial amplia</span>
            <h2 id="tcw2-universe-title">Universo económico y cobertura Atlas</h2>
            <p>El denominador territorial se construye por RUT con geografía disponible. RES aporta domicilio masivo y SII determina vigencia cuando existe coincidencia.</p>
          </div>
          <span className="tcw2-section-note">fuera del IGR · directorio paginado</span>
        </div>

        {universeSummary.error ? (
          <div className="tcw2-state">No fue posible cargar el universo territorial. <button type="button" onClick={universeSummary.reload}>Reintentar</button></div>
        ) : (
          <div className="tcw2-cohort-strip" aria-label="Universo territorial de la comuna">
            <button type="button" data-active={segment === 'UNIVERSE' && universeStatus === 'ALL'} onClick={() => chooseUniverse('ALL')}>
              <span>Universo territorial</span>
              <strong className="num">{universeSummary.loading && !broad ? '…' : n(broad?.universe_total)}</strong>
              <small>RUT territorializados</small>
            </button>
            <button type="button" data-active={segment === 'UNIVERSE' && universeStatus === 'ACTIVE'} onClick={() => chooseUniverse('ACTIVE')}>
              <span>Activas SII</span>
              <strong className="num">{universeSummary.loading && !broad ? '…' : n(broad?.sii_active)}</strong>
              <small>vigentes según publicación</small>
            </button>
            <button type="button" data-active={segment === 'UNIVERSE' && universeStatus === 'TERMINATED'} onClick={() => chooseUniverse('TERMINATED')}>
              <span>Término de giro</span>
              <strong className="num">{universeSummary.loading && !broad ? '…' : n(broad?.sii_terminated)}</strong>
              <small>estado SII publicado</small>
            </button>
            <button type="button" data-active={segment === 'ALL'} onClick={() => chooseSegment('ALL')}>
              <span>Observadas por Atlas</span>
              <strong className="num">{universeSummary.loading && !broad ? '…' : n(broad?.atlas_observed)}</strong>
              <small>materializadas analíticamente</small>
            </button>
            <button type="button" data-active={false} onClick={() => chooseSegment('ALL')}>
              <span>Cobertura Atlas</span>
              <strong className="num">{broad?.atlas_coverage_pct == null ? '—' : `${n1(broad.atlas_coverage_pct)}%`}</strong>
              <small>observadas / universo</small>
            </button>
          </div>
        )}
      </section>

      <section className="tcw2-panel tcw2-matrix-section" aria-labelledby="tcw2-matrix-title">
        <div className="tcw2-section-head tcw2-matrix-head">
          <div>
            <span className="tcw2-kicker">Quiénes están aquí</span>
            <h2 id="tcw2-matrix-title">Matriz de entidades por sector y cohorte</h2>
            <p>Selecciona una celda para cruzar inmediatamente una industria de la Ley 19.913 con una cohorte del universo analíticamente observado.</p>
          </div>
          <span className="tcw2-section-note">contexto · fuera del IGR</span>
        </div>

        {context.error ? (
          <div className="tcw2-state">No fue posible cargar la caracterización comunal. <button type="button" onClick={context.reload}>Reintentar</button></div>
        ) : (
          <>
            <div className="tcw2-cohort-strip" aria-label="Cohortes de la comuna">
              {SEGMENTS.map((item) => (
                <button type="button" key={item.key} data-active={segment === item.key} onClick={() => chooseSegment(item.key)}>
                  <span>{item.short}</span>
                  <strong className="num">{item.key === 'UNIVERSE'
                    ? (universeSummary.loading && !broad ? '…' : n(metricFor(item.key)))
                    : (context.loading && !metrics ? '…' : n(metricFor(item.key)))}</strong>
                  <small>{item.helper}</small>
                </button>
              ))}
            </div>

            {!matrix.length ? (
              <div className="tcw2-state">Sin sectores Ley 19.913 observados en este corte comunal.</div>
            ) : (
              <div className="tcw2-matrix-wrap">
                <table className="tcw2-matrix">
                  <thead><tr><th>Sector / industria Ley 19.913</th>{MATRIX_COLUMNS.map((column) => <th key={column.key}>{column.label}</th>)}</tr></thead>
                  <tbody>
                    {visibleMatrix.map((row) => (
                      <tr key={row.sector}>
                        <th>
                          <button type="button" data-active={sector === row.sector} onClick={() => setSector(sector === row.sector ? null : row.sector)}>
                            <span>{titleCase(row.sector)}</span>
                            <small>{n(row.so_count + row.potential_count)} SO / potenciales</small>
                          </button>
                        </th>
                        {MATRIX_COLUMNS.map((column) => {
                          const value = Number(row[column.field] ?? 0);
                          const active = segment === column.key && sector === row.sector;
                          const heat = value === 0 ? 0 : 9 + Math.round((value / matrixMax) * 51);
                          return (
                            <td key={column.key}>
                              <button
                                type="button"
                                data-active={active}
                                disabled={value === 0}
                                style={{ ['--heat-alpha' as string]: `${heat}%` }}
                                onClick={() => chooseMatrixCell(column.key, row.sector)}
                                title={`${titleCase(row.sector)} · ${column.label}: ${n(value)}`}
                              >
                                <strong className="num">{n(value)}</strong>
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {matrix.length > MATRIX_VISIBLE && (
              <div className="tcw2-matrix-foot">
                <span>{matrixExpanded ? `${n(matrix.length)} sectores visibles` : `Mostrando ${n(MATRIX_VISIBLE)} de ${n(matrix.length)} sectores`}</span>
                <button type="button" onClick={() => setMatrixExpanded((value) => !value)}>{matrixExpanded ? 'Contraer matriz' : 'Ver todos los sectores'} →</button>
              </div>
            )}
          </>
        )}
      </section>

      <section className="tcw2-directory" id="tcw-directory" aria-labelledby="tcw2-directory-title">
        <div className="tcw2-directory-head">
          <div>
            <span className="tcw2-kicker">Directorio comunal</span>
            <h2 id="tcw2-directory-title">{segmentLabel(segment)}{segment === 'UNIVERSE' && universeStatus !== 'ALL' ? ` · ${universeStatus === 'ACTIVE' ? 'Activas SII' : 'Término de giro'}` : ''}{sector ? ` · ${titleCase(sector)}` : ''}</h2>
            <p>{directoryHint(segment)}</p>
          </div>
          <div className="tcw2-directory-total"><strong className="num">{activeRpc.loading && !activeRpc.data ? '…' : n(total)}</strong><small>entidades del corte exacto</small></div>
        </div>

        <div className="tcw2-active-filter">
          <span>{segmentLabel(segment)}</span>
          {segment === 'UNIVERSE' && universeStatus !== 'ALL' && <span>{universeStatus === 'ACTIVE' ? 'Activas SII' : 'Término de giro'}</span>}
          {sector && <span>{titleCase(sector)}</span>}
          {(segment !== 'UNIVERSE' || universeStatus !== 'ALL' || sector) && <button type="button" onClick={() => { setSegment('UNIVERSE'); setUniverseStatus('ALL'); setSector(null); }}>Restablecer corte ×</button>}
        </div>

        <div className="tcw2-directory-tools">
          <label className="tcw2-search">
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={segment === 'UNIVERSE' ? 'Buscar por inicio del nombre o RUT…' : 'Buscar por nombre, RUT, actividad, sector o industria…'}
              aria-label="Buscar en directorio comunal"
            />
            {query && <button type="button" onClick={() => setQuery('')} aria-label="Limpiar búsqueda">×</button>}
          </label>
          {segment === 'UNIVERSE' ? (
            <div className="tcw2-sort" aria-label="Orden del directorio">
              <button type="button" data-active={sort !== 'name'} onClick={() => setSort('relevance')}>Cobertura</button>
              <button type="button" data-active={sort === 'name'} onClick={() => setSort('name')}>Nombre</button>
            </div>
          ) : (
            <div className="tcw2-sort" aria-label="Orden del directorio">
              <button type="button" data-active={sort === 'relevance'} onClick={() => setSort('relevance')}>Relevancia</button>
              <button type="button" data-active={sort === 'score'} onClick={() => setSort('score')}>{segment === 'POTENTIAL' ? 'IVO' : 'Prioridad'}</button>
              <button type="button" data-active={sort === 'signals'} onClick={() => setSort('signals')}>Señales</button>
              <button type="button" data-active={sort === 'name'} onClick={() => setSort('name')}>Nombre</button>
            </div>
          )}
        </div>

        {activeRpc.error ? (
          <div className="tcw2-state">El directorio no pudo cargar este corte. <button type="button" onClick={activeRpc.reload}>Reintentar</button></div>
        ) : activeRpc.loading && !activeRpc.data ? (
          <div className="tcw2-state">Leyendo el directorio comunal…</div>
        ) : !activeRows.length ? (
          <div className="tcw2-state">No hay entidades que coincidan con esta selección.</div>
        ) : segment === 'UNIVERSE' ? (
          <UniverseTable rows={universeDirectory.data ?? []} onNavigate={onNavigate} />
        ) : segment === 'POTENTIAL' ? (
          <PotentialTable rows={potentialDirectory.data ?? []} onNavigate={onNavigate} />
        ) : (
          <EntityTable rows={entityDirectory.data ?? []} onNavigate={onNavigate} />
        )}

        <footer className="tcw2-directory-foot">
          <span><b>{n(start)}–{n(end)}</b> de <b>{n(total)}</b></span>
          <div className="tcw2-pages">
            <button type="button" disabled={page === 0 || activeRpc.loading} onClick={() => setPage((value) => Math.max(0, value - 1))}>← Anterior</button>
            <span>{page + 1} / {totalPages}</span>
            <button type="button" disabled={page + 1 >= totalPages || activeRpc.loading} onClick={() => setPage((value) => Math.min(totalPages - 1, value + 1))}>Siguiente →</button>
          </div>
          <span>Ubicación y marcas describen contexto; no atribuyen riesgo individual.</span>
        </footer>
      </section>

      <div className="tcw2-semantic"><strong>Lectura correcta.</strong> El universo territorial describe la mayor población identificable con geografía disponible; Atlas, UAF, OSFL, fintech y otras marcas son capas superpuestas. El IGR continúa caracterizando presión criminógena territorial y no se modifica por estos conteos.</div>
    </div>
  );
}

function HeroKpi({ label, value, foot, tone }: { label: string; value: string; foot: string; tone?: string }) {
  return (
    <div className="tcw2-hero-kpi" style={tone ? { ['--kpi-tone' as string]: tone } : undefined}>
      <span>{label}</span><strong className="num">{value}</strong><small>{foot}</small>
    </div>
  );
}

function DotScale({ value }: { value: number }) {
  const filled = Math.max(0, Math.min(10, Math.round(value / 10)));
  return <div className="tcw2-dot-scale" aria-label={`Puntaje ${n1(value)} de 100`}>{Array.from({ length: 10 }, (_, index) => <i key={index} data-on={index < filled} />)}</div>;
}

function UniverseTable({ rows, onNavigate }: { rows: UniverseEntity[]; onNavigate: (hash: string) => void }) {
  return (
    <div className="tcw2-table-scroll">
      <table className="tcw2-entity-table">
        <thead><tr><th>Entidad</th><th>Situación SII</th><th>Fuentes</th><th>Cobertura Atlas</th><th>Geografía</th><th>Acción</th></tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.rut}>
              <td className="tcw2-entity-name"><b>{titleCase(row.name)}</b><span>{rutFormat(row.rut)} · {titleCase(row.entity_type)}</span></td>
              <td><State status={row.sii_status} /></td>
              <td>
                <div className="tcw2-signals">
                  {row.in_sii && <span data-kind="sii">SII</span>}
                  {row.in_res && <span data-kind="res">RES</span>}
                  {row.in_uaf && <span data-kind="uaf">SO UAF</span>}
                  {row.in_osfl && <span data-kind="osfl">OSFL</span>}
                  {row.in_potential && <span data-kind="potential">Potencial</span>}
                  {row.in_fintech && <span data-kind="fintech">Fintech</span>}
                </div>
              </td>
              <td>{row.in_atlas ? <span className="tcw2-state-pill" data-tone="active"><i />Observada</span> : <span className="tcw2-secondary">sin ficha analítica</span>}</td>
              <td><b>{row.commune ? titleCase(row.commune) : 'sin comuna'}</b><span className="tcw2-secondary">{row.geo_source.replace(/_/g, ' ')}</span></td>
              <td>{row.atlas_entity_id ? <button type="button" className="tcw2-open" onClick={() => onNavigate(hrefFor({ view: 'ficha', entityId: row.atlas_entity_id! }))}>Entidad 360 →</button> : <span className="tcw2-secondary">disponible como registro base</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EntityTable({ rows, onNavigate }: { rows: CommuneEntity[]; onNavigate: (hash: string) => void }) {
  return (
    <div className="tcw2-table-scroll">
      <table className="tcw2-entity-table">
        <thead><tr><th>Entidad</th><th>Sector Ley 19.913</th><th>Situación / actividad</th><th>Marcas</th><th>Prioridad</th><th>Acción</th></tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.entity_id}>
              <td className="tcw2-entity-name"><b>{titleCase(row.name)}</b><span>{row.rut ? rutFormat(row.rut) : 'sin RUT'} · {row.entity_type ? titleCase(row.entity_type) : 'tipo no observado'}</span></td>
              <td><b>{row.uaf_sector ? titleCase(row.uaf_sector) : row.potential_sector ? titleCase(row.potential_sector) : 'Sin sector observado'}</b>{row.fintech_vertical && <span className="tcw2-secondary">Fintech · {titleCase(row.fintech_vertical)}</span>}{row.economic_sector && <span className="tcw2-secondary">SII · {titleCase(row.economic_sector)}</span>}</td>
              <td><State status={row.sii_status} /><span className="tcw2-secondary">{row.main_activity ? titleCase(row.main_activity) : 'sin actividad principal observada'}</span>{row.sii_termination_date && <span className="tcw2-secondary">Término {row.sii_termination_date.slice(0, 10)}</span>}</td>
              <td><Signals row={row} /></td>
              <td className="tcw2-priority"><strong className="num">{row.priority_score == null ? '—' : n1(row.priority_score)}</strong><small>{row.priority_metric ?? 'IPA'}{row.priority_band ? ` · ${titleCase(row.priority_band.replace(/_/g, ' '))}` : ''}</small></td>
              <td><button type="button" className="tcw2-open" onClick={() => onNavigate(hrefFor({ view: 'ficha', entityId: row.entity_id }))}>Entidad 360 →</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PotentialTable({ rows, onNavigate }: { rows: CommunePotential[]; onNavigate: (hash: string) => void }) {
  return (
    <div className="tcw2-table-scroll">
      <table className="tcw2-entity-table">
        <thead><tr><th>Entidad</th><th>Sector sugerido</th><th>Industria / evidencia</th><th>Caracterización</th><th>IVO</th><th>Acción</th></tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.rut}>
              <td className="tcw2-entity-name"><b>{titleCase(row.name)}</b><span>{rutFormat(row.rut)} · {row.sales_band_size ?? row.sales_band_uf ?? 'escala no observada'}</span></td>
              <td><b>{row.implied_sector ? titleCase(row.implied_sector) : 'sin sector sugerido'}</b><span className="tcw2-secondary">{row.detection_tier ?? row.evidence_class ?? 'conciliación por giro'}</span></td>
              <td><b>{row.economic_sector ? titleCase(row.economic_sector) : 'sin industria SII observada'}</b><span className="tcw2-secondary">{row.matched_activity ? titleCase(row.matched_activity) : 'sin actividad gatillante'}</span></td>
              <td><PotentialSignals row={row} /></td>
              <td className="tcw2-priority"><strong className="num">{row.ivo_score == null ? '—' : n1(row.ivo_score)}</strong><small>{row.ivo_band ? titleCase(row.ivo_band.replace(/_/g, ' ')) : 'sin banda'}</small></td>
              <td>{row.entity_id ? <button type="button" className="tcw2-open" onClick={() => onNavigate(hrefFor({ view: 'ficha', entityId: row.entity_id! }))}>Entidad 360 →</button> : <span className="tcw2-secondary">sin ficha 360</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Signals({ row }: { row: CommuneEntity }) {
  const hasAny = row.is_uaf_observed || row.is_potential || row.is_osfl || row.is_fintech || row.is_state_supplier
    || row.sanction_count > 0 || row.press_evidence_count > 0 || row.alert_count > 0 || row.finding_count > 0 || Boolean(row.attention_motive);
  if (!hasAny) return <span className="tcw2-secondary">sin marca en estos cruces</span>;
  return (
    <div className="tcw2-signals">
      {row.is_uaf_observed && <span data-kind="uaf">SO UAF</span>}
      {row.is_potential && !row.is_uaf_observed && <span data-kind="potential">Potencial</span>}
      {row.sanction_count > 0 && <span data-kind="sanction">Sanción · {n(row.sanction_count)}</span>}
      {row.press_evidence_count > 0 && <span data-kind="press">Prensa · {n(row.press_evidence_count)}</span>}
      {row.is_osfl && <span data-kind="osfl">OSFL</span>}
      {row.is_fintech && <span data-kind="fintech">Fintech</span>}
      {row.is_state_supplier && <span data-kind="provider">Proveedor Estado</span>}
      {row.alert_count > 0 && <span data-kind="alert">Señal · {n(row.alert_count)}</span>}
      {row.finding_count > 0 && <span data-kind="finding">Hallazgo · {n(row.finding_count)}</span>}
      {row.attention_motive && <span data-kind="attention">{titleCase(row.attention_motive.replace(/_/g, ' '))}</span>}
    </div>
  );
}

function PotentialSignals({ row }: { row: CommunePotential }) {
  const flags = row.flags ?? [];
  const sanctions = row.uaf_sanction_events ?? 0;
  if (!flags.length && !row.res_available && sanctions === 0) return <span className="tcw2-secondary">sin marca adicional</span>;
  return (
    <div className="tcw2-signals">
      {row.res_available && <span data-kind="res">RES</span>}
      {sanctions > 0 && <span data-kind="sanction">Sanción UAF · {n(sanctions)}</span>}
      {flags.slice(0, 3).map((flag) => <span data-kind="potential" key={flag}>{titleCase(flag.replace(/_/g, ' '))}</span>)}
      {flags.length > 3 && <span data-kind="more">+{flags.length - 3}</span>}
    </div>
  );
}

function State({ status }: { status: string | null }) {
  const tone = status === 'ACTIVE_AS_PUBLISHED' ? 'active' : status === 'TERMINATED_AS_PUBLISHED' ? 'terminated' : 'unknown';
  return <span className="tcw2-state-pill" data-tone={tone}><i />{stateLabel(status)}</span>;
}

function stateLabel(status: string | null) {
  if (status === 'ACTIVE_AS_PUBLISHED') return 'Activo ante SII';
  if (status === 'TERMINATED_AS_PUBLISHED') return 'Término de giro';
  if (status === 'SIN_PERFIL_SII') return 'Sin perfil SII';
  return status ? titleCase(status.replace(/_/g, ' ')) : 'Estado no observado';
}

function segmentLabel(segment: Segment) {
  return SEGMENTS.find((item) => item.key === segment)?.label ?? 'Directorio comunal';
}

function directoryHint(segment: Segment) {
  if (segment === 'UNIVERSE') return 'Mayor universo territorial identificable por RUT con comuna disponible. El directorio se pagina en servidor y sólo materializa Entidad 360 cuando Atlas ya dispone de una ficha analítica.';
  if (segment === 'POTENTIAL') return 'Candidatos construidos desde evidencia registral y actividad económica. IVO ordena revisión y no acredita obligación.';
  if (segment === 'SO') return 'Sujetos obligados observados en el padrón UAF y domiciliados en la comuna.';
  if (segment === 'SANCTIONED') return 'Entidades de la comuna con evidencia sancionatoria resuelta a su identidad.';
  if (segment === 'PRESS') return 'Entidades con identidad resuelta en el monitor de prensa; la mención no acredita conducta.';
  if (segment === 'OSFL') return 'Entidades reconocidas como OSFL en las fuentes integradas por ATLAS.';
  if (segment === 'FINTECH') return 'Entidades del ecosistema fintech con presencia comunal resuelta en fuentes abiertas.';
  return 'Entidades que Atlas ya materializó analíticamente. Mantienen señales, prioridades y acceso directo a Entidad 360.';
}

function layerDescription(index: number) {
  if (index === 0) return 'Economías ilícitas y facilitadores observados en la estructura territorial.';
  if (index === 1) return 'Delitos base con vínculo directo a la presión criminógena considerada por el índice.';
  return 'Condiciones del entorno que acompañan o sostienen la presión criminógena comunal.';
}

function anomalyLevel(value: number) {
  if (value >= 80) return 'high';
  if (value >= 60) return 'medium';
  return 'watch';
}

function anomalyLabel(value: number) {
  if (value >= 80) return 'Alta';
  if (value >= 60) return 'Media';
  return 'Atención';
}

function trendLabel(value: number) {
  if (value >= 60) return 'tendencia elevada';
  if (value >= 40) return 'tendencia media';
  return 'tendencia contenida';
}
