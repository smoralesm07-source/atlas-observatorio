from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    if old not in text:
        raise SystemExit(f'No se encontró el bloque esperado en {path}: {old[:120]!r}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')


def remove_once(path: str, old: str) -> None:
    replace_once(path, old, '')


# 1) App: Gasto público deja de ser una vista/ruta del producto y viewer no entra a Gestión SO.
remove_once('src/App.tsx', "import { GastoPublico } from './views/GastoPublico';\n")
replace_once(
    'src/App.tsx',
    "  const publicSpendRestricted = role !== 'admin'\n    && (route.view === 'gasto' || route.view === 'gastoActor');\n\n  useEffect(() => {\n    if (!publicSpendRestricted) return;\n    if (window.location.hash !== '#/pulso') window.location.hash = '#/pulso';\n  }, [publicSpendRestricted]);\n\n  if (publicSpendRestricted) {\n    return (\n      <Shell route={{ view: 'pulso' }} session={session} role={role}>\n        <PulsoV6 onNavigate={go} />\n      </Shell>\n    );\n  }\n",
    "  const caseManagementRestricted = role === 'viewer'\n    && route.view === 'universo'\n    && route.mode === 'casos';\n\n  useEffect(() => {\n    if (!caseManagementRestricted) return;\n    if (window.location.hash !== '#/universo-so') window.location.hash = '#/universo-so';\n  }, [caseManagementRestricted]);\n\n  if (caseManagementRestricted) {\n    return (\n      <Shell route={{ view: 'universo', mode: 'padron' }} session={session} role={role}>\n        <UniversoSOV2 onNavigate={go} initialMode=\"padron\" />\n      </Shell>\n    );\n  }\n",
)
replace_once(
    'src/App.tsx',
    "          <Entity360StatusMarks entityId={route.entityId} />",
    "          <Entity360StatusMarks entityId={route.entityId} role={role} />",
)
remove_once('src/App.tsx', "      {route.view === 'gasto' && <GastoPublico familiaInicial={route.familia} onNavigate={go} />}\n")
remove_once(
    'src/App.tsx',
    "      {route.view === 'gastoActor' && (\n        <GastoPublico\n          key={`${route.role}|${route.actorId}`}\n          actor={{ id: route.actorId, role: route.role }}\n          onNavigate={go}\n        />\n      )}\n",
)

# 2) Shell: no se ofrece Gasto público y Gestión SO sólo aparece a analyst/admin.
remove_once(
    'src/components/Shell.tsx',
    "          {role === 'admin' && (\n            <a href={hrefFor({ view: 'gasto' })} data-active={['gasto', 'gastoActor'].includes(route.view)}>\n              Gasto público\n            </a>\n          )}\n\n",
)
replace_once(
    'src/components/Shell.tsx',
    "                <a\n                  href={hrefFor({ view: 'universo', mode: 'casos', cola: 'potenciales' })}\n                  className=\"monitor-menu-item\"\n                  data-active={universoMode === 'casos'}\n                  role=\"menuitem\"\n                  onClick={() => setOpenMenu(null)}\n                >\n                  <span className=\"monitor-menu-icon\"><UniversoGlyph mode=\"casos\" /></span>\n                  <span className=\"monitor-menu-copy\">\n                    <strong>Gestión SO</strong>\n                    <small>Potenciales SO, términos de giro y cartera compartida</small>\n                  </span>\n                  <span className=\"monitor-menu-arrow\" aria-hidden>›</span>\n                </a>\n",
    "                {role !== 'viewer' && (\n                  <a\n                    href={hrefFor({ view: 'universo', mode: 'casos', cola: 'potenciales' })}\n                    className=\"monitor-menu-item\"\n                    data-active={universoMode === 'casos'}\n                    role=\"menuitem\"\n                    onClick={() => setOpenMenu(null)}\n                  >\n                    <span className=\"monitor-menu-icon\"><UniversoGlyph mode=\"casos\" /></span>\n                    <span className=\"monitor-menu-copy\">\n                      <strong>Gestión SO</strong>\n                      <small>Potenciales SO, términos de giro y cartera compartida</small>\n                    </span>\n                    <span className=\"monitor-menu-arrow\" aria-hidden>›</span>\n                  </a>\n                )}\n",
)

# 3) Router: enlaces antiguos a /gasto ya no resuelven a una superficie Atlas.
remove_once('src/lib/router.ts', "  | { view: 'gasto'; familia?: string }\n")
remove_once('src/lib/router.ts', "  | { view: 'gastoActor'; actorId: string; role: 'BUYER' | 'SUPPLIER' }\n")
remove_once(
    'src/lib/router.ts',
    "    case 'gasto':\n      if (seg[1] === 'comprador' && seg[2]) {\n        return { view: 'gastoActor', actorId: decodeURIComponent(seg[2]), role: 'BUYER' };\n      }\n      if (seg[1] === 'proveedor' && seg[2]) {\n        return { view: 'gastoActor', actorId: decodeURIComponent(seg[2]), role: 'SUPPLIER' };\n      }\n      return { view: 'gasto', familia: params.get('familia') ?? undefined };\n",
)
remove_once(
    'src/lib/router.ts',
    "    case 'gasto':\n      return r.familia ? `#/gasto?familia=${encodeURIComponent(r.familia)}` : '#/gasto';\n    case 'gastoActor':\n      return `#/gasto/${r.role === 'BUYER' ? 'comprador' : 'proveedor'}/${encodeURIComponent(r.actorId)}`;\n",
)

# 4) Entidad 360: conservar sólo la señal de proveedor del Estado.
replace_once(
    'src/views/EntityExpediente.tsx',
    "type Tab = 'resumen' | 'tributario' | 'uaf' | 'sanciones' | 'compras' | 'registros' | 'historico' | 'fuentes';",
    "type Tab = 'resumen' | 'tributario' | 'uaf' | 'sanciones' | 'registros' | 'historico' | 'fuentes';",
)
replace_once(
    'src/views/EntityExpediente.tsx',
    "type TimelineKind = 'tax' | 'sanction' | 'press' | 'purchase' | 'event';",
    "type TimelineKind = 'tax' | 'sanction' | 'press' | 'event';",
)
remove_once('src/views/EntityExpediente.tsx', "  { id: 'compras', label: 'Compras públicas' },\n")
remove_once(
    'src/views/EntityExpediente.tsx',
    "  const purchases = coverageByCode(data, 'MERCADO_PUBLICO');\n  if (purchases?.status === 'PRESENT') {\n    rows.push({\n      key: 'purchase-source',\n      date: purchases.last_event_at,\n      title: purchases.record_count ? `${n(purchases.record_count)} registros en compras públicas` : 'Registro en compras públicas',\n      detail: purchases.detail?.monto_12m_clp != null ? `Monto observado 12 meses: ${formatClp(purchases.detail.monto_12m_clp)}` : null,\n      source: 'ChileCompra',\n      kind: 'purchase',\n    });\n  }\n",
)
replace_once(
    'src/views/EntityExpediente.tsx',
    "  data.events.forEach((event) => {\n    if (event.productor === 'RADAR_SANCIONES' || event.productor === 'RADAR_PRENSA') return;",
    "  data.events.forEach((event) => {\n    const producer = String(event.productor ?? '').toUpperCase();\n    if (producer === 'RADAR_SANCIONES' || producer === 'RADAR_PRENSA'\n      || /GASTO|COMPRA|MERCADO_PUBLICO|PRESUPUESTO/.test(producer)) return;",
)
remove_once('src/views/EntityExpediente.tsx', "    compras: purchase?.status === 'PRESENT' || Number(purchase?.record_count ?? 0) > 0,\n")
replace_once(
    'src/views/EntityExpediente.tsx',
    "      {tab === 'resumen' && <ResumenTab data={data} press={press} articles={articles} timeline={timeline} activities={activities} history={history} purchase={purchase} registry={{ uaf: uafCoverage, sii: siiCoverage, osfl: osflCoverage, res: resCoverage, press: pressCoverage, sanctions: sanctionCoverage }} onNavigate={onNavigate} />}",
    "      {tab === 'resumen' && <ResumenTab data={data} press={press} articles={articles} timeline={timeline} activities={activities} history={history} purchase={purchase} registry={{ uaf: uafCoverage, sii: siiCoverage, osfl: osflCoverage, res: resCoverage, press: pressCoverage, sanctions: sanctionCoverage }} />}",
)
remove_once('src/views/EntityExpediente.tsx', "      {tab === 'compras' && <ComprasTab data={data} coverage={purchase} onNavigate={onNavigate} />}\n")
replace_once(
    'src/views/EntityExpediente.tsx',
    "  registry: { uaf: CoverageRow | undefined; sii: CoverageRow | undefined; osfl: CoverageRow | undefined; res: CoverageRow | undefined; press: CoverageRow | undefined; sanctions: CoverageRow | undefined };\n  onNavigate: (hash: string) => void;\n}) {",
    "  registry: { uaf: CoverageRow | undefined; sii: CoverageRow | undefined; osfl: CoverageRow | undefined; res: CoverageRow | undefined; press: CoverageRow | undefined; sanctions: CoverageRow | undefined };\n}) {",
)
remove_once('src/views/EntityExpediente.tsx', "  const purchaseCount = purchase?.record_count ?? 0;\n")
remove_once('src/views/EntityExpediente.tsx', "  const purchaseAmount = purchase?.detail?.monto_12m_clp ?? purchase?.detail?.monto_clp ?? null;\n")
replace_once(
    'src/views/EntityExpediente.tsx',
    "        <Kpi icon=\"public\" label=\"Proveedor del Estado\" value={purchasePresent ? `${n(purchaseCount)} registros` : coverageLabel(purchase)} sub={purchasePresent && purchaseAmount != null ? formatClp(purchaseAmount) : 'ChileCompra'} tone={purchasePresent ? 'present' : 'neutral'} />",
    "        <Kpi icon=\"public\" label=\"Proveedor del Estado\" value={purchasePresent ? 'Sí' : coverageLabel(purchase)} sub=\"ChileCompra · señal de presencia\" tone={purchasePresent ? 'present' : 'neutral'} />",
)
replace_once(
    'src/views/EntityExpediente.tsx',
    "      <div className=\"entity360-row entity360-row-bottom\"><SanctionsCard data={data} /><PressCard press={press} articles={articles} /><PurchasesCard data={data} coverage={purchase} onNavigate={onNavigate} /></div>",
    "      <div className=\"entity360-row entity360-row-bottom\"><SanctionsCard data={data} /><PressCard press={press} articles={articles} /></div>",
)
replace_once(
    'src/views/EntityExpediente.tsx',
    "    <RegistryTile icon=\"public\" label=\"Compras públicas\" status={coverageStatus(purchase)} value={coverageLabel(purchase)} detail={purchase?.record_count ? `${n(purchase.record_count)} registros` : 'ChileCompra'} />",
    "    <RegistryTile icon=\"public\" label=\"Proveedor del Estado\" status={coverageStatus(purchase)} value={purchase?.status === 'PRESENT' ? 'Sí' : coverageLabel(purchase)} detail=\"ChileCompra · presencia como proveedor\" />",
)
remove_once(
    'src/views/EntityExpediente.tsx',
    "function PurchasesCard({ data, coverage, onNavigate }: { data: EntityDetail; coverage: CoverageRow | undefined; onNavigate: (hash: string) => void }) {\n  const present = coverage?.status === 'PRESENT';\n  const amount = coverage?.detail?.monto_12m_clp ?? coverage?.detail?.monto_clp ?? null;\n  const count = coverage?.record_count ?? 0;\n  return <Card title=\"Compras públicas\" meta=\"ChileCompra\">{present ? <div className=\"entity360-purchase\"><div className=\"entity360-purchase-facts\"><div><span>Registros</span><strong>{n(count)}</strong></div><div><span>Monto observado</span><strong>{formatClp(amount)}</strong></div><div><span>Último evento</span><strong>{fecha(coverage?.last_event_at)}</strong></div></div>{data.entity.rut && <button className=\"entity360-primary-action\" onClick={() => onNavigate(`#/gasto/proveedor/${encodeURIComponent(data.entity.rut as string)}`)}>Abrir perfil de proveedor →</button>}</div> : <Empty title={coverageLabel(coverage)} hint=\"La ficha no inventa contrapartes ni montos cuando el productor de compras públicas no materializa a la entidad.\" />}</Card>;\n}\n\n",
)
remove_once(
    'src/views/EntityExpediente.tsx',
    "function ComprasTab({ data, coverage, onNavigate }: { data: EntityDetail; coverage: CoverageRow | undefined; onNavigate: (hash: string) => void }) {\n  const present = coverage?.status === 'PRESENT';\n  const amount = coverage?.detail?.monto_12m_clp ?? coverage?.detail?.monto_clp ?? null;\n  return <div className=\"entity360-tabgrid entity360-tabgrid-2\"><Card title=\"Presencia en Mercado Público\" meta=\"ChileCompra\">{present ? <div className=\"entity360-purchase-large\"><div className=\"entity360-purchase-metric\"><span>Registros observados</span><strong>{n(coverage?.record_count)}</strong></div><div className=\"entity360-purchase-metric\"><span>Monto observado</span><strong>{formatClp(amount)}</strong></div><div className=\"entity360-purchase-metric\"><span>Último evento</span><strong>{fecha(coverage?.last_event_at)}</strong></div>{data.entity.rut && <button className=\"entity360-primary-action\" onClick={() => onNavigate(`#/gasto/proveedor/${encodeURIComponent(data.entity.rut as string)}`)}>Profundizar en Gasto público →</button>}</div> : <Empty title={coverageLabel(coverage)} hint=\"No se muestran rankings o compradores si el actor no está materializado en el productor de compras.\" />}</Card><Card title=\"Qué puede analizar Atlas\" meta=\"cuando el actor está materializado\"><div className=\"entity360-feature-list\"><span>Concentración comprador–proveedor</span><span>Aceleración de montos y órdenes</span><span>Participación dentro del gasto observado</span><span>Convergencia de hallazgos de compras</span></div></Card></div>;\n}\n\n",
)

# 5) Botón de gestión en Entidad 360: no existe para viewers.
replace_once(
    'src/components/Entity360StatusMarks.tsx',
    "import { Badge } from './primitives';\n",
    "import { Badge } from './primitives';\nimport type { AtlasRole } from './Auth';\n",
)
replace_once(
    'src/components/Entity360StatusMarks.tsx',
    "export function Entity360StatusMarks({ entityId }: { entityId: string }) {",
    "export function Entity360StatusMarks({ entityId, role }: { entityId: string; role: AtlasRole }) {",
)
replace_once(
    'src/components/Entity360StatusMarks.tsx',
    "  const manageableQueue = potential ? 'potenciales' : registered && terminated ? 'termino' : null;",
    "  const manageableQueue = role !== 'viewer'\n    ? (potential ? 'potenciales' : registered && terminated ? 'termino' : null)\n    : null;",
)

# Comprobaciones mínimas para que el piloto no vuelva a publicar el módulo completo.
checks = {
    'src/App.tsx': ['GastoPublico', "view === 'gasto'", "view === 'gastoActor'"],
    'src/components/Shell.tsx': ["view: 'gasto'", 'Gasto público'],
    'src/lib/router.ts': ["view: 'gasto'", "view: 'gastoActor'", "case 'gasto'"],
    'src/views/EntityExpediente.tsx': ['ComprasTab', 'PurchasesCard', '#/gasto/', "id: 'compras'"],
}
for path, banned in checks.items():
    text = Path(path).read_text(encoding='utf-8')
    for token in banned:
        if token in text:
            raise SystemExit(f'Quedó una referencia activa no permitida en {path}: {token}')

print('OK: Gasto público desacoplado; señal Proveedor del Estado preservada; Gestión SO restringida en UI.')
