from pathlib import Path
import re

REPORT = Path('src/views/Reportes.tsx')
NARRATIVE = Path('supabase/functions/atlas-report-narrative/index.ts')
GUARDED = Path('supabase/functions/atlas-report-narrative-guarded/index.ts')
CSS = Path('src/styles/reportes.css')


def sub_once(text: str, pattern: str, repl: str, label: str, flags: int = 0) -> str:
    out, count = re.subn(pattern, repl, text, count=1, flags=flags)
    if count != 1:
        raise SystemExit(f'Patch failed at {label}: matches={count}')
    print(f'OK: {label}')
    return out


report = REPORT.read_text(encoding='utf-8')

report = sub_once(
    report,
    r"if \(q\.id === 'reporting_concentration'\) return `La reportabilidad 2025 alcanza \$\{fmt0\.format\(q\.ros_total_2025 \?\? 0\)\} ROS y existen \$\{q\.silent_sector_count \?\? 0\} categorías sin ROS en el quinquenio sectorial disponible\. El silencio no equivale por sí solo a incumplimiento\.`;",
    "if (q.id === 'reporting_concentration') return `La reportabilidad 2025 alcanza ${fmt0.format(q.ros_total_2025 ?? 0)} ROS y existen ${q.silent_sector_count ?? 0} categorías sin ROS en el quinquenio sectorial disponible. El silencio identifica ausencia de ROS observados en el período; por sí solo no califica la conducta del sector.`;",
    'reporting concentration wording',
)

report = sub_once(
    report,
    r"if \(profile === 'supervision'\) return \[.*?\n  \];",
    """if (profile === 'supervision') return [
    `El universo obligado debe leerse junto con su comportamiento: crecimiento del padrón, concentración de ROS, silencios de reportabilidad y categorías sin sujetos inscritos describen dimensiones distintas de cobertura.`,
    `Atlas separa la ausencia de ROS observados de la ausencia de correspondencia en el padrón, y mantiene sanciones y señales externas como capas de contexto independientes.`,
    `El objetivo es responder qué sectores cambiaron, cuáles concentran reportabilidad, dónde aparecen silencios y qué categorías no registran sujetos inscritos en el corte analizado.`
  ];""",
    'supervision deterministic brief',
    re.S,
)

report = sub_once(
    report,
    r"(  const focusTertiary = useAiVersion \? aiInsights\?\.\[focusConfig\.tertiary\] : null;\n)",
    r"\1\n  const reportingSilence2025 = [...p.sectores.movimientos]\n    .filter(x => Number(x.registered_so_2025 ?? 0) > 0 && Number(x.ros_2025 ?? 0) === 0)\n    .sort((a,b) => Number(b.registered_so_2025 ?? 0) - Number(a.registered_so_2025 ?? 0));\n  const reportingSilence5y = reportingSilence2025.filter(x => x.silence_5y === true);\n  const sectorsWithoutRegisteredSo = [...p.sectores.movimientos]\n    .filter(x => x.sector_canonical == null)\n    .sort((a,b) => a.sector_official.localeCompare(b.sector_official, 'es'));\n",
    'coverage slices',
)

report = sub_once(
    report,
    r"(      highest_ros_2025: \[\.\.\.p\.sectores\.movimientos\].*?\n)(    \},\n    territory:)",
    r"\1      reporting_silence_2025: reportingSilence2025.slice(0,8).map(x => ({ sector: x.sector_official, registered_so_2025: x.registered_so_2025, ros_2025: x.ros_2025, ros_total_2021_2025: x.ros_total_2021_2025, silence_5y: x.silence_5y })),\n      persistent_silence_5y: reportingSilence5y.slice(0,8).map(x => ({ sector: x.sector_official, registered_so_2025: x.registered_so_2025, ros_total_2021_2025: x.ros_total_2021_2025 })),\n      without_registered_so: sectorsWithoutRegisteredSo.slice(0,12).map(x => ({ sector: x.sector_official, sector_canonical: x.sector_canonical })),\n      coverage_summary: { current_silence_count: reportingSilence2025.length, persistent_silence_count: reportingSilence5y.length, without_registered_so_count: sectorsWithoutRegisteredSo.length, registered_total_2025: p.sectores.resumen.registered_total ?? null },\n\2",
    'AI chart context coverage',
    re.S,
)

report = sub_once(
    report,
    r"(      'Distinguir hechos, señales, proxies y limitaciones\.')",
    r"\1,\n      'Cuando no hay ROS, describir sólo ausencia de reportes observados en el período y fuente analizada.',\n      'Cuando una categoría no tiene correspondencia en el padrón, describir sólo cobertura registral observada.',\n      'No convertir ausencia de ROS o de inscritos en calificaciones de cumplimiento, irregularidad o deber.'",
    'validated constraints',
)

new_sector = '''      <section className="report-section report-page-break">
        <div className="report-section-heading"><span>06</span><div><h3>Cobertura y dinámica de los sectores obligados</h3><p>Reportabilidad, silencios observados y categorías sin sujetos inscritos en el corte disponible.</p></div></div>
        <div className="sr-sector-kpis"><div><strong>{t8==null?'s/d':`${fmt.format(t8)}%`}</strong><span>ROS 2025 concentrados en top 8 sectores</span></div><div><strong>{reportingSilence2025.length}</strong><span>sectores con inscritos y 0 ROS en 2025</span></div><div><strong>{reportingSilence5y.length}</strong><span>silencios persistentes 2021–2025</span></div><div><strong>{sectorsWithoutRegisteredSo.length}</strong><span>categorías sin SO inscritos observados</span></div></div>
        <h4 className="sr-subtitle">Movimientos de reportabilidad</h4>
        <div className="report-table-wrap"><table className="report-table"><thead><tr><th>Sector</th><th>SO 2025</th><th>ROS 2024</th><th>ROS 2025</th><th>Var.</th><th>ROS/100 SO</th><th>Indicios 2025</th></tr></thead><tbody>{sectorMoves.map(x => <tr key={x.sector_official}><td>{x.sector_official}</td><td>{x.registered_so_2025==null?'—':fmt0.format(x.registered_so_2025)}</td><td>{x.ros_2024==null?'—':fmt0.format(x.ros_2024)}</td><td>{x.ros_2025==null?'—':fmt0.format(x.ros_2025)}</td><td>{x.delta_ros_2025_vs_2024_pct==null?'—':signed(x.delta_ros_2025_vs_2024_pct)}</td><td>{x.ros_per_100_so_2025==null?'—':fmt.format(x.ros_per_100_so_2025)}</td><td>{x.indicios_2025==null?'—':fmt0.format(x.indicios_2025)}</td></tr>)}</tbody></table></div>
        <div className="sr-two-col">
          <div><h4 className="sr-subtitle">Silencios de reportabilidad observados</h4><div className="report-table-wrap"><table className="report-table"><thead><tr><th>Sector</th><th>SO 2025</th><th>ROS 2025</th><th>Lectura</th></tr></thead><tbody>{reportingSilence2025.slice(0,8).map(x => <tr key={`silence-${x.sector_official}`}><td>{x.sector_official}</td><td>{fmt0.format(Number(x.registered_so_2025 ?? 0))}</td><td>{fmt0.format(Number(x.ros_2025 ?? 0))}</td><td>{x.silence_5y ? '0 ROS 2021–2025' : '0 ROS en 2025'}</td></tr>)}{!reportingSilence2025.length && <tr><td colSpan={4}>Sin silencios sectoriales observados en 2025.</td></tr>}</tbody></table></div></div>
          <div><h4 className="sr-subtitle">Categorías sin SO inscritos observados</h4><div className="report-table-wrap"><table className="report-table"><thead><tr><th>Categoría oficial</th><th>Cobertura registral</th></tr></thead><tbody>{sectorsWithoutRegisteredSo.slice(0,8).map(x => <tr key={`coverage-${x.sector_official}`}><td>{x.sector_official}</td><td>Sin correspondencia en padrón vigente</td></tr>)}{!sectorsWithoutRegisteredSo.length && <tr><td colSpan={2}>Todas las categorías del contrato tienen correspondencia registral en el corte.</td></tr>}</tbody></table></div></div>
        </div>
        {useAiVersion && aiInsights?.sectors && <p className="report-ai-insight"><strong>Lectura IA</strong>{aiInsights.sectors}</p>}
        <p className="report-method-note">Silencio 2025 = sector con sujetos inscritos y 0 ROS agregados observados en 2025. Silencio persistente = 0 ROS agregados entre 2021 y 2025. “Sin SO inscritos observados” identifica categorías oficiales sin correspondencia en el padrón vigente del corte. Estas señales describen cobertura y reportabilidad agregada; no califican la conducta de entidades individuales ni permiten inferir por sí solas una exigencia de inscripción o reporte.</p>
      </section>

'''
report = sub_once(
    report,
    r"      <section className=\"report-section report-page-break\">\n        <div className=\"report-section-heading\"><span>06</span>.*?      </section>\n\n(?=      <section className=\"report-section report-page-break\">\n        <div className=\"report-section-heading\"><span>07</span>)",
    new_sector,
    'sector coverage section',
    re.S,
)

REPORT.write_text(report, encoding='utf-8')

css = CSS.read_text(encoding='utf-8')
css = sub_once(css, r"\.sr-sector-kpis\{display:grid;grid-template-columns:repeat\(3,1fr\);gap:10px;margin-bottom:13px\}", '.sr-sector-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:13px}', 'sector KPI grid')
CSS.write_text(css, encoding='utf-8')

narr = NARRATIVE.read_text(encoding='utf-8')
narr = sub_once(
    narr,
    r"(      highest_ros_2025: Array\.isArray\(sectorCtx\.highest_ros_2025\) \? sectorCtx\.highest_ros_2025\.slice\(0, 5\) : \[\],\n)(    \},\n    constraints: Array\.isArray\(d\.constraints\) \? d\.constraints\.slice\(0, 5\)\.map\(\(x: unknown\) => text\(x, 160\)\) : \[\],)",
    r"\1      reporting_silence_2025: Array.isArray(sectorCtx.reporting_silence_2025) ? sectorCtx.reporting_silence_2025.slice(0, 8) : [],\n      persistent_silence_5y: Array.isArray(sectorCtx.persistent_silence_5y) ? sectorCtx.persistent_silence_5y.slice(0, 8) : [],\n      without_registered_so: Array.isArray(sectorCtx.without_registered_so) ? sectorCtx.without_registered_so.slice(0, 12) : [],\n      coverage_summary: sectorCtx.coverage_summary ?? {},\n    },\n    constraints: Array.isArray(d.constraints) ? d.constraints.slice(0, 8).map((x: unknown) => text(x, 180)) : [],",
    'compact AI coverage packet',
)

guard_code = r'''const forbiddenInferencePatterns: Array<{ id: string; re: RegExp }> = [
  { id: 'legal_obligation', re: /obligaci(?:ó|o)n(?:es)?\s+jur[ií]dica/i },
  { id: 'confirmed_obligation', re: /obligaci(?:ó|o)n(?:es)?\s+confirmad/i },
  { id: 'should_be_registered', re: /deber[ií]a(?:n)?\s+(?:estar\s+)?inscrit/i },
  { id: 'should_report', re: /deber[ií]a(?:n)?\s+reportar/i },
  { id: 'noncompliance', re: /\bincumpl(?:imiento|e|en|ió|ieron|ir)/i },
  { id: 'irregularity', re: /\birregularidad(?:es)?\b/i },
  { id: 'evasion', re: /\bevas(?:i[oó]n|ivo|iva|ivos|ivas)\b/i },
  { id: 'unsupported_legal_translation', re: /no\s+se\s+traduce\s+en\s+obligaciones/i },
];

function repairPolicyText(value: string): { text: string; removed: string[] } {
  const pieces = value.split(/(?<=[.!?])\s+|\n+/).map((x) => x.trim()).filter(Boolean);
  const removed: string[] = [];
  const kept = pieces.filter((piece) => {
    const hit = forbiddenInferencePatterns.find((rule) => rule.re.test(piece));
    if (!hit) return true;
    removed.push(hit.id);
    return false;
  });
  return { text: kept.join(' ').trim(), removed: [...new Set(removed)] };
}

'''
narr = sub_once(narr, r"function text\(v: unknown, max = 260\): string \| null \{", guard_code + "function text(v: unknown, max = 260): string | null {", 'policy guard functions')

narr = sub_once(
    narr,
    r"    'Para sectores usa sectors\.largest_increases, largest_declines y highest_ros_2025 para nombrar industrias que explican movimientos\.',\n    'No conviertas prensa, sanciones o proxies en prueba de delito o prevalencia criminal\.',",
    "    'Para sectores usa sectors.largest_increases, largest_declines y highest_ros_2025 para nombrar industrias que explican movimientos.',\n    'Incluye, cuando existan, los silencios de reportabilidad y las categorías sin sujetos inscritos usando sectors.reporting_silence_2025, persistent_silence_5y, without_registered_so y coverage_summary.',\n    'Silencio significa únicamente ausencia de ROS agregados observados en el período indicado. Describe el dato y su alcance; no califiques la conducta de un sector o entidad.',\n    'Una categoría sin correspondencia en el padrón debe describirse únicamente como cobertura registral observada. No infieras a partir de ello una exigencia, una falta o un estado regulatorio.',\n    'Evita lenguaje jurídico conclusivo o no sustentado, incluyendo expresiones equivalentes a obligación jurídica confirmada, debería estar inscrito, debería reportar, incumplimiento, irregularidad o evasión.',\n    'No conviertas prensa, sanciones o proxies en prueba de delito o prevalencia criminal.',",
    'AI instructions for silences and coverage',
)

new_repair = '''    const repairOutput = (value: unknown) => {
      const numeric = repairNumericText(String(value ?? '').trim(), compact);
      const policy = repairPolicyText(numeric.text);
      return { text: policy.text, removedNumeric: numeric.removed, removedPolicy: policy.removed };
    };
    const repairedNarrative = repairOutput(originalNarrative);
    const rn = repairOutput(i.novelties); const rt = repairOutput(i.territory); const rc = repairOutput(i.crime); const rs = repairOutput(i.sectors); const rcap = repairOutput(i.capacity);
    const fallbackInsight = 'El paquete validado no permite agregar una lectura adicional con suficiente respaldo; se mantiene la interpretación determinística del bloque.';
    const insights: AiInsights = {
      novelties: rn.text || fallbackInsight,
      territory: rt.text || fallbackInsight,
      crime: rc.text || fallbackInsight,
      sectors: rs.text || fallbackInsight,
      capacity: rcap.text || fallbackInsight,
    };
    const narrative = repairedNarrative.text || [insights.sectors, insights.capacity, insights.novelties].join(' ');
    const removed = [...repairedNarrative.removedNumeric, ...rn.removedNumeric, ...rt.removedNumeric, ...rc.removedNumeric, ...rs.removedNumeric, ...rcap.removedNumeric]
      .filter((item, index, all) => all.findIndex((x) => x.token === item.token) === index)
      .slice(0, 12);
    const removedPolicy = [...repairedNarrative.removedPolicy, ...rn.removedPolicy, ...rt.removedPolicy, ...rc.removedPolicy, ...rs.removedPolicy, ...rcap.removedPolicy]
      .filter((item, index, all) => all.indexOf(item) === index);

    return json({
      ai_used: true,
      narrative,
      insights,
      model,
      provider: 'groq',
      generated_at: new Date().toISOString(),
      diagnostic: { stage: 'success', provider: 'groq', code: removedPolicy.length ? 'ai_generated_with_policy_guard' : removed.length ? 'ai_generated_with_numeric_repair' : 'ai_narrative_and_insights_generated', removed_numeric_fragments: removed, removed_policy_categories: removedPolicy, compact_payload_chars: JSON.stringify(compact).length },
    });'''
narr = sub_once(
    narr,
    r"    const repairedNarrative = repairNumericText\(originalNarrative, compact\);.*?    return json\(\{\n      ai_used: true,.*?\n    \}\);",
    new_repair,
    'AI output policy gate',
    re.S,
)
NARRATIVE.write_text(narr, encoding='utf-8')

guarded = GUARDED.read_text(encoding='utf-8')
guarded = sub_once(
    guarded,
    r"interpretation: 'Screening económico: observadas es el universo examinado y accionables son hipótesis de inscripción que requieren validación\. No acredita obligación jurídica, falta de inscripción ni incumplimiento\. Si una hipótesis se confirma, puede ampliar tareas de validación, incorporación registral, orientación, supervisión y futura reportabilidad; estas cifras no estiman una brecha de dotación\.',",
    "interpretation: 'Screening económico: observadas es el universo examinado y accionables son casos para validación. La salida debe limitarse a describir universo observado, correspondencias registrales y pendientes de contraste, sin calificar cumplimiento ni inferir deberes a partir de una ausencia de coincidencia. Puede orientar tareas de validación registral y análisis de cobertura, sin estimar una brecha de dotación.',",
    'guarded potential SO wording',
)
GUARDED.write_text(guarded, encoding='utf-8')

print('Atlas report coverage/silence patch applied successfully.')
