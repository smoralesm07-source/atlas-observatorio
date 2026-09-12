import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDebounced, useRpc } from '../lib/rpc';
import { hrefFor } from '../lib/router';
import {
  looksLikePersonName,
  screenWatchlists,
  type WatchlistResult,
} from '../lib/connectors';
import { Empty, ErrorBox, Loading, Semantics } from '../components/primitives';
import { WatchlistResults } from '../components/Watchlists';
import { IdentidadDigital } from '../components/IdentidadDigital';
import { PressMatches } from '../components/PressMatches';
import { normalizePressText, searchPress, type PressMatch } from '../lib/press';
import { n } from '../lib/format';
import '../styles/entities-potential-so.css';

const PAGE = 20;

const REGIONS = [
  'Metropolitana de Santiago', 'Valparaíso', 'Biobío', 'Maule', 'La Araucanía',
  'Libertador General Bernardo O’Higgins', 'Los Lagos', 'Coquimbo', 'Antofagasta',
  'Ñuble', 'Los Ríos', 'Tarapacá', 'Atacama', 'Arica y Parinacota', 'Magallanes',
  'Aysén',
];

const ENTITY_TYPES = [
  'Persona jurídica',
  'Persona natural',
  'OSFL',
  'Organismo público',
];

type ViewMode = 'results' | 'international' | 'digital';
type AsyncStatus = 'idle' | 'loading' | 'done' | 'error';

interface SourceHealth {
  source_code: string;
  source_name?: string;
  integration_mode?: string;
  software_status?: string;
  data_status?: string;
  scope_partial?: boolean;
  last_source_record_at?: string | null;
  last_successful_ingest_at?: string | null;
}

interface SourceHit {
  source_code: string;
  source_label?: string;
  cascade_order?: number;
  matched_label?: string;
  registry_class?: string | null;
  match_type?: string;
  match_score?: number;
  match_pct?: number;
  identity_linked?: boolean;
  context?: Record<string, unknown> | null;
}

interface EntitySearchItem {
  entity_id: string;
  rut?: string | null;
  name: string;
  entity_type?: string | null;
  region?: string | null;
  commune?: string | null;
  source_count?: number | null;
  sources?: string[];
  roles?: string[];
  openable?: boolean;
  is_uaf_observed?: boolean;
  is_sanctioned?: boolean;
  is_uaf_registered?: boolean;
  is_potential_screening?: boolean;
  uaf_universe_status?: string | null;
  management_bucket?: string | null;
  potential_uaf_sector?: string | null;
  uaf_status_basis?: string | null;
  uaf_status_refreshed_at?: string | null;
  match_source?: string;
  match_type?: string;
  match_score?: number | null;
  match_score_pct?: number | null;
  match_score_semantics?: string;
  matched_label?: string;
  source_code?: string;
  source_label?: string;
  source_hit_count?: number;
  source_hits?: SourceHit[];
  query_sources?: string[];
  cascade_order?: number;
  cascade_stage?: string;
  cascade_rank?: number;
  result_tier?: string;
  tier_priority?: number;
  identity_assertion?: boolean;
  identity_confidence?: number | null;
  event_count?: number | null;
  ipa3_score?: number | null;
  priority_band_shadow?: string | null;
  coverage_index_pct?: number | null;
}

interface EntitySearchResponse {
  schema?: string;
  kind?: string;
  generated_at?: string;
  items?: EntitySearchItem[];
  page?: {
    limit?: number;
    offset?: number;
    returned?: number;
    total?: number;
  };
  facets?: {
    quick_counts?: QuickCounts;
  };
  semantics?: {
    mode?: string;
    cascade_order?: string[];
    source_health?: SourceHealth[];
    query_match_percentage_is_not_identity_probability?: boolean;
    international_screening_is_on_demand?: boolean;
  };
}

interface QuickCounts {
  total?: number;
  uaf?: number;
  sanctioned?: number;
  uaf_and_sanctioned?: number;
  multi_source_3?: number;
  osfl?: number;
  public_bodies?: number;
}

interface PressState {
  status: AsyncStatus;
  matches: PressMatch[];
  error?: string;
}

interface WatchState {
  status: AsyncStatus;
  result?: WatchlistResult;
  error?: string;
  auto?: boolean;
}

interface CascadeStage {
  code: string;
  label: string;
  short: string;
}

const CASCADE: CascadeStage[] = [
  { code: 'RADAR_UAF', label: 'Padrón UAF', short: 'UAF' },
  { code: 'RADAR_SII', label: 'Padrón SII', short: 'SII' },
  { code: 'RES', label: 'Registro Empresas y Sociedades', short: 'RES' },
  { code: 'CANONICAL', label: 'Identidad reconciliada Atlas', short: 'Atlas' },
  { code: 'RADAR_OSFL', label: 'Radar OSFL', short: 'OSFL' },
  { code: 'RADAR_SANCIONES', label: 'Radar Sanciones', short: 'Sanciones' },
  { code: 'MERCADO_PUBLICO', label: 'Mercado Público', short: 'Gasto' },
  { code: 'FINTECH', label: 'Radar Fintech', short: 'Fintech' },
  { code: 'RADAR_PRENSA', label: 'Radar Prensa', short: 'Prensa' },
  { code: 'INTERNATIONAL_WATCHLISTS', label: 'Listas internacionales', short: 'Listas' },
];

const SOURCE_LABEL: Record<string, string> = {
  RADAR_UAF: 'Padrón UAF',
  RADAR_SII: 'Padrón SII',
  RES: 'RES',
  CANONICAL: 'Atlas',
  RADAR_OSFL: 'OSFL',
  RADAR_SANCIONES: 'Sanciones',
  MERCADO_PUBLICO: 'Mercado Público',
  PRESUPUESTO_ABIERTO: 'Presupuesto Abierto',
  FINTECH: 'Fintech',
  RADAR_PRENSA: 'Prensa',
  DIGITAL_IDENTITY: 'Identidad digital',
};

export function Entidades({
  initialQuery,
  initialRegion,
  onNavigate,
}: {
  initialQuery?: string;
  initialRegion?: string;
  onNavigate: (hash: string) => void;
}) {
  const [q, setQ] = useState(initialQuery ?? '');
  const [region, setRegion] = useState<string | null>(initialRegion ?? null);
  const [entityType, setEntityType] = useState<string | null>(null);
  const [onlyUaf, setOnlyUaf] = useState(false);
  const [onlySanctioned, setOnlySanctioned] = useState(false);
  const [multiSource, setMultiSource] = useState(false);
  const [page, setPage] = useState(0);
  const [mode, setMode] = useState<ViewMode>('results');
  const [press, setPress] = useState<PressState>({ status: 'idle', matches: [] });
  const [watch, setWatch] = useState<WatchState>({ status: 'idle' });
  const [digitalQuery, setDigitalQuery] = useState<string | null>(null);
  const [digitalDone, setDigitalDone] = useState(false);

  const debounced = useDebounced(q, 260);
  const search = debounced.trim();
  const hasQuery = search.length >= 2;
  const hasFilters = Boolean(region || entityType || onlyUaf || onlySanctioned || multiSource);
  const isPerson = looksLikePersonName(search);
  const looksRut = /^[0-9.\-kK]+$/.test(search) && search.replace(/[^0-9kK]/gi, '').length >= 7;

  useEffect(() => {
    setPage(0);
  }, [search, region, entityType, onlyUaf, onlySanctioned, multiSource]);

  useEffect(() => {
    setWatch({ status: 'idle' });
    setDigitalQuery(null);
    setDigitalDone(false);
    setMode('results');
  }, [search]);

  useEffect(() => {
    const target = hrefFor({
      view: 'entidades',
      q: search || undefined,
      region: region ?? undefined,
    });
    if (window.location.hash !== target) window.history.replaceState(null, '', target);
  }, [search, region]);

  const cascadeRequest = useMemo(() => ({
    kind: 'results',
    search,
    limit: PAGE,
    offset: page * PAGE,
    region: region ?? '',
    entity_type: entityType ?? '',
    uaf: onlyUaf,
    sanctioned: onlySanctioned,
    min_sources: multiSource ? 3 : 0,
  }), [search, page, region, entityType, onlyUaf, onlySanctioned, multiSource]);

  const cascade = useRpc<EntitySearchResponse>(
    'atlas_v2_entity_search_cascade',
    { p_request: cascadeRequest },
    { skip: !hasQuery },
  );

  const explorerRequest = useMemo(() => ({
    kind: 'explorer',
    limit: PAGE,
    offset: page * PAGE,
    region: region ?? '',
    entity_type: entityType ?? '',
    uaf: onlyUaf,
    sanctioned: onlySanctioned,
    min_sources: multiSource ? 3 : 0,
    sort: 'coverage',
  }), [page, region, entityType, onlyUaf, onlySanctioned, multiSource]);

  const explorer = useRpc<EntitySearchResponse>(
    'atlas_v2_entity_search',
    { p_request: explorerRequest },
    { skip: hasQuery || !hasFilters },
  );

  const meta = useRpc<EntitySearchResponse>(
    'atlas_v2_entity_search',
    { p_request: { kind: 'explorer_meta' } },
  );

  useEffect(() => {
    let cancelled = false;
    if (!hasQuery || search.length < 3) {
      setPress({ status: 'idle', matches: [] });
      return () => { cancelled = true; };
    }

    setPress((current) => ({ status: 'loading', matches: current.matches }));
    void searchPress(search, 12)
      .then((matches) => {
        if (!cancelled) setPress({ status: 'done', matches });
      })
      .catch((e) => {
        if (!cancelled) setPress({ status: 'error', matches: [], error: (e as Error).message });
      });

    return () => { cancelled = true; };
  }, [hasQuery, search]);

  const runWatchlists = useCallback(async (auto: boolean) => {
    if (!hasQuery) return;
    setWatch({ status: 'loading', auto });
    if (auto) setMode('international');
    try {
      const result = await screenWatchlists({
        name: looksRut ? '' : search,
        rut: looksRut ? search : null,
      });
      setWatch({ status: 'done', result, auto });
    } catch (e) {
      setWatch({ status: 'error', error: (e as Error).message, auto });
    }
  }, [hasQuery, looksRut, search]);

  const localItems = hasQuery
    ? (cascade.data?.items ?? [])
    : hasFilters
      ? (explorer.data?.items ?? [])
      : [];
  const localTotal = hasQuery
    ? Number(cascade.data?.page?.total ?? localItems.length)
    : hasFilters
      ? Number(explorer.data?.page?.total ?? localItems.length)
      : 0;
  const localLoading = hasQuery ? cascade.loading : hasFilters ? explorer.loading : false;
  const localError = hasQuery ? cascade.error : hasFilters ? explorer.error : null;
  const reloadLocal = hasQuery ? cascade.reload : explorer.reload;

  const standalonePressCount = useMemo(() => {
    if (press.status !== 'done') return 0;
    return press.matches.filter((match) => !pressAlreadyRepresented(match, localItems)).length;
  }, [localItems, press]);

  const visibleTotal = localTotal + standalonePressCount;
  const pressHits = press.matches.length;
  const externalHits = watch.result
    ? Object.values(watch.result.sources).reduce((acc, source) => acc + (source.records?.length ?? 0), 0)
    : 0;

  useEffect(() => {
    if (!hasQuery || cascade.loading || cascade.error || !cascade.data) return;
    if (press.status === 'idle' || press.status === 'loading') return;
    if (localTotal > 0 || pressHits > 0 || watch.status !== 'idle') return;
    void runWatchlists(true);
  }, [hasQuery, cascade.loading, cascade.error, cascade.data, press.status, localTotal, pressHits, watch.status, runWatchlists]);

  const pages = Math.max(1, Math.ceil(localTotal / PAGE));
  const quick = meta.data?.facets?.quick_counts ?? {};

  const clearFilters = () => {
    setRegion(null);
    setEntityType(null);
    setOnlyUaf(false);
    setOnlySanctioned(false);
    setMultiSource(false);
  };

  return (
    <div className="entity-search-view fade-in">
      <header className="entity-search-head">
        <div>
          <div className="entity-search-eyebrow">ENTIDADES · RESOLUCIÓN FEDERADA</div>
          <h1>Explorador de entidades</h1>
          <p>
            Busca por nombre, razón social o RUT. Atlas recorre los padrones en cascada,
            consolida coincidencias por entidad y explica de dónde viene cada resultado.
          </p>
        </div>
        <div className="entity-search-legend">
          <span><i className="entity-dot exact" /> exacta</span>
          <span><i className="entity-dot strong" /> alta</span>
          <span><i className="entity-dot review" /> revisar</span>
        </div>
      </header>

      <section className="entity-search-console" aria-label="Buscador de entidades">
        <div className="entity-search-box-row">
          <div className="entity-search-box">
            <SearchIcon />
            <input
              id="obs-search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Nombre, razón social o RUT…"
              autoComplete="off"
              spellCheck={false}
              autoFocus
              aria-label="Buscar entidad"
            />
            {q && (
              <button className="entity-clear" onClick={() => setQ('')} title="Limpiar búsqueda" aria-label="Limpiar búsqueda">
                ×
              </button>
            )}
            <span className="entity-key">/</span>
          </div>
          <button className="entity-search-button" onClick={() => document.getElementById('obs-search')?.focus()}>
            Buscar
          </button>
        </div>

        <div className="entity-filters">
          <select value={region ?? ''} onChange={(e) => setRegion(e.target.value || null)}>
            <option value="">Todo el territorio</option>
            {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>

          <select value={entityType ?? ''} onChange={(e) => setEntityType(e.target.value || null)}>
            <option value="">Todo tipo</option>
            {ENTITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>

          <button data-on={onlyUaf} onClick={() => setOnlyUaf((v) => !v)}>Padrón UAF</button>
          <button data-on={onlySanctioned} onClick={() => setOnlySanctioned((v) => !v)}>Con sanciones</button>
          <button data-on={multiSource} onClick={() => setMultiSource((v) => !v)}>3+ fuentes</button>

          {hasFilters && (
            <button className="entity-filter-clear" onClick={clearFilters}>Limpiar filtros ×</button>
          )}
        </div>

        {!hasQuery && (
          <div className="entity-quick-row">
            <span>Nóminas rápidas</span>
            <QuickChip label="Observadas UAF" value={quick.uaf} active={onlyUaf} onClick={() => setOnlyUaf((v) => !v)} />
            <QuickChip label="Con sanciones" value={quick.sanctioned} active={onlySanctioned} onClick={() => setOnlySanctioned((v) => !v)} />
            <QuickChip label="UAF + sanciones" value={quick.uaf_and_sanctioned} active={onlyUaf && onlySanctioned} onClick={() => { setOnlyUaf(true); setOnlySanctioned(true); }} />
            <QuickChip label="Multi-fuente 3+" value={quick.multi_source_3} active={multiSource} onClick={() => setMultiSource((v) => !v)} />
            <QuickChip label="OSFL" value={quick.osfl} active={entityType === 'OSFL'} onClick={() => setEntityType(entityType === 'OSFL' ? null : 'OSFL')} />
            <QuickChip label="Organismos públicos" value={quick.public_bodies} active={entityType === 'Organismo público'} onClick={() => setEntityType(entityType === 'Organismo público' ? null : 'Organismo público')} />
          </div>
        )}
      </section>

      {hasQuery && (
        <CascadeStrip
          response={cascade.data}
          loading={cascade.loading}
          press={press}
          watch={watch}
        />
      )}

      {hasQuery && (
        <div className="entity-mode-tabs">
          <button data-active={mode === 'results'} onClick={() => setMode('results')}>
            Resultados <span>{localLoading || press.status === 'loading' ? '…' : n(visibleTotal)}</span>
          </button>
          <button
            data-active={mode === 'international'}
            onClick={() => {
              setMode('international');
              if (watch.status === 'idle') void runWatchlists(false);
            }}
          >
            Listas internacionales <span>{watch.status === 'loading' ? '…' : watch.status === 'done' ? n(externalHits) : 'consultar'}</span>
          </button>
          <button
            data-active={mode === 'digital'}
            disabled={!isPerson}
            title={isPerson ? 'Buscar aliases y perfiles públicos' : 'Disponible para nombres de persona'}
            onClick={() => {
              if (!isPerson) return;
              setMode('digital');
              setDigitalQuery(search);
            }}
          >
            Identidad digital <span>{!isPerson ? 'nombre de persona' : digitalDone ? 'consultada' : 'bajo demanda'}</span>
          </button>
        </div>
      )}

      {mode === 'results' && (
        <ResultsPanel
          query={search}
          hasQuery={hasQuery}
          hasFilters={hasFilters}
          items={localItems}
          total={localTotal}
          page={page}
          pages={pages}
          loading={localLoading}
          error={localError}
          onRetry={reloadLocal}
          onPrev={() => setPage((p) => Math.max(0, p - 1))}
          onNext={() => setPage((p) => Math.min(pages - 1, p + 1))}
          onOpen={(entityId) => onNavigate(hrefFor({ view: 'ficha', entityId }))}
          press={press}
          watch={watch}
          onScreen={() => void runWatchlists(false)}
          quick={quick}
        />
      )}

      {mode === 'international' && hasQuery && (
        <section className="entity-secondary-panel fade-in">
          {watch.status === 'loading' && <Loading label="Consultando listas internacionales y fuentes oficiales…" />}
          {watch.status === 'error' && <ErrorBox error={watch.error ?? 'Screening no disponible'} onRetry={() => void runWatchlists(false)} />}
          {watch.status === 'done' && watch.result && <WatchlistResults result={watch.result} query={search} />}
          {watch.status === 'idle' && (
            <div className="entity-screen-prompt">
              <div>
                <h3>Screening internacional bajo demanda</h3>
                <p>Se consulta sólo cuando el analista lo solicita o cuando la cascada local y Radar Prensa terminan sin candidatos.</p>
              </div>
              <button className="entity-primary-action" onClick={() => void runWatchlists(false)}>Consultar ahora</button>
            </div>
          )}
        </section>
      )}

      {mode === 'digital' && digitalQuery && (
        <section className="entity-secondary-panel fade-in">
          <IdentidadDigital query={digitalQuery} onSettled={() => setDigitalDone(true)} />
        </section>
      )}

      <Semantics>
        <strong>Lectura del porcentaje.</strong> El porcentaje mostrado es similitud entre la consulta y el nombre o RUT encontrado en la fuente; no es probabilidad de identidad, culpabilidad ni riesgo. Una coincidencia nominal sigue siendo un candidato y debe corroborarse con RUT, atributos y evidencia original. La prensa aporta contexto y las listas internacionales permanecen como screening bajo demanda.
      </Semantics>
    </div>
  );
}

function ResultsPanel({
  query,
  hasQuery,
  hasFilters,
  items,
  total,
  page,
  pages,
  loading,
  error,
  onRetry,
  onPrev,
  onNext,
  onOpen,
  press,
  watch,
  onScreen,
  quick,
}: {
  query: string;
  hasQuery: boolean;
  hasFilters: boolean;
  items: EntitySearchItem[];
  total: number;
  page: number;
  pages: number;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onPrev: () => void;
  onNext: () => void;
  onOpen: (entityId: string) => void;
  press: PressState;
  watch: WatchState;
  onScreen: () => void;
  quick: QuickCounts;
}) {
  if (!hasQuery && !hasFilters) {
    return <SearchLanding quick={quick} />;
  }

  if (error) {
    return <div className="entity-results-shell"><ErrorBox error={error} onRetry={onRetry} /></div>;
  }

  const pressOnly = hasQuery && press.status === 'done' && press.matches.length > 0 && total === 0;
  const noEverything = hasQuery && !loading && total === 0 && press.status === 'done' && press.matches.length === 0;

  return (
    <section className="entity-results-shell">
      <div className="entity-results-head">
        <div>
          <div className="entity-results-kicker">{hasQuery ? 'Resultados consolidados' : 'Nómina filtrada'}</div>
          <h2>
            {loading ? 'Buscando…' : `${n(total)} ${total === 1 ? 'entidad local' : 'entidades locales'}`}
            {hasQuery && query ? <span> para “{query}”</span> : null}
          </h2>
        </div>
        {hasQuery && watch.status === 'idle' && !noEverything && (
          <button className="entity-ghost-action" onClick={onScreen}>Extender a listas internacionales</button>
        )}
      </div>

      {loading && items.length === 0 && <Loading label="Recorriendo padrones e índices de identidad…" />}

      {items.length > 0 && (
        <div className="entity-result-list" style={{ opacity: loading ? 0.62 : 1 }}>
          {items.map((item, index) => (
            <EntityCandidateCard
              key={`${item.entity_id}|${item.match_source ?? 'explorer'}`}
              item={item}
              rank={page * PAGE + index + 1}
              onOpen={() => onOpen(item.entity_id)}
            />
          ))}
        </div>
      )}

      {total > 0 && pages > 1 && (
        <div className="entity-pagination">
          <button disabled={page === 0} onClick={onPrev}>← Anterior</button>
          <span>Página {page + 1} de {pages}</span>
          <button disabled={page >= pages - 1} onClick={onNext}>Siguiente →</button>
        </div>
      )}

      {press.status === 'error' && hasQuery && (
        <div className="entity-inline-warning">Radar Prensa no pudo completar esta consulta: {press.error}</div>
      )}

      {hasQuery && press.status === 'loading' && (
        <div className="entity-press-loading"><span className="entity-pulse" /> Completando la cascada con Radar Prensa…</div>
      )}

      {hasQuery && press.matches.length > 0 && (
        <div className="entity-press-section">
          <div className="entity-subsection-head">
            <div>
              <span>Contexto abierto</span>
              <h3>{pressOnly ? 'La coincidencia aparece en prensa, pero aún no quedó resuelta a una identidad local' : 'Evidencia coincidente en Radar Prensa'}</h3>
            </div>
            <div className="entity-context-badge">{n(press.matches.length)} coincidencia{press.matches.length === 1 ? '' : 's'}</div>
          </div>
          <PressMatches matches={press.matches} loading={press.status === 'loading'} />
        </div>
      )}

      {noEverything && watch.status === 'loading' && (
        <div className="entity-screen-prompt compact">
          <div>
            <h3>Sin coincidencias locales ni en prensa</h3>
            <p>Atlas continuó automáticamente hacia listas internacionales.</p>
          </div>
          <span className="entity-spinner" aria-hidden />
        </div>
      )}

      {noEverything && watch.status === 'idle' && (
        <Empty
          title="La cascada local no encontró candidatos"
          hint="Se revisaron las fuentes locales y Radar Prensa. Puedes extender la consulta a listas internacionales o probar una variante del nombre/RUT."
        />
      )}
    </section>
  );
}

function SearchLanding({ quick }: { quick: QuickCounts }) {
  return (
    <section className="entity-search-landing">
      <div className="entity-search-orbit" aria-hidden>
        <div className="entity-orbit-core"><SearchIcon /></div>
        <span className="o1">UAF</span>
        <span className="o2">SII</span>
        <span className="o3">RES</span>
        <span className="o4">Prensa</span>
        <span className="o5">Listas</span>
      </div>
      <h2>Busca una identidad o explora una nómina</h2>
      <p>
        El buscador ya no depende sólo del universo materializado de Atlas: consulta padrones
        fuente por fuente y muestra la coincidencia, su porcentaje y la evidencia que la sostiene.
      </p>
      <div className="entity-landing-metrics">
        <Metric value={quick.total} label="entidades reconciliadas" />
        <Metric value={quick.uaf} label="observadas UAF" />
        <Metric value={quick.multi_source_3} label="con 3+ fuentes" />
        <Metric value={quick.sanctioned} label="con sanciones" />
      </div>
      <div className="entity-cascade-preview">
        {CASCADE.map((stage, index) => (
          <div key={stage.code}>
            <span>{index + 1}</span>
            <b>{stage.short}</b>
            {index < CASCADE.length - 1 && <i>→</i>}
          </div>
        ))}
      </div>
    </section>
  );
}

function CascadeStrip({
  response,
  loading,
  press,
  watch,
}: {
  response: EntitySearchResponse | null;
  loading: boolean;
  press: PressState;
  watch: WatchState;
}) {
  const items = response?.items ?? [];
  const hitCounts = new Map<string, number>();
  items.forEach((item) => {
    (item.source_hits ?? []).forEach((hit) => {
      hitCounts.set(hit.source_code, (hitCounts.get(hit.source_code) ?? 0) + 1);
    });
  });

  const health = new Map((response?.semantics?.source_health ?? []).map((row) => [row.source_code, row]));
  const externalHits = watch.result
    ? Object.values(watch.result.sources).reduce((acc, source) => acc + (source.records?.length ?? 0), 0)
    : 0;

  return (
    <section className="entity-cascade-strip" aria-label="Secuencia de fuentes consultadas">
      <div className="entity-cascade-title">
        <span>Cascada de resolución</span>
        <small>primero identidad local; después contexto y screening</small>
      </div>
      <div className="entity-cascade-track">
        {CASCADE.map((stage, index) => {
          const sourceHealth = health.get(stage.code);
          let state: 'idle' | 'loading' | 'hit' | 'miss' | 'watch' = 'idle';
          let value = '';

          if (stage.code === 'RADAR_PRENSA') {
            state = press.status === 'loading' ? 'loading' : press.status === 'done' ? (press.matches.length ? 'hit' : 'miss') : press.status === 'error' ? 'watch' : 'idle';
            value = press.status === 'done' ? n(press.matches.length) : press.status === 'loading' ? '…' : '';
          } else if (stage.code === 'INTERNATIONAL_WATCHLISTS') {
            state = watch.status === 'loading' ? 'loading' : watch.status === 'done' ? (externalHits ? 'hit' : 'miss') : watch.status === 'error' ? 'watch' : 'idle';
            value = watch.status === 'done' ? n(externalHits) : watch.status === 'loading' ? '…' : 'bajo demanda';
          } else {
            const count = hitCounts.get(stage.code) ?? 0;
            if (loading) state = 'loading';
            else if (response) state = count > 0 ? 'hit' : sourceHealth?.software_status === 'healthy' || !sourceHealth ? 'miss' : 'watch';
            value = response ? n(count) : loading ? '…' : '';
          }

          return (
            <div className="entity-cascade-node-wrap" key={stage.code}>
              <div className="entity-cascade-node" data-state={state} title={stage.label}>
                <span className="entity-cascade-step">{index + 1}</span>
                <div>
                  <b>{stage.short}</b>
                  <small>{value}</small>
                </div>
              </div>
              {index < CASCADE.length - 1 && <span className="entity-cascade-arrow">›</span>}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function EntityCandidateCard({
  item,
  rank,
  onOpen,
}: {
  item: EntitySearchItem;
  rank: number;
  onOpen: () => void;
}) {
  const [expanded, setExpanded] = useState(rank === 1 && (item.source_hits?.length ?? 0) > 1);
  const pct = item.match_score_pct ?? (item.match_score != null ? item.match_score * 100 : null);
  const grade = scoreGrade(pct, item.match_type);
  const sourceHits = [...(item.source_hits ?? [])].sort((a, b) => (a.cascade_order ?? 99) - (b.cascade_order ?? 99));
  const sources = item.query_sources?.length ? item.query_sources : item.sources ?? [];
  const explorer = item.result_tier === 'EXPLORER_ENTITY' || pct == null;

  return (
    <article className="entity-candidate-card" data-grade={explorer ? 'explorer' : grade}>
      <div className="entity-candidate-rank">{rank}</div>
      <div className="entity-candidate-main">
        <div className="entity-candidate-top">
          <div className="entity-candidate-identity">
            <div className="entity-candidate-title-row">
              <h3>{item.name || item.matched_label || 'Entidad sin nombre'}</h3>
              {item.is_uaf_observed && <span className="entity-mini-tag uaf">UAF</span>}
              {item.is_potential_screening && item.is_uaf_registered !== true && item.is_uaf_observed !== true && (
                <span
                  className="entity-mini-tag potential-so"
                  title={item.potential_uaf_sector
                    ? `Potencial SO · sector sugerido: ${item.potential_uaf_sector}`
                    : item.uaf_status_basis ?? 'Potencial SO según screening SII ↔ UAF'}
                >
                  Potencial SO
                </span>
              )}
              {item.is_sanctioned && <span className="entity-mini-tag sanction">sanción</span>}
            </div>
            <div className="entity-candidate-meta">
              {item.rut && <span className="mono">{item.rut}</span>}
              {item.entity_type && <span>{item.entity_type}</span>}
              {item.region && <span>{item.region}{item.commune ? ` · ${item.commune}` : ''}</span>}
            </div>
          </div>

          <div className="entity-match-block">
            {explorer ? (
              <>
                <strong>{n(item.source_count ?? sources.length)}</strong>
                <span>fuentes</span>
              </>
            ) : (
              <>
                <strong>{formatPct(pct)}</strong>
                <span>coincidencia</span>
              </>
            )}
          </div>
        </div>

        {!explorer && (
          <div className="entity-match-explanation">
            <span className={`entity-dot ${grade}`} />
            <b>{matchLabel(item.match_type)}</b>
            {item.matched_label && normalizePressText(item.matched_label) !== normalizePressText(item.name) && (
              <span>como “{item.matched_label}”</span>
            )}
            {item.source_label && <span>· primera coincidencia en {item.source_label}</span>}
          </div>
        )}

        <div className="entity-source-ribbon">
          {sources.slice(0, 9).map((source) => (
            <span key={source} data-source={source}>{SOURCE_LABEL[source] ?? source.replace(/^RADAR_/, '')}</span>
          ))}
          {sources.length > 9 && <span>+{sources.length - 9}</span>}
          {item.source_count != null && sources.length === 0 && <span>{n(item.source_count)} fuentes en Atlas</span>}
        </div>

        {sourceHits.length > 0 && (
          <div className="entity-evidence-toggle-wrap">
            <button className="entity-evidence-toggle" onClick={() => setExpanded((v) => !v)}>
              {expanded ? 'Ocultar evidencia' : `Ver por qué coincide · ${sourceHits.length} ${sourceHits.length === 1 ? 'fuente' : 'fuentes'}`}
              <span>{expanded ? '⌃' : '⌄'}</span>
            </button>
          </div>
        )}

        {expanded && sourceHits.length > 0 && (
          <div className="entity-source-evidence-list">
            {sourceHits.map((hit, index) => (
              <SourceEvidenceRow key={`${hit.source_code}|${hit.matched_label ?? index}`} hit={hit} />
            ))}
          </div>
        )}

        <div className="entity-candidate-foot">
          <div className="entity-candidate-signals">
            {item.event_count != null && item.event_count > 0 && <span>{n(item.event_count)} eventos</span>}
            {item.priority_band_shadow && <span>prioridad {item.priority_band_shadow.toLowerCase()}</span>}
            {item.coverage_index_pct != null && <span>cobertura {Math.round(item.coverage_index_pct)}%</span>}
          </div>
          <button className="entity-open-button" disabled={item.openable === false} onClick={onOpen}>
            Abrir Entidad 360 →
          </button>
        </div>
      </div>
    </article>
  );
}

function SourceEvidenceRow({ hit }: { hit: SourceHit }) {
  const context = hit.context ?? {};
  const facts = contextFacts(context);
  const url = typeof context.document_url === 'string'
    ? context.document_url
    : typeof context.source_url === 'string'
      ? context.source_url
      : null;

  return (
    <div className="entity-source-evidence" data-source={hit.source_code}>
      <div className="entity-source-evidence-order">{hit.cascade_order ?? '·'}</div>
      <div className="entity-source-evidence-body">
        <div className="entity-source-evidence-head">
          <b>{hit.source_label ?? SOURCE_LABEL[hit.source_code] ?? hit.source_code}</b>
          {hit.match_pct != null && <span>{formatPct(hit.match_pct)}</span>}
          {hit.registry_class && <small>{hit.registry_class}</small>}
        </div>
        <div className="entity-source-matchline">
          {hit.matched_label && <strong>{hit.matched_label}</strong>}
          <span>{matchLabel(hit.match_type)}</span>
          {hit.identity_linked && <em>vinculada a la entidad</em>}
        </div>
        {facts.length > 0 && (
          <dl className="entity-source-facts">
            {facts.map((fact) => (
              <div key={fact.label}>
                <dt>{fact.label}</dt>
                <dd>{fact.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
      {url && (
        <a className="entity-source-link" href={url} target="_blank" rel="noopener noreferrer">Fuente ↗</a>
      )}
    </div>
  );
}

function QuickChip({
  label,
  value,
  active,
  onClick,
}: {
  label: string;
  value?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button className="entity-quick-chip" data-on={active} onClick={onClick}>
      {label} {value != null && <b>{n(value)}</b>}
    </button>
  );
}

function Metric({ value, label }: { value?: number; label: string }) {
  return (
    <div className="entity-landing-metric">
      <strong>{value == null ? '—' : n(value)}</strong>
      <span>{label}</span>
    </div>
  );
}

function SearchIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="m16 16 4.2 4.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function pressAlreadyRepresented(match: PressMatch, items: EntitySearchItem[]): boolean {
  const ruts = new Set(match.ruts.map(compactRut).filter(Boolean));
  const names = new Set([match.name, ...match.aliases].map(normalizePressText).filter(Boolean));
  return items.some((item) => {
    const rut = compactRut(item.rut);
    if (rut && ruts.has(rut)) return true;
    return names.has(normalizePressText(item.name));
  });
}

function compactRut(value: string | null | undefined): string {
  return String(value ?? '').toUpperCase().replace(/[^0-9K]/g, '');
}

function scoreGrade(
  pct: number | null,
  matchType?: string,
): 'exact' | 'strong' | 'review' {
  if (matchType === 'rut_exact' || matchType === 'name_exact' || matchType === 'alias_exact' || (pct ?? 0) >= 99.5) return 'exact';
  if ((pct ?? 0) >= 88) return 'strong';
  return 'review';
}

function formatPct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const pct = value <= 1 ? value * 100 : value;
  return `${pct >= 99.95 ? '100' : pct.toFixed(pct >= 90 ? 0 : 1)}%`;
}

function matchLabel(matchType?: string): string {
  switch (matchType) {
    case 'rut_exact': return 'RUT exacto';
    case 'rut_prefix': return 'RUT parcial';
    case 'name_exact': return 'Nombre exacto';
    case 'alias_exact': return 'Alias exacto';
    case 'name_prefix': return 'Prefijo de nombre';
    case 'name_fuzzy': return 'Nombre aproximado';
    case 'press_name_exact': return 'Nombre exacto en prensa';
    case 'press_name_high_confidence': return 'Nombre aproximado en prensa';
    case 'contact_exact': return 'Identificador digital exacto';
    case 'contact_contains': return 'Identificador digital contenido';
    default: return matchType ? matchType.replace(/_/g, ' ') : 'Coincidencia';
  }
}

function contextFacts(context: Record<string, unknown>): Array<{ label: string; value: string }> {
  const keys: Array<[string, string]> = [
    ['uaf_sector', 'Sector UAF'],
    ['subject_nature', 'Naturaleza'],
    ['sii_status', 'Estado SII'],
    ['current_status', 'Estado'],
    ['activity_start_date', 'Inicio actividades'],
    ['termination_date', 'Término de giro'],
    ['regulator', 'Regulador'],
    ['event_date', 'Fecha'],
    ['event_kind', 'Evento'],
    ['reason', 'Materia'],
    ['constitution_date', 'Constitución'],
    ['capital', 'Capital'],
    ['total_clp', 'Monto'],
    ['order_count', 'Órdenes'],
    ['primary_vertical', 'Vertical'],
    ['business_model', 'Modelo de negocio'],
    ['psav_status', 'PSAV'],
    ['article_count', 'Noticias'],
  ];

  return keys
    .filter(([key]) => context[key] != null && context[key] !== '')
    .slice(0, 5)
    .map(([key, label]) => ({ label, value: formatContextValue(key, context[key]) }));
}

function formatContextValue(key: string, value: unknown): string {
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  if (typeof value === 'number') {
    if (key.includes('clp') || key === 'capital') {
      return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(value);
    }
    return new Intl.NumberFormat('es-CL').format(value);
  }
  return String(value).replace(/_/g, ' ');
}
