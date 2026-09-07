import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDebounced, useRpc } from '../lib/rpc';
import { hrefFor } from '../lib/router';
import type { EntityRow } from '../lib/contracts';
import {
  looksLikePersonName, screenWatchlists, type WatchlistResult,
} from '../lib/connectors';
import { Badge, Empty, ErrorBox, Loading, Semantics } from '../components/primitives';
import { EntityRowItem } from '../components/EntityRowItem';
import { WatchlistResults } from '../components/Watchlists';
import { IdentidadDigital } from '../components/IdentidadDigital';
import { PressMatches } from '../components/PressMatches';
import { normalizePressText, searchPress, type PressMatch } from '../lib/press';
import { n, shortSource, titleCase } from '../lib/format';

const PAGE = 25;

const SOURCES = ['RADAR_UAF', 'RADAR_SII', 'RADAR_OSFL', 'RADAR_SANCIONES', 'RADAR_PRENSA'];

const REGIONS = [
  'Metropolitana de Santiago', 'Valparaíso', 'Biobío', 'Maule', 'La Araucanía',
  'Libertador General Bernardo O’Higgins', 'Los Lagos', 'Coquimbo', 'Antofagasta',
  'Ñuble', 'Los Ríos', 'Tarapacá', 'Atacama', 'Arica y Parinacota', 'Magallanes',
  'Aysén',
];

type Layer = 'universo' | 'internacional' | 'digital';

interface LayerState {
  status: 'idle' | 'loading' | 'done' | 'error';
  result?: WatchlistResult;
  error?: string;
  auto?: boolean;
}

interface PressState {
  status: 'idle' | 'loading' | 'done' | 'error';
  matches: PressMatch[];
  error?: string;
}

function compactRut(value: string | null | undefined): string {
  return String(value ?? '').toUpperCase().replace(/[^0-9K]/g, '');
}

function pressAlreadyRepresented(match: PressMatch, rows: EntityRow[]): boolean {
  const names = new Set([
    normalizePressText(match.name),
    ...match.aliases.map(normalizePressText),
  ].filter(Boolean));
  const ruts = new Set(match.ruts.map(compactRut).filter(Boolean));
  return rows.some((row) => {
    const rut = compactRut(row.rut);
    if (rut && ruts.has(rut)) return true;
    return names.has(normalizePressText(row.name));
  });
}

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
  const [source, setSource] = useState<string | null>(null);
  const [onlyUaf, setOnlyUaf] = useState(false);
  const [onlySanctioned, setOnlySanctioned] = useState(false);
  const [multiSource, setMultiSource] = useState(false);
  const [page, setPage] = useState(0);

  const [layer, setLayer] = useState<Layer>('universo');
  const [watch, setWatch] = useState<LayerState>({ status: 'idle' });
  const [digitalQuery, setDigitalQuery] = useState<string | null>(null);
  const [digitalDone, setDigitalDone] = useState(false);
  const [press, setPress] = useState<PressState>({ status: 'idle', matches: [] });

  const debounced = useDebounced(q, 240);
  const trimmed = debounced.trim();

  useEffect(() => setPage(0), [debounced, region, source, onlyUaf, onlySanctioned, multiSource]);

  // Cada consulta nueva reinicia las capas externas: un resultado de OFAC de la
  // búsqueda anterior junto a un nombre distinto sería una atribución falsa.
  useEffect(() => {
    setWatch({ status: 'idle' });
    setDigitalQuery(null);
    setDigitalDone(false);
    setLayer('universo');
  }, [trimmed]);

  // Radar Prensa participa en la búsqueda principal. El bridge conserva las
  // entidades detectadas por el Monitor incluso cuando todavía no tienen RUT o
  // no han sido conciliadas con una identidad canónica de Atlas.
  useEffect(() => {
    let cancelled = false;
    if (trimmed.length < 3) {
      setPress({ status: 'idle', matches: [] });
      return () => { cancelled = true; };
    }
    setPress((current) => ({ status: 'loading', matches: current.matches }));
    void searchPress(trimmed, 12)
      .then((matches) => {
        if (!cancelled) setPress({ status: 'done', matches });
      })
      .catch((e) => {
        if (!cancelled) {
          setPress({ status: 'error', matches: [], error: (e as Error).message });
        }
      });
    return () => { cancelled = true; };
  }, [trimmed]);

  useEffect(() => {
    const target = hrefFor({
      view: 'entidades',
      q: trimmed || undefined,
      region: region ?? undefined,
    });
    if (window.location.hash !== target) window.history.replaceState(null, '', target);
  }, [trimmed, region]);

  const args = useMemo(
    () => ({
      p_q: trimmed || null,
      p_limit: PAGE,
      p_offset: page * PAGE,
      p_region: region,
      p_source: source,
      p_only_uaf: onlyUaf,
      p_only_sanctioned: onlySanctioned,
      p_min_sources: multiSource ? 3 : null,
    }),
    [trimmed, page, region, source, onlyUaf, onlySanctioned, multiSource],
  );

  const { data, error, loading, reload } = useRpc<EntityRow[]>('obs_search_entities', args);
  const total = data?.[0]?.total_count ?? 0;
  const pages = Math.ceil(total / PAGE);
  const hasFilters = !!(region || source || onlyUaf || onlySanctioned || multiSource);
  const isPerson = looksLikePersonName(trimmed);

  // Una coincidencia PRESS_ONLY se suma al resultado sólo si no está ya
  // representada por una entidad canónica en la página actual. La evidencia de
  // prensa, en cambio, siempre se muestra para que el analista pueda abrirla.
  const standalonePressCount = useMemo(() => {
    if (!data || press.status !== 'done') return 0;
    return press.matches.filter((match) => !pressAlreadyRepresented(match, data)).length;
  }, [data, press]);
  const visibleTotal = total + standalonePressCount;
  const pressHits = press.matches.length;

  const runWatchlists = useCallback(
    async (auto: boolean) => {
      if (!trimmed) return;
      setWatch({ status: 'loading', auto });
      try {
        const result = await screenWatchlists({ name: trimmed });
        setWatch({ status: 'done', result, auto });
      } catch (e) {
        setWatch({ status: 'error', error: (e as Error).message, auto });
      }
    },
    [trimmed],
  );

  // La cascada sale a listas internacionales sólo cuando tanto el universo
  // materializado como Radar Prensa terminaron sin coincidencias.
  useEffect(() => {
    if (loading || error || !trimmed || trimmed.length < 3) return;
    if (press.status === 'idle' || press.status === 'loading') return;
    if (total > 0 || pressHits > 0) return;
    if (watch.status !== 'idle') return;
    setLayer('internacional');
    void runWatchlists(true);
  }, [loading, error, trimmed, total, press.status, pressHits, watch.status, runWatchlists]);

  const externalHits = watch.result
    ? Object.values(watch.result.sources).reduce((acc, s) => acc + (s.records?.length ?? 0), 0)
    : 0;

  return (
    <div className="fade-in">
      <header className="view-head">
        <h1 className="view-title">Entidades</h1>
        <p className="view-lede">
          Escribe un nombre o un RUT. El Observatorio cruza el universo gobernado con
          Radar Prensa y muestra la evidencia periodística coincidente. Si ambas capas
          quedan sin resultados, continúa hacia las listas internacionales.
        </p>
      </header>

      <div className="searchbar" style={{ marginBottom: 6 }}>
        <div className="searchbar-field">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }} aria-hidden>
            <circle cx="11" cy="11" r="7" stroke="var(--ink-3)" strokeWidth="1.8" />
            <path d="m16.5 16.5 4.2 4.2" stroke="var(--ink-3)" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <input
            id="obs-search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Nombre, razón social o RUT (76.123.456-7)…"
            autoComplete="off"
            spellCheck={false}
            autoFocus
          />
          {q && (
            <button className="icon-btn" style={{ width: 26, height: 26 }} onClick={() => setQ('')} title="Limpiar">
              ✕
            </button>
          )}
          <span className="searchbar-hint">/</span>
        </div>
      </div>

      {/* Las capas son explícitas: el analista siempre sabe dónde está mirando. */}
      {trimmed.length >= 3 && (
        <div className="filters" style={{ marginTop: 12, marginBottom: 4 }}>
          <LayerTab
            active={layer === 'universo'}
            onClick={() => setLayer('universo')}
            label="Universo observado"
            badge={loading || press.status === 'loading' ? '…' : n(visibleTotal)}
            tone={visibleTotal > 0 ? 'present' : 'absent'}
          />
          <LayerTab
            active={layer === 'internacional'}
            onClick={() => {
              setLayer('internacional');
              if (watch.status === 'idle') void runWatchlists(false);
            }}
            label="Listas internacionales"
            badge={
              watch.status === 'loading' ? '…'
              : watch.status === 'done' ? n(externalHits)
              : watch.status === 'error' ? '!' : 'consultar'
            }
            tone={externalHits > 0 ? 'critical' : watch.status === 'done' ? 'present' : 'absent'}
          />
          <LayerTab
            active={layer === 'digital'}
            onClick={() => {
              setLayer('digital');
              setDigitalQuery(trimmed);
            }}
            label="Identidad digital"
            badge={
              !isPerson ? 'requiere nombre'
              : digitalDone ? 'consultada'
              : digitalQuery ? '…' : 'consultar'
            }
            tone={digitalDone ? 'present' : 'absent'}
            disabled={!isPerson}
            title={
              isPerson
                ? 'Resuelve el nombre en aliases candidatos y busca perfiles públicos'
                : 'La identidad digital opera sobre nombres de persona (nombre y apellido)'
            }
          />
        </div>
      )}

      {layer === 'universo' && (
        <>
          <div className="filters" style={{ marginTop: 10 }}>
            <button className="chip" data-on={onlyUaf} onClick={() => setOnlyUaf((v) => !v)}>
              Padrón UAF
            </button>
            <button className="chip" data-on={onlySanctioned} onClick={() => setOnlySanctioned((v) => !v)}>
              Con sanción
            </button>
            <button className="chip" data-on={multiSource} onClick={() => setMultiSource((v) => !v)}>
              3+ fuentes
            </button>
            <select className="chip" value={source ?? ''} data-on={!!source}
              onChange={(e) => setSource(e.target.value || null)}>
              <option value="">Cualquier fuente</option>
              {SOURCES.map((s) => (
                <option key={s} value={s}>{titleCase(shortSource(s))}</option>
              ))}
            </select>
            <select className="chip" value={region ?? ''} data-on={!!region}
              onChange={(e) => setRegion(e.target.value || null)}>
              <option value="">Todas las regiones</option>
              {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            {hasFilters && (
              <button className="chip" onClick={() => {
                setRegion(null); setSource(null);
                setOnlyUaf(false); setOnlySanctioned(false); setMultiSource(false);
              }}>
                Limpiar filtros ✕
              </button>
            )}
          </div>

          <div className="section-title" style={{ marginTop: 20 }}>
            {loading || press.status === 'loading'
              ? 'Buscando…'
              : `${n(visibleTotal)} ${visibleTotal === 1 ? 'entidad' : 'entidades'}`}
            {trimmed && !loading && <span className="hint">para “{trimmed}”</span>}
            {!trimmed && !hasFilters && !loading && (
              <span className="hint">universo completo · empieza a escribir para acotar</span>
            )}
          </div>

          {error && <ErrorBox error={error} onRetry={reload} />}
          {loading && !data && <Loading label="Consultando el índice de entidades…" />}
          {press.status === 'error' && trimmed.length >= 3 && (
            <div className="note" style={{ marginBottom: 12 }}>
              Radar Prensa no pudo incorporarse a esta búsqueda: {press.error}
            </div>
          )}

          {!error && data && (
            <>
              {total === 0 && pressHits === 0 && press.status === 'done' ? (
                <Empty
                  title="Ninguna entidad del universo observado coincide"
                  hint={
                    trimmed
                      ? 'Ni las fuentes materializadas ni Radar Prensa reportan esta consulta en el corte vigente. El Observatorio continúa hacia las listas internacionales.'
                      : 'Ajusta los filtros para ampliar la búsqueda.'
                  }
                />
              ) : total > 0 ? (
                <div className="panel" style={{ opacity: loading ? 0.6 : 1, transition: 'opacity .18s' }}>
                  <div className="rows">
                    {data.map((e) => (
                      <EntityRowItem
                        key={e.entity_id}
                        entity={e}
                        onOpen={() => onNavigate(hrefFor({ view: 'ficha', entityId: e.entity_id }))}
                      />
                    ))}
                  </div>
                </div>
              ) : press.status === 'loading' ? (
                <Loading label="Consultando entidades detectadas por Radar Prensa…" />
              ) : null}

              <PressMatches matches={press.matches} loading={press.status === 'loading' && press.matches.length > 0} />

              {pages > 1 && (
                <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 22, alignItems: 'center' }}>
                  <button className="btn" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                    Anterior
                  </button>
                  <span className="num" style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>
                    {page + 1} / {n(pages)}
                  </span>
                  <button className="btn" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>
                    Siguiente
                  </button>
                </div>
              )}
            </>
          )}

          <div style={{ marginTop: 24 }}>
            <Semantics>
              <strong>Qué son los puntos de fuente.</strong> Cada cuadro encendido junto a una
              entidad es una fuente gobernada que tiene registro suyo. Un cuadro apagado
              significa que esa fuente no la reporta — no que la haya descartado. Una entidad
              marcada como <em>identidad sin resolver</em> puede provenir exclusivamente de
              prensa y no debe tratarse como una identidad canónica hasta su conciliación.
            </Semantics>
          </div>
        </>
      )}

      {layer === 'internacional' && (
        <div style={{ marginTop: 18 }}>
          {watch.auto && total === 0 && pressHits === 0 && (
            <div className="note" style={{ marginBottom: 14 }}>
              El universo observado y Radar Prensa no reportan “{trimmed}”, así que el Observatorio
              continuó solo hacia listas de sanciones, debarment y bases offshore.
            </div>
          )}
          {watch.status === 'loading' && (
            <Loading label="Consultando sanciones, debarment y bases offshore…" />
          )}
          {watch.status === 'error' && (
            <ErrorBox error={watch.error ?? ''} onRetry={() => void runWatchlists(false)} />
          )}
          {watch.status === 'idle' && (
            <Empty
              title="Listas internacionales no consultadas"
              hint="Se consultan bajo demanda, por consulta. Pulsa la pestaña para ejecutarlas."
            />
          )}
          {watch.status === 'done' && watch.result && (
            <WatchlistResults result={watch.result} query={trimmed} />
          )}
        </div>
      )}

      {layer === 'digital' && (
        <div style={{ marginTop: 18 }}>
          {digitalQuery ? (
            <IdentidadDigital query={digitalQuery} onSettled={() => setDigitalDone(true)} />
          ) : (
            <Empty title="Identidad digital no consultada" />
          )}
        </div>
      )}
    </div>
  );
}

function LayerTab({
  active, onClick, label, badge, tone, disabled, title,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  badge: string;
  tone: 'present' | 'absent' | 'critical';
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      className="chip"
      data-on={active}
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{ opacity: disabled ? 0.45 : 1, gap: 8, padding: '6px 12px' }}
    >
      {label}
      <Badge tone={tone}>{badge}</Badge>
    </button>
  );
}
