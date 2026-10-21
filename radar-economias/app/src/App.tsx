import { useEffect, useState } from 'react';
import { instant, n } from './format';
import type { Snapshot } from './types';
import { EMPTY_FILTER, Eventos, type EventFilter } from './views/Eventos';
import { Fuentes } from './views/Fuentes';
import { Metodo } from './views/Metodo';
import { Panorama } from './views/Panorama';

type Tab = 'panorama' | 'hechos' | 'fuentes' | 'metodo';
const TABS: [Tab, string][] = [['panorama', 'Panorama'], ['hechos', 'Hechos'], ['fuentes', 'Fuentes'], ['metodo', 'Método']];

export function App() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('panorama');
  const [filter, setFilter] = useState<EventFilter>(EMPTY_FILTER);

  useEffect(() => {
    // La versión autocontenida (scripts/standalone.mjs) trae el corte embebido;
    // la app servida por Vite lo lee de data/latest.json.
    const embedded = document.getElementById('radar-snapshot')?.textContent;
    const load: Promise<Snapshot> = embedded
      ? Promise.resolve(JSON.parse(embedded))
      : fetch('./latest.json', { cache: 'no-store' })
          .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))));
    load
      .then((s) => {
        if (s.schema !== 'radar.snapshot.v1') throw new Error(`Esquema no soportado: ${s.schema}`);
        setSnap(s);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  // Cada sección tiene su ancla (#hechos, #fuentes…) para poder compartirla.
  useEffect(() => {
    const fromHash = () => {
      const h = location.hash.slice(1) as Tab;
      if (TABS.some(([k]) => k === h)) setTab(h);
    };
    fromHash();
    window.addEventListener('hashchange', fromHash);
    return () => window.removeEventListener('hashchange', fromHash);
  }, []);
  const go = (t: Tab) => {
    setTab(t);
    try { history.replaceState(null, '', `#${t}`); } catch { /* el visor puede impedirlo */ }
  };

  if (error) {
    return <main className="shell"><p className="notice">No se pudo leer el corte vigente ({error}). Corre los recolectores: <code>python -m radar.run</code>.</p></main>;
  }
  if (!snap) return <main className="shell"><p className="loading">Leyendo el corte vigente…</p></main>;

  const fresh = snap.sources.filter((s) => s.status === 'FRESH' || s.status === 'ARCHIVE').length;
  const openEconomy = (economy: string) => { setFilter({ ...EMPTY_FILTER, economy }); go('hechos'); };

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
          <button key={k} type="button" aria-current={tab === k ? 'page' : undefined} onClick={() => go(k)}>{label}</button>
        ))}
      </nav>

      {tab === 'panorama' && <Panorama snap={snap} onOpen={openEconomy} />}
      {tab === 'hechos' && <Eventos snap={snap} filter={filter} setFilter={setFilter} />}
      {tab === 'fuentes' && <Fuentes snap={snap} />}
      {tab === 'metodo' && <Metodo snap={snap} />}

      <footer className="foot">
        No es un ROS, una denuncia ni una decisión institucional. Las publicaciones de actores criminales son
        afirmaciones de esos actores, no hechos acreditados.
      </footer>
    </main>
  );
}
