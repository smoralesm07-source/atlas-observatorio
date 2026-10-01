from pathlib import Path

path = Path('src/views/EntityExpediente.tsx')
text = path.read_text(encoding='utf-8')


def replace_once(old: str, new: str, label: str) -> None:
    global text
    if old not in text:
        raise SystemExit(f'No se encontró bloque esperado: {label}. No se aplicó un parche parcial.')
    text = text.replace(old, new, 1)


replace_once(
"""type ActivityRow = {
  code: string | null;
  name: string;
  principal: boolean;
};
""",
"""type ActivityRow = {
  code: string | null;
  name: string;
  principal: boolean;
  coverage?: 'CURRENT_ACTECO_LIST' | 'ANNUAL_PRINCIPAL_ACTIVITY';
  commercialYear?: number | null;
  economicSector?: string | null;
  economicSubsector?: string | null;
  source?: string | null;
};
""",
'ActivityRow',
)

replace_once(
"""type EntityTaxHistoryRow = {
  commercial_year: number;
  sales_band?: string | null;
  sales_band_code?: string | null;
  sales_band_rank?: number | null;
  sales_band_uf?: string | null;
  size_label?: string | null;
  workers_numeric?: number | null;
  source?: string | null;
};
""",
"""type EntityTaxHistoryRow = {
  commercial_year: number;
  sales_band?: string | null;
  sales_band_code?: string | null;
  sales_band_rank?: number | null;
  sales_band_uf?: string | null;
  size_label?: string | null;
  workers_numeric?: number | null;
  main_activity?: string | null;
  economic_sector?: string | null;
  economic_subsector?: string | null;
  activity_coverage?: string | null;
  source?: string | null;
};
""",
'EntityTaxHistoryRow',
)

replace_once(
"""  if (rows.length === 0 && main) return [{ name: titleCase(main), code: codes[0] ?? null, principal: true }];
  return rows;
}

function salesHistory(data: EntityDetail, annual: EntityTaxHistoryRow[] | null): TaxEvolutionRow[] {
""",
"""  if (rows.length === 0 && main) return [{
    name: titleCase(main), code: codes[0] ?? null, principal: true,
    coverage: 'CURRENT_ACTECO_LIST', source: text(tax.economic_data_source),
  }];
  return rows.map((row) => ({ ...row, coverage: 'CURRENT_ACTECO_LIST' as const, source: text(tax.economic_data_source) }));
}

function activitiesFromAnnualHistory(annual: EntityTaxHistoryRow[] | null): ActivityRow[] {
  const latest = [...(annual ?? [])]
    .filter((row) => text(row.main_activity))
    .sort((a, b) => Number(b.commercial_year) - Number(a.commercial_year))[0];
  const main = text(latest?.main_activity);
  if (!latest || !main) return [];
  return [{
    code: null,
    name: titleCase(main),
    principal: true,
    coverage: 'ANNUAL_PRINCIPAL_ACTIVITY',
    commercialYear: Number(latest.commercial_year),
    economicSector: text(latest.economic_sector),
    economicSubsector: text(latest.economic_subsector),
    source: text(latest.source) ?? 'RADAR_SII_TAX_HISTORY_WEB_V2',
  }];
}

function salesHistory(data: EntityDetail, annual: EntityTaxHistoryRow[] | null): TaxEvolutionRow[] {
""",
'fallback anual de actividad',
)

replace_once(
"""  const osfl = record(data.osfl);
  const activities = activitiesFor(data);
  const byYear = new Map<number, EntityTaxHistoryRow>();
""",
"""  const osfl = record(data.osfl);
  const materializedActivities = activitiesFor(data);
  const byYear = new Map<number, EntityTaxHistoryRow>();
""",
'inicio merge actividad/historia',
)

replace_once(
"""  const mergedTaxHistory = [...byYear.values()]
    .filter((row) => Number.isFinite(Number(row.commercial_year)))
    .sort((a, b) => Number(a.commercial_year) - Number(b.commercial_year));
  const history = salesHistory(data, mergedTaxHistory);
""",
"""  const mergedTaxHistory = [...byYear.values()]
    .filter((row) => Number.isFinite(Number(row.commercial_year)))
    .sort((a, b) => Number(a.commercial_year) - Number(b.commercial_year));
  const activities = materializedActivities.length ? materializedActivities : activitiesFromAnnualHistory(mergedTaxHistory);
  const history = salesHistory(data, mergedTaxHistory);
""",
'merge actividad anual',
)

replace_once(
"""              {text(tax.main_activity) && <span className=\"entity360-meta-activity\">{titleCase(String(tax.main_activity))}</span>}
""",
"""              {(text(tax.main_activity) ?? activities[0]?.name) && <span className=\"entity360-meta-activity\">{titleCase(String(text(tax.main_activity) ?? activities[0]?.name))}</span>}
""",
'actividad en cabecera',
)

replace_once(
"""function ActivitiesCard({ rows }: { rows: ActivityRow[] }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? rows : rows.slice(0, 5);
  return <Card title=\"Actividades y giros (SII)\" meta={`${n(rows.length)} materializados`}>
    {rows.length ? <div className=\"entity360-activity-list\">{visible.map((row, index) => <div className=\"entity360-activity\" key={`${row.code ?? index}-${row.name}`}><div className=\"entity360-activity-rank\">{String(index + 1).padStart(2, '0')}</div><div className=\"entity360-activity-text\"><strong>{row.name}</strong><span>{row.code ? `Código ${row.code}` : 'Código no materializado'}</span></div>{row.principal && <Badge tone=\"present\">Principal</Badge>}</div>)}{rows.length > 5 && <button className=\"entity360-linkbtn\" onClick={() => setExpanded((value) => !value)}>{expanded ? 'Mostrar menos' : `Ver ${rows.length - 5} actividades más`} →</button>}</div> : <Empty title=\"Sin actividades materializadas\" hint=\"Atlas no tiene giros materializados para esta entidad en el corte actual; esto no equivale a ausencia de actividades en SII.\" />}
  </Card>;
}
""",
"""function ActivitiesCard({ rows }: { rows: ActivityRow[] }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? rows : rows.slice(0, 5);
  const annualFallback = rows.length > 0 && rows.every((row) => row.coverage === 'ANNUAL_PRINCIPAL_ACTIVITY');
  const fallbackYear = annualFallback ? Math.max(...rows.map((row) => Number(row.commercialYear ?? 0))) : null;
  const meta = annualFallback
    ? `actividad principal SII · ${fallbackYear || 'histórico'}`
    : `${n(rows.length)} materializados`;
  return <Card title=\"Actividades y giros (SII)\" meta={meta}>
    {rows.length ? <><div className=\"entity360-activity-list\">{visible.map((row, index) => <div className=\"entity360-activity\" key={`${row.code ?? index}-${row.name}`}><div className=\"entity360-activity-rank\">{String(index + 1).padStart(2, '0')}</div><div className=\"entity360-activity-text\"><strong>{row.name}</strong><span>{row.code ? `Código ${row.code}` : row.coverage === 'ANNUAL_PRINCIPAL_ACTIVITY' ? `Actividad principal · año comercial ${row.commercialYear ?? '—'}` : 'Código no materializado'}</span></div>{row.principal && <Badge tone=\"present\">Principal</Badge>}</div>)}{rows.length > 5 && <button className=\"entity360-linkbtn\" onClick={() => setExpanded((value) => !value)}>{expanded ? 'Mostrar menos' : `Ver ${rows.length - 5} actividades más`} →</button>}</div>{annualFallback && <div className=\"entity360-card-footnote\">Radar SII aporta la actividad económica principal del último año comercial disponible. No se presenta como listado completo de giros vigentes cuando la nómina ACTECO actual no está materializada.</div>}</> : <Empty title=\"Sin actividad económica disponible\" hint=\"Atlas no encontró actividades en la nómina ACTECO vigente ni una actividad principal en la historia anual publicada por Radar SII.\" />}
  </Card>;
}
""",
'ActivitiesCard',
)

replace_once(
"""  const annualAvailableLive = annualGap && Boolean(latestHistory);
  return <div className=\"entity360-tabgrid entity360-tabgrid-tax\"><Card title=\"Perfil tributario\" meta=\"Servicio de Impuestos Internos\"><dl className=\"entity360-kv entity360-kv-wide\">
""",
"""  const annualAvailableLive = annualGap && Boolean(latestHistory);
  const principalActivity = activities.find((row) => row.principal) ?? activities[0];
  const economicSector = text(tax.economic_sector) ?? principalActivity?.economicSector ?? null;
  const economicSubsector = text(tax.economic_subsector) ?? principalActivity?.economicSubsector ?? null;
  return <div className=\"entity360-tabgrid entity360-tabgrid-tax\"><Card title=\"Perfil tributario\" meta=\"Servicio de Impuestos Internos\"><dl className=\"entity360-kv entity360-kv-wide\">
""",
'contexto tributario de actividad',
)

replace_once(
"""    <dt>Sector económico</dt><dd>{text(tax.economic_sector) ? titleCase(String(tax.economic_sector)) : '—'}</dd>
    <dt>Subsector</dt><dd>{text(tax.economic_subsector) ? titleCase(String(tax.economic_subsector)) : '—'}</dd>
""",
"""    <dt>Sector económico</dt><dd>{economicSector ? titleCase(String(economicSector)) : '—'}</dd>
    <dt>Subsector</dt><dd>{economicSubsector ? titleCase(String(economicSubsector)) : '—'}</dd>
""",
'sector/subsector tributario',
)

path.write_text(text, encoding='utf-8')
print('EntityExpediente.tsx actualizado: ACTECO actual con fallback universal a actividad principal anual Radar SII.')
