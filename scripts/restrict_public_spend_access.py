from pathlib import Path

APP = Path('src/App.tsx')
SHELL = Path('src/components/Shell.tsx')

app = APP.read_text(encoding='utf-8')
shell = SHELL.read_text(encoding='utf-8')

app = app.replace(
    "import { useCallback } from 'react';",
    "import { useCallback, useEffect } from 'react';",
    1,
)

anchor = """  const go = useCallback((hash: string) => {\n    window.location.hash = hash.startsWith('#') ? hash : `#${hash}`;\n  }, []);\n"""
replacement = anchor + """\n  const publicSpendRestricted = role !== 'admin'\n    && (route.view === 'gasto' || route.view === 'gastoActor');\n\n  useEffect(() => {\n    if (!publicSpendRestricted) return;\n    if (window.location.hash !== '#/pulso') window.location.hash = '#/pulso';\n  }, [publicSpendRestricted]);\n\n  if (publicSpendRestricted) {\n    return (\n      <Shell route={{ view: 'pulso' }} session={session} role={role}>\n        <PulsoV6 onNavigate={go} />\n      </Shell>\n    );\n  }\n"""
if replacement not in app:
    if anchor not in app:
        raise SystemExit('No se encontró el ancla de navegación en src/App.tsx')
    app = app.replace(anchor, replacement, 1)

old_nav = """const NAV: { label: string; route: Route; match: Route['view'][] }[] = [\n  { label: 'Gasto público', route: { view: 'gasto' }, match: ['gasto', 'gastoActor'] },\n  { label: 'Fuentes', route: { view: 'fuentes' }, match: ['fuentes'] },\n];\n"""
new_nav = """const NAV: { label: string; route: Route; match: Route['view'][] }[] = [\n  { label: 'Fuentes', route: { view: 'fuentes' }, match: ['fuentes'] },\n];\n"""
if old_nav in shell:
    shell = shell.replace(old_nav, new_nav, 1)
elif new_nav not in shell:
    raise SystemExit('No se encontró NAV esperado en src/components/Shell.tsx')

nav_map = """          {NAV.map((item) => (\n            <a\n              key={item.label}\n              href={hrefFor(item.route)}\n              data-active={item.match.includes(route.view)}\n            >\n              {item.label}\n            </a>\n          ))}\n"""
admin_spend = """          {role === 'admin' && (\n            <a href={hrefFor({ view: 'gasto' })} data-active={['gasto', 'gastoActor'].includes(route.view)}>\n              Gasto público\n            </a>\n          )}\n\n""" + nav_map
if admin_spend not in shell:
    if nav_map not in shell:
        raise SystemExit('No se encontró bloque NAV.map en src/components/Shell.tsx')
    shell = shell.replace(nav_map, admin_spend, 1)

APP.write_text(app, encoding='utf-8')
SHELL.write_text(shell, encoding='utf-8')

# Verificaciones estáticas para que el parche falle si la restricción queda incompleta.
assert "publicSpendRestricted" in app
assert "route.view === 'gasto' || route.view === 'gastoActor'" in app
assert "role === 'admin'" in shell
assert "Gasto público" in shell
assert "{ label: 'Gasto público', route: { view: 'gasto' }" not in shell

print('Restricción de Gasto público aplicada: sólo admin en menú y rutas.')
