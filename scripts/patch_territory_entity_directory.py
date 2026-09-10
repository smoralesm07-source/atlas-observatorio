from pathlib import Path

# Idempotente: permite volver a validar la homologación sin reescribir la vista.
path = Path('src/views/Territorio.tsx')
text = path.read_text(encoding='utf-8')

old_primitives = "import { Badge, Empty, ErrorBox, Loading, Panel, Semantics } from '../components/primitives';"
new_primitives = "import { Empty, ErrorBox, Loading, Panel, Semantics } from '../components/primitives';"
if old_primitives in text:
    text = text.replace(old_primitives, new_primitives, 1)

# El directorio encapsula navegación a Entidad 360 y formato de RUT.
text = text.replace("import { hrefFor } from '../lib/router';\n", '', 1)
text = text.replace(
    "import { n, n1, rutFormat, titleCase } from '../lib/format';",
    "import { n, n1, titleCase } from '../lib/format';",
    1,
)

anchor = "import { ChileMap } from '../components/ChileMap';"
component_import = "import { TerritoryEntityDirectory } from '../components/TerritoryEntityDirectory';"
if component_import not in text:
    if anchor not in text:
        raise SystemExit('No se encontró el import de ChileMap para insertar TerritoryEntityDirectory')
    text = text.replace(anchor, f"{anchor}\n{component_import}", 1)

new_block = """      {data.entidades.length > 0 && (\n        <div style={{ marginTop: 16 }}>\n          <Panel\n            title={`Entidades domiciliadas · ${data.entidades.length}`}\n            meta=\"marcas propias de entidad · separadas del IGR\"\n            pad={false}\n          >\n            <TerritoryEntityDirectory\n              rows={data.entidades}\n              region={t.region_name}\n              commune={t.commune_name}\n              onNavigate={onNavigate}\n            />\n          </Panel>\n        </div>\n      )}\n"""

if '<TerritoryEntityDirectory' not in text:
    start_marker = "      {data.entidades.length > 0 && (\n"
    next_marker = "      <div style={{ marginTop: 24 }}>\n        <Semantics>"
    start = text.find(start_marker)
    if start < 0:
        raise SystemExit('No se encontró el bloque actual de entidades domiciliadas')
    end = text.find(next_marker, start)
    if end < 0:
        raise SystemExit('No se encontró el límite posterior al bloque de entidades')
    text = text[:start] + new_block + "\n" + text[end:]

path.write_text(text, encoding='utf-8')
print('Territorio.tsx homologado con el Directorio de sujetos obligados')
