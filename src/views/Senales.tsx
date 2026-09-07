import { useMemo, useState } from 'react';
import { useRpc } from '../lib/rpc';
import type { AlertRow } from '../lib/contracts';
import { AlertCard } from '../components/AlertCard';
import { Empty, ErrorBox, Loading, Semantics } from '../components/primitives';
import { n, titleCase } from '../lib/format';

const PRIORITIES = ['MUY ALTA', 'ALTA', 'MEDIA', 'OBSERVAR'];
const SCOPES = [
  ['ENTITY', 'Entidad'],
  ['SECTOR', 'Sector'],
  ['REGION', 'Región'],
  ['FINDING', 'Hallazgo'],
  ['SYSTEM', 'Sistema'],
] as const;

const PAGE = 40;

export function Senales({
  family,
  onNavigate,
}: {
  family?: string;
  onNavigate: (hash: string) => void;
}) {
  const [priority, setPriority] = useState<string | null>(null);
  const [scope, setScope] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  const args = useMemo(
    () => ({
      p_family: family ?? null,
      p_priority: priority,
      p_scope_type: scope,
      p_limit: PAGE,
      p_offset: page * PAGE,
    }),
    [family, priority, scope, page],
  );

  const { data, error, loading, reload } = useRpc<AlertRow[]>('obs_alert_feed', args);
  const total = data?.[0]?.total_count ?? 0;
  const pages = Math.ceil(total / PAGE);

  function reset(fn: () => void) {
    fn();
    setPage(0);
  }

  return (
    <div className="fade-in">
      <header className="view-head">
        <h1 className="view-title">Señales</h1>
        <p className="view-lede">
          Patrones que el observatorio detecta sobre las fuentes gobernadas. Cada señal
          declara su familia, su alcance y la intensidad con que se manifiesta. Una señal
          es una invitación a mirar, no un juicio sobre la entidad o el sector señalado.
        </p>
      </header>

      <div className="filters" style={{ marginBottom: 18 }}>
        {family && (
          <button className="chip" data-on="true" onClick={() => onNavigate('#/senales')}>
            Familia: {titleCase(family)} ✕
          </button>
        )}
        <span style={{ fontSize: 11, color: 'var(--ink-4)', letterSpacing: '.08em', textTransform: 'uppercase', fontWeight: 650, marginRight: 2 }}>
          Prioridad
        </span>
        {PRIORITIES.map((p) => (
          <button
            key={p}
            className="chip"
            data-on={priority === p}
            onClick={() => reset(() => setPriority(priority === p ? null : p))}
          >
            {p}
          </button>
        ))}
        <span style={{ width: 10 }} />
        <span style={{ fontSize: 11, color: 'var(--ink-4)', letterSpacing: '.08em', textTransform: 'uppercase', fontWeight: 650, marginRight: 2 }}>
          Alcance
        </span>
        {SCOPES.map(([code, label]) => (
          <button
            key={code}
            className="chip"
            data-on={scope === code}
            onClick={() => reset(() => setScope(scope === code ? null : code))}
          >
            {label}
          </button>
        ))}
      </div>

      {loading && <Loading label="Leyendo el feed de señales…" />}
      {error && <ErrorBox error={error} onRetry={reload} />}

      {!loading && !error && (
        <>
          <div className="section-title">
            {n(total)} señales
            <span className="hint">
              ordenadas por prioridad declarada y luego por intensidad
            </span>
          </div>

          {total === 0 ? (
            <Empty
              title="Ninguna señal cumple estos filtros"
              hint="Prueba quitando la prioridad o el alcance. La ausencia de señales no significa ausencia de riesgo: significa que ningún patrón gobernado se activó en este corte."
            />
          ) : (
            <div className="grid" style={{ gap: 10 }}>
              {data?.map((a) => (
                <AlertCard key={a.alert_id} alert={a} onNavigate={onNavigate} />
              ))}
            </div>
          )}

          {pages > 1 && (
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 22, alignItems: 'center' }}>
              <button className="btn" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                Anterior
              </button>
              <span className="num" style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>
                {page + 1} / {pages}
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
          <strong>Cómo leer una señal.</strong> La intensidad ordena el esfuerzo de
          análisis dentro de este corte; no es una probabilidad ni una medida de gravedad
          jurídica. La prioridad la declara el productor del patrón, no esta interfaz.
          Dos señales de familias distintas no son comparables entre sí salvo que
          compartan universo y grano.
        </Semantics>
      </div>
    </div>
  );
}
