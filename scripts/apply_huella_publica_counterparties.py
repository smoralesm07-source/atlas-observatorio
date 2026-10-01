from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"Missing patch anchor: {label}")
    return text.replace(old, new, 1)


root = Path(__file__).resolve().parents[1]
relation_path = root / 'src/views/RelacionEstado.tsx'
entity_path = root / 'src/views/EntityExpediente.tsx'

# ---------------------------------------------------------------------------
# Huella pública: fichas laterales de comprador / pagador, siempre bajo demanda.
# ---------------------------------------------------------------------------
relation = relation_path.read_text(encoding='utf-8')
relation = replace_once(
    relation,
    "import { HuellaPublicaTrends, type PublicFundsTrendYear } from '../components/HuellaPublicaTrends';\n",
    "import { HuellaPublicaTrends, type PublicFundsTrendYear } from '../components/HuellaPublicaTrends';\n"
    "import { StateCounterpartyDrawer, type StateCounterpartySelection } from '../components/StateCounterpartyDrawer';\n",
    'counterparty import',
)
relation = replace_once(
    relation,
    "  const [marketHistoryState, setMarketHistoryState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');\n",
    "  const [marketHistoryState, setMarketHistoryState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');\n"
    "  const [counterparty, setCounterparty] = useState<StateCounterpartySelection | null>(null);\n",
    'counterparty state',
)
relation = replace_once(
    relation,
    "  return <div className=\"state-entity-layout\">\n",
    "  return <><div className=\"state-entity-layout\">\n",
    'entity layout fragment open',
)
relation = replace_once(
    relation,
    "          <DetailTable title=\"¿A quién ha vendido?\" source={marketSource} rows={marketBuyerRows.slice(0, 10)} nameKey=\"buyer_label\" fallbackKey=\"buyer_id\" amountKey=\"amount_clp\" countKey=\"order_count\" />\n"
    "          <DetailTable title=\"¿Quién le ha pagado?\" source=\"Presupuesto Abierto\" rows={fundPayerRows.slice(0, 10)} nameKey=\"payer_name\" fallbackKey=\"payer_key\" amountKey=\"amount_paid\" countKey=\"transaction_count\" />\n",
    "          <DetailTable title=\"¿A quién ha vendido?\" source={marketSource} rows={marketBuyerRows.slice(0, 10)} nameKey=\"buyer_label\" fallbackKey=\"buyer_id\" amountKey=\"amount_clp\" countKey=\"order_count\" onOpen={(row) => setCounterparty({\n"
    "            kind: 'buyer', label: String(row.buyer_label || row.buyer_id || 'Organismo comprador'), identifier: row.buyer_id ? String(row.buyer_id) : null,\n"
    "            amount: row.amount_clp == null ? null : Number(row.amount_clp), count: row.order_count == null ? null : Number(row.order_count),\n"
    "            firstYear: row.first_year == null ? fromYear : Number(row.first_year), lastYear: row.last_year == null ? toYear : Number(row.last_year),\n"
    "          })} />\n"
    "          <DetailTable title=\"¿Quién le ha pagado?\" source=\"Presupuesto Abierto\" rows={fundPayerRows.slice(0, 10)} nameKey=\"payer_name\" fallbackKey=\"payer_key\" amountKey=\"amount_paid\" countKey=\"transaction_count\" onOpen={(row) => setCounterparty({\n"
    "            kind: 'payer', label: String(row.payer_name || row.payer_key || 'Organismo pagador'), identifier: row.payer_key ? String(row.payer_key) : null,\n"
    "            amount: row.amount_paid == null ? null : Number(row.amount_paid), count: row.transaction_count == null ? null : Number(row.transaction_count),\n"
    "            firstYear: row.first_year == null ? fromYear : Number(row.first_year), lastYear: row.last_year == null ? toYear : Number(row.last_year),\n"
    "            supplierRole: Boolean(row.supplier_role), recipientRole: Boolean(row.recipient_role),\n"
    "          })} />\n",
    'detail table open handlers',
)
relation = replace_once(
    relation,
    "    </section>\n  </div>;\n}\n\nfunction SampleBuilder",
    "    </section>\n  </div>\n  <StateCounterpartyDrawer item={counterparty} onClose={() => setCounterparty(null)} onNavigate={onNavigate} />\n  </>;\n}\n\nfunction SampleBuilder",
    'entity layout fragment close',
)
relation = replace_once(
    relation,
    "function DetailTable({ title, source, rows, nameKey, fallbackKey, amountKey, countKey }: { title: string; source: string; rows: any[]; nameKey: string; fallbackKey: string; amountKey: string; countKey: string }) {\n"
    "  return <div className=\"detail-list\"><div className=\"detail-list-head\"><strong>{title}</strong><span>{source}</span></div>{rows.length === 0 ? <div className=\"state-empty\">Sin detalle para el período.</div> : rows.map((r, i) => <div className=\"detail-row\" key={`${r[fallbackKey]}-${i}`}><span><b>{r[nameKey] || r[fallbackKey]}</b><small>{yearRange(r.first_year, r.last_year)}</small></span><span><b>{clp(r[amountKey])}</b><small>{num(r[countKey])} registros</small></span></div>)}</div>;\n"
    "}",
    "function DetailTable({ title, source, rows, nameKey, fallbackKey, amountKey, countKey, onOpen }: { title: string; source: string; rows: any[]; nameKey: string; fallbackKey: string; amountKey: string; countKey: string; onOpen: (row: any) => void }) {\n"
    "  return <div className=\"detail-list\"><div className=\"detail-list-head\"><strong>{title}</strong><span>{source}</span></div>{rows.length === 0 ? <div className=\"state-empty\">Sin detalle para el período.</div> : rows.map((r, i) => <button type=\"button\" className=\"detail-row detail-row-button\" key={`${r[fallbackKey]}-${i}`} onClick={() => onOpen(r)}><span><b>{r[nameKey] || r[fallbackKey]}</b><small>{yearRange(r.first_year, r.last_year)}</small></span><span><b>{clp(r[amountKey])}</b><small>{num(r[countKey])} registros · ver ficha</small></span></button>)}</div>;\n"
    "}",
    'clickable detail table',
)
relation_path.write_text(relation, encoding='utf-8')

# ---------------------------------------------------------------------------
# Entidad 360: usa las mismas dos fuentes que Huella pública para el resumen.
# La consulta se hace sólo por RUT de la entidad y reconcilia la cobertura
# publicada en memoria, sin reescribir el snapshot ni duplicar datos.
# ---------------------------------------------------------------------------
entity = entity_path.read_text(encoding='utf-8')
entity = replace_once(
    entity,
    "type TaxEvolutionRow = {\n  year: number;\n  rank: number | null;\n  band: string | null;\n  workers: number | null;\n  source: string | null;\n};\n",
    "type TaxEvolutionRow = {\n  year: number;\n  rank: number | null;\n  band: string | null;\n  workers: number | null;\n  source: string | null;\n};\n\n"
    "type StateMarketSummary = {\n  rut?: string | null;\n  label?: string | null;\n  first_year?: number | null;\n  last_year?: number | null;\n  first_seen?: string | null;\n  last_seen?: string | null;\n  amount_clp?: number | null;\n  order_count?: number | null;\n  buyer_count?: number | null;\n};\n\n"
    "type StateFundsSummary = {\n  rut?: string | null;\n  label?: string | null;\n  first_year?: number | null;\n  last_year?: number | null;\n  first_seen?: string | null;\n  last_seen?: string | null;\n  amount_paid?: number | null;\n  amount_as_supplier?: number | null;\n  amount_as_recipient?: number | null;\n  transaction_count?: number | null;\n  payer_count?: number | null;\n};\n\n"
    "type StateSummaryResponse<T> = { summary?: T | null; supplier?: T | null };\n"
    "type PublicFootprintState = {\n  market: StateMarketSummary | null;\n  funds: StateFundsSummary | null;\n  loading: boolean;\n  error: boolean;\n  fromYear: number;\n  toYear: number;\n  marketCoverage: boolean;\n  fundsCoverage: boolean;\n};\n",
    'state footprint types',
)
entity = replace_once(
    entity,
    "  const { data: taxHistory } = useRpc<EntityTaxHistoryRow[]>('obs_entity_tax_history', { p_entity_id: entityId });\n  const [liveTaxHistory, setLiveTaxHistory] = useState<EntityTaxHistoryRow[] | null>(null);\n",
    "  const { data: taxHistory } = useRpc<EntityTaxHistoryRow[]>('obs_entity_tax_history', { p_entity_id: entityId });\n"
    "  const stateRut = data?.entity.rut ?? null;\n"
    "  const stateFromYear = 2020;\n"
    "  const stateToYear = new Date().getFullYear();\n"
    "  const publishedMarketPresent = Boolean(data?.coverage.some((row) => row.source_code === 'MERCADO_PUBLICO' && row.status === 'PRESENT'));\n"
    "  const publishedFundsPresent = Boolean(data?.coverage.some((row) => row.source_code === 'PRESUPUESTO_ABIERTO' && row.status === 'PRESENT'));\n"
    "  const stateMarket = useRpc<StateSummaryResponse<StateMarketSummary>>('obs_state_interaction_entity', {\n"
    "    p_action: 'summary', p_rut: stateRut, p_query: null, p_from_year: stateFromYear, p_to_year: stateToYear, p_limit: 20, p_offset: 0,\n"
    "  }, { skip: !stateRut || publishedMarketPresent });\n"
    "  const stateFunds = useRpc<StateSummaryResponse<StateFundsSummary>>('obs_state_public_funds_entity', {\n"
    "    p_action: 'summary', p_rut: stateRut, p_query: null, p_from_year: stateFromYear, p_to_year: stateToYear, p_limit: 20, p_offset: 0,\n"
    "  }, { skip: !stateRut || publishedFundsPresent });\n"
    "  const [liveTaxHistory, setLiveTaxHistory] = useState<EntityTaxHistoryRow[] | null>(null);\n",
    'state footprint hooks',
)
entity = replace_once(
    entity,
    "  const finding = mainFinding(data);\n  const purchase = coverageByCode(data, 'MERCADO_PUBLICO');\n  const uafCoverage = coverageByCode(data, 'RADAR_UAF');\n  const siiCoverage = coverageByCode(data, 'RADAR_SII');\n  const osflCoverage = coverageByCode(data, 'RADAR_OSFL', 'REGISTRO_CIVIL_OSFL');\n  const resCoverage = coverageByCode(data, 'RES');\n  const pressCoverage = coverageByCode(data, 'RADAR_PRENSA');\n  const sanctionCoverage = coverageByCode(data, 'RADAR_SANCIONES');\n",
    "  const finding = mainFinding(data);\n"
    "  const marketFootprint = stateMarket.data?.supplier ?? null;\n"
    "  const fundsFootprint = stateFunds.data?.summary ?? null;\n"
    "  const reconciledCoverage: CoverageRow[] = data.coverage.map((row) => {\n"
    "    if (row.source_code === 'MERCADO_PUBLICO' && marketFootprint) return {\n"
    "      ...row, status: 'PRESENT' as const, record_count: marketFootprint.order_count ?? row.record_count,\n"
    "      last_event_at: marketFootprint.last_seen ?? row.last_event_at,\n"
    "      detail: { ...row.detail, unidad: 'órdenes de compra', monto_clp: marketFootprint.amount_clp ?? undefined },\n"
    "    };\n"
    "    if (row.source_code === 'PRESUPUESTO_ABIERTO' && fundsFootprint) return {\n"
    "      ...row, status: 'PRESENT' as const, record_count: fundsFootprint.transaction_count ?? row.record_count,\n"
    "      last_event_at: fundsFootprint.last_seen ?? row.last_event_at,\n"
    "      detail: { ...row.detail, unidad: 'pagos / transferencias', monto_clp: fundsFootprint.amount_paid ?? undefined },\n"
    "    };\n"
    "    return row;\n"
    "  });\n"
    "  const coverage = (...codes: string[]) => reconciledCoverage.find((row) => codes.includes(row.source_code));\n"
    "  const publicFootprint: PublicFootprintState = {\n"
    "    market: marketFootprint, funds: fundsFootprint,\n"
    "    loading: stateMarket.loading || stateFunds.loading, error: Boolean(stateMarket.error || stateFunds.error),\n"
    "    fromYear: stateFromYear, toYear: stateToYear,\n"
    "    marketCoverage: coverage('MERCADO_PUBLICO')?.status === 'PRESENT',\n"
    "    fundsCoverage: coverage('PRESUPUESTO_ABIERTO')?.status === 'PRESENT',\n"
    "  };\n"
    "  const uafCoverage = coverage('RADAR_UAF');\n"
    "  const siiCoverage = coverage('RADAR_SII');\n"
    "  const osflCoverage = coverage('RADAR_OSFL', 'REGISTRO_CIVIL_OSFL');\n"
    "  const resCoverage = coverage('RES');\n"
    "  const pressCoverage = coverage('RADAR_PRENSA');\n"
    "  const sanctionCoverage = coverage('RADAR_SANCIONES');\n",
    'reconciled coverage',
)
entity = replace_once(
    entity,
    "    fuentes: data.coverage.some((row) => row.status === 'PRESENT'),\n",
    "    fuentes: reconciledCoverage.some((row) => row.status === 'PRESENT'),\n",
    'sources tab data marker',
)
entity = replace_once(
    entity,
    "      {tab === 'resumen' && <ResumenTab data={data} press={press} articles={articles} timeline={timeline} activities={activities} history={history} purchase={purchase} registry={{ uaf: uafCoverage, sii: siiCoverage, osfl: osflCoverage, res: resCoverage, press: pressCoverage, sanctions: sanctionCoverage }} />}\n",
    "      {tab === 'resumen' && <ResumenTab data={data} press={press} articles={articles} timeline={timeline} activities={activities} history={history} publicFootprint={publicFootprint} registry={{ uaf: uafCoverage, sii: siiCoverage, osfl: osflCoverage, res: resCoverage, press: pressCoverage, sanctions: sanctionCoverage }} />}\n",
    'summary footprint prop',
)
entity = replace_once(
    entity,
    "      {tab === 'fuentes' && <FuentesTab coverage={data.coverage} />}\n",
    "      {tab === 'fuentes' && <FuentesTab coverage={reconciledCoverage} />}\n",
    'sources reconciled coverage',
)
entity = replace_once(
    entity,
    "function ResumenTab({ data, press, articles, timeline, activities, history, purchase, registry }: {\n  data: EntityDetail;\n  press: PressState;\n  articles: ReturnType<typeof pressArticles>;\n  timeline: TimelineRow[];\n  activities: ActivityRow[];\n  history: ReturnType<typeof salesHistory>;\n  purchase: CoverageRow | undefined;\n  registry: { uaf: CoverageRow | undefined; sii: CoverageRow | undefined; osfl: CoverageRow | undefined; res: CoverageRow | undefined; press: CoverageRow | undefined; sanctions: CoverageRow | undefined };\n}) {\n",
    "function ResumenTab({ data, press, articles, timeline, activities, history, publicFootprint, registry }: {\n  data: EntityDetail;\n  press: PressState;\n  articles: ReturnType<typeof pressArticles>;\n  timeline: TimelineRow[];\n  activities: ActivityRow[];\n  history: ReturnType<typeof salesHistory>;\n  publicFootprint: PublicFootprintState;\n  registry: { uaf: CoverageRow | undefined; sii: CoverageRow | undefined; osfl: CoverageRow | undefined; res: CoverageRow | undefined; press: CoverageRow | undefined; sanctions: CoverageRow | undefined };\n}) {\n",
    'summary signature',
)
entity = replace_once(
    entity,
    "  const purchasePresent = purchase?.status === 'PRESENT';\n  const indexedPressCount",
    "  const marketPresent = Boolean(publicFootprint.market || publicFootprint.marketCoverage);\n"
    "  const fundsPresent = Boolean(publicFootprint.funds || publicFootprint.fundsCoverage);\n"
    "  const footprintPresent = marketPresent || fundsPresent;\n"
    "  const footprintUnknown = !footprintPresent && (publicFootprint.loading || publicFootprint.error);\n"
    "  const footprintValue = publicFootprint.loading && !footprintPresent ? 'Consultando…' : footprintPresent ? 'Sí registra' : publicFootprint.error ? 'No disponible' : 'No registra';\n"
    "  const footprintSub = marketPresent && fundsPresent\n"
    "    ? `Mercado Público + Presupuesto Abierto · ${publicFootprint.fromYear}–${publicFootprint.toYear}`\n"
    "    : publicFootprint.market\n"
    "      ? `Mercado Público · ${formatClp(publicFootprint.market.amount_clp)} · ${n(publicFootprint.market.order_count ?? 0)} OC`\n"
    "      : publicFootprint.funds\n"
    "        ? `Presupuesto Abierto · ${formatClp(publicFootprint.funds.amount_paid)} · ${n(publicFootprint.funds.transaction_count ?? 0)} transacciones`\n"
    "        : marketPresent\n"
    "          ? 'Mercado Público · presencia materializada'\n"
    "          : fundsPresent\n"
    "            ? 'Presupuesto Abierto · presencia materializada'\n"
    "            : footprintUnknown ? 'Verificando fuentes consolidadas' : `Sin compras ni pagos observados · ${publicFootprint.fromYear}–${publicFootprint.toYear}`;\n"
    "  const indexedPressCount",
    'summary footprint state',
)
entity = replace_once(
    entity,
    "        <Kpi icon=\"public\" label=\"Proveedor del Estado\" value={purchasePresent ? 'Sí' : coverageLabel(purchase)} sub=\"ChileCompra · señal de presencia\" tone={purchasePresent ? 'present' : 'neutral'} />\n",
    "        <Kpi icon=\"public\" label=\"Huella pública\" value={footprintValue} sub={footprintSub} tone={footprintPresent ? 'present' : 'neutral'} />\n",
    'summary public KPI',
)
entity = replace_once(
    entity,
    "      <div className=\"entity360-row entity360-row-middle\"><RegistryCard data={data} pressStatus={press.status} pressCount={Number(pressCount)} registry={registry} purchase={purchase} /><TimelineCard rows={timeline} /></div>\n",
    "      <div className=\"entity360-row entity360-row-middle\"><RegistryCard data={data} pressStatus={press.status} pressCount={Number(pressCount)} registry={registry} publicFootprint={publicFootprint} /><TimelineCard rows={timeline} /></div>\n",
    'registry footprint prop',
)
entity = replace_once(
    entity,
    "function RegistryCard({ data, pressStatus, pressCount, registry, purchase }: {\n  data: EntityDetail;\n  pressStatus: PressState['status'];\n  pressCount: number;\n  registry: { uaf: CoverageRow | undefined; sii: CoverageRow | undefined; osfl: CoverageRow | undefined; res: CoverageRow | undefined; press: CoverageRow | undefined; sanctions: CoverageRow | undefined };\n  purchase: CoverageRow | undefined;\n}) {\n  const pressTone = pressStatus === 'loading' ? 'unknown' : pressCount > 0 ? 'present' : coverageStatus(registry.press);\n",
    "function RegistryCard({ data, pressStatus, pressCount, registry, publicFootprint }: {\n  data: EntityDetail;\n  pressStatus: PressState['status'];\n  pressCount: number;\n  registry: { uaf: CoverageRow | undefined; sii: CoverageRow | undefined; osfl: CoverageRow | undefined; res: CoverageRow | undefined; press: CoverageRow | undefined; sanctions: CoverageRow | undefined };\n  publicFootprint: PublicFootprintState;\n}) {\n  const pressTone = pressStatus === 'loading' ? 'unknown' : pressCount > 0 ? 'present' : coverageStatus(registry.press);\n  const marketPresent = Boolean(publicFootprint.market || publicFootprint.marketCoverage);\n  const fundsPresent = Boolean(publicFootprint.funds || publicFootprint.fundsCoverage);\n  const publicPresent = marketPresent || fundsPresent;\n  const publicUnknown = !publicPresent && (publicFootprint.loading || publicFootprint.error);\n  const publicSources = [marketPresent ? 'Mercado Público' : null, fundsPresent ? 'Presupuesto Abierto' : null].filter(Boolean).join(' + ');\n",
    'registry signature',
)
entity = replace_once(
    entity,
    "    <RegistryTile icon=\"public\" label=\"Proveedor del Estado\" status={coverageStatus(purchase)} value={purchase?.status === 'PRESENT' ? 'Sí' : coverageLabel(purchase)} detail=\"ChileCompra · presencia como proveedor\" />\n",
    "    <RegistryTile icon=\"public\" label=\"Huella pública\" status={publicPresent ? 'present' : publicUnknown ? 'unknown' : 'absent'} value={publicFootprint.loading && !publicPresent ? 'Consultando…' : publicPresent ? 'Sí registra' : publicFootprint.error ? 'No disponible' : 'No registra'} detail={publicSources || `Mercado Público + Presupuesto Abierto · ${publicFootprint.fromYear}–${publicFootprint.toYear}`} />\n",
    'registry public tile',
)
entity_path.write_text(entity, encoding='utf-8')

print('Huella pública counterparties and Entity 360 coherence patch applied.')
