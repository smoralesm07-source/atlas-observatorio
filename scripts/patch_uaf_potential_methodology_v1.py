from pathlib import Path


def replace(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"No se encontró patrón en {path}: {old[:100]!r}")
    p.write_text(text.replace(old, new, 1))


# Contrato: universo amplio + muestra operativa y cobertura SII de personas naturales.
replace(
    "src/lib/contracts.ts",
    "  reviewed_by_email: string | null;\n  semantics: string | null;\n}\n\nexport interface UafPotential {",
    "  reviewed_by_email: string | null;\n  /** Posición reproducible dentro de la muestra operativa de Gestión SO. */\n  selection_rank?: number | null;\n  selection_basis?: string | null;\n  selection_reason?: string | null;\n  semantics: string | null;\n}\n\nexport interface UafPotential {",
)
replace(
    "src/lib/contracts.ts",
    "  contract: 'ATLAS_OBS_UAF_POTENTIAL_V1';",
    "  contract: 'ATLAS_OBS_UAF_POTENTIAL_V1' | 'ATLAS_OBS_UAF_POTENTIAL_V2';",
)
replace(
    "src/lib/contracts.ts",
    "    observadas: number;\n    con_res: number;\n    accionables: number;",
    "    observadas: number;\n    /** Universo amplio de screening por RUT único. */\n    detectados?: number;\n    evidencia_2_mas?: number;\n    evidencia_3_mas?: number;\n    territorializados?: number;\n    con_res: number;\n    /** Tamaño de la muestra operativa, conservado como alias de compatibilidad. */\n    accionables: number;\n    muestra_gestion?: number;",
)
replace(
    "src/lib/contracts.ts",
    "  } | null;\n  /** De qué universo se parte y con cuántas entidades termina el analista. */\n  embudo:",
    "  } | null;\n  metodologia?: {\n    tipo: string;\n    objetivo: string;\n    universo: string;\n    regla: string;\n    orden: string;\n    no_es: string;\n    version: string;\n  };\n  /** De qué universo se parte y con cuántas entidades termina el analista. */\n  embudo:",
)
replace(
    "src/lib/contracts.ts",
    "    sin_perfil: number;\n    con_inicio: number;",
    "    sin_perfil: number;\n    /** Sin perfil porque la fuente SII usada es de personas jurídicas, no una falla de conciliación. */\n    sin_perfil_persona_natural?: number;\n    /** Casos sin perfil SII que sí requieren revisar cobertura/conciliación. */\n    sin_perfil_no_natural?: number;\n    con_inicio: number;",
)
replace(
    "src/lib/contracts.ts",
    "    denominator_note: string;\n  };",
    "    denominator_note: string;\n    sii_profile_scope_note?: string;\n  };",
)

# Padrón: cifra ancla = universo detectado; Gestión = muestra priorizada.
replace(
    "src/views/universo/PadronAxisV2.tsx",
    "  const potentialTotal = potential?.totales?.accionables ?? 0;",
    "  const potentialDetected = potential?.totales?.detectados ?? potential?.totales?.observadas ?? 0;\n  const potentialSample = potential?.totales?.muestra_gestion ?? potential?.totales?.accionables ?? 0;",
)
replace(
    "src/views/universo/PadronAxisV2.tsx",
    "        <Kpi label=\"Potenciales SO\" value={potentialTotal} hint=\"hipótesis accionables SII ↔ UAF\" tone=\"var(--unknown)\" onClick={() => focusDirectory({ kind: 'potential', title: 'Potenciales sujetos obligados', hint: 'hipótesis de registro por actividad económica' })} />",
    "        <Kpi label=\"Potenciales detectados\" value={potentialDetected} hint={`Gestión SO prioriza ${n(potentialSample)} casos`} tone=\"var(--unknown)\" onClick={() => focusDirectory({ kind: 'potential', title: 'Muestra priorizada de potenciales SO', hint: `${n(potentialSample)} casos seleccionados desde ${n(potentialDetected)} RUT detectados` })} />",
)
replace(
    "src/views/universo/PadronAxisV2.tsx",
    "          <p className=\"uso2-edge-note\">{n(potentialTotal)} candidatos accionables sobre {n(potential?.totales?.observadas)} observados por giro. Son hipótesis de registro, no incumplimientos acreditados.</p>",
    "          <p className=\"uso2-edge-note\">{n(potentialDetected)} RUT detectados por screening. Gestión SO trabaja una muestra operativa de {n(potentialSample)} casos; la selección no acredita obligación ni incumplimiento.</p>",
)
replace(
    "src/views/universo/PadronAxisV2.tsx",
    "<button onClick={() => onWork({ kind: 'POTENCIAL' })}>Gestionar potenciales SO →</button>",
    "<button onClick={() => onWork({ kind: 'POTENCIAL' })}>Gestionar muestra priorizada →</button>",
)

# Gestión SO: cola y ayuda metodológica visibles.
replace(
    "src/views/universo/CasosAxis.tsx",
    "  { value: 'score', label: 'Índice, mayor primero' },",
    "  { value: 'score', label: 'Prioridad de cola' },",
)
replace(
    "src/views/universo/CasosAxis.tsx",
    "        default: return dir * ((a.score ?? -1) - (b.score ?? -1));",
    "        default:\n          if (a.kind === 'POTENCIAL' || b.kind === 'POTENCIAL') {\n            return (a.candidate?.selection_rank ?? 999999) - (b.candidate?.selection_rank ?? 999999);\n          }\n          return dir * ((a.score ?? -1) - (b.score ?? -1));",
)
replace(
    "src/views/universo/CasosAxis.tsx",
    "          <em>Pendientes sin asignar · conciliación SII ↔ UAF</em>",
    "          <em>Muestra operativa priorizada · {n(potential?.totales?.detectados ?? potential?.totales?.observadas ?? 0)} detectados</em>",
)
replace(
    "src/views/universo/CasosAxis.tsx",
    "          title=\"Conciliación SII ↔ UAF\"",
    "          title=\"Del universo detectado a la muestra de gestión\"",
)
old_facts = """          <div className=\"uso-funnel-facts\">\n            <span>Sin revisar <b className=\"num\">{n(potential.totales?.sin_revisar)}</b></span>\n            <span>Con revisión registrada <b className=\"num\">{n(potential.totales?.revisados)}</b></span>\n            <span>IVO medio <b className=\"num\">{n1(potential.totales?.ivo_medio)}</b></span>\n            <span>Materialidad media <b className=\"num\">{n1(potential.totales?.materialidad_media)}</b></span>\n            <span>Sectores con brecha <b className=\"num\">{n(potential.totales?.sectores)}</b></span>\n            <em>Escala logarítmica: el embudo cae tres órdenes de magnitud y en escala lineal el último paso desaparecería.</em>\n          </div>"""
new_facts = """          <div className=\"uso-funnel-facts\">\n            <span>Detectados <b className=\"num\">{n(potential.totales?.detectados ?? potential.totales?.observadas)}</b></span>\n            <span>2+ actividades coincidentes <b className=\"num\">{n(potential.totales?.evidencia_2_mas)}</b></span>\n            <span>3+ actividades coincidentes <b className=\"num\">{n(potential.totales?.evidencia_3_mas)}</b></span>\n            <span>Muestra Gestión SO <b className=\"num\">{n(potential.totales?.muestra_gestion ?? potential.totales?.accionables)}</b></span>\n            <span>Sectores cubiertos <b className=\"num\">{n(potential.totales?.sectores)}</b></span>\n            <em>La muestra es operativa y estratificada; no es una muestra estadística ni una estimación de incumplimiento.</em>\n          </div>\n          {potential.metodologia && (\n            <details className=\"uso-method-help\">\n              <summary>¿Por qué Gestión SO trabaja una muestra y cómo se selecciona?</summary>\n              <div>\n                <p><strong>Objetivo.</strong> {potential.metodologia.objetivo}</p>\n                <p><strong>Universo de partida.</strong> {potential.metodologia.universo}</p>\n                <p><strong>Regla de selección.</strong> {potential.metodologia.regla}</p>\n                <p><strong>Orden de prioridad.</strong> {potential.metodologia.orden}</p>\n                <p><strong>Límite metodológico.</strong> {potential.metodologia.no_es}</p>\n                <em>Versión {potential.metodologia.version}</em>\n              </div>\n            </details>\n          )}"""
replace("src/views/universo/CasosAxis.tsx", old_facts, new_facts)

# Ficha: si no existe IVO, explicar la selección en vez de dibujar un cero.
replace(
    "src/views/universo/CaseFile.tsx",
    "  const scoreLabel = row.candidate ? 'IVO' : 'IPF';",
    "  const scoreLabel = row.candidate ? 'IVO' : 'IPF';\n  const selectionRank = row.candidate?.selection_rank ?? null;",
)
replace(
    "src/views/universo/CaseFile.tsx",
    "            {score != null && <strong>{scoreLabel} {n1(score)}</strong>}",
    "            {score != null\n              ? <strong>{scoreLabel} {n1(score)}</strong>\n              : selectionRank != null ? <strong>Muestra #{n(selectionRank)}</strong> : null}",
)
old_score = """      <div className=\"uso-score uso-case-snapshot-score\">\n        <div className=\"uso-score-main\">\n          <span className=\"uso-kicker\">IVO · índice de verosimilitud de obligación</span>\n          <b className=\"num\">{n1(c.ivo_score)}</b>\n          <em>\n            banda {titleCase(c.ivo_band ?? '—')}\n            {c.ivo_credibility_pct != null && ` · credibilidad ${n1(c.ivo_credibility_pct)}%`}\n          </em>\n          <span className=\"uso-score-track\" aria-hidden><i style={{ width: `${Math.min(100, c.ivo_score ?? 0)}%` }} /></span>\n          <p>Ordena revisión. No acredita obligación ni riesgo LA/FT.</p>\n        </div>\n      </div>"""
new_score = """      <div className=\"uso-score uso-case-snapshot-score\">\n        <div className=\"uso-score-main\">\n          {c.ivo_score != null ? (\n            <>\n              <span className=\"uso-kicker\">IVO · índice de verosimilitud de obligación</span>\n              <b className=\"num\">{n1(c.ivo_score)}</b>\n              <em>\n                banda {titleCase(c.ivo_band ?? '—')}\n                {c.ivo_credibility_pct != null && ` · credibilidad ${n1(c.ivo_credibility_pct)}%`}\n              </em>\n              <span className=\"uso-score-track\" aria-hidden><i style={{ width: `${Math.min(100, c.ivo_score)}%` }} /></span>\n              <p>Ordena revisión cuando existe evidencia suficiente para calcularlo. No acredita obligación ni riesgo LA/FT.</p>\n            </>\n          ) : (\n            <>\n              <span className=\"uso-kicker\">Prioridad metodológica · muestra Gestión SO</span>\n              <b className=\"num\">#{n(c.selection_rank)}</b>\n              <em>{c.selection_basis ? titleCase(c.selection_basis.replace(/_/g, ' ')) : 'selección estratificada'}</em>\n              <p>{c.selection_reason ?? 'Seleccionado por la regla reproducible de la muestra operativa.'}</p>\n              <p className=\"uso-note\">No se muestra IVO porque esta entidad no cuenta con evidencia suficiente para calcularlo de forma independiente.</p>\n            </>\n          )}\n        </div>\n      </div>"""
replace("src/views/universo/CaseFile.tsx", old_score, new_score)
replace(
    "src/views/universo/CaseFile.tsx",
    "        <Field label=\"Nivel de detección\">{TIER_LABEL[c.detection_tier ?? ''] ?? (c.detection_tier ? titleCase(c.detection_tier.replace(/_/g, ' ')) : '—')}</Field>",
    "        <Field label=\"Nivel de evidencia\">{TIER_LABEL[c.detection_tier ?? ''] ?? (c.detection_tier ? titleCase(c.detection_tier.replace(/_/g, ' ')) : '—')}</Field>",
)
replace(
    "src/views/universo/CaseFile.tsx",
    "  C_BAJA: 'Coincidencia de giro baja',\n};",
    "  C_BAJA: 'Coincidencia de giro baja',\n  EVIDENCIA_3_MAS: '3 o más actividades coincidentes',\n  EVIDENCIA_2: '2 actividades coincidentes',\n  EVIDENCIA_1: '1 actividad coincidente',\n};",
)

# Semántica de cobertura SII: persona natural fuera de la nómina PJ.
replace(
    "src/views/UniversoSOV2.tsx",
    "        Gestión SO mantiene responsable, avance y trazabilidad del trabajo sobre potenciales y términos de giro.\n      </Semantics>",
    "        Gestión SO mantiene responsable, avance y trazabilidad del trabajo sobre potenciales y términos de giro.\n        {pulse.data.coverage?.sii_profile_scope_note && <> {pulse.data.coverage.sii_profile_scope_note}</>}\n      </Semantics>",
)

# Estilo compacto para la ayuda metodológica.
p = Path("src/styles/universo-so-management.css")
css = p.read_text()
marker = "/* gestion-so-methodology-v1 */"
if marker not in css:
    css += """\n\n/* gestion-so-methodology-v1 */\n.uso-method-help {\n  margin-top: 10px;\n  border: 1px solid var(--line);\n  border-radius: 10px;\n  background: color-mix(in srgb, var(--panel) 88%, transparent);\n}\n.uso-method-help summary {\n  cursor: pointer;\n  padding: 10px 12px;\n  color: var(--ink-1);\n  font-weight: 700;\n  font-size: 12px;\n}\n.uso-method-help > div {\n  padding: 0 12px 12px;\n  display: grid;\n  gap: 6px;\n}\n.uso-method-help p {\n  margin: 0;\n  color: var(--ink-2);\n  font-size: 11.5px;\n  line-height: 1.45;\n}\n.uso-method-help em {\n  color: var(--ink-3);\n  font-size: 10.5px;\n}\n"""
    p.write_text(css)

print("patch_uaf_potential_methodology_v1: OK")
