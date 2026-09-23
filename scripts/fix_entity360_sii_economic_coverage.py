from pathlib import Path

path = Path('src/views/EntityExpediente.tsx')
text = path.read_text(encoding='utf-8')

old = """function numberValue(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
"""
new = """function numberValue(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

type SiiEconomicDisplay = { value: string; sub: string };

function atlasAnnualMissing(tax: Record<string, unknown>, fieldStatus?: string | null): boolean {
  return text(tax.economic_data_status) === 'ATLAS_ANNUAL_NOT_MATERIALIZED'
    || fieldStatus === 'ATLAS_NOT_MATERIALIZED';
}

function salesBandDisplay(tax: Record<string, unknown>, fallback?: string | null): SiiEconomicDisplay {
  const status = text(tax.sales_data_status);
  const year = text(tax.commercial_year);
  if (atlasAnnualMissing(tax, status)) {
    return {
      value: 'No cargado en Atlas',
      sub: 'Histórico anual SII pendiente de materialización',
    };
  }
  if (status === 'SII_REPORTED_NO_INFORMATION' || numberValue(tax.sales_band_rank) === 1) {
    return {
      value: 'Sin información SII',
      sub: year ? `Año comercial ${year} · tramo 1 SII` : 'Tramo 1 informado por SII',
    };
  }
  const band = text(tax.sales_band_uf) ?? fallback ?? 'Sin tramo';
  return {
    value: band,
    sub: year ? `Año comercial ${year}` : 'SII',
  };
}

function workersDisplay(tax: Record<string, unknown>, fallback?: number | null): SiiEconomicDisplay {
  const status = text(tax.workers_data_status);
  if (atlasAnnualMissing(tax, status)) {
    return {
      value: 'No cargado en Atlas',
      sub: 'Histórico anual SII pendiente de materialización',
    };
  }
  const workers = numberValue(tax.workers_numeric) ?? fallback ?? null;
  if (workers == null) {
    return {
      value: '—',
      sub: status === 'SII_NOT_REPORTED' ? 'No informado por SII' : 'Sin dato materializado',
    };
  }
  return { value: n(workers), sub: 'Dotación publicada por SII' };
}
"""
if old not in text:
    raise SystemExit('No se encontró numberValue esperado; no se aplicó ningún cambio.')
text = text.replace(old, new, 1)

old = """  const salesBand = text(tax.sales_band_uf) ?? data.entity.tax_sales_band_uf ?? 'Sin tramo';
  const workers = numberValue(tax.workers_numeric) ?? data.entity.tax_workers;
"""
new = """  const salesBand = salesBandDisplay(tax, data.entity.tax_sales_band_uf);
  const workers = workersDisplay(tax, data.entity.tax_workers);
"""
if old not in text:
    raise SystemExit('No se encontró bloque de KPI económico esperado.')
text = text.replace(old, new, 1)

old = """        <Kpi icon=\"sales\" label=\"Tramo ventas (UF)\" value={salesBand} sub={text(tax.commercial_year) ? `Año comercial ${text(tax.commercial_year)}` : 'SII'} compact />
        <Kpi icon=\"people\" label=\"Trabajadores\" value={workers == null ? '—' : n(workers)} sub={workers == null ? 'Sin dato publicado' : 'Dotación publicada por SII'} />
"""
new = """        <Kpi icon=\"sales\" label=\"Tramo ventas (UF)\" value={salesBand.value} sub={salesBand.sub} compact />
        <Kpi icon=\"people\" label=\"Trabajadores\" value={workers.value} sub={workers.sub} compact={workers.value === 'No cargado en Atlas'} />
"""
if old not in text:
    raise SystemExit('No se encontró render de KPI económico esperado.')
text = text.replace(old, new, 1)

old = """    1: { short: 'Sin ventas', full: 'Sin ventas', hasUf: false },
"""
new = """    1: { short: 'Sin info.', full: 'Sin información de ventas (SII)', hasUf: false },
"""
if old not in text:
    raise SystemExit('No se encontró semántica antigua del tramo 1.')
text = text.replace(old, new, 1)

old = """function SalesBandCard({ history, currentBand }: { history: ReturnType<typeof salesHistory>; currentBand: string }) {
  const maxRank = Math.max(13, ...history.map((row) => row.rank ?? 0));
  return <Card title=\"Evolución tributaria\" meta=\"tramo de ventas SII\">
    {history.length ? <div className=\"entity360-bars\" role=\"img\" aria-label=\"Evolución del tramo de ventas en UF por año comercial\"><div className=\"entity360-bars-grid\" /><div className=\"entity360-bars-items\">{history.map((row) => {
      const label = salesBandUfLabel(row.rank);
      return <div className=\"entity360-bar-col\" key={row.year} title={`${row.year}: ${label.full}`}><div className=\"entity360-bar-value\"><span>{label.short}</span>{label.hasUf && <small>UF</small>}</div><div className=\"entity360-bar-wrap\"><i style={{ height: `${Math.max(8, ((row.rank ?? 0) / maxRank) * 100)}%` }} /></div><div className=\"entity360-bar-year\">{row.year}</div></div>;
    })}</div></div> : <div className=\"entity360-bigfact\"><span>Tramo publicado</span><strong>{currentBand}</strong><small>No hay serie comparable materializada para años anteriores.</small></div>}
    <div className=\"entity360-chart-note\">El gráfico muestra el <strong>tramo de ventas en UF</strong> por año comercial. La altura conserva el orden relativo entre tramos y la etiqueta entrega el rango publicado.</div>
  </Card>;
}
"""
new = """function SalesBandCard({ history, currentBand, dataStatus }: { history: ReturnType<typeof salesHistory>; currentBand: string; dataStatus?: string | null }) {
  const maxRank = Math.max(13, ...history.map((row) => row.rank ?? 0));
  const atlasMissing = dataStatus === 'ATLAS_NOT_MATERIALIZED';
  return <Card title=\"Evolución tributaria\" meta=\"tramo de ventas SII\">
    {history.length ? <div className=\"entity360-bars\" role=\"img\" aria-label=\"Evolución del tramo de ventas en UF por año comercial\"><div className=\"entity360-bars-grid\" /><div className=\"entity360-bars-items\">{history.map((row) => {
      const label = salesBandUfLabel(row.rank);
      return <div className=\"entity360-bar-col\" key={row.year} title={`${row.year}: ${label.full}`}><div className=\"entity360-bar-value\"><span>{label.short}</span>{label.hasUf && <small>UF</small>}</div><div className=\"entity360-bar-wrap\"><i style={{ height: `${Math.max(8, ((row.rank ?? 0) / maxRank) * 100)}%` }} /></div><div className=\"entity360-bar-year\">{row.year}</div></div>;
    })}</div></div> : atlasMissing ? <Empty title=\"Histórico anual SII no cargado en Atlas\" hint=\"La entidad está presente en el registro SII, pero su perfil económico anual todavía no fue materializado en este corte.\" /> : <div className=\"entity360-bigfact\"><span>Tramo publicado</span><strong>{currentBand}</strong><small>No hay serie comparable materializada para años anteriores.</small></div>}
    <div className=\"entity360-chart-note\">El gráfico muestra el <strong>tramo de ventas en UF</strong> por año comercial. El tramo 1 significa <strong>sin información de ventas</strong>, no ventas cero. La altura conserva el orden relativo entre tramos y la etiqueta entrega el rango publicado.</div>
  </Card>;
}
"""
if old not in text:
    raise SystemExit('No se encontró SalesBandCard esperado.')
text = text.replace(old, new, 1)

old = """  </div></Card>;
}

function RegistryCard"""
# Sólo cambia el primer bloque correspondiente a ActivitiesCard inmediatamente antes de RegistryCard.
activity_old = """{rows.length ? <div className=\"entity360-activity-list\">{visible.map((row, index) => <div className=\"entity360-activity\" key={`${row.code ?? index}-${row.name}`}><div className=\"entity360-activity-rank\">{String(index + 1).padStart(2, '0')}</div><div className=\"entity360-activity-text\"><strong>{row.name}</strong><span>{row.code ? `Código ${row.code}` : 'Código no materializado'}</span></div>{row.principal && <Badge tone=\"present\">Principal</Badge>}</div>)}{rows.length > 5 && <button className=\"entity360-linkbtn\" onClick={() => setExpanded((value) => !value)}>{expanded ? 'Mostrar menos' : `Ver ${rows.length - 5} actividades más`} →</button>}</div> : <Empty title=\"Sin actividades materializadas\" hint=\"El corte SII no aporta giros para esta entidad.\" />}
"""
activity_new = """{rows.length ? <div className=\"entity360-activity-list\">{visible.map((row, index) => <div className=\"entity360-activity\" key={`${row.code ?? index}-${row.name}`}><div className=\"entity360-activity-rank\">{String(index + 1).padStart(2, '0')}</div><div className=\"entity360-activity-text\"><strong>{row.name}</strong><span>{row.code ? `Código ${row.code}` : 'Código no materializado'}</span></div>{row.principal && <Badge tone=\"present\">Principal</Badge>}</div>)}{rows.length > 5 && <button className=\"entity360-linkbtn\" onClick={() => setExpanded((value) => !value)}>{expanded ? 'Mostrar menos' : `Ver ${rows.length - 5} actividades más`} →</button>}</div> : <Empty title=\"Sin actividades materializadas\" hint=\"Atlas no tiene giros materializados para esta entidad en el corte actual; esto no equivale a ausencia de actividades en SII.\" />}
"""
if activity_old not in text:
    raise SystemExit('No se encontró mensaje de ActivitiesCard esperado.')
text = text.replace(activity_old, activity_new, 1)

old = """function TributarioTab({ data, activities, history }: { data: EntityDetail; activities: ActivityRow[]; history: ReturnType<typeof salesHistory> }) {
  const tax = record(data.tax);
  const workers = numberValue(tax.workers_numeric);
  return <div className=\"entity360-tabgrid entity360-tabgrid-tax\"><Card title=\"Perfil tributario\" meta=\"Servicio de Impuestos Internos\"><dl className=\"entity360-kv entity360-kv-wide\">
"""
new = """function TributarioTab({ data, activities, history }: { data: EntityDetail; activities: ActivityRow[]; history: ReturnType<typeof salesHistory> }) {
  const tax = record(data.tax);
  const salesBand = salesBandDisplay(tax, data.entity.tax_sales_band_uf);
  const workers = workersDisplay(tax, data.entity.tax_workers);
  const annualMissing = text(tax.economic_data_status) === 'ATLAS_ANNUAL_NOT_MATERIALIZED';
  return <div className=\"entity360-tabgrid entity360-tabgrid-tax\"><Card title=\"Perfil tributario\" meta=\"Servicio de Impuestos Internos\"><dl className=\"entity360-kv entity360-kv-wide\">
"""
if old not in text:
    raise SystemExit('No se encontró inicio de TributarioTab esperado.')
text = text.replace(old, new, 1)

old = """    <dt>Tramo ventas UF</dt><dd>{text(tax.sales_band_uf) ?? '—'}</dd>
    <dt>Trabajadores</dt><dd className=\"mono\">{workers == null ? '—' : n(workers)}</dd>
    <dt>Domicilios observados</dt><dd className=\"mono\">{numberValue(tax.address_count) == null ? '—' : n(numberValue(tax.address_count))}</dd>
  </dl></Card><SalesBandCard history={history} currentBand={text(tax.sales_band_uf) ?? 'Sin tramo'} /><ActivitiesCard rows={activities} /></div>;
}
"""
new = """    <dt>Tramo ventas UF</dt><dd>{salesBand.value}</dd>
    <dt>Trabajadores</dt><dd className={workers.value === 'No cargado en Atlas' ? undefined : 'mono'}>{workers.value}</dd>
    {annualMissing && <><dt>Cobertura económica</dt><dd>Histórico anual SII no materializado en Atlas</dd></>}
    <dt>Domicilios observados</dt><dd className=\"mono\">{numberValue(tax.address_count) == null ? '—' : n(numberValue(tax.address_count))}</dd>
  </dl></Card><SalesBandCard history={history} currentBand={salesBand.value} dataStatus={text(tax.sales_data_status)} /><ActivitiesCard rows={activities} /></div>;
}
"""
if old not in text:
    raise SystemExit('No se encontró cierre de TributarioTab esperado.')
text = text.replace(old, new, 1)

path.write_text(text, encoding='utf-8')
print('EntityExpediente.tsx actualizado: cobertura económica SII explícita y tramo 1 corregido.')
