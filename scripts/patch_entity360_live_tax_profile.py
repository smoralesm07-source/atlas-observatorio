from pathlib import Path

path = Path('src/views/EntityExpediente.tsx')
text = path.read_text(encoding='utf-8')

replacements = [
    (
        "function salesBandDisplay(tax: Record<string, unknown>, fallback?: string | null): SiiEconomicDisplay {\n  const status = text(tax.sales_data_status);\n  const year = text(tax.commercial_year);\n  if (atlasAnnualMissing(tax, status)) {\n    return {\n      value: 'No cargado en Atlas',\n      sub: 'Histórico anual SII pendiente de materialización',\n    };\n  }\n",
        "function salesBandDisplay(tax: Record<string, unknown>, fallback?: string | null, latest?: TaxEvolutionRow | null): SiiEconomicDisplay {\n  const status = text(tax.sales_data_status);\n  const year = text(tax.commercial_year);\n  if (atlasAnnualMissing(tax, status)) {\n    if (latest && (latest.rank != null || latest.band)) {\n      if (latest.rank === 1) {\n        return {\n          value: 'Sin información SII',\n          sub: `Año comercial ${latest.year} · tramo 1 SII · Radar SII`,\n        };\n      }\n      return {\n        value: latest.band ?? salesBandUfLabel(latest.rank).full,\n        sub: `Año comercial ${latest.year} · Radar SII`,\n      };\n    }\n    return {\n      value: 'No cargado en Atlas',\n      sub: 'Histórico anual SII pendiente de materialización',\n    };\n  }\n",
    ),
    (
        "function workersDisplay(tax: Record<string, unknown>, fallback?: number | null): SiiEconomicDisplay {\n  const status = text(tax.workers_data_status);\n  if (atlasAnnualMissing(tax, status)) {\n    return {\n      value: 'No cargado en Atlas',\n      sub: 'Histórico anual SII pendiente de materialización',\n    };\n  }\n",
        "function workersDisplay(tax: Record<string, unknown>, fallback?: number | null, latest?: TaxEvolutionRow | null): SiiEconomicDisplay {\n  const status = text(tax.workers_data_status);\n  if (atlasAnnualMissing(tax, status)) {\n    if (latest && latest.workers != null) {\n      return { value: n(latest.workers), sub: `Año comercial ${latest.year} · Radar SII` };\n    }\n    return {\n      value: 'No cargado en Atlas',\n      sub: 'Histórico anual SII pendiente de materialización',\n    };\n  }\n",
    ),
    (
        "function TributarioTab({ data, activities, history }: { data: EntityDetail; activities: ActivityRow[]; history: ReturnType<typeof salesHistory> }) {\n  const tax = record(data.tax);\n  const salesBand = salesBandDisplay(tax, data.entity.tax_sales_band_uf);\n  const workers = workersDisplay(tax, data.entity.tax_workers);\n  const annualMissing = text(tax.economic_data_status) === 'ATLAS_ANNUAL_NOT_MATERIALIZED';\n",
        "function TributarioTab({ data, activities, history }: { data: EntityDetail; activities: ActivityRow[]; history: ReturnType<typeof salesHistory> }) {\n  const tax = record(data.tax);\n  const latestHistory = history.length ? history[history.length - 1] : null;\n  const salesBand = salesBandDisplay(tax, data.entity.tax_sales_band_uf, latestHistory);\n  const workers = workersDisplay(tax, data.entity.tax_workers, latestHistory);\n  const annualGap = text(tax.economic_data_status) === 'ATLAS_ANNUAL_NOT_MATERIALIZED';\n  const annualMissing = annualGap && !latestHistory;\n  const annualAvailableLive = annualGap && Boolean(latestHistory);\n",
    ),
    (
        "  const tax = record(data.tax);\n  const salesBand = salesBandDisplay(tax, data.entity.tax_sales_band_uf);\n  const workers = workersDisplay(tax, data.entity.tax_workers);\n",
        "  const tax = record(data.tax);\n  const latestHistory = history.length ? history[history.length - 1] : null;\n  const salesBand = salesBandDisplay(tax, data.entity.tax_sales_band_uf, latestHistory);\n  const workers = workersDisplay(tax, data.entity.tax_workers, latestHistory);\n",
    ),
    (
        "    {annualMissing && <><dt>Cobertura económica</dt><dd>Histórico anual SII no materializado en Atlas</dd></>}\n",
        "    {annualMissing && <><dt>Cobertura económica</dt><dd>Histórico anual SII no materializado en Atlas</dd></>}\n    {annualAvailableLive && latestHistory && <><dt>Cobertura económica</dt><dd>Disponible vía Radar SII · último año {latestHistory.year}</dd></>}\n",
    ),
]

for old, new in replacements:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'Expected exactly one match, found {count}: {old[:160]!r}')
    text = text.replace(old, new, 1)

path.write_text(text, encoding='utf-8')
print('Entity 360 live tax profile semantics patched.')
