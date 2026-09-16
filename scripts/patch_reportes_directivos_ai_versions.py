from pathlib import Path

path = Path('src/views/ReportesDirectivosV2.tsx')
s = path.read_text(encoding='utf-8')

# 1) Types + focus configuration for the ACTUAL report view mounted by App.tsx.
anchor = "type Profile = { id: ProfileId; label: string; title: string; subtitle: string };\n\ntype TrendPoint"
if anchor not in s:
    raise SystemExit('type anchor not found')
insert = """type Profile = { id: ProfileId; label: string; title: string; subtitle: string };
type AiInsights = { novelties: string; territory: string; crime: string; sectors: string; capacity: string };
type AiInsightKey = keyof AiInsights;
type ReportVersion = 'base' | 'ai';
type FocusConfig = { title: string; lead: string; primary: AiInsightKey; secondary: AiInsightKey; tertiary: AiInsightKey };

const FOCUS_CONFIG: Record<ProfileId, FocusConfig> = {
  presupuesto: { title: 'Presión y capacidad institucional', lead: 'Conecta crecimiento de la demanda observable, capacidad institucional y expansión del perímetro obligado.', primary: 'capacity', secondary: 'sectors', tertiary: 'novelties' },
  crimen: { title: 'Señales asociadas a economías criminales', lead: 'Prioriza contexto público y territorial, distinguiendo proxies y hechos de una medición directa de criminalidad.', primary: 'crime', secondary: 'territory', tertiary: 'novelties' },
  supervision: { title: 'Sectores que explican el cambio del universo obligado', lead: 'Prioriza industrias que aumentan o disminuyen, concentración del padrón y señales recientes útiles para supervisión.', primary: 'sectors', secondary: 'novelties', tertiary: 'capacity' },
  ciudadania: { title: 'Qué cambió y cómo interpretarlo', lead: 'Traduce los principales movimientos institucionales a una lectura pública clara y cauta.', primary: 'novelties', secondary: 'capacity', tertiary: 'territory' },
  internacional: { title: 'Presión doméstica y dimensión internacional', lead: 'Relaciona capacidad nacional, cooperación entre UIF y cambios recientes sin confundir intercambio con criminalidad.', primary: 'novelties', secondary: 'capacity', tertiary: 'territory' },
  ejecutivo: { title: 'Lectura directiva de los cambios relevantes', lead: 'Concentra los movimientos que más cambian el cuadro institucional y los factores que ayudan a explicarlos.', primary: 'capacity', secondary: 'sectors', tertiary: 'novelties' },
};

type TrendPoint"""
s = s.replace(anchor, insert, 1)

# 2) State: keep base report independent from AI proposal.
anchor = "  const [aiText, setAiText] = useState<string | null>(null);\n  const [aiStatus, setAiStatus]"
if anchor not in s:
    raise SystemExit('state anchor not found')
s = s.replace(anchor, "  const [aiText, setAiText] = useState<string | null>(null);\n  const [aiInsights, setAiInsights] = useState<AiInsights | null>(null);\n  const [reportVersion, setReportVersion] = useState<ReportVersion>('base');\n  const [aiStatus, setAiStatus]", 1)

# 3) Reset AI proposal whenever deterministic inputs change.
old = "  useEffect(() => { setAiText(null); setAiStatus('idle'); setAiMeta(null); }, [profileId, fromYear, toYear, noveltyDays]);"
new = "  useEffect(() => { setAiText(null); setAiInsights(null); setReportVersion('base'); setAiStatus('idle'); setAiMeta(null); }, [profileId, fromYear, toYear, noveltyDays]);"
if old not in s:
    raise SystemExit('reset anchor not found')
s = s.replace(old, new, 1)

# 4) Base vs AI rendering and profile-dependent focus.
old = "  const baseSummary = buildSummary(profileId, d, context);\n  const summary = aiText ? aiText.split(/\\n\\s*\\n/).filter(Boolean) : baseSummary;\n  const growth = d.sector_growth.slice(0, 7);\n  const declines = d.sector_decline.slice(0, 4);\n  const themes = context?.press_momentum?.slice(0, 5) ?? [];\n  const regions = context?.regional_convergence?.slice(0, 5) ?? [];"
new = "  const baseSummary = buildSummary(profileId, d, context);\n  const useAiVersion = reportVersion === 'ai' && aiStatus === 'ready' && !!aiText;\n  const summary = useAiVersion && aiText ? aiText.split(/\\n\\s*\\n/).filter(Boolean) : baseSummary;\n  const growth = d.sector_growth.slice(0, 7);\n  const declines = d.sector_decline.slice(0, 4);\n  const themes = context?.press_momentum?.slice(0, 5) ?? [];\n  const regions = context?.regional_convergence?.slice(0, 5) ?? [];\n  const focusConfig = FOCUS_CONFIG[profileId];\n  const focusPrimary = useAiVersion ? aiInsights?.[focusConfig.primary] : null;\n  const focusSecondary = useAiVersion ? aiInsights?.[focusConfig.secondary] : null;\n  const focusTertiary = useAiVersion ? aiInsights?.[focusConfig.tertiary] : null;"
if old not in s:
    raise SystemExit('summary anchor not found')
s = s.replace(old, new, 1)

# 5) Replace validated package so Groq's compact backend actually receives the active report's data.
start = s.index("  const validated = {")
end = s.index("\n\n  async function generateNarrative()", start)
validated = """  const generated = new Date(d.generated_at);
  const validated = {
    contract: d.contract,
    generated_context: { year: generated.getUTCFullYear(), month: generated.getUTCMonth() + 1, day: generated.getUTCDate(), novelty_days: noveltyDays },
    profile: { id: profile.id, audience: profile.label, purpose: profile.subtitle },
    structural: {
      period: d.period,
      situation: d.situation,
      change: d.change,
    },
    strategic_questions: [],
    novelties: {
      press_summary: context ? { article_count: context.coverage.press_relevant_articles ?? null, media_count: context.coverage.press_media_count ?? null } : null,
      external_alerts: [],
      press_themes: themes.map((x) => ({ theme: x.theme, article_count: x.current_n, source_count: x.current_media, latest_date: x.latest_date, previous_count: x.previous_n, delta_pct: x.delta_pct })),
      recent_sanctions: [],
    },
    territory: {
      year: toYear,
      top_regions: regions.map((x, index) => ({
        region_name: x.region_name,
        strategic_rank: index + 1,
        avg_igr: x.avg_igr,
        max_igr: x.max_igr,
        finding_n: x.finding_n,
        sanction_n: x.sanction_n,
        alert_context: x.alert_context,
        coverage: x.coverage,
      })),
      top_communes: [],
      cead_components: [],
      methodology: 'Convergencia territorial de señales públicas y capas Atlas; no equivale a prevalencia de lavado de activos o crimen organizado.',
    },
    chart_context: {
      sectors: {
        largest_increases: growth.map((x) => ({ sector: x.sector, registered_so_2025: x.registered_so_2025, current_subjects: x.current_subjects, delta_subjects: x.delta, delta_pct: x.delta_pct, top_region: x.top_region, top_region_share_pct: x.top_region_share_pct })),
        largest_declines: declines.map((x) => ({ sector: x.sector, registered_so_2025: x.registered_so_2025, current_subjects: x.current_subjects, delta_subjects: x.delta, delta_pct: x.delta_pct, top_region: x.top_region, top_region_share_pct: x.top_region_share_pct })),
        highest_ros_2025: [],
      },
      capacity: { period: d.period, situation: d.situation, change: d.change },
      novelties: { press_summary: context?.coverage ?? null, press_themes: themes },
      territory: { leaders: regions },
      crime: { press_themes: themes, regional_context: regions },
    },
    constraints: [
      'No recalcular ni introducir cifras nuevas.',
      'No inferir déficit de personal sin datos internos de carga, complejidad, backlog y tiempos de ciclo.',
      'No tratar ROS, ROE e IIF como unidades equivalentes.',
      'No presentar prensa o indicadores territoriales como medición directa de criminalidad.',
      'No recomendar una decisión presupuestaria o política.'
    ]
  };"""
s = s[:start] + validated + s[end:]

# 6) Consume structured AI insights and auto-open the AI proposal; failures always return to base.
start = s.index("  async function generateNarrative()")
end = s.index("\n\n  function printPdf()", start)
generate = """  async function generateNarrative() {
    setAiStatus('loading'); setAiMeta(null); setAiInsights(null);
    const { data, error } = await supabase.functions.invoke('atlas-report-narrative', {
      body: { profile: { id: profile.id, audience: profile.label, purpose: profile.subtitle, question: profile.title }, validated_data: validated }
    });
    if (error || !data?.narrative) {
      setAiText(null); setAiInsights(null); setReportVersion('base'); setAiStatus('fallback');
      setAiMeta(error?.message ?? data?.reason ?? 'Se mantiene el informe base determinístico.');
      return;
    }
    const insights = data?.insights;
    const validInsights = insights && ['novelties','territory','crime','sectors','capacity'].every((key) => typeof insights[key] === 'string');
    setAiText(String(data.narrative));
    setAiInsights(validInsights ? {
      novelties: String(insights.novelties), territory: String(insights.territory), crime: String(insights.crime), sectors: String(insights.sectors), capacity: String(insights.capacity)
    } : null);
    setAiStatus(data.ai_used ? 'ready' : 'fallback');
    setReportVersion(data.ai_used ? 'ai' : 'base');
    setAiMeta(data.ai_used ? `Propuesta IA disponible · ${String(data.model ?? 'modelo configurado')}` : String(data.reason ?? 'Se mantiene el informe base determinístico.'));
  }"""
s = s[:start] + generate + s[end:]

# 7) PDF explicitly records which version is exported.
old = "    document.title = `ATLAS_Situacion_UAF_${profile.label}_${fromYear}_${toYear}`;"
new = "    document.title = `ATLAS_Situacion_UAF_${profile.label}_${fromYear}_${toYear}_${useAiVersion ? 'IA' : 'Base'}`;"
if old not in s:
    raise SystemExit('pdf title anchor not found')
s = s.replace(old, new, 1)

# 8) Visible, reversible version switch in the REAL report controls.
old = """      <label><span>Contexto reciente</span><select value={noveltyDays} onChange={(e) => setNoveltyDays(Number(e.target.value))}><option value={7}>7 días</option><option value={30}>30 días</option><option value={60}>60 días</option><option value={90}>90 días</option></select></label>
      <button className=\"report-btn report-btn-ai\" onClick={() => void generateNarrative()} disabled={aiStatus === 'loading'}>{aiStatus === 'loading' ? 'Actualizando síntesis…' : 'Actualizar síntesis'}</button>
      <button className=\"report-btn report-btn-primary\" onClick={printPdf}>Generar PDF</button>"""
new = """      <label><span>Contexto reciente</span><select value={noveltyDays} onChange={(e) => setNoveltyDays(Number(e.target.value))}><option value={7}>7 días</option><option value={30}>30 días</option><option value={60}>60 días</option><option value={90}>90 días</option></select></label>
      <div className=\"report-safety-box\"><strong>Versión del informe</strong><span>El informe base siempre se conserva. La propuesta IA cambia la lectura y el foco, pero no las cifras ni gráficos validados.</span></div>
      <div className=\"report-version-switch\" aria-label=\"Versión del informe\">
        <button className={reportVersion === 'base' ? 'is-active' : ''} onClick={() => setReportVersion('base')}>Informe base</button>
        <button className={reportVersion === 'ai' ? 'is-active' : ''} onClick={() => setReportVersion('ai')} disabled={aiStatus !== 'ready'}>Propuesta IA</button>
      </div>
      <button className=\"report-btn report-btn-ai\" onClick={() => void generateNarrative()} disabled={aiStatus === 'loading'}>{aiStatus === 'loading' ? 'Generando propuesta…' : aiStatus === 'ready' ? 'Regenerar propuesta IA' : 'Generar propuesta IA'}</button>
      <button className=\"report-btn report-btn-primary\" onClick={printPdf}>Generar PDF · {useAiVersion ? 'IA' : 'Base'}</button>"""
if old not in s:
    raise SystemExit('controls anchor not found')
s = s.replace(old, new, 1)

# 9) Make version visible on the cover.
old = "<div className=\"dbv2-cover-meta\"><span>Último padrón: {d.situation.subjects_latest_date ?? 's/d'}</span><span>Última dotación publicada: {d.situation.staff_latest_date ?? 's/d'}</span></div>"
new = "<div className=\"dbv2-cover-meta\"><span>Último padrón: {d.situation.subjects_latest_date ?? 's/d'}</span><span>Última dotación publicada: {d.situation.staff_latest_date ?? 's/d'}</span><span>{useAiVersion ? 'PROPUESTA IA · REVERSIBLE' : 'INFORME BASE'}</span></div>"
if old not in s:
    raise SystemExit('cover anchor not found')
s = s.replace(old, new, 1)

# 10) Identify the executive summary version.
old = "        <div className=\"dbv2-summary\">{summary.map((p, i) => <p key={i}>{p}</p>)}</div>"
new = "        <div className=\"dbv2-summary\"><div className=\"report-narrative-label\"><span>{useAiVersion ? 'Síntesis estratégica · propuesta IA' : 'Síntesis estratégica base'}</span><small>{useAiVersion ? 'Propuesta reversible sobre datos validados.' : 'Texto reproducible sin dependencia de IA.'}</small></div>{summary.map((p, i) => <p key={i}>{p}</p>)}</div>"
if old not in s:
    raise SystemExit('summary ui anchor not found')
s = s.replace(old, new, 1)

# 11) Add a genuinely profile-dependent focal section only to the AI version.
marker = """      <section className=\"report-section report-page-break\">
        <div className=\"report-section-heading\"><span>02</span><div><h3>Evolución institucional</h3>"""
if marker not in s:
    raise SystemExit('section 02 marker not found')
focus = """      {useAiVersion && <section className=\"report-section report-page-break dbv2-focus-section\">
        <div className=\"report-section-heading\"><span>FOCO</span><div><h3>Lectura focal · {profile.label}</h3><p>{focusConfig.lead}</p></div></div>
        <div className=\"sr-focus-shell\">
          <div className=\"sr-focus-head\"><span>PROPUESTA IA · REVERSIBLE</span><h4>{focusConfig.title}</h4><p>Esta página cambia según el enfoque elegido. Los cálculos y gráficos permanecen idénticos al informe base.</p></div>
          <div className=\"sr-focus-grid\">
            <article className=\"sr-focus-card is-primary\"><span>HALLAZGO CENTRAL</span><p>{focusPrimary ?? summary[0]}</p></article>
            <article className=\"sr-focus-card\"><span>QUÉ LO SOSTIENE</span><p>{focusSecondary ?? 'La IA no agregó una segunda lectura válida; se conserva la evidencia del informe base.'}</p></article>
            <article className=\"sr-focus-card\"><span>QUÉ CONTRASTAR</span><p>{focusTertiary ?? 'La IA no agregó una tercera lectura válida; revise el informe base para mantener la interpretación reproducible.'}</p></article>
          </div>
          <div className=\"sr-focus-footer\"><strong>Control del usuario</strong><span>Use “Informe base” para volver instantáneamente al documento original, sin regenerar datos ni consumir otra llamada IA.</span></div>
        </div>
      </section>}

""" + marker
s = s.replace(marker, focus, 1)

# 12) Add AI reading where it adds domain-specific value, not below every graph.
old = """        </div>
        <p className=\"dbv2-note\">La ampliación de actividades desde 2023 corresponde a un cambio del perímetro normativo. La dotación corresponde al total institucional publicado y no a una división específica.</p>"""
new = """        </div>
        {useAiVersion && aiInsights?.capacity && <p className=\"report-ai-insight\"><strong>Lectura IA</strong>{aiInsights.capacity}</p>}
        <p className=\"dbv2-note\">La ampliación de actividades desde 2023 corresponde a un cambio del perímetro normativo. La dotación corresponde al total institucional publicado y no a una división específica.</p>"""
if old not in s:
    raise SystemExit('capacity insight anchor not found')
s = s.replace(old, new, 1)

old = """        <div className=\"report-table-wrap\"><table className=\"report-table\"><thead><tr><th>Sector</th><th>2025</th><th>Actual</th><th>Variación</th><th>Región principal</th></tr></thead><tbody>{growth.map((x) => <tr key={x.sector}><td>{x.sector}</td><td>{fmt0.format(x.registered_so_2025 ?? 0)}</td><td>{fmt0.format(x.current_subjects ?? 0)}</td><td>+{fmt0.format(x.delta ?? 0)} ({signed(x.delta_pct)})</td><td>{x.top_region ?? '—'}</td></tr>)}</tbody></table></div>
        {declines.length > 0 && <p className=\"dbv2-note\">Sectores con disminución registral en el mismo contraste: {declines.map((x) => `${x.sector} (${fmt0.format(x.delta ?? 0)})`).join(', ')}.</p>}"""
new = """        <div className=\"report-table-wrap\"><table className=\"report-table\"><thead><tr><th>Sector</th><th>2025</th><th>Actual</th><th>Variación</th><th>Región principal</th></tr></thead><tbody>{growth.map((x) => <tr key={x.sector}><td>{x.sector}</td><td>{fmt0.format(x.registered_so_2025 ?? 0)}</td><td>{fmt0.format(x.current_subjects ?? 0)}</td><td>+{fmt0.format(x.delta ?? 0)} ({signed(x.delta_pct)})</td><td>{x.top_region ?? '—'}</td></tr>)}</tbody></table></div>
        {useAiVersion && aiInsights?.sectors && <p className=\"report-ai-insight\"><strong>Lectura IA</strong>{aiInsights.sectors}</p>}
        {declines.length > 0 && <p className=\"dbv2-note\">Sectores con disminución registral en el mismo contraste: {declines.map((x) => `${x.sector} (${fmt0.format(x.delta ?? 0)})`).join(', ')}.</p>}"""
if old not in s:
    raise SystemExit('sector insight anchor not found')
s = s.replace(old, new, 1)

# Recent context: choose a reading that follows the report focus.
old = """        </div>
        <p className=\"dbv2-note\">La prensa describe agenda pública y hechos reportados; el IGR y los hallazgos territoriales son señales de contexto. Ninguna de estas capas constituye por sí sola una medición de lavado de activos o crimen organizado.</p>"""
new = """        </div>
        {useAiVersion && aiInsights && <p className=\"report-ai-insight\"><strong>Lectura IA</strong>{profileId === 'crimen' ? aiInsights.crime : profileId === 'supervision' ? aiInsights.novelties : profileId === 'internacional' ? aiInsights.novelties : profileId === 'ciudadania' ? aiInsights.novelties : aiInsights.territory}</p>}
        <p className=\"dbv2-note\">La prensa describe agenda pública y hechos reportados; el IGR y los hallazgos territoriales son señales de contexto. Ninguna de estas capas constituye por sí sola una medición de lavado de activos o crimen organizado.</p>"""
if old not in s:
    raise SystemExit('context insight anchor not found')
s = s.replace(old, new, 1)

path.write_text(s, encoding='utf-8')
print('ReportesDirectivosV2 patched with reversible Base/IA versions and focal AI section')
