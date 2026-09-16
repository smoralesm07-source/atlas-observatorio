import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

type NarrativeRequest = {
  profile?: { id?: string; audience?: string; purpose?: string; question?: string };
  validated_data?: unknown;
};

type AiInsights = {
  novelties: string;
  territory: string;
  crime: string;
  sectors: string;
  capacity: string;
};

type NumericIssue = { token: string; value: number | null };

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function extractOutputText(payload: any): string {
  if (!payload || !Array.isArray(payload.output)) return '';
  const chunks: string[] = [];
  for (const item of payload.output) {
    if (item?.type !== 'message' || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (content?.type === 'output_text' && typeof content.text === 'string') chunks.push(content.text);
    }
  }
  return chunks.join('\n').trim();
}

function rawNumericTokens(text: string): string[] {
  return text.match(/(?<!\d)[-−]?\d+(?:[.,]\d+)*(?:%)?/g) ?? [];
}

function parseNumericToken(token: string): number | null {
  let raw = token.trim().replace(/%$/, '').replace('−', '-');
  const sign = raw.startsWith('-') ? -1 : 1;
  if (sign < 0) raw = raw.slice(1);
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(raw)) raw = raw.replace(/\./g, '').replace(',', '.');
  else raw = raw.replace(',', '.');
  const value = Number(raw);
  return Number.isFinite(value) ? sign * value : null;
}

function numericTokens(text: string): number[] {
  return rawNumericTokens(text).map(parseNumericToken).filter((x): x is number => x != null);
}

function collectAllowedNumbers(value: unknown, out: number[] = []): number[] {
  if (typeof value === 'number' && Number.isFinite(value)) out.push(value);
  else if (typeof value === 'string') out.push(...numericTokens(value));
  else if (Array.isArray(value)) {
    out.push(value.length);
    value.forEach((v) => collectAllowedNumbers(v, out));
  } else if (value && typeof value === 'object') {
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      out.push(...numericTokens(key));
      collectAllowedNumbers(v, out);
    }
  }
  return out;
}

function tokenDecimals(token: string): number {
  let raw = token.trim().replace(/%$/, '').replace('−', '-');
  if (raw.startsWith('-')) raw = raw.slice(1);
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(raw)) return (raw.split(',')[1] ?? '').length;
  const normalized = raw.replace(',', '.');
  return (normalized.split('.')[1] ?? '').length;
}

function isAllowedNumber(token: string, allowed: number[]): boolean {
  const value = parseNumericToken(token);
  if (value == null) return false;
  const decimals = tokenDecimals(token);
  return allowed.some((candidate) => {
    if (Math.abs(candidate - value) < 0.0005) return true;
    if (decimals === 0 && Math.round(candidate) === value) return true;
    if (decimals === 1 && Math.abs(Math.round(candidate * 10) / 10 - value) < 0.0005) return true;
    if (decimals === 2 && Math.abs(Math.round(candidate * 100) / 100 - value) < 0.0005) return true;
    return false;
  });
}

function invalidNumbers(text: string, data: unknown): NumericIssue[] {
  const allowed = [...collectAllowedNumbers(data), 0, 1, 100];
  const invalid = rawNumericTokens(text)
    .filter((token) => !isAllowedNumber(token, allowed))
    .map((token) => ({ token, value: parseNumericToken(token) }));
  return invalid.filter((item, index, all) => all.findIndex((x) => x.token === item.token) === index).slice(0, 8);
}

function repairNumericText(text: string, data: unknown): { text: string; removed: NumericIssue[] } {
  const pieces = text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((x) => x.trim())
    .filter(Boolean);
  const kept: string[] = [];
  const removed: NumericIssue[] = [];
  for (const piece of pieces) {
    const bad = invalidNumbers(piece, data);
    if (bad.length) removed.push(...bad);
    else kept.push(piece);
  }
  const unique = removed.filter((item, index, all) => all.findIndex((x) => x.token === item.token) === index).slice(0, 8);
  return { text: kept.join(' ').trim(), removed: unique };
}

function text(v: unknown, max = 260): string | null {
  if (typeof v !== 'string') return null;
  const clean = v.replace(/\s+/g, ' ').trim();
  return clean ? clean.slice(0, max) : null;
}

function buildCompactPacket(source: any) {
  const d = source ?? {};
  const q = Array.isArray(d.strategic_questions) ? d.strategic_questions.slice(0, 5) : [];
  const alerts = Array.isArray(d.novelties?.external_alerts) ? d.novelties.external_alerts.slice(0, 3) : [];
  const themes = Array.isArray(d.novelties?.press_themes) ? d.novelties.press_themes.slice(0, 5) : [];
  const sanctions = Array.isArray(d.novelties?.recent_sanctions) ? d.novelties.recent_sanctions.slice(0, 3) : [];
  const regions = Array.isArray(d.territory?.top_regions) ? d.territory.top_regions.slice(0, 5) : [];
  const communes = Array.isArray(d.territory?.top_communes) ? d.territory.top_communes.slice(0, 5) : [];
  const components = Array.isArray(d.territory?.cead_components) ? d.territory.cead_components.slice(0, 5) : [];
  const sectorCtx = d.chart_context?.sectors ?? {};

  return {
    generated_context: d.generated_context,
    structural: d.structural,
    strategic_questions: q.map((x: any) => ({
      id: x.id,
      answer: x.answer,
      pressure_index: x.pressure_index,
      staff_index: x.staff_index,
      gap_points: x.gap_points,
      external_alert_count: x.external_alert_count,
      strategic_press_count: x.strategic_press_count,
      recent_uaf_sanction_count: x.recent_uaf_sanction_count,
      ros_total_2025: x.ros_total_2025,
      silent_sector_count: x.silent_sector_count,
      caveat: text(x.caveat, 180),
    })),
    novelties: {
      press_summary: d.novelties?.press_summary,
      external_alerts: alerts.map((x: any) => ({ entity_name: x.entity_name, severity: x.severity, urgency_score: x.urgency_score, event_at: x.event_at, signal_label: text(x.signal_label, 120) })),
      press_themes: themes.map((x: any) => ({ theme: x.theme, article_count: x.article_count, source_count: x.source_count, latest_date: x.latest_date })),
      recent_sanctions: sanctions.map((x: any) => ({ event_date: x.event_date, canonical_name: x.canonical_name, regulator: x.regulator, uaf_sector: x.uaf_sector, region: x.region })),
    },
    territory: {
      year: d.territory?.year,
      top_regions: regions.map((x: any) => ({ region_name: x.region_name, strategic_rank: x.strategic_rank, avg_igr: x.avg_igr, avg_predicate_score: x.avg_predicate_score, avg_criminal_economy_score: x.avg_criminal_economy_score, avg_criminogenic_context_score: x.avg_criminogenic_context_score })),
      top_communes: communes.map((x: any) => ({ region_name: x.region_name, commune_name: x.commune_name, igr: x.igr, predicate_score: x.predicate_score, criminal_economy_score: x.criminal_economy_score, criminogenic_context_score: x.criminogenic_context_score })),
      cead_components: components.map((x: any) => ({ component_label: x.component_label, commune_count: x.commune_count, avg_score: x.avg_score, avg_trend: x.avg_trend, total_2025: x.total_2025 })),
      methodology: text(d.territory?.methodology, 260),
    },
    sectors: {
      largest_increases: Array.isArray(sectorCtx.largest_increases) ? sectorCtx.largest_increases.slice(0, 5) : [],
      largest_declines: Array.isArray(sectorCtx.largest_declines) ? sectorCtx.largest_declines.slice(0, 5) : [],
      highest_ros_2025: Array.isArray(sectorCtx.highest_ros_2025) ? sectorCtx.highest_ros_2025.slice(0, 5) : [],
    },
    constraints: Array.isArray(d.constraints) ? d.constraints.slice(0, 5).map((x: unknown) => text(x, 160)) : [],
  };
}

function providerReason(status: number, errorType?: string, errorCode?: string): string {
  const marker = `${errorType ?? ''} ${errorCode ?? ''}`.toLowerCase();
  if (marker.includes('token')) return 'Groq alcanzó un límite temporal de tokens. Atlas conserva la síntesis determinística.';
  if (status === 401) return 'Groq rechazó la credencial de API. Revisa que GROQ_API_KEY sea una clave válida y activa.';
  if (status === 429) return 'Groq alcanzó un límite temporal de uso. Atlas conserva la síntesis determinística.';
  if (status === 413) return 'El paquete enviado a Groq excedió el tamaño permitido. Atlas conserva la síntesis determinística.';
  if (status === 403) return 'Groq rechazó la solicitud por permisos de la clave API.';
  if (status === 400) return `Groq rechazó la solicitud por configuración${errorType ? ` (${errorType})` : ''}.`;
  return `Groq no devolvió una síntesis utilizable${errorType ? ` (${errorType})` : ''}.`;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const auth = req.headers.get('authorization') ?? '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (token.split('.').length !== 3) return json({ error: 'authenticated_user_required' }, 401);

  let body: NarrativeRequest;
  try { body = await req.json(); }
  catch { return json({ error: 'invalid_json' }, 400); }
  if (!body.validated_data || !body.profile?.id) return json({ error: 'validated_data_and_profile_required' }, 400);

  const apiKey = Deno.env.get('GROQ_API_KEY');
  const model = Deno.env.get('ATLAS_REPORT_GROQ_MODEL') || 'openai/gpt-oss-120b';
  if (!apiKey) return json({ ai_used: false, narrative: null, insights: null, reason: 'GROQ_API_KEY no está configurada; Atlas conserva la síntesis determinística.', diagnostic: { stage: 'secret', code: 'missing_groq_api_key' } });

  const compact = buildCompactPacket(body.validated_data as any);
  const instructions = [
    'Redacta análisis estratégico AML/ALA-CFT en español profesional.',
    'Interpreta sólo el paquete validado; no inventes ni recalcules cifras.',
    'Entrega narrative en 3 a 4 párrafos breves y cinco insights: novelties, territory, crime, sectors, capacity.',
    'Cada insight debe ser una bajada breve que explique patrón, determinante principal y cautela metodológica.',
    'Para sectores usa sectors.largest_increases, largest_declines y highest_ros_2025 para nombrar industrias que explican movimientos.',
    'No conviertas prensa, sanciones o proxies en prueba de delito o prevalencia criminal.',
    'Si una cifra no es indispensable, explica la tendencia sin repetirla. Si mencionas una cifra, debe existir literalmente o por redondeo en el paquete.',
    'No cites fuentes externas ni formules recomendaciones políticas, presupuestarias o de voto.',
  ].join(' ');

  const schema = {
    type: 'object',
    properties: {
      narrative: { type: 'string' },
      insights: {
        type: 'object',
        properties: {
          novelties: { type: 'string' }, territory: { type: 'string' }, crime: { type: 'string' }, sectors: { type: 'string' }, capacity: { type: 'string' },
        },
        required: ['novelties', 'territory', 'crime', 'sectors', 'capacity'],
        additionalProperties: false,
      },
    },
    required: ['narrative', 'insights'],
    additionalProperties: false,
  };

  try {
    const response = await fetch('https://api.groq.com/openai/v1/responses', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        reasoning: { effort: 'low' },
        instructions,
        input: JSON.stringify({ profile: body.profile, validated_data: compact }),
        max_output_tokens: 850,
        text: { format: { type: 'json_schema', name: 'atlas_report_analysis', strict: true, schema } },
      }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const errorType = typeof payload?.error?.type === 'string' ? payload.error.type : undefined;
      const errorCode = typeof payload?.error?.code === 'string' ? payload.error.code : undefined;
      console.error('Groq response error', response.status, errorType ?? 'unknown', errorCode ?? 'unknown');
      return json({ ai_used: false, narrative: null, insights: null, reason: providerReason(response.status, errorType, errorCode), diagnostic: { stage: 'provider', provider: 'groq', provider_status: response.status, provider_error_type: errorType ?? null, provider_error_code: errorCode ?? null } });
    }

    const raw = extractOutputText(payload);
    if (!raw) return json({ ai_used: false, narrative: null, insights: null, reason: 'La respuesta de Groq llegó sin texto; Atlas conserva la síntesis determinística.', diagnostic: { stage: 'response', provider: 'groq', code: 'empty_output' } });

    let parsed: { narrative?: unknown; insights?: Partial<AiInsights> };
    try { parsed = JSON.parse(raw); }
    catch { return json({ ai_used: false, narrative: null, insights: null, reason: 'Groq devolvió una estructura no utilizable; Atlas conserva la síntesis determinística.', diagnostic: { stage: 'response', provider: 'groq', code: 'invalid_structured_output' } }); }

    const originalNarrative = typeof parsed.narrative === 'string' ? parsed.narrative.trim() : '';
    const i = parsed.insights ?? {};
    if (!originalNarrative || !['novelties','territory','crime','sectors','capacity'].every((k) => typeof (i as any)[k] === 'string')) {
      return json({ ai_used: false, narrative: null, insights: null, reason: 'La respuesta estructurada de Groq quedó incompleta; Atlas conserva la síntesis determinística.', diagnostic: { stage: 'response', provider: 'groq', code: 'incomplete_structured_output' } });
    }

    const repairedNarrative = repairNumericText(originalNarrative, compact);
    const repairInsight = (value: unknown) => repairNumericText(String(value ?? '').trim(), compact);
    const rn = repairInsight(i.novelties); const rt = repairInsight(i.territory); const rc = repairInsight(i.crime); const rs = repairInsight(i.sectors); const rcap = repairInsight(i.capacity);
    const fallbackInsight = 'El paquete validado no permite agregar una lectura cuantitativa adicional sin introducir cifras ajenas; se mantiene la interpretación determinística del bloque.';
    const insights: AiInsights = {
      novelties: rn.text || fallbackInsight,
      territory: rt.text || fallbackInsight,
      crime: rc.text || fallbackInsight,
      sectors: rs.text || fallbackInsight,
      capacity: rcap.text || fallbackInsight,
    };
    const narrative = repairedNarrative.text || [insights.sectors, insights.capacity, insights.novelties].join(' ');
    const removed = [...repairedNarrative.removed, ...rn.removed, ...rt.removed, ...rc.removed, ...rs.removed, ...rcap.removed]
      .filter((item, index, all) => all.findIndex((x) => x.token === item.token) === index)
      .slice(0, 12);

    return json({
      ai_used: true,
      narrative,
      insights,
      model,
      provider: 'groq',
      generated_at: new Date().toISOString(),
      diagnostic: { stage: 'success', provider: 'groq', code: removed.length ? 'ai_generated_with_numeric_repair' : 'ai_narrative_and_insights_generated', removed_numeric_fragments: removed, compact_payload_chars: JSON.stringify(compact).length },
    });
  } catch (error) {
    console.error('Groq narrative generation failed', error instanceof Error ? error.message : 'unknown');
    return json({ ai_used: false, narrative: null, insights: null, reason: 'No fue posible generar la síntesis IA con Groq; Atlas conserva la síntesis determinística.', diagnostic: { stage: 'runtime', provider: 'groq', code: 'provider_call_failed' } });
  }
});
