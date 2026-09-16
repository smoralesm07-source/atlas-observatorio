from pathlib import Path

path = Path('src/views/ReportesDirectivosV2.tsx')
text = path.read_text(encoding='utf-8')

anchor = "function buildSummary(profile: ProfileId, d: BriefPayload, depth: DepthPayload | null): string[] {"
helpers = r'''const AI_UNUSABLE_PATTERNS = [
  /no permite (?:agregar|generar|construir|realizar)/i,
  /se mantiene (?:la )?(?:interpretaci[oó]n|lectura|s[ií]ntesis|versi[oó]n|informe).*determin/i,
  /sin introducir cifras (?:ajenas|nuevas)/i,
  /no (?:es|fue) posible/i,
  /no hay (?:suficiente|una lectura)/i,
  /no (?:se )?dispone de informaci[oó]n suficiente/i,
  /paquete validado.*no/i,
  /no agreg[oó] una .*lectura/i,
  /no devolvi[oó] una .*utilizable/i,
  /tokens?/i,
];

function isUsableAiBlock(value: unknown, minLength = 55): value is string {
  if (typeof value !== 'string') return false;
  const text = value.trim();
  if (text.length < minLength) return false;
  return !AI_UNUSABLE_PATTERNS.some((pattern) => pattern.test(text));
}

function parseUsableAiInsights(value: unknown): AiInsights | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  const keys: AiInsightKey[] = ['novelties', 'territory', 'crime', 'sectors', 'capacity'];
  if (!keys.every((key) => isUsableAiBlock(candidate[key]))) return null;
  return {
    novelties: String(candidate.novelties),
    territory: String(candidate.territory),
    crime: String(candidate.crime),
    sectors: String(candidate.sectors),
    capacity: String(candidate.capacity),
  };
}

function isUsableAiNarrative(value: unknown): value is string {
  if (!isUsableAiBlock(value, 180)) return false;
  const paragraphs = value.split(/\n\s*\n/).map((part) => part.trim()).filter((part) => part.length >= 40);
  return paragraphs.length >= 2;
}

'''
if 'const AI_UNUSABLE_PATTERNS' not in text:
    if anchor not in text:
        raise SystemExit('buildSummary anchor not found')
    text = text.replace(anchor, helpers + anchor, 1)

old = r'''  async function generateNarrative() {
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
  }'''
new = r'''  async function generateNarrative() {
    setAiStatus('loading'); setAiMeta(null); setAiInsights(null);
    const { data, error } = await supabase.functions.invoke('atlas-report-narrative', {
      body: { profile: { id: profile.id, audience: profile.label, purpose: profile.subtitle, question: profile.title }, validated_data: validated }
    });

    const usableInsights = parseUsableAiInsights(data?.insights);
    const proposalIsUsable = !error && data?.ai_used === true && isUsableAiNarrative(data?.narrative) && usableInsights !== null;

    if (!proposalIsUsable) {
      // Fail closed: a partial, abstaining or provider-error response never becomes a visible AI report.
      // Detailed provider/guardrail diagnostics remain outside the document; the user simply keeps the base report.
      setAiText(null);
      setAiInsights(null);
      setReportVersion('base');
      setAiStatus('fallback');
      setAiMeta('Se mantiene el informe base.');
      return;
    }

    setAiText(data.narrative.trim());
    setAiInsights(usableInsights);
    setAiStatus('ready');
    setReportVersion('ai');
    setAiMeta(`Propuesta IA validada · ${String(data.model ?? 'modelo configurado')}`);
  }'''
if old not in text:
    raise SystemExit('generateNarrative block not found')
text = text.replace(old, new, 1)

# Defensive: never show a fallback sentence inside the focal cards if state somehow becomes inconsistent.
text = text.replace("{focusPrimary ?? summary[0]}", "{focusPrimary || summary[0]}")
text = text.replace("{focusSecondary ?? summary[1] ?? summary[0]}", "{focusSecondary || summary[1] || summary[0]}")
text = text.replace("{focusTertiary ?? summary[2] ?? summary[0]}", "{focusTertiary || summary[2] || summary[0]}")

path.write_text(text, encoding='utf-8')
print('Applied strict AI proposal quality gate to active directive report')
