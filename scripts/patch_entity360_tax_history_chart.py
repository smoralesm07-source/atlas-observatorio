#!/usr/bin/env python3
from pathlib import Path
import re

VIEW = Path('src/views/EntityExpediente.tsx')
CSS = Path('src/styles/entity-expediente.css')

src = VIEW.read_text(encoding='utf-8')

marker = "type ActivityRow = {\n  code: string | null;\n  name: string;\n  principal: boolean;\n};\n"
insert = marker + "\ntype EntityTaxHistoryRow = {\n  commercial_year: number;\n  sales_band?: string | null;\n  sales_band_code?: string | null;\n  sales_band_rank?: number | null;\n  sales_band_uf?: string | null;\n  size_label?: string | null;\n  workers_numeric?: number | null;\n  source?: string | null;\n};\n\ntype TaxEvolutionRow = {\n  year: number;\n  rank: number | null;\n  band: string | null;\n  workers: number | null;\n  source: string | null;\n};\n"
if 'type EntityTaxHistoryRow' not in src:
    if marker not in src:
        raise SystemExit('ActivityRow marker not found')
    src = src.replace(marker, insert, 1)

pattern = re.compile(r"function salesHistory\(data: EntityDetail\) \{.*?\n\}\n\nfunction pressArticles", re.S)
replacement = """function salesHistory(data: EntityDetail, annual: EntityTaxHistoryRow[] | null): TaxEvolutionRow[] {
  const tax = record(data.tax);
  const rows: TaxEvolutionRow[] = (annual ?? [])
    .map((row) => ({
      year: Number(row.commercial_year),
      rank: numberValue(row.sales_band_rank),
      band: text(row.sales_band_uf) ?? text(row.sales_band) ?? text(row.sales_band_code),
      workers: numberValue(row.workers_numeric),
      source: text(row.source),
    }))
    .filter((row) => Number.isFinite(row.year) && row.year > 0)
    .sort((a, b) => a.year - b.year);

  const currentYear = numberValue(tax.commercial_year);
  if (currentYear && !rows.some((row) => row.year === currentYear)) {
    rows.push({
      year: currentYear,
      rank: numberValue(tax.sales_band_rank),
      band: text(tax.sales_band_uf) ?? text(data.entity.tax_sales_band_uf),
      workers: numberValue(tax.workers_numeric) ?? data.entity.tax_workers ?? null,
      source: text(tax.economic_data_source),
    });
  }

  return rows.sort((a, b) => a.year - b.year).slice(-6);
}

function pressArticles"""
src, n = pattern.subn(replacement, src, count=1)
if n != 1:
    raise SystemExit(f'salesHistory replacement count={n}')

old_hook = "  const { data, error, loading, reload } = useRpc<EntityDetail | null>('obs_entity_detail', { p_entity_id: entityId });\n"
new_hook = old_hook + "  const { data: taxHistory } = useRpc<EntityTaxHistoryRow[]>('obs_entity_tax_history', { p_entity_id: entityId });\n"
if "obs_entity_tax_history" not in src:
    if old_hook not in src:
        raise SystemExit('obs_entity_detail hook marker not found')
    src = src.replace(old_hook, new_hook, 1)

src = src.replace('  const history = salesHistory(data);', '  const history = salesHistory(data, taxHistory);', 1)

pattern = re.compile(r"function SalesBandCard\(\{ history, currentBand, dataStatus \}: \{ history: ReturnType<typeof salesHistory>; currentBand: string; dataStatus\?: string \| null \}\) \{.*?\n\}\n\nfunction ActivitiesCard", re.S)
replacement = """function SalesBandCard({ history, currentBand, dataStatus }: { history: ReturnType<typeof salesHistory>; currentBand: string; dataStatus?: string | null }) {
  const maxRank = Math.max(13, ...history.map((row) => row.rank ?? 0));
  const workerValues = history.map((row) => row.workers).filter((value): value is number => value != null && Number.isFinite(value));
  const maxWorkers = Math.max(1, ...workerValues);
  const atlasMissing = dataStatus === 'ATLAS_NOT_MATERIALIZED';
  const linePoints = history
    .map((row, index) => row.workers == null ? null : {
      x: ((index + 0.5) / history.length) * 100,
      y: 100 - (row.workers / maxWorkers) * 100,
      workers: row.workers,
      year: row.year,
    })
    .filter((point): point is { x: number; y: number; workers: number; year: number } => point != null);

  return <Card title="Evolución tributaria" meta="ventas + dotación SII">
    {history.length ? <div className="entity360-tax-evolution">
      <div className="entity360-tax-legend" aria-label="Leyenda del gráfico"><span><i className="sales" />Tramo de ventas</span><span><i className="workers" />Trabajadores</span></div>
      <div className="entity360-tax-combo" role="img" aria-label="Evolución anual del tramo de ventas SII y cantidad de trabajadores">
        <div className="entity360-bars-grid" />
        <div className="entity360-bars-items">{history.map((row) => {
          const label = salesBandUfLabel(row.rank);
          const workerText = row.workers == null ? 'sin dato de trabajadores' : `${n(row.workers)} trabajadores`;
          return <div className="entity360-bar-col" key={row.year} title={`${row.year}: ${label.full} · ${workerText}`}>
            <div className="entity360-bar-value"><span>{label.short}</span>{label.hasUf && <small>UF</small>}</div>
            <div className="entity360-bar-wrap"><i style={{ height: `${row.rank == null ? 0 : Math.max(8, (row.rank / maxRank) * 100)}%` }} /></div>
            <div className="entity360-bar-year">{row.year}</div>
          </div>;
        })}</div>
        {linePoints.length > 0 && <div className="entity360-workers-overlay" aria-hidden="true">
          {linePoints.length > 1 && <svg viewBox="0 0 100 100" preserveAspectRatio="none"><polyline points={linePoints.map((point) => `${point.x},${point.y}`).join(' ')} /></svg>}
          {linePoints.map((point) => <span key={point.year} className="entity360-workers-point" style={{ left: `${point.x}%`, top: `${point.y}%` }} title={`${point.year}: ${n(point.workers)} trabajadores`} />)}
          <div className="entity360-workers-axis"><strong>{n(maxWorkers)}</strong><span>trab.</span><em>0</em></div>
        </div>}
      </div>
      <div className="entity360-tax-year-values">{history.map((row) => <div key={row.year}><strong>{row.year}</strong><span>Ventas: {salesBandUfLabel(row.rank).full}</span><span>Trab.: {row.workers == null ? '—' : n(row.workers)}</span></div>)}</div>
    </div> : atlasMissing ? <Empty title="Histórico anual SII no cargado en Atlas" hint="La entidad está presente en el registro SII, pero su perfil económico anual todavía no fue materializado en este corte." /> : <div className="entity360-bigfact"><span>Tramo publicado</span><strong>{currentBand}</strong><small>No hay serie histórica materializada para años anteriores.</small></div>}
    <div className="entity360-chart-note"><strong>Barras:</strong> tramo de ventas en UF por año comercial. <strong>Línea:</strong> trabajadores dependientes informados, con escala propia a la derecha. El tramo 1 significa <strong>sin información de ventas</strong>, no ventas cero; una dotación de 0 sí se conserva como valor observado.</div>
  </Card>;
}

function ActivitiesCard"""
src, n = pattern.subn(replacement, src, count=1)
if n != 1:
    raise SystemExit(f'SalesBandCard replacement count={n}')

VIEW.write_text(src, encoding='utf-8')

css = CSS.read_text(encoding='utf-8')
css_block = r'''

/* Entity 360 · evolución tributaria combinada (ventas + trabajadores) */
.entity360-tax-evolution { display: grid; gap: 10px; min-width: 0; }
.entity360-tax-legend { display: flex; align-items: center; gap: 18px; flex-wrap: wrap; font-size: 11px; color: var(--text-muted, #64748b); }
.entity360-tax-legend span { display: inline-flex; align-items: center; gap: 6px; }
.entity360-tax-legend i { width: 16px; height: 4px; border-radius: 999px; display: inline-block; }
.entity360-tax-legend i.sales { height: 9px; border-radius: 2px; background: var(--accent, #2f7087); opacity: .8; }
.entity360-tax-legend i.workers { background: currentColor; }
.entity360-tax-combo { position: relative; min-height: 235px; padding-right: 34px; overflow: hidden; }
.entity360-tax-combo .entity360-bars-grid { position: absolute; inset: 38px 34px 28px 0; pointer-events: none; }
.entity360-tax-combo .entity360-bars-items { position: absolute; inset: 0 34px 0 0; z-index: 2; }
.entity360-workers-overlay { position: absolute; z-index: 4; left: 0; right: 34px; top: 38px; bottom: 28px; pointer-events: none; }
.entity360-workers-overlay svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.entity360-workers-overlay polyline { fill: none; stroke: currentColor; stroke-width: 2.2; vector-effect: non-scaling-stroke; opacity: .86; }
.entity360-workers-point { position: absolute; width: 8px; height: 8px; border-radius: 50%; background: currentColor; border: 2px solid var(--surface, #fff); transform: translate(-50%, -50%); box-shadow: 0 0 0 1px currentColor; }
.entity360-workers-axis { position: absolute; left: calc(100% + 7px); top: -4px; bottom: -2px; width: 30px; display: grid; grid-template-rows: auto auto 1fr auto; justify-items: start; color: var(--text-muted, #64748b); font-size: 9px; }
.entity360-workers-axis strong { font-size: 10px; color: var(--text, #1e293b); font-weight: 700; }
.entity360-workers-axis span { line-height: 1; }
.entity360-workers-axis em { align-self: end; font-style: normal; }
.entity360-tax-year-values { display: grid; grid-template-columns: repeat(auto-fit, minmax(104px, 1fr)); gap: 6px; }
.entity360-tax-year-values > div { padding: 6px 7px; border: 1px solid var(--border, #e2e8f0); border-radius: 7px; background: color-mix(in srgb, var(--surface, #fff) 94%, currentColor 6%); display: grid; gap: 2px; min-width: 0; }
.entity360-tax-year-values strong { font-size: 10px; }
.entity360-tax-year-values span { font-size: 9px; line-height: 1.25; color: var(--text-muted, #64748b); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
@media (max-width: 760px) {
  .entity360-tax-combo { min-height: 220px; }
  .entity360-tax-year-values { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
'''
if 'Entity 360 · evolución tributaria combinada' not in css:
    CSS.write_text(css.rstrip() + css_block + '\n', encoding='utf-8')

print('Entity 360 tax history chart patch applied')
