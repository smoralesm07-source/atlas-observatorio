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

new_entity_block = """      {data.entidades.length > 0 && (\n        <div style={{ marginTop: 16 }}>\n          <Panel\n            title={`Entidades domiciliadas · ${data.entidades.length}`}\n            meta=\"marcas propias de entidad · separadas del IGR\"\n            pad={false}\n          >\n            <TerritoryEntityDirectory\n              rows={data.entidades}\n              region={t.region_name}\n              commune={t.commune_name}\n              onNavigate={onNavigate}\n            />\n          </Panel>\n        </div>\n      )}\n"""

if '<TerritoryEntityDirectory' not in text:
    start_marker = "      {data.entidades.length > 0 && (\n"
    next_marker = "      <div style={{ marginTop: 24 }}>\n        <Semantics>"
    start = text.find(start_marker)
    if start < 0:
        raise SystemExit('No se encontró el bloque actual de entidades domiciliadas')
    end = text.find(next_marker, start)
    if end < 0:
        raise SystemExit('No se encontró el límite posterior al bloque de entidades')
    text = text[:start] + new_entity_block + "\n" + text[end:]

# Reordena el detalle comunal: primero toda la lectura CEAD/IGR y después el
# contexto institucional/abierto. Así se evita el gran vacío producido por dos
# columnas con alturas muy distintas.
detail_start = text.find('function ComunaDetalle')
if detail_start < 0:
    raise SystemExit('No se encontró ComunaDetalle')
layout_start = text.find('      <div className="grid grid-main" style={{ marginTop: 16 }}>', detail_start)
entities_start = text.find('      {data.entidades.length > 0 && (', layout_start)

new_layout = """      <section className=\"territory-detail-segment\" aria-labelledby=\"territory-cead-title\">\n        <div className=\"territory-detail-section-head\">\n          <div>\n            <span className=\"territory-detail-kicker\">Evidencia territorial CEAD</span>\n            <h2 id=\"territory-cead-title\">Lectura del IGR y sus componentes</h2>\n            <p>\n              Primero se concentra toda la evidencia que construye la lectura territorial.\n              Las entidades domiciliadas, sanciones y otras fuentes se muestran después como contexto independiente.\n            </p>\n          </div>\n          <div className=\"territory-detail-section-meta\">\n            {n(layers.length)} capas · año {t.year ?? '—'}\n          </div>\n        </div>\n\n        <div className=\"territory-cead-overview\">\n          <Panel title=\"Lectura IGR\" meta={`banda ${t.igr_level ?? '—'} · lectura territorial`}>\n            <dl className=\"kv\">\n              <dt>IGR</dt><dd className=\"num\">{n1(t.igr_score)}</dd>\n              <dt>Percentil nacional</dt><dd className=\"num\">{t.igr_percentile == null ? '—' : `P${n1(t.igr_percentile)}`}</dd>\n              <dt>Confianza</dt><dd className=\"num\">{t.igr_confidence == null ? '—' : `${n1(t.igr_confidence)}%`} {t.igr_confidence_level ? `· ${t.igr_confidence_level}` : ''}</dd>\n              <dt>Banda</dt><dd>{t.igr_level ?? '—'}</dd>\n              <dt>Lectura de frontera</dt><dd>{t.igr_boundary_status === 'borderline' ? 'Cerca de frontera' : t.igr_boundary_status === 'stable_relative_to_thresholds' ? 'Estable respecto de cortes' : '—'}</dd>\n              <dt>Distancia a frontera</dt><dd className=\"num\">{t.igr_boundary_distance == null ? '—' : n1(t.igr_boundary_distance)}</dd>\n              <dt>Cobertura metodológica</dt><dd className=\"num\">{t.igr_methodological_coverage == null ? '—' : `${n1(t.igr_methodological_coverage)}%`}</dd>\n            </dl>\n            <div className=\"note\" style={{ marginTop: 12 }}>\n              Score y percentil son la lectura principal. Confianza y cobertura informan robustez y disponibilidad; no alteran el score ni trasladan riesgo a las entidades domiciliadas.\n            </div>\n          </Panel>\n\n          <Panel title=\"Comparación de capas CEAD\" meta=\"puntaje · peso · cobertura\">\n            <div className=\"territory-layer-summary\">\n              {layers.map(([key, layer]) => {\n                const score = Number(layer.score ?? 0);\n                const width = Math.max(0, Math.min(100, score));\n                return (\n                  <div className=\"territory-layer-summary-row\" key={`layer-summary-${key}`}>\n                    <strong>{layer.label}</strong>\n                    <span className=\"num\">{n1(score)}</span>\n                    <small>peso {n1(layer.configured_weight * 100)}% · cobertura {n1(layer.coverage * 100)}%</small>\n                    <span className=\"territory-layer-track\" aria-hidden>\n                      <i style={{ width: `${width}%`, background: scoreTone(score) }} />\n                    </span>\n                  </div>\n                );\n              })}\n            </div>\n          </Panel>\n        </div>\n\n        <div className=\"territory-cead-layers\">\n          {layers.map(([key, layer]) => (\n            <Panel\n              key={key}\n              title={layer.label}\n              meta={`peso ${n1(layer.configured_weight * 100)}% · cobertura ${n1(layer.coverage * 100)}%`}\n              pad={false}\n            >\n              <div style={{ padding: '11px 20px 10px' }}>\n                <Meter\n                  value={Number(layer.score ?? 0)}\n                  label=\"Puntaje de la capa\"\n                  tone={scoreTone(Number(layer.score ?? 0))}\n                />\n              </div>\n              <table className=\"table\">\n                <thead>\n                  <tr>\n                    <th>Componente</th>\n                    <th className=\"right\">Puntaje</th>\n                    <th className=\"right\">Intensidad</th>\n                    <th className=\"right\">Persistencia</th>\n                    <th className=\"right\">Tendencia</th>\n                    <th className=\"right\">Anomalía temporal</th>\n                    <th className=\"right\">Años</th>\n                  </tr>\n                </thead>\n                <tbody>\n                  {(layer.components ?? []).map((c) => (\n                    <tr key={c.id}>\n                      <td>{titleCase(c.label)}</td>\n                      <td className=\"right num\" style={{ fontWeight: 650 }}>{n1(c.score)}</td>\n                      <td className=\"right num\">{n1(c.intensity)}</td>\n                      <td className=\"right num\">{n1(c.persistence)}</td>\n                      <td className=\"right num\">{n1(c.trend)}</td>\n                      <td className=\"right num\">{n1(c.temporal_anomaly ?? c.anomaly)}</td>\n                      <td className=\"right num\">{n(c.years_observed)}</td>\n                    </tr>\n                  ))}\n                </tbody>\n              </table>\n            </Panel>\n          ))}\n        </div>\n      </section>\n\n      <section className=\"territory-detail-segment\" aria-labelledby=\"territory-context-title\">\n        <div className=\"territory-detail-section-head\">\n          <div>\n            <span className=\"territory-detail-kicker\">Contexto de la comuna</span>\n            <h2 id=\"territory-context-title\">Entidades y señales complementarias</h2>\n            <p>Universo institucional, prensa y composición sectorial. Estas señales describen el entorno y no forman parte del cálculo del IGR.</p>\n          </div>\n          <div className=\"territory-detail-section-meta\">\n            {n(t.ctx_entities)} entidades observadas\n          </div>\n        </div>\n\n        <div className=\"territory-context-grid\">\n          <div>\n            <Panel title=\"Universo observado aquí\" meta=\"contexto · fuera del índice\">\n              <dl className=\"kv\">\n                <dt>Entidades</dt><dd className=\"num\">{n(t.ctx_entities)}</dd>\n                <dt>Sujetos obligados UAF</dt><dd className=\"num\">{n(t.ctx_uaf_observed)}</dd>\n                <dt>Con sanción</dt><dd className=\"num\">{n(t.ctx_sanctioned)}</dd>\n                <dt>Con señal</dt><dd className=\"num\">{n(t.ctx_alerted)}</dd>\n                <dt>Hallazgos</dt><dd className=\"num\">{n(t.ctx_findings)}</dd>\n              </dl>\n              <div className=\"note\" style={{ marginTop: 12 }}>\n                El domicilio territorial no atribuye conducta ni riesgo individual. Las marcas pertenecen a cada entidad y se revisan por separado.\n              </div>\n            </Panel>\n          </div>\n\n          <div>\n            <PrensaComunal comuna={t.commune_name} />\n          </div>\n\n          {data.sectores.length > 0 && (\n            <div>\n              <Panel title=\"Sectores UAF presentes\" meta={`${n(data.sectores.length)} sectores con inscritos`}>\n                <Bars\n                  data={data.sectores.map((s) => ({ label: titleCase(s.uaf_sector), value: s.n }))}\n                  height={132}\n                />\n              </Panel>\n            </div>\n          )}\n        </div>\n      </section>\n"""

if layout_start < 0 or entities_start < 0:
    # Si ya está aplicado, no lo tratamos como error.
    if 'territory-cead-overview' not in text:
        raise SystemExit('No se encontró el layout anterior del detalle territorial')
else:
    text = text[:layout_start] + new_layout + "\n" + text[entities_start:]

path.write_text(text, encoding='utf-8')
print('Territorio.tsx homologado y reorganizado por evidencia CEAD + contexto')
