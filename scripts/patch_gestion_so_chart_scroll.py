from pathlib import Path

TSX = Path('src/views/universo/CasosAxis.tsx')
CSS = Path('src/styles/gestion-so-redesign-v2.css')

src = TSX.read_text(encoding='utf-8')
old = """  const selectedItem = selected ? items.find((item) => item.value === selected) : undefined;\n  const leading = items.slice(0, 5);\n  const visible = selectedItem && !leading.some((item) => item.value === selectedItem.value)\n    ? [selectedItem, ...leading.slice(0, 4)]\n    : leading;\n  const peak = Math.max(1, ...visible.map((item) => item.count));\n  const denominator = Math.max(1, total);\n"""
new = """  const visible = items;\n  const peak = Math.max(1, ...items.map((item) => item.count));\n  const denominator = Math.max(1, total);\n  const activeRef = useRef<HTMLButtonElement>(null);\n\n  useEffect(() => {\n    if (!selected) return;\n    activeRef.current?.scrollIntoView({ block: 'nearest' });\n  }, [selected]);\n"""
if old not in src:
    raise SystemExit('No se encontró el bloque de recorte top-5 en QueueDistributionChart')
src = src.replace(old, new, 1)

old_div = '        <div className="uso-nav-chart-bars">\n'
new_div = """        <div\n          className=\"uso-nav-chart-bars\"\n          data-scrollable={items.length > 5 ? 'true' : undefined}\n          tabIndex={items.length > 5 ? 0 : undefined}\n          aria-label={`${title}: ${n(items.length)} categorías. Desplázate para verlas todas.`}\n        >\n"""
if old_div not in src:
    raise SystemExit('No se encontró contenedor de barras')
src = src.replace(old_div, new_div, 1)

old_button = """                className=\"uso-nav-chart-row\"\n                data-on={active}\n                aria-pressed={active}\n"""
new_button = """                className=\"uso-nav-chart-row\"\n                data-on={active}\n                ref={active ? activeRef : undefined}\n                aria-pressed={active}\n"""
if old_button not in src:
    raise SystemExit('No se encontró botón de categoría')
src = src.replace(old_button, new_button, 1)

old_foot = """        <span><b>{n(items.length)}</b> categorías disponibles</span>\n        <span>Selecciona una barra para filtrar la tabla</span>\n"""
new_foot = """        <span><b>{n(items.length)}</b> categorías disponibles · desplázate para ver todas</span>\n        <span>Selecciona una barra para filtrar la tabla</span>\n"""
if old_foot not in src:
    raise SystemExit('No se encontró pie de gráfico')
src = src.replace(old_foot, new_foot, 1)
TSX.write_text(src, encoding='utf-8')

css = CSS.read_text(encoding='utf-8')
marker = """.uso-mode-casos .uso-nav-chart-bars {\n  display: flex;\n  flex-direction: column;\n  gap: 2px;\n}\n"""
replacement = """.uso-mode-casos .uso-nav-chart-bars {\n  display: flex;\n  flex-direction: column;\n  gap: 2px;\n  max-height: 151px;\n  overflow-y: auto;\n  overscroll-behavior: contain;\n  padding-right: 3px;\n  scrollbar-gutter: stable;\n  scrollbar-width: thin;\n  scrollbar-color: color-mix(in srgb, var(--ink-4) 45%, transparent) transparent;\n}\n\n.uso-mode-casos .uso-nav-chart-bars[data-scrollable='true'] {\n  border-bottom: 1px solid color-mix(in srgb, var(--line) 40%, transparent);\n}\n\n.uso-mode-casos .uso-nav-chart-bars:focus-visible {\n  outline: 2px solid color-mix(in srgb, var(--accent) 48%, transparent);\n  outline-offset: 2px;\n  border-radius: 7px;\n}\n\n.uso-mode-casos .uso-nav-chart-bars::-webkit-scrollbar {\n  width: 6px;\n}\n\n.uso-mode-casos .uso-nav-chart-bars::-webkit-scrollbar-thumb {\n  border-radius: 999px;\n  background: color-mix(in srgb, var(--ink-4) 42%, transparent);\n}\n\n.uso-mode-casos .uso-nav-chart-bars::-webkit-scrollbar-track {\n  background: transparent;\n}\n"""
if marker not in css:
    raise SystemExit('No se encontró bloque CSS de barras')
css = css.replace(marker, replacement, 1)
CSS.write_text(css, encoding='utf-8')

print('Gestión SO: gráficos de sector y región ahora recorren todas las categorías.')
