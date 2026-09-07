import { useEffect, useMemo, useState } from 'react';
import { useDebounced, useRpc } from '../lib/rpc';
import { hrefFor } from '../lib/router';
import type { EntityRow } from '../lib/contracts';
import { Empty, ErrorBox, Loading, Semantics } from '../components/primitives';
import { n, shortSource, titleCase } from '../lib/format';
import { EntityRowItem } from '../components/EntityRowItem';

const PAGE = 25;

const SOURCES = [
  'RADAR_UAF',
  'RADAR_SII',
  'RADAR_OSFL',
  'RADAR_SANCIONES',
  'RADAR_PRENSA',
];

const REGIONS = [
  'Metropolitana de Santiago', 'Valparaíso', 'Biobío', 'Maule', 'Araucanía',
  'Libertador General Bernardo O’Higgins', 'Los Lagos', 'Coquimbo', 'Antofagasta',
  'Ñuble', 'Los Ríos', 'Tarapacá', 'Atacama', 'Arica y Parinacota', 'Magallanes',
  'Aysén',
];

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

  const debounced = useDebounced(q, 240);

  // Any change to the question restarts the answer.
  useEffect(() => setPage(0), [debounced, region, source, onlyUaf, onlySanctioned, multiSource]);

  // Keep the address bar shareable without re-rendering on every keystroke.
  useEffect(() => {
    const target = hrefFor({
      view: 'entidades',
      q: debounced || undefined,
      region: region ?? undefined,
    });
    if (window.location.hash !== target) {
      window.history.replaceState(null, '', target);
    }
  }, [debounced, region]);

  const args = useMemo(
    () => ({
      p_q: debounced.trim() || null,
      p_limit: PAGE,
      p_offset: page * PAGE,
      p_region: region,
      p_source: source,
      p_only_uaf: onlyUaf,
      p_only_sanctioned: onlySanctioned,
      p_min_sources: multiSource ? 3 : null,
    }),
    [debounced, page, region, source, onlyUaf, onlySanctioned, multiSource],
  );

  const { data, error, loading, reload } = useRpc<EntityRow[]>('obs_search_entities', args);
  const total = data?.[0]?.total_count ?? 0;
  const pages = Math.ceil(total / PAGE);
  const hasFilters = !!(region || source || onlyUaf || onlySanctioned || multiSource);

  return (
    <div className="fade-in">
      <header className="view-head">
        <h1 className="view-title">Entidades</h1>
        <p className="view-lede">
          Escribe un nombre o un RUT y verás de inmediato qué información tiene el
          observatorio sobre esa entidad y de qué fuente proviene. La búsqueda tolera
          acentos, puntos y guiones.
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
            placeholder="Nombre de la entidad o RUT (76.123.456-7)…"
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

        <div className="filters">
          <button className="chip" data-on={onlyUaf} onClick={() => setOnlyUaf((v) => !v)}>
            Padrón UAF
          </button>
          <button className="chip" data-on={onlySanctioned} onClick={() => setOnlySanctioned((v) => !v)}>
            Con sanción
          </button>
          <button className="chip" data-on={multiSource} onClick={() => setMultiSource((v) => !v)}>
            3+ fuentes
          </button>
          <select
            className="chip"
            value={source ?? ''}
            onChange={(e) => setSource(e.target.value || null)}
            data-on={!!source}
          >
            <option value="">Cualquier fuente</option>
            {SOURCES.map((s) => (
              <option key={s} value={s}>{titleCase(shortSource(s))}</option>
            ))}
          </select>
          <select
            className="chip"
            value={region ?? ''}
            onChange={(e) => setRegion(e.target.value || null)}
            data-on={!!region}
          >
            <option value="">Todas las regiones</option>
            {REGIONS.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
          {hasFilters && (
            <button
              className="chip"
              onClick={() => {
                setRegion(null); setSource(null);
                setOnlyUaf(false); setOnlySanctioned(false); setMultiSource(false);
              }}
            >
              Limpiar filtros ✕
            </button>
          )}
        </div>
      </div>

      <div className="section-title" style={{ marginTop: 20 }}>
        {loading ? 'Buscando…' : `${n(total)} ${total === 1 ? 'entidad' : 'entidades'}`}
        {debounced && !loading && <span className="hint">para “{debounced}”</span>}
        {!debounced && !hasFilters && !loading && (
          <span className="hint">universo completo · empieza a escribir para acotar</span>
        )}
      </div>

      {error && <ErrorBox error={error} onRetry={reload} />}
      {loading && !data && <Loading label="Consultando el índice de entidades…" />}

      {!error && data && (
        <>
          {total === 0 ? (
            <Empty
              title="Ninguna entidad coincide"
              hint={
                debounced
                  ? `No hay registro de “${debounced}” en el universo observado. Eso no significa que la entidad no exista: significa que ninguna fuente gobernada la ha reportado en este corte.`
                  : 'Ajusta los filtros para ampliar la búsqueda.'
              }
            />
          ) : (
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
          )}

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
          significa que esa fuente no la reporta — no que la haya descartado. Las listas
          internacionales y las consultas OSINT se ejecutan bajo demanda desde la ficha,
          por lo que aparecen como «no consultadas» hasta que alguien las pide.
        </Semantics>
      </div>
    </div>
  );
}
