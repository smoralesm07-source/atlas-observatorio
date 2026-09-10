import { useEffect, useMemo, useState } from 'react';
import type { TerritoryDetail } from '../lib/contracts';
import { useDebounced, useRpc } from '../lib/rpc';
import { hrefFor } from '../lib/router';
import { n, n1, rutFormat, titleCase } from '../lib/format';
import '../styles/territory-commune-workspace.css';

const PAGE = 80;

type Segment = 'ALL' | 'SO' | 'POTENTIAL' | 'SANCTIONED' | 'PRESS' | 'OSFL' | 'FINTECH';
type SortMode = 'relevance' | 'score' | 'signals' | 'name';

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
  semantics: string;
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
  uaf_sanction_events: number;
  flags: string[] | null;
  total_count: number;
};

const SEGMENTS: { key: Segment; label: string; helper: string }[] = [
  { key: 'ALL', label: 'Entidades', helper: 'universo observado' },
  { key: 'SO', label: 'SO UAF', helper: 'inscritos en la comuna' },
  { key: 'POTENTIAL', label: 'Potenciales SO', helper: 'candidatos por giro' },
  { key: 'SANCTIONED', label: 'Con sanción', helper: 'evidencia sancionatoria' },
  { key: 'PRESS', label: 'Con prensa', helper: 'identidad resuelta' },
  { key: 'OSFL', label: 'OSFL', helper: 'reconocidas en fuentes' },
  { key: 'FINTECH', label: 'Fintech', helper: 'ecosistema identificado' },
];

const levelStep = (level: string | null | undefined) => {
  const map: Record<string, number> = { 'Muy bajo': 1, Bajo: 2, Moderado: 2, Medio: 3, Alto: 4, 'Muy alto': 5 };
  return map[level ?? ''] ?? 1;
};

const scoreStep = (value: number) => (value >= 80 ? 5 : value >= 60 ? 4 : value >= 40 ? 3 : value >= 20 ? 2 : 1);

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
  const [selectedLayer, setSelectedLayer] = useState<string | null>(layers[0]?.[0] ?? null);
  const [segment, setSegment] = useState<Segment>('ALL');
  const [sector, setSector] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounced(query, 220);
  const [sort, setSort] = useState<SortMode>('relevance');
  const [page, setPage] = useState(0);

  const context = useRpc<CommuneContext | null>('obs_territory_commune_context_v2', {
    p_territory_id: t.territory_id,
  });

  const entityDirectory = useRpc<CommuneEntity[]>('obs_territory_entity_directory_v2', {
    p_territory_id: t.territory_id,
    p_segment: segment,
    p_q: debouncedQuery.trim() || null,
    p_sector: sector,
    p_order: sort,
    p_limit: PAGE,
    p_offset: page * PAGE,
  }, { skip: segment === 'POTENTIAL' });

  const potentialDirectory = useRpc<CommunePotential[]>('obs_territory_potential_directory_v2', {
    p_territory_id: t.territory_id,
    p_q: debouncedQuery.trim() || null,
    p_sector: sector,
    p_order: sort,
    p_limit: PAGE,
    p_offset: page * PAGE,
  }, { skip: segment !== 'POTENTIAL' });

  useEffect(() => setPage(0), [segment, sector, debouncedQuery, sort]);

  const drivers = useMemo(() => layers.flatMap(([layerKey, layer]) =>
    (layer.components ?? []).map((component) => ({
      layerKey,
      layerLabel: layer.label,
      component,
    })),
  ).sort((a, b) => Number(b.component.score ?? 0) - Number(a.component.score ?? 0)).slice(0, 5), [layers]);

  const metrics = context.data?.metrics;
  const activeRows = segment === 'POTENTIAL' ? (potentialDirectory.data ?? []) : (entityDirectory.data ?? []);
  const activeRpc = segment === 'POTENTIAL' ? potentialDirectory : entityDirectory;
  const total = activeRows[0]?.total_count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE));
  const start = total ? page * PAGE + 1 : 0;
  const end = Math.min(total, (page + 1) * PAGE);
  const selectedLayerData = selectedLayer ? t.layers?.[selectedLayer] : null;

  const metricFor = (key: Segment) => {
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
    setPage(0);
  };

  return (
    <div className="fade-in territory-commune-workspace">
      <nav className="tcw-back">
        <button type="button" onClick={onBack}>← Territorio</button>
      </nav>

      <header className="tcw-hero">
        <div className="tcw-hero-copy">
          <div className="tcw-eyebrow">Lectura comunal · {t.region_name}</div>
          <h1>{t.commune_name}</h1>
          <div className="tcw-meta">
            {t.commune_code && <span className="mono">CUT {t.commune_code}</span>}
            <span>año {t.year ?? '—'}</span>
            <span>posición regional {n(p.posicion_en_region)} de {n(p.comunas_region)}</span>
          </div>
          {t.interpretation && <p>{t.interpretation}</p>}
        </div>

        <div className="tcw-scoreboard" aria-label="Síntesis IGR de la comuna">
          <div className="tcw-score-main" style={{ ['--tcw-score' as string]: `var(--igr-${levelStep(t.igr_level)})` }}>
            <span>IGR</span>
            <strong className="num">{n1(t.igr_score)}</strong>
            <small>{t.igr_level ?? 'sin banda'}</small>
          </div>
          <div className="tcw-score-item">
            <span>Percentil nacional</span>
            <strong className="num">{t.igr_percentile == null ? '—' : `P${n1(t.igr_percentile)}`}</strong>
            <small>{n(p.posicion_nacional)} de {n(p.comunas_pais)}</small>
          </div>
          <div className="tcw-score-item">
            <span>Confianza</span>
            <strong className="num">{t.igr_confidence == null ? '—' : `${n1(t.igr_confidence)}%`}</strong>
            <small>{t.igr_confidence_level ?? 'robustez no clasificada'}</small>
          </div>
        </div>
      </header>

      <section className="tcw-section" aria-labelledby="tcw-igr-title">
        <div className="tcw-section-head">
          <div>
            <span className="tcw-kicker">Qué explica el territorio</span>
            <h2 id="tcw-igr-title">IGR en una mirada</h2>
            <p>Las capas resumen la evidencia CEAD. El detalle técnico queda disponible bajo demanda y deja de dominar la pantalla.</p>
          </div>
          <div className="tcw-coverage">
            <span>Cobertura metodológica</span>
            <strong className="num">{t.igr_methodological_coverage == null ? '—' : `${n1(t.igr_methodological_coverage)}%`}</strong>
          </div>
        </div>

        <div className="tcw-igr-grid">
          <div className="tcw-layer-strip" role="list" aria-label="Capas del IGR">
            {layers.map(([key, layer]) => {
              const score = Number(layer.score ?? 0);
              const active = selectedLayer === key;
              return (
                <button
                  type="button"
                  className="tcw-layer-card"
                  data-active={active}
                  key={key}
                  onClick={() => setSelectedLayer(active ? null : key)}
                >
                  <div className="tcw-layer-title"><span>{layer.label}</span><strong className="num">{n1(score)}</strong></div>
                  <div className="tcw-layer-bar"><i style={{ width: `${Math.max(0, Math.min(100, score))}%`, background: `var(--igr-${scoreStep(score)})` }} /></div>
                  <div className="tcw-layer-foot">
                    <span>peso {n1(layer.configured_weight * 100)}%</span>
                    <span>cobertura {n1(layer.coverage * 100)}%</span>
                    <b>{active ? 'Ocultar detalle' : 'Profundizar →'}</b>
                  </div>
                </button>
              );
            })}
          </div>

          <aside className="tcw-drivers">
            <div className="tcw-card-head">
              <div><span className="tcw-kicker">Componentes</span><h3>Principales impulsores</h3></div>
              <small>ordenados por puntaje</small>
            </div>
            <div className="tcw-driver-list">
              {drivers.map(({ layerKey, layerLabel, component }, index) => (
                <button type="button" key={`${layerKey}-${component.id}`} onClick={() => setSelectedLayer(layerKey)}>
                  <span className="tcw-driver-rank">{index + 1}</span>
                  <span className="tcw-driver-name"><b>{titleCase(component.label)}</b><small>{layerLabel}</small></span>
                  <strong className="num">{n1(component.score)}</strong>
                </button>
              ))}
            </div>
          </aside>
        </div>

        {selectedLayerData && (
          <div className="tcw-layer-detail">
            <div className="tcw-layer-detail-head">
              <div>
                <span className="tcw-kicker">Diagnóstico técnico</span>
                <h3>{selectedLayerData.label}</h3>
              </div>
              <button type="button" onClick={() => setSelectedLayer(null)}>Cerrar ×</button>
            </div>
            <div className="tcw-layer-table-wrap">
              <table className="tcw-layer-table">
                <thead><tr>
                  <th>Componente</th><th>Puntaje</th><th>Intensidad</th><th>Persistencia</th><th>Tendencia</th><th>Anomalía</th><th>Años</th>
                </tr></thead>
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

      <section className="tcw-section tcw-ecosystem" aria-labelledby="tcw-ecosystem-title">
        <div className="tcw-section-head">
          <div>
            <span className="tcw-kicker">Quiénes están aquí</span>
            <h2 id="tcw-ecosystem-title">Ecosistema observado en {t.commune_name}</h2>
            <p>Selecciona una cohorte o una industria de la Ley 19.913 y el directorio se actualiza sin salir de la comuna.</p>
          </div>
          <div className="tcw-context-note">Contexto independiente del IGR</div>
        </div>

        {context.error ? (
          <div className="tcw-state">No fue posible cargar la caracterización comunal. <button type="button" onClick={context.reload}>Reintentar</button></div>
        ) : (
          <div className="tcw-segment-grid">
            {SEGMENTS.map((item) => (
              <button
                type="button"
                key={item.key}
                className="tcw-segment"
                data-active={segment === item.key}
                onClick={() => chooseSegment(item.key)}
              >
                <span>{item.label}</span>
                <strong className="num">{context.loading && !metrics ? '…' : n(metricFor(item.key))}</strong>
                <small>{item.helper}</small>
              </button>
            ))}
          </div>
        )}

        <div className="tcw-sector-block">
          <div className="tcw-sector-head">
            <div><span className="tcw-kicker">Cruce sectorial</span><h3>Industrias / sectores Ley 19.913</h3></div>
            {sector && <button type="button" className="tcw-clear" onClick={() => setSector(null)}>Quitar filtro ×</button>}
          </div>
          {!context.data?.sectors?.length ? (
            <div className="tcw-sector-empty">Sin sectores UAF observados en este corte comunal.</div>
          ) : (
            <div className="tcw-sector-rail">
              {context.data.sectors.map((item) => {
                const active = sector === item.sector;
                const max = Math.max(...context.data!.sectors.map((x) => x.total_count), 1);
                return (
                  <button type="button" key={item.sector} data-active={active} onClick={() => setSector(active ? null : item.sector)}>
                    <span className="tcw-sector-name">{titleCase(item.sector)}</span>
                    <span className="tcw-sector-count num">{n(item.total_count)}</span>
                    <span className="tcw-sector-mini"><i style={{ width: `${Math.max(8, (item.total_count / max) * 100)}%` }} /></span>
                    <small>{n(item.so_count)} SO · {n(item.potential_count)} potenciales</small>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="tcw-directory">
          <div className="tcw-directory-head">
            <div>
              <span className="tcw-kicker">Directorio comunal</span>
              <h3>{segmentLabel(segment)}{sector ? ` · ${titleCase(sector)}` : ''}</h3>
              <p>{directoryHint(segment)}</p>
            </div>
            <div className="tcw-directory-total">
              <strong className="num">{activeRpc.loading && !activeRpc.data ? '…' : n(total)}</strong>
              <small>entidades del corte exacto</small>
            </div>
          </div>

          <div className="tcw-directory-tools">
            <label className="tcw-search">
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar nombre, RUT, sector, actividad o industria…"
                aria-label="Buscar en directorio comunal"
              />
              {query && <button type="button" onClick={() => setQuery('')} aria-label="Limpiar búsqueda">×</button>}
            </label>
            <div className="tcw-sort" aria-label="Orden del directorio">
              <button type="button" data-active={sort === 'relevance'} onClick={() => setSort('relevance')}>Relevancia</button>
              <button type="button" data-active={sort === 'score'} onClick={() => setSort('score')}>{segment === 'POTENTIAL' ? 'IVO' : 'Prioridad'}</button>
              <button type="button" data-active={sort === 'signals'} onClick={() => setSort('signals')}>Señales</button>
              <button type="button" data-active={sort === 'name'} onClick={() => setSort('name')}>Nombre</button>
            </div>
          </div>

          {activeRpc.error ? (
            <div className="tcw-state">El directorio no pudo cargar este corte. <button type="button" onClick={activeRpc.reload}>Reintentar</button></div>
          ) : activeRpc.loading && !activeRpc.data ? (
            <div className="tcw-state">Leyendo el directorio comunal…</div>
          ) : !activeRows.length ? (
            <div className="tcw-state tcw-state-empty">No hay entidades que coincidan con esta selección.</div>
          ) : segment === 'POTENTIAL' ? (
            <PotentialTable rows={potentialDirectory.data ?? []} onNavigate={onNavigate} />
          ) : (
            <EntityTable rows={entityDirectory.data ?? []} onNavigate={onNavigate} />
          )}

          <footer className="tcw-directory-foot">
            <span><b>{n(start)}–{n(end)}</b> de <b>{n(total)}</b></span>
            <div className="tcw-pages">
              <button type="button" disabled={page === 0 || activeRpc.loading} onClick={() => setPage((value) => Math.max(0, value - 1))}>← Anterior</button>
              <span>{page + 1} / {totalPages}</span>
              <button type="button" disabled={page + 1 >= totalPages || activeRpc.loading} onClick={() => setPage((value) => Math.min(totalPages - 1, value + 1))}>Siguiente →</button>
            </div>
            <span className="tcw-directory-semantic">La ubicación y las marcas no atribuyen riesgo individual.</span>
          </footer>
        </div>
      </section>

      <div className="tcw-semantic">
        <strong>Lectura correcta.</strong> El IGR caracteriza amenaza territorial. SO, potenciales, sanciones, prensa, OSFL y fintech son capas de contexto que se navegan aparte y nunca modifican el puntaje comunal.
      </div>
    </div>
  );
}

function EntityTable({ rows, onNavigate }: { rows: CommuneEntity[]; onNavigate: (hash: string) => void }) {
  return (
    <div className="tcw-table-scroll">
      <table className="tcw-entity-table">
        <thead><tr>
          <th>Entidad</th><th>Sector Ley 19.913</th><th>Situación / actividad</th><th>Marcas</th><th>Prioridad</th><th>Acción</th>
        </tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.entity_id}>
              <td className="tcw-entity-name">
                <b>{titleCase(row.name)}</b>
                <span>{row.rut ? rutFormat(row.rut) : 'sin RUT'} · {row.entity_type ? titleCase(row.entity_type) : 'tipo no observado'}</span>
              </td>
              <td>
                <b>{row.uaf_sector ? titleCase(row.uaf_sector) : row.potential_sector ? titleCase(row.potential_sector) : 'Sin sector observado'}</b>
                {row.fintech_vertical && <span className="tcw-secondary">Fintech · {titleCase(row.fintech_vertical)}</span>}
                {row.economic_sector && <span className="tcw-secondary">SII · {titleCase(row.economic_sector)}</span>}
              </td>
              <td>
                <State status={row.sii_status} />
                <span className="tcw-secondary">{row.main_activity ? titleCase(row.main_activity) : 'sin actividad principal observada'}</span>
                {row.sii_termination_date && <span className="tcw-secondary">Término {row.sii_termination_date.slice(0, 10)}</span>}
              </td>
              <td><Signals row={row} /></td>
              <td className="tcw-priority">
                <strong className="num">{row.priority_score == null ? '—' : n1(row.priority_score)}</strong>
                <small>{row.priority_metric ?? 'IPA'}{row.priority_band ? ` · ${titleCase(row.priority_band.replace(/_/g, ' '))}` : ''}</small>
              </td>
              <td>
                <button type="button" className="tcw-open" onClick={() => onNavigate(hrefFor({ view: 'ficha', entityId: row.entity_id }))}>Entidad 360 →</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PotentialTable({ rows, onNavigate }: { rows: CommunePotential[]; onNavigate: (hash: string) => void }) {
  return (
    <div className="tcw-table-scroll">
      <table className="tcw-entity-table">
        <thead><tr>
          <th>Entidad</th><th>Sector sugerido</th><th>Industria / evidencia</th><th>Caracterización</th><th>IVO</th><th>Acción</th>
        </tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.rut}>
              <td className="tcw-entity-name"><b>{titleCase(row.name)}</b><span>{rutFormat(row.rut)} · {row.sales_band_size ?? row.sales_band_uf ?? 'escala no observada'}</span></td>
              <td><b>{row.implied_sector ? titleCase(row.implied_sector) : 'sin sector sugerido'}</b><span className="tcw-secondary">{row.detection_tier ?? row.evidence_class ?? 'conciliación por giro'}</span></td>
              <td><b>{row.economic_sector ? titleCase(row.economic_sector) : 'sin industria SII observada'}</b><span className="tcw-secondary">{row.matched_activity ? titleCase(row.matched_activity) : 'sin actividad gatillante'}</span></td>
              <td><PotentialSignals row={row} /></td>
              <td className="tcw-priority"><strong className="num">{row.ivo_score == null ? '—' : n1(row.ivo_score)}</strong><small>{row.ivo_band ? titleCase(row.ivo_band.replace(/_/g, ' ')) : 'sin banda'}</small></td>
              <td>{row.entity_id ? <button type="button" className="tcw-open" onClick={() => onNavigate(hrefFor({ view: 'ficha', entityId: row.entity_id! }))}>Entidad 360 →</button> : <span className="tcw-secondary">sin ficha 360</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Signals({ row }: { row: CommuneEntity }) {
  const hasAny = row.is_uaf_observed || row.is_potential || row.is_osfl || row.is_fintech || row.is_state_supplier
    || row.sanction_count > 0 || row.press_evidence_count > 0 || row.alert_count > 0 || row.finding_count > 0;
  if (!hasAny) return <span className="tcw-secondary">sin marca en estos cruces</span>;
  return (
    <div className="tcw-signals">
      {row.is_uaf_observed && <span data-kind="uaf">SO UAF</span>}
      {row.is_potential && <span data-kind="potential">Potencial SO</span>}
      {row.sanction_count > 0 && <span data-kind="sanction">Sanción · {n(row.sanction_count)}</span>}
      {row.press_evidence_count > 0 && <span data-kind="press">Prensa · {n(row.press_evidence_count)}</span>}
      {row.is_osfl && <span data-kind="osfl">OSFL</span>}
      {row.is_fintech && <span data-kind="fintech">Fintech</span>}
      {row.is_state_supplier && <span data-kind="supplier">Proveedor Estado</span>}
      {row.alert_count > 0 && <span data-kind="alert">Señal · {n(row.alert_count)}</span>}
      {row.finding_count > 0 && <span data-kind="finding">Hallazgo · {n(row.finding_count)}</span>}
    </div>
  );
}

function PotentialSignals({ row }: { row: CommunePotential }) {
  const flags = row.flags ?? [];
  if (!row.res_available && row.uaf_sanction_events <= 0 && flags.length === 0) return <span className="tcw-secondary">sin marca adicional</span>;
  return (
    <div className="tcw-signals">
      {row.res_available && <span data-kind="res">RES</span>}
      {row.uaf_sanction_events > 0 && <span data-kind="sanction">Sanción UAF · {n(row.uaf_sanction_events)}</span>}
      {flags.slice(0, 3).map((flag) => <span key={flag} data-kind="potential">{titleCase(flag.replace(/_/g, ' '))}</span>)}
    </div>
  );
}

function State({ status }: { status: string | null }) {
  const normalized = status ?? '';
  const label = normalized === 'ACTIVE_AS_PUBLISHED' ? 'Activo ante SII'
    : normalized === 'TERMINATED_AS_PUBLISHED' ? 'Término de giro'
      : normalized === 'SIN_PERFIL_SII' ? 'Sin perfil SII'
        : normalized ? titleCase(normalized.replace(/_/g, ' ')) : 'Estado no observado';
  const kind = normalized === 'ACTIVE_AS_PUBLISHED' ? 'active' : normalized === 'TERMINATED_AS_PUBLISHED' ? 'terminated' : 'unknown';
  return <span className="tcw-state-pill" data-kind={kind}><i />{label}</span>;
}

function segmentLabel(segment: Segment) {
  return SEGMENTS.find((item) => item.key === segment)?.label ?? 'Entidades';
}

function directoryHint(segment: Segment) {
  if (segment === 'SO') return 'Padrón inscrito UAF con actividad, situación tributaria, marcas y prioridad.';
  if (segment === 'POTENTIAL') return 'Candidatos no inscritos detectados por giro y evidencia abierta/tributaria disponible.';
  if (segment === 'SANCTIONED') return 'Entidades domiciliadas con evidencia sancionatoria propia.';
  if (segment === 'PRESS') return 'Entidades con identidad resuelta contra el historial de prensa; una mención no acredita conducta.';
  if (segment === 'OSFL') return 'Organizaciones sin fines de lucro reconocidas por las fuentes integradas.';
  if (segment === 'FINTECH') return 'Actores del ecosistema fintech identificados y vinculados territorialmente.';
  return 'Universo de entidades reconocidas en la comuna, sin límite artificial de 40 registros.';
}
