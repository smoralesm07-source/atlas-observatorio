from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: se esperaba 1 coincidencia y se encontraron {count}")
    return text.replace(old, new, 1)


path = Path("src/views/Reportes.tsx")
text = path.read_text(encoding="utf-8")

if "type AiInsights =" not in text:
    text = replace_once(
        text,
        "type Profile = { id: ProfileId; short: string; title: string; audience: string; purpose: string; lead: string };\n",
        "type Profile = { id: ProfileId; short: string; title: string; audience: string; purpose: string; lead: string };\n"
        "type AiInsights = { novelties: string; territory: string; crime: string; sectors: string; capacity: string };\n",
        "AI insights type",
    )

if "const [aiInsights, setAiInsights]" not in text:
    text = replace_once(
        text,
        "  const [aiNarrative, setAiNarrative] = useState<string | null>(null);\n",
        "  const [aiNarrative, setAiNarrative] = useState<string | null>(null);\n"
        "  const [aiInsights, setAiInsights] = useState<AiInsights | null>(null);\n",
        "AI insights state",
    )

text = text.replace(
    "  useEffect(() => { setAiNarrative(null); setAiStatus('idle'); setAiMeta(null); }, [fromYear, toYear, noveltyDays, profileId]);",
    "  useEffect(() => { setAiNarrative(null); setAiInsights(null); setAiStatus('idle'); setAiMeta(null); }, [fromYear, toYear, noveltyDays, profileId]);",
)

if "const sectorDeltas =" not in text:
    text = replace_once(
        text,
        "  const qCrime = questions.find(q => q.id === 'organized_crime_proxy');\n\n  const generated = new Date(p.generated_at);",
        "  const qCrime = questions.find(q => q.id === 'organized_crime_proxy');\n\n"
        "  const sectorDeltas = p.sectores.movimientos\n"
        "    .filter(x => x.ros_2024 != null && x.ros_2025 != null)\n"
        "    .map(x => ({\n"
        "      sector: x.sector_official,\n"
        "      ros_2024: Number(x.ros_2024),\n"
        "      ros_2025: Number(x.ros_2025),\n"
        "      delta_ros: Number(x.ros_2025) - Number(x.ros_2024),\n"
        "      delta_pct: x.delta_ros_2025_vs_2024_pct,\n"
        "      registered_so_2025: x.registered_so_2025,\n"
        "    }));\n"
        "  const chartContext = {\n"
        "    sectors: {\n"
        "      largest_increases: [...sectorDeltas].filter(x => x.delta_ros > 0).sort((a,b) => b.delta_ros-a.delta_ros).slice(0,5),\n"
        "      largest_declines: [...sectorDeltas].filter(x => x.delta_ros < 0).sort((a,b) => a.delta_ros-b.delta_ros).slice(0,5),\n"
        "      highest_ros_2025: [...p.sectores.movimientos].filter(x => x.ros_2025 != null).sort((a,b) => Number(b.ros_2025)-Number(a.ros_2025)).slice(0,5).map(x => ({ sector: x.sector_official, ros_2025: x.ros_2025, registered_so_2025: x.registered_so_2025 })),\n"
        "    },\n"
        "    territory: { leaders: regions.slice(0,5), communes: communes.slice(0,5) },\n"
        "    crime: { components: components.slice(0,5) },\n"
        "    capacity: { from: s.from, to: s.to, subject_growth_pct: s.soGrowth, ros_growth_pct: s.rosGrowth, staff_growth_pct: s.staffGrowth, iif_growth_pct: s.iifGrowth, mp_growth_pct: s.mpGrowth, pressure_index: s.pressureIndex, staff_index: s.staffIndex },\n"
        "    novelties: { external_alert_count: alerts.length, press_summary: p.novedades.prensa_resumen, recent_sanction_count: p.novedades.sanciones_resumen.recent_event_count ?? 0, press_themes: p.novedades.prensa_temas.slice(0,6) },\n"
        "  };\n\n"
        "  const generated = new Date(p.generated_at);",
        "deterministic chart context",
    )

if "chart_context: chartContext" not in text:
    text = replace_once(
        text,
        "    sectors: sectorMoves,\n    rules: p.reglas,",
        "    sectors: sectorMoves,\n    chart_context: chartContext,\n    rules: p.reglas,",
        "validated chart context",
    )

old_request = """  async function requestAiNarrative() {
    setAiStatus('loading'); setAiMeta(null);
    const { data, error } = await supabase.functions.invoke('atlas-report-narrative', { body: { profile: { id: profile.id, audience: profile.audience, purpose: profile.purpose, question: profile.lead }, validated_data: validated } });
    if (error || !data?.narrative) { setAiNarrative(null); setAiStatus('fallback'); setAiMeta(error?.message ?? data?.reason ?? 'Se mantiene la síntesis determinística.'); return; }
    setAiNarrative(String(data.narrative)); setAiStatus(data.ai_used ? 'ready' : 'fallback'); setAiMeta(data.ai_used ? `Síntesis estratégica IA · ${String(data.model ?? 'modelo configurado')}` : String(data.reason ?? 'Se mantiene la síntesis determinística.'));
  }
"""
new_request = """  async function requestAiNarrative() {
    setAiStatus('loading'); setAiMeta(null); setAiInsights(null);
    const { data, error } = await supabase.functions.invoke('atlas-report-narrative', { body: { profile: { id: profile.id, audience: profile.audience, purpose: profile.purpose, question: profile.lead }, validated_data: validated } });
    if (error || !data?.narrative) { setAiNarrative(null); setAiInsights(null); setAiStatus('fallback'); setAiMeta(error?.message ?? data?.reason ?? 'Se mantiene la síntesis determinística.'); return; }
    const insights = data?.insights;
    const validInsights = insights && ['novelties','territory','crime','sectors','capacity'].every(k => typeof insights[k] === 'string');
    setAiNarrative(String(data.narrative));
    setAiInsights(validInsights ? { novelties: String(insights.novelties), territory: String(insights.territory), crime: String(insights.crime), sectors: String(insights.sectors), capacity: String(insights.capacity) } : null);
    setAiStatus(data.ai_used ? 'ready' : 'fallback');
    setAiMeta(data.ai_used ? `Síntesis + lecturas IA · ${String(data.model ?? 'modelo configurado')}` : String(data.reason ?? 'Se mantiene la síntesis determinística.'));
  }
"""
if "Síntesis + lecturas IA" not in text:
    text = replace_once(text, old_request, new_request, "AI request with chart insights")

text = text.replace(
    "<span>IA → síntesis ejecutiva sobre paquete ya validado.</span>",
    "<span>IA → síntesis ejecutiva y lecturas de gráficos sobre un paquete ya validado.</span>",
)

if "aiInsights?.novelties" not in text:
    text = replace_once(
        text,
        "        <h4 className=\"sr-subtitle\">Alertas externas prioritarias</h4>",
        "        {aiStatus==='ready' && aiInsights?.novelties && <p className=\"report-ai-insight\"><strong>Lectura IA</strong>{aiInsights.novelties}</p>}\n        <h4 className=\"sr-subtitle\">Alertas externas prioritarias</h4>",
        "novelties AI insight",
    )

if "aiInsights?.territory" not in text:
    text = replace_once(
        text,
        "        <h4 className=\"sr-subtitle\">Comunas prioritarias por IGR</h4>",
        "        {aiStatus==='ready' && aiInsights?.territory && <p className=\"report-ai-insight\"><strong>Lectura IA</strong>{aiInsights.territory}</p>}\n        <h4 className=\"sr-subtitle\">Comunas prioritarias por IGR</h4>",
        "territory AI insight",
    )

if "aiInsights?.crime" not in text:
    text = replace_once(
        text,
        "        <p className=\"report-method-note\">Estos indicadores permiten formular preguntas —por ejemplo, dónde coinciden delitos asociados a drogas, receptación, robos de vehículos u homicidios con señales económicas—, pero no deben utilizarse para afirmar que una comuna “tiene más crimen organizado”.</p>",
        "        {aiStatus==='ready' && aiInsights?.crime && <p className=\"report-ai-insight\"><strong>Lectura IA</strong>{aiInsights.crime}</p>}\n        <p className=\"report-method-note\">Estos indicadores permiten formular preguntas —por ejemplo, dónde coinciden delitos asociados a drogas, receptación, robos de vehículos u homicidios con señales económicas—, pero no deben utilizarse para afirmar que una comuna “tiene más crimen organizado”.</p>",
        "crime AI insight",
    )

if "aiInsights?.sectors" not in text:
    text = replace_once(
        text,
        "        <p className=\"report-method-note\">Las variaciones extremas pueden reflejar bases pequeñas. Volumen o silencio de ROS no equivalen automáticamente a riesgo, calidad ni cumplimiento.</p>",
        "        {aiStatus==='ready' && aiInsights?.sectors && <p className=\"report-ai-insight\"><strong>Lectura IA</strong>{aiInsights.sectors}</p>}\n        <p className=\"report-method-note\">Las variaciones extremas pueden reflejar bases pequeñas. Volumen o silencio de ROS no equivalen automáticamente a riesgo, calidad ni cumplimiento.</p>",
        "sectors AI insight",
    )

if "aiInsights?.capacity" not in text:
    text = replace_once(
        text,
        "        <p className=\"report-method-note\">La comparación no define productividad ni dotación óptima. La dotación corresponde al total institucional y los IIF pueden consolidar múltiples ROS y otros antecedentes.</p>",
        "        {aiStatus==='ready' && aiInsights?.capacity && <p className=\"report-ai-insight\"><strong>Lectura IA</strong>{aiInsights.capacity}</p>}\n        <p className=\"report-method-note\">La comparación no define productividad ni dotación óptima. La dotación corresponde al total institucional y los IIF pueden consolidar múltiples ROS y otros antecedentes.</p>",
        "capacity AI insight",
    )

path.write_text(text, encoding="utf-8")

css_path = Path("src/styles/reportes.css")
css = css_path.read_text(encoding="utf-8")
if ".report-ai-insight{" not in css:
    css += "\n.report-ai-insight{margin:14px 0 12px;padding:11px 13px;border-left:3px solid #4f7db6;border-radius:0 7px 7px 0;background:#eef3f8;color:#33465b;font-size:10.5px;line-height:1.55}.report-ai-insight strong{display:inline-block;margin-right:8px;font-size:8.5px;letter-spacing:.06em;text-transform:uppercase;color:#315f91}\n"
css_path.write_text(css, encoding="utf-8")

print("Reportes: contexto determinístico + lecturas IA por bloque incorporadas.")
