from pathlib import Path
import ast

SOURCE = Path('scripts/patch_pulso_briefing_layout.py')
VIEW = Path('src/views/Pulso.tsx')
CSS = Path('src/styles/pulso.css')

# Reutiliza literalmente el JSX y CSS ya revisados del parche anterior, pero
# extrae los bloques como constantes sin ejecutar ese script.
source_text = SOURCE.read_text(encoding='utf-8')
tree = ast.parse(source_text)
replacement = None
css_append = None
for node in ast.walk(tree):
    if isinstance(node, ast.Assign):
        for target in node.targets:
            if isinstance(target, ast.Name) and target.id == 'replacement':
                replacement = ast.literal_eval(node.value)
    if (
        isinstance(node, ast.AugAssign)
        and isinstance(node.target, ast.Name)
        and node.target.id == 'css'
        and isinstance(node.op, ast.Add)
    ):
        css_append = ast.literal_eval(node.value)

if not isinstance(replacement, str) or not replacement.strip():
    raise SystemExit('No se pudo recuperar el JSX del parche anterior')
if not isinstance(css_append, str) or not css_append.strip():
    raise SystemExit('No se pudo recuperar el CSS del parche anterior')

text = VIEW.read_text(encoding='utf-8')
start_marker = '      {/* ── 3. Lectura del corte'
end_marker = '      {/* ── 5. Cruces relevantes, sin compras públicas'
start = text.find(start_marker)
end = text.find(end_marker, start + 1)
if start < 0 or end < 0:
    raise SystemExit(f'No se localizaron los límites del bloque: start={start}, end={end}')
end_close = text.find('*/}', end)
if end_close < 0:
    raise SystemExit('No se encontró el cierre del comentario de la sección 5')
end_close += len('*/}')
text = text[:start] + replacement + text[end_close:]
VIEW.write_text(text, encoding='utf-8')

css = CSS.read_text(encoding='utf-8')
marker = '/* ── briefing reorganizado: lectura + contexto en una sola retícula ── */'
if marker not in css:
    css += css_append
    CSS.write_text(css, encoding='utf-8')
