import { useMemo, useState } from 'react';
import { EVENT_TYPE_LABEL, SCOPE_LABEL, civil, instant, n } from '../format';
import type { RadarEvent, Snapshot } from '../types';

export interface EventFilter {
  economy: string;
  scope: string;
  source: string;
  q: string;
  onlyNew: boolean;
}

export const EMPTY_FILTER: EventFilter = { economy: '', scope: '', source: '', q: '', onlyNew: false };

function haystack(e: RadarEvent) {
  return [e.title, e.actor, JSON.stringify(e.target)].join(' ').toLowerCase();
}

function Facts({ e }: { e: RadarEvent }) {
  const t = e.target as Record<string, string | undefined>;
  const a = e.attributes as Record<string, unknown>;
  const bits: string[] = [];
  if (t.domain) bits.push(String(t.domain));
  if (t.sector) bits.push(String(t.sector));
  if (t.category) bits.push(String(t.category));
  if (t.chain) bits.push(`${t.chain} · ${t.address}`);
  if (a.accounts) bits.push(`${n(Number(a.accounts))} cuentas`);
  if (Array.isArray(a.data_classes) && a.data_classes.length) bits.push((a.data_classes as string[]).slice(0, 4).join(', '));
  if (a.republications) bits.push(`republicada ${a.republications} ${a.republications === 1 ? 'vez' : 'veces'}`);
  if (a.status) bits.push(`estado ${a.status}`);
  if (a.note) bits.push(String(a.note));
  return bits.length ? <small>{bits.join(' · ')}</small> : null;
}

export function Eventos({ snap, filter, setFilter }: {
  snap: Snapshot; filter: EventFilter; setFilter: (f: EventFilter) => void;
}) {
  const newIds = useMemo(() => new Set(snap.new_event_ids), [snap]);
  const sources = useMemo(() => Object.fromEntries(snap.sources.map((s) => [s.code, s])), [snap]);
  const [limit, setLimit] = useState(100);

  const rows = useMemo(() => {
    const q = filter.q.trim().toLowerCase();
    return snap.events.filter((e) =>
      (!filter.economy || e.economy === filter.economy) &&
      (!filter.scope || e.scope === filter.scope) &&
      (!filter.source || e.source_code === filter.source) &&
      (!filter.onlyNew || newIds.has(e.id)) &&
      (!q || haystack(e).includes(q)));
  }, [snap, filter, newIds]);

  const set = (patch: Partial<EventFilter>) => { setLimit(100); setFilter({ ...filter, ...patch }); };

  return (
    <div className="view">
      <div className="filters" role="search">
        <label>Economía
          <select value={filter.economy} onChange={(e) => set({ economy: e.target.value })}>
            <option value="">Todas</option>
            {Object.entries(snap.economies).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </label>
        <label>Alcance
          <select value={filter.scope} onChange={(e) => set({ scope: e.target.value })}>
            <option value="">Todos</option>
            {Object.entries(SCOPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label>Fuente
          <select value={filter.source} onChange={(e) => set({ source: e.target.value })}>
            <option value="">Todas</option>
            {snap.sources.filter((s) => s.records_kept > 0).map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
          </select>
        </label>
        <label className="grow">Buscar
          <input type="search" value={filter.q} placeholder="Nombre, dominio, grupo…" onChange={(e) => set({ q: e.target.value })} />
        </label>
        <label className="check">
          <input type="checkbox" checked={filter.onlyNew} onChange={(e) => set({ onlyNew: e.target.checked })} />
          Sólo nuevos
        </label>
      </div>

      <p className="semantics">
        <b>{n(rows.length)} hechos.</b> Cada fila es lo que una fuente publicó, no una conclusión: una reivindicación
        no confirma un incidente, un dominio de phishing no prueba fraude consumado y la ausencia de una entidad no
        significa que no esté expuesta. Los dominios maliciosos se muestran neutralizados («[.]») y sin enlace.
      </p>

      <div className="table-wrap">
        <table className="events">
          <thead>
            <tr>
              <th>Fecha</th><th>Hecho</th><th>Actor</th><th>Vínculo con Chile</th><th>Fuente</th><th>Visto desde</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map((e) => (
              <tr key={e.id}>
                <td className="mono">{civil(e.event_date)}</td>
                <td>
                  <strong>{e.evidence.indicator ?? e.title}</strong>
                  <span className="kind">{EVENT_TYPE_LABEL[e.event_type] ?? e.event_type} · {snap.economies[e.economy]?.label}</span>
                  <Facts e={e} />
                  {newIds.has(e.id) && <span className="tag tag-new">nuevo</span>}
                  {e.carried_from && <span className="tag">arrastrado de {e.carried_from}</span>}
                </td>
                <td>{e.actor ?? '—'}</td>
                <td>
                  {e.chile_link
                    ? <>{e.chile_link.reason}<small>confianza {e.chile_link.confidence}</small></>
                    : <span className="muted">{SCOPE_LABEL[e.scope]}</span>}
                </td>
                <td>
                  {e.evidence.source_url?.startsWith('http')
                    ? <a href={e.evidence.source_url} target="_blank" rel="noreferrer noopener">{sources[e.source_code]?.name.split(' (')[0]}</a>
                    : sources[e.source_code]?.name.split(' (')[0]}
                </td>
                <td className="mono">{instant(e.first_seen)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <p className="empty">Ningún hecho coincide con los filtros.</p>}
      </div>
      {rows.length > limit && (
        <button className="more" type="button" onClick={() => setLimit(limit + 200)}>Mostrar más ({n(rows.length - limit)} restantes)</button>
      )}
    </div>
  );
}
