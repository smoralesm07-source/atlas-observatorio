import { useEffect, useState } from 'react';
import { instant, n } from './format';
import type { Snapshot } from './types';
import { EMPTY_FILTER, Eventos, type EventFilter } from './views/Eventos';
import { Fuentes } from './views/Fuentes';
import { Metodo } from './views/Metodo';
import { Panorama } from './views/Panorama';

type Tab = 'panorama' | 'eventos' | 'fuentes' | 'metodo';
const TABS: [Tab, string][] = [['panorama', 'Panorama'], ['eventos', 'Hechos'], ['fuentes', 'Fuentes'], ['metodo', 'Método']];

export function App() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('panorama');
  const [filter, setFilter] = useState<EventFilter>(EMPTY_FILTER);

  useEffect(() => {
    fetch('./latest.json', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((s: Snapshot) => {
        if (s.schema !== 'radar.snapshot.v1') throw new Error(`Esquema no soportado: ${s.schema}`);
        setSnap(s);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error) {
    return <main className="shell"><p className="notice">No se pudo leer el corte vigente ({error}). Corre los recolectores: <code>python -m radar.run</code>.</p></main>;
  }
  if (!snap) return <main className="shell"><p className="loading">Leyendo el corte vigente…</p></main>;

  const fresh = snap.sources.filter((s) => s.status === 'FRESH' || s.status === 'ARCHIVE').length;
  const openEconomy = (economy: string) => { setFilter({ ...EMPTY_FILTER, economy }); setTab('eventos'); };

  return (
    <main className="shell">
      <header className="top">
        <div>
          <span className="kicker">Prototipo · LA/FT · fuentes abiertas</span>
          <h1>Radar de economías criminales</h1>
          <p className="lede">Mercados ilícitos que se anuncian en la dark web y canales similares, y su vínculo con entidades y mercados chilenos.</p>
        </div>
        <dl className="snap-meta">
          <div><dt>Corte</dt><dd className="mono">{snap.snapshot_id}</dd></div>
          <div><dt>Publicado</dt><dd>{instant(snap.generated_at)}</dd></div>
          <div><dt>Fuentes con lectura</dt><dd>{fresh} de {snap.sources.length}</dd></div>
          <div><dt>Hechos</dt><dd>{n(snap.events.length)}{snap.new_event_ids.length ? ` · ${n(snap.new_event_ids.length)} nuevos` : ''}</dd></div>
        </dl>
      </header>

      <nav className="tabs" aria-label="Secciones">
        {TABS.map(([k, label]) => (
          <button key={k} type="button" aria-current={tab === k ? 'page' : undefined} onClick={() => setTab(k)}>{label}</button>
        ))}
      </nav>

      {tab === 'panorama' && <Panorama snap={snap} onOpen={openEconomy} />}
      {tab === 'eventos' && <Eventos snap={snap} filter={filter} setFilter={setFilter} />}
      {tab === 'fuentes' && <Fuentes snap={snap} />}
      {tab === 'metodo' && <Metodo snap={snap} />}

      <footer className="foot">
        No es un ROS, una denuncia ni una decisión institucional. Las publicaciones de actores criminales son
        afirmaciones de esos actores, no hechos acreditados.
      </footer>
    </main>
  );
}
