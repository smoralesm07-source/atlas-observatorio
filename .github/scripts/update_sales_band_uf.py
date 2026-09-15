from pathlib import Path


tsx = Path('src/views/EntityExpediente.tsx')
text = tsx.read_text()
old = '''function SalesBandCard({ history, currentBand }: { history: ReturnType<typeof salesHistory>; currentBand: string }) {
  const maxRank = Math.max(13, ...history.map((row) => row.rank ?? 0));
  return <Card title="Evolución tributaria" meta="tramo de ventas SII">
    {history.length ? <div className="entity360-bars" role="img" aria-label="Evolución del tramo de ventas por año comercial"><div className="entity360-bars-grid" /><div className="entity360-bars-items">{history.map((row) => <div className="entity360-bar-col" key={row.year} title={`${row.year}: tramo ${row.band ?? row.rank ?? '—'}`}><div className="entity360-bar-value">{row.rank ?? '—'}</div><div className="entity360-bar-wrap"><i style={{ height: `${Math.max(8, ((row.rank ?? 0) / maxRank) * 100)}%` }} /></div><div className="entity360-bar-year">{row.year}</div></div>)}</div></div> : <div className="entity360-bigfact"><span>Tramo publicado</span><strong>{currentBand}</strong><small>No hay serie comparable materializada para años anteriores.</small></div>}
    <div className="entity360-chart-note">El gráfico representa el <strong>ordinal del tramo</strong>, no ventas exactas. El rango en UF se muestra en la tarjeta superior.</div>
  </Card>;
}
'''
new = '''function salesBandUfLabel(rank: number | null | undefined) {
  const labels: Record<number, { short: string; full: string; hasUf: boolean }> = {
    1: { short: 'Sin ventas', full: 'Sin ventas', hasUf: false },
    2: { short: '0,01–200', full: '0,01 a 200 UF', hasUf: true },
    3: { short: '200–600', full: '200,01 a 600 UF', hasUf: true },
    4: { short: '600–2,4k', full: '600,01 a 2.400 UF', hasUf: true },
    5: { short: '2,4k–5k', full: '2.400,01 a 5.000 UF', hasUf: true },
    6: { short: '5k–10k', full: '5.000,01 a 10.000 UF', hasUf: true },
    7: { short: '10k–25k', full: '10.000,01 a 25.000 UF', hasUf: true },
    8: { short: '25k–50k', full: '25.000,01 a 50.000 UF', hasUf: true },
    9: { short: '50k–100k', full: '50.000,01 a 100.000 UF', hasUf: true },
    10: { short: '100k–200k', full: '100.000,01 a 200.000 UF', hasUf: true },
    11: { short: '200k–600k', full: '200.000,01 a 600.000 UF', hasUf: true },
    12: { short: '600k–1M', full: '600.000,01 a 1.000.000 UF', hasUf: true },
    13: { short: '>1M', full: 'Más de 1.000.000 UF', hasUf: true },
  };
  return labels[Number(rank)] ?? { short: '—', full: 'Tramo no disponible', hasUf: false };
}

function SalesBandCard({ history, currentBand }: { history: ReturnType<typeof salesHistory>; currentBand: string }) {
  const maxRank = Math.max(13, ...history.map((row) => row.rank ?? 0));
  return <Card title="Evolución tributaria" meta="tramo de ventas SII">
    {history.length ? <div className="entity360-bars" role="img" aria-label="Evolución del tramo de ventas en UF por año comercial"><div className="entity360-bars-grid" /><div className="entity360-bars-items">{history.map((row) => {
      const label = salesBandUfLabel(row.rank);
      return <div className="entity360-bar-col" key={row.year} title={`${row.year}: ${label.full}`}><div className="entity360-bar-value"><span>{label.short}</span>{label.hasUf && <small>UF</small>}</div><div className="entity360-bar-wrap"><i style={{ height: `${Math.max(8, ((row.rank ?? 0) / maxRank) * 100)}%` }} /></div><div className="entity360-bar-year">{row.year}</div></div>;
    })}</div></div> : <div className="entity360-bigfact"><span>Tramo publicado</span><strong>{currentBand}</strong><small>No hay serie comparable materializada para años anteriores.</small></div>}
    <div className="entity360-chart-note">El gráfico muestra el <strong>tramo de ventas en UF</strong> por año comercial. La altura conserva el orden relativo entre tramos y la etiqueta entrega el rango publicado.</div>
  </Card>;
}
'''
if old not in text:
    raise SystemExit('No se encontró el bloque SalesBandCard esperado')
tsx.write_text(text.replace(old, new, 1))

css = Path('src/styles/entity-expediente.css')
styles = css.read_text()
old_css = '''.entity360-bar-col { flex: 1 1 0; display: grid; grid-template-rows: 15px minmax(0, 1fr) 20px; align-self: stretch; min-width: 24px; text-align: center; }
.entity360-bar-value { color: var(--ink-4); font-family: var(--mono); font-size: 8.5px; }
'''
new_css = '''.entity360-bar-col { flex: 1 1 0; display: grid; grid-template-rows: 31px minmax(0, 1fr) 20px; align-self: stretch; min-width: 24px; text-align: center; }
.entity360-bar-value { display: flex; min-width: 0; flex-direction: column; align-items: center; justify-content: flex-end; padding: 0 2px 3px; color: var(--ink-3); font-family: var(--mono); font-size: 8.5px; line-height: 1.05; }
.entity360-bar-value > span { display: block; max-width: 100%; white-space: nowrap; }
.entity360-bar-value > small { display: block; margin-top: 1px; color: var(--ink-4); font-family: var(--font); font-size: 7px; font-weight: 700; letter-spacing: .06em; line-height: 1; }
'''
if old_css not in styles:
    raise SystemExit('No se encontró el bloque CSS de barras esperado')
css.write_text(styles.replace(old_css, new_css, 1))
