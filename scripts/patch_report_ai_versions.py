from pathlib import Path

TSX = Path('src/views/Reportes.tsx')
CSS = Path('src/styles/reportes.css')

ts = TSX.read_text(encoding='utf-8')
css = CSS.read_text(encoding='utf-8')


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f'Marker not found: {label}')
    return text.replace(old, new, 1)

# 1) Types + profile-specific focus configuration.
old = "type AiInsights = { novelties: string; territory: string; crime: string; sectors: string; capacity: string };\n"
new = """type AiInsights = { novelties: string; territory: string; crime: string; sectors: string; capacity: string };\ntype AiInsightKey = keyof AiInsights;\ntype ReportVersion = 'base' | 'ai';\ntype FocusConfig = { title: string; lead: string; primary: AiInsightKey; secondary: AiInsightKey; tertiary: AiInsightKey };\n\nconst FOCUS_CONFIG: Record<ProfileId, FocusConfig> = {\n  presupuesto: { title: 'Presión y capacidad institucional', lead: 'Prioriza la relación entre demanda observable, capacidad y cambios que agregan complejidad.', primary: 'capacity', secondary: 'sectors', tertiary: 'novelties' },\n  crimen: { title: 'Convergencia de señales vinculadas a economías criminales', lead: 'Prioriza proxies, territorio y novedades sin convertir señales de contexto en prueba de delito.', primary: 'crime', secondary: 'territory', tertiary: 'novelties' },\n  supervision: { title: 'Sectores que explican los cambios de reportabilidad', lead: 'Prioriza industrias que aumentan o reducen su aporte, concentración y señales de contexto supervisor.', primary: 'sectors', secondary: 'novelties', tertiary: 'capacity' },\n  territorial: { title: 'Dónde se concentran y qué explica las señales', lead: 'Prioriza regiones, comunas y componentes que explican la lectura territorial del período.', primary: 'territory', secondary: 'crime', tertiary: 'novelties' },\n  ciudadania: { title: 'Qué cambió y cómo debe interpretarse', lead: 'Traduce los principales cambios a una lectura pública clara, con límites metodológicos explícitos.', primary: 'novelties', secondary: 'capacity', tertiary: 'territory' },\n  internacional: { title: 'Dimensión internacional y presión doméstica', lead: 'Relaciona novedades transfronterizas con la evolución del sistema nacional sin confundir cooperación con criminalidad.', primary: 'novelties', secondary: 'capacity', tertiary: 'territory' },\n  ejecutivo: { title: 'Lectura directiva de los cambios más relevantes', lead: 'Concentra los cambios que merecen atención y los factores que explican su movimiento.', primary: 'capacity', secondary: 'sectors', tertiary: 'novelties' },\n};\n"""
ts = replace_once(ts, old, new, 'AI types')

# 2) Explicit report version state.
old = "  const [aiMeta, setAiMeta] = useState<string | null>(null);\n"
new = "  const [aiMeta, setAiMeta] = useState<string | null>(null);\n  const [reportVersion, setReportVersion] = useState<ReportVersion>('base');\n"
ts = replace_once(ts, old, new, 'report version state')

old = "  useEffect(() => { setAiNarrative(null); setAiInsights(null); setAiStatus('idle'); setAiMeta(null); }, [fromYear, toYear, noveltyDays, profileId]);\n"
new = "  useEffect(() => { setAiNarrative(null); setAiInsights(null); setAiStatus('idle'); setAiMeta(null); setReportVersion('base'); }, [fromYear, toYear, noveltyDays, profileId]);\n"
ts = replace_once(ts, old, new, 'reset report version')

# 3) Base is the invariant; AI only renders when explicitly selected and validated.
old = "  const baseBrief = deterministicBrief(profileId, p, s);\n  const brief = aiNarrative ? aiNarrative.split(/\\n\\s*\\n/).filter(Boolean) : baseBrief;\n"
new = "  const baseBrief = deterministicBrief(profileId, p, s);\n  const useAiVersion = reportVersion === 'ai' && aiStatus === 'ready' && !!aiNarrative;\n  const brief = useAiVersion && aiNarrative ? aiNarrative.split(/\\n\\s*\\n/).filter(Boolean) : baseBrief;\n  const focusConfig = FOCUS_CONFIG[profileId];\n"
ts = replace_once(ts, old, new, 'brief version selection')

# Add focus values after question lookup.
old = "  const qCrime = questions.find(q => q.id === 'organized_crime_proxy');\n"
new = """  const qCrime = questions.find(q => q.id === 'organized_crime_proxy');\n  const focusPrimary = useAiVersion ? aiInsights?.[focusConfig.primary] : null;\n  const focusSecondary = useAiVersion ? aiInsights?.[focusConfig.secondary] : null;\n  const focusTertiary = useAiVersion ? aiInsights?.[focusConfig.tertiary] : null;\n"""
ts = replace_once(ts, old, new, 'focus values')

# 4) AI request promotes proposal only on success; failure always returns to base.
old = "  async function requestAiNarrative() {\n    setAiStatus('loading'); setAiMeta(null); setAiInsights(null);\n"
new = "  async function requestAiNarrative() {\n    setAiStatus('loading'); setAiMeta(null); setAiInsights(null);\n"
ts = replace_once(ts, old, new, 'request entry')

old = "    if (error || !data?.narrative) { setAiNarrative(null); setAiInsights(null); setAiStatus('fallback'); setAiMeta(error?.message ?? data?.reason ?? 'Se mantiene la síntesis determinística.'); return; }\n"
new = "    if (error || !data?.narrative) { setAiNarrative(null); setAiInsights(null); setAiStatus('fallback'); setReportVersion('base'); setAiMeta(error?.message ?? data?.reason ?? 'Se mantiene el informe base determinístico.'); return; }\n"
ts = replace_once(ts, old, new, 'AI failure fallback')

old = "    setAiStatus(data.ai_used ? 'ready' : 'fallback');\n    setAiMeta(data.ai_used ? `Síntesis + lecturas IA · ${String(data.model ?? 'modelo configurado')}` : String(data.reason ?? 'Se mantiene la síntesis determinística.'));\n"
new = "    setAiStatus(data.ai_used ? 'ready' : 'fallback');\n    setReportVersion(data.ai_used ? 'ai' : 'base');\n    setAiMeta(data.ai_used ? `Propuesta IA disponible · ${String(data.model ?? 'modelo configurado')}` : String(data.reason ?? 'Se mantiene el informe base determinístico.'));\n"
ts = replace_once(ts, old, new, 'AI success version')

# 5) PDF title clearly records which version is exported.
old = "  function printPdf() {\n    const prev = document.title; document.title = `ATLAS_Informe_Estrategico_${profile.short}_${fromYear}_${toYear}`; window.print(); window.setTimeout(() => { document.title = prev; }, 500);\n  }\n"
new = "  function printPdf() {\n    const prev = document.title; const version = useAiVersion ? 'IA' : 'Base'; document.title = `ATLAS_Informe_Estrategico_${profile.short}_${fromYear}_${toYear}_${version}`; window.print(); window.setTimeout(() => { document.title = prev; }, 500);\n  }\n"
ts = replace_once(ts, old, new, 'PDF version title')

# 6) Controls: visible base/AI choice and explicit reversibility.
old = "      <div><span className=\"report-kicker\">ATLAS · INFORMES ESTRATÉGICOS</span><h1>Informe de situación</h1><p>Combina evidencia estructural con novedades del entorno. La IA redacta; no calcula.</p></div>\n"
new = "      <div><span className=\"report-kicker\">ATLAS · INFORMES ESTRATÉGICOS</span><h1>Informe de situación</h1><p>El informe base siempre se conserva. La IA propone una versión focalizada; nunca reemplaza los datos ni cálculos de Atlas.</p></div>\n"
ts = replace_once(ts, old, new, 'control description')

old = "      <div className=\"report-safety-box\"><strong>Arquitectura</strong><span>SQL / reglas → cifras, rankings, selección de novedades y preguntas.</span><span>IA → síntesis ejecutiva y lecturas de gráficos sobre un paquete ya validado.</span></div>\n      <button className=\"report-btn report-btn-ai\" onClick={() => void requestAiNarrative()} disabled={aiStatus==='loading'}>{aiStatus==='loading'?'Redactando…':'Redactar síntesis IA'}</button>\n      <button className=\"report-btn report-btn-primary\" onClick={printPdf}>Generar PDF</button>\n"
new = """      <div className=\"report-safety-box\"><strong>Arquitectura</strong><span>SQL / reglas → cifras, rankings, selección de novedades y preguntas.</span><span>IA → propone síntesis y una lectura focal sobre el mismo paquete validado. El informe base permanece disponible.</span></div>\n      <div className=\"report-version-switch\" aria-label=\"Versión del informe\">\n        <button className={reportVersion==='base'?'is-active':''} onClick={() => setReportVersion('base')}>Informe base</button>\n        <button className={reportVersion==='ai'?'is-active':''} onClick={() => setReportVersion('ai')} disabled={aiStatus!=='ready'}>Propuesta IA</button>\n      </div>\n      <button className=\"report-btn report-btn-ai\" onClick={() => void requestAiNarrative()} disabled={aiStatus==='loading'}>{aiStatus==='loading'?'Generando propuesta…':aiStatus==='ready'?'Regenerar propuesta IA':'Generar propuesta IA'}</button>\n      <button className=\"report-btn report-btn-primary\" onClick={printPdf}>Generar PDF · {useAiVersion?'IA':'Base'}</button>\n"""
ts = replace_once(ts, old, new, 'version controls')

# 7) Cover and executive labels follow selected version, not merely AI availability.
ts = ts.replace("{aiStatus==='ready'?'SÍNTESIS IA VALIDADA':'SÍNTESIS DETERMINÍSTICA'}", "{useAiVersion?'PROPUESTA IA VALIDADA':'INFORME BASE DETERMINÍSTICO'}")
ts = ts.replace("{aiStatus==='ready'?'Síntesis estratégica IA':'Síntesis estratégica base'}", "{useAiVersion?'Síntesis estratégica · propuesta IA':'Síntesis estratégica base'}")
ts = ts.replace("{aiStatus==='ready'?'Redacción sobre paquete validado, sin cálculo generativo.':'Texto reproducible construido desde reglas y métricas.'}", "{useAiVersion?'Versión reversible construida sobre paquete validado, sin cálculo generativo.':'Texto reproducible construido desde reglas y métricas.'}")

# 8) Section 02 becomes adaptive only in AI mode. Base section is preserved verbatim.
old = """      <section className=\"report-section report-page-break\">\n        <div className=\"report-section-heading\"><span>02</span><div><h3>Preguntas que el informe puede responder</h3><p>Las respuestas cambian cuando cambian los datos, no por criterio del modelo generativo.</p></div></div>\n        <div className=\"sr-question-grid\">{questions.map(q => <article className=\"sr-question\" key={q.id}><span>INTERROGANTE</span><h4>{q.question}</h4><p>{answerQuestion(q,s,p)}</p>{q.caveat && <small>{q.caveat}</small>}</article>)}</div>\n      </section>\n"""
new = """      <section className=\"report-section report-page-break\">\n        {useAiVersion ? <>\n          <div className=\"report-section-heading\"><span>02</span><div><h3>Lectura focal · {profile.short}</h3><p>{focusConfig.lead}</p></div></div>\n          <div className=\"sr-focus-shell\">\n            <div className=\"sr-focus-head\"><span>PROPUESTA IA · REVERSIBLE</span><h4>{focusConfig.title}</h4><p>Atlas selecciona el foco según el propósito del informe; la IA interpreta únicamente señales ya validadas.</p></div>\n            <div className=\"sr-focus-grid\">\n              <article className=\"sr-focus-card is-primary\"><span>HALLAZGO CENTRAL</span><p>{focusPrimary ?? brief[0]}</p></article>\n              <article className=\"sr-focus-card\"><span>QUÉ LO SOSTIENE</span><p>{focusSecondary ?? 'La propuesta IA no agregó una segunda lectura válida; se conserva la evidencia del informe base.'}</p></article>\n              <article className=\"sr-focus-card\"><span>QUÉ CONTRASTAR</span><p>{focusTertiary ?? 'La propuesta IA no agregó una tercera lectura válida; revise las preguntas determinísticas del informe base.'}</p></article>\n            </div>\n            <div className=\"sr-focus-footer\"><strong>Control del usuario</strong><span>Puede volver a “Informe base” en cualquier momento. Los datos, gráficos y cálculos no cambian entre versiones.</span></div>\n          </div>\n        </> : <>\n          <div className=\"report-section-heading\"><span>02</span><div><h3>Preguntas que el informe puede responder</h3><p>Las respuestas cambian cuando cambian los datos, no por criterio del modelo generativo.</p></div></div>\n          <div className=\"sr-question-grid\">{questions.map(q => <article className=\"sr-question\" key={q.id}><span>INTERROGANTE</span><h4>{q.question}</h4><p>{answerQuestion(q,s,p)}</p>{q.caveat && <small>{q.caveat}</small>}</article>)}</div>\n        </>}\n      </section>\n"""
ts = replace_once(ts, old, new, 'adaptive section 02')

# 9) Existing AI chart readings are visible only when user has selected the AI proposal.
ts = ts.replace("aiStatus==='ready' && aiInsights?.", "useAiVersion && aiInsights?.")

# 10) CSS for reversible report-version control and dynamic focal section.
css_append = """

/* Base / AI report versions */
.report-version-switch{display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:5px;border:1px solid rgba(255,255,255,.09);border-radius:10px;background:rgba(255,255,255,.025)}
.report-version-switch button{border:0;border-radius:7px;padding:9px 8px;background:transparent;color:#93a1b4;font-size:10px;font-weight:850;cursor:pointer}
.report-version-switch button.is-active{background:#edf2f8;color:#152538;box-shadow:0 1px 4px rgba(0,0,0,.18)}
.report-version-switch button:disabled{opacity:.38;cursor:not-allowed}
.sr-focus-shell{border:1px solid #d7e0e9;border-radius:12px;background:#fff;overflow:hidden}
.sr-focus-head{padding:18px 20px;background:#13263b;color:#fff}
.sr-focus-head>span{display:block;margin-bottom:7px;font-size:8px;font-weight:900;letter-spacing:.09em;color:#9fc2ea}
.sr-focus-head h4{margin:0 0 7px;font-size:18px;letter-spacing:-.02em}
.sr-focus-head p{margin:0;max-width:760px;font-size:10.5px;line-height:1.55;color:#cbd6e2}
.sr-focus-grid{display:grid;grid-template-columns:1.4fr 1fr 1fr;gap:0;border-top:1px solid #dfe5eb}
.sr-focus-card{padding:17px 18px;min-height:148px;border-left:1px solid #e1e6ec}
.sr-focus-card:first-child{border-left:0}
.sr-focus-card>span{display:block;margin-bottom:9px;font-size:8px;font-weight:900;letter-spacing:.075em;color:#567493}
.sr-focus-card p{margin:0;font-size:11px;line-height:1.62;color:#344354}
.sr-focus-card.is-primary{background:#f1f5f8}
.sr-focus-card.is-primary p{font-size:12.5px;color:#1f3449}
.sr-focus-footer{display:flex;justify-content:space-between;gap:18px;padding:10px 18px;border-top:1px solid #e1e6ec;background:#f8fafb}
.sr-focus-footer strong{font-size:8.5px;color:#355b82;text-transform:uppercase;letter-spacing:.055em}
.sr-focus-footer span{font-size:8.7px;line-height:1.45;color:#718092;text-align:right}
@media(max-width:680px){.sr-focus-grid{grid-template-columns:1fr}.sr-focus-card{border-left:0;border-top:1px solid #e1e6ec}.sr-focus-card:first-child{border-top:0}.sr-focus-footer{display:grid}.sr-focus-footer span{text-align:left}}
"""
if '/* Base / AI report versions */' not in css:
    css += css_append

TSX.write_text(ts, encoding='utf-8')
CSS.write_text(css, encoding='utf-8')
print('Applied reversible base/AI report versions and profile-focused section.')
