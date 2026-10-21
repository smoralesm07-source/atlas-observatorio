import { Columns, HBars } from '../components/Bars';
import { StatusBadge } from '../components/StatusBadge';
import { n } from '../format';
import type { Snapshot, Source } from '../types';

const RESPONDED = new Set(['FRESH', 'ARCHIVE']);

/** Una economía sin ninguna fuente que haya respondido no tiene lectura: se
 *  dice así, en vez de mostrar un cero que se leería como «sin riesgo». */
export function economyReading(snap: Snapshot, code: string) {
  const sources = snap.sources.filter((s) => s.economy === code);
  const responded = sources.filter((s) => RESPONDED.has(s.status));
  return { sources, responded, hasReading: responded.length > 0 };
}

export function Panorama({ snap, onOpen }: { snap: Snapshot; onOpen: (economy: string) => void }) {
  const ind = snap.indicators;
  const ecosystem = ind.ecosystem?.categories ?? [];
  const chains = Object.entries(ind.ofac_crypto?.by_chain ?? {});
  const lacking = snap.sources.filter((s) => !RESPONDED.has(s.status));

  return (
    <div className="view">
      {lacking.length > 0 && (
        <aside className="notice" aria-label="Fuentes sin lectura en este corte">
          <strong>{lacking.length} de {snap.sources.length} fuentes no tienen lectura en este corte.</strong>{' '}
          Sus economías se muestran sin cifra, no con cero: {lacking.map((s: Source) => s.name.split(' (')[0]).join(' · ')}.
        </aside>
      )}

      <section aria-labelledby="eco-title">
        <h2 id="eco-title" className="section-title">Economías observadas</h2>
        <div className="eco-grid">
          {Object.entries(snap.economies).map(([code, eco]) => {
            const r = economyReading(snap, code);
            const b = ind.by_economy[code];
            return (
              <button key={code} className="eco-card" onClick={() => onOpen(code)} type="button">
                <span className="eco-label">{eco.label}</span>
                {r.hasReading && code === 'CRIPTO_SANCIONADO' ? (
                  // Es una lista de vigilancia global: su cifra es el tamaño de
                  // la lista, y los hechos son las designaciones nuevas.
                  <span className="eco-figure">
                    <strong>{n(ind.ofac_crypto?.addresses_total ?? 0)}</strong>
                    <span>direcciones en vigilancia · {n(b?.total ?? 0)} designaciones nuevas</span>
                  </span>
                ) : r.hasReading ? (
                  <span className="eco-figure">
                    <strong>{n(b?.cl ?? 0)}</strong>
                    <span>{b?.cl === 1 ? 'hecho' : 'hechos'} con vínculo a Chile{b && b.total > b.cl ? ` · ${n(b.total)} en total` : ''}</span>
                  </span>
                ) : (
                  <span className="eco-figure eco-figure-none">
                    <strong>Sin lectura</strong>
                    <span>ninguna fuente respondió</span>
                  </span>
                )}
                {b && b.new > 0 && <span className="eco-new">{n(b.new)} nuevos</span>}
                <span className="eco-sources">
                  {r.sources.map((s) => <StatusBadge key={s.code} status={s.status} />)}
                </span>
                <span className="eco-laft">{eco.laft}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="chart-grid" aria-label="Indicadores">
        <article className="card">
          <header>
            <h3>Reivindicaciones de ransomware sobre entidades chilenas, por año</h3>
            <p>Publicaciones de los grupos en sus sitios de filtración. Una reivindicación no confirma el incidente.</p>
          </header>
          <Columns unit="reivindicaciones"
                   data={Object.entries(ind.ransomware.by_year).map(([y, v]) => ({ label: y, value: v }))} />
          <footer>
            Grupos con más reivindicaciones: {ind.ransomware.top_groups.slice(0, 4).map(([g, c]) => `${g} (${c})`).join(', ') || '—'}.
            {(ind.ransomware.by_confidence?.baja ?? 0) > 0 && (
              <> {n(ind.ransomware.by_confidence!.baja)} sólo traen el país asignado por el agregador y deben verificarse.</>
            )}
          </footer>
        </article>

        <article className="card">
          <header>
            <h3>Dominios de phishing activos por marca chilena suplantada</h3>
            <p>Coincidencia por nombre de dominio contra el catálogo de marcas. Ningún dominio se visita.</p>
          </header>
          <HBars unit="dominios" data={ind.phishing.by_brand.map(([label, value]) => ({ label, value }))} />
        </article>

        <article className="card">
          <header>
            <h3>Actores activos en el ecosistema, por categoría</h3>
            <p>Mercados, foros y canales con estado ONLINE según el catálogo comunitario deepdarkCTI.</p>
          </header>
          <HBars unit="activos" data={ecosystem.filter((c) => c.total > 0).map((c) => ({
            label: c.category, value: c.active,
            detail: `${n(c.inactive)} inactivos · ${n(c.unknown)} sin estado · ${n(c.total)} catalogados`,
          }))} />
          {ecosystem.find((c) => c.active_by_kind) && (
            <footer>Mercados activos por tipo: {Object.entries(ecosystem.find((c) => c.active_by_kind)!.active_by_kind!)
              .sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ')}</footer>
          )}
        </article>

        <article className="card">
          <header>
            <h3>Direcciones cripto sancionadas por OFAC, por red</h3>
            <p>Lista de vigilancia para el módulo de exposición de exchanges. USDT sobre TRON es la vía habitual del cash-out regional.</p>
          </header>
          <HBars unit="direcciones" max={8} data={chains.map(([label, value]) => ({ label, value }))} />
          <footer>{n(ind.ofac_crypto?.addresses_total)} direcciones en total.</footer>
        </article>
      </section>
    </div>
  );
}
