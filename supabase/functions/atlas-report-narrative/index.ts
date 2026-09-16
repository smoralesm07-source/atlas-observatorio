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

type NumericCheck = {
  ok: boolean;
  invalid: Array<{ token: string; value: number | null }>;
};

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

function numericTokens(text: string): number[] {
  return rawNumericTokens(text).map(parseNumericToken).filter((x): x is number => x != null);
}

function collectAllowedNumbers(value: unknown, out: number[] = []): number[] {
  if (typeof value === 'number' && Number.isFinite(value)) {
    out.push(value);
  } else if (typeof value === 'string') {
    out.push(...numericTokens(value));
  } else if (Array.isArray(value)) {
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

function parseNumericToken(token: string): number | null {
  let raw = token.trim().replace(/%$/, '').replace('−', '-');
  const sign = raw.startsWith('-') ? -1 : 1;
  if (sign < 0) raw = raw.slice(1);
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(raw)) raw = raw.replace(/\./g, '').replace(',', '.');
  else raw = raw.replace(',', '.');
  const value = Number(raw);
  return Number.isFinite(value) ? sign * value : null;
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

function checkAllowedNumbers(text: string, data: unknown): NumericCheck {
  const allowed = [...collectAllowedNumbers(data), 0, 1, 100];
  const invalid = rawNumericTokens(text)
    .filter((token) => !isAllowedNumber(token, allowed))
    .map((token) => ({ token, value: parseNumericToken(token) }));
  const unique = invalid.filter((item, index, all) => all.findIndex((x) => x.token === item.token) === index);
  return { ok: unique.length === 0, invalid: unique.slice(0, 8) };
}

function providerReason(status: number, errorType?: string): string {
  if (status === 401) return 'Groq rechazó la credencial de API. Revisa que GROQ_API_KEY sea una clave válida y activa.';
  if (status === 429) return 'Groq rechazó temporalmente la solicitud por cuota o límite de uso. Atlas conserva la síntesis determinística.';
  if (status === 403) return 'Groq rechazó la solicitud por permisos de la clave API.';
  if (status === 400) return `Groq rechazó la solicitud por configuración de la petición${errorType ? ` (${errorType})` : ''}.`;
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

  if (!body.validated_data || !body.profile?.id) {
    return json({ error: 'validated_data_and_profile_required' }, 400);
  }

  const apiKey = Deno.env.get('GROQ_API_KEY');
  const model = Deno.env.get('ATLAS_REPORT_GROQ_MODEL') || 'openai/gpt-oss-120b';
  if (!apiKey) {
    return json({
      ai_used: false,
      narrative: null,
      insights: null,
      reason: 'GROQ_API_KEY no está configurada en los secretos de la función; Atlas conserva la síntesis determinística.',
      diagnostic: { stage: 'secret', code: 'missing_groq_api_key' },
    });
  }

  const instructions = [
    'Eres la capa de redacción estratégica de ATLAS Observatorio para informes AML/ALA-CFT de alto nivel.',
    'Tu tarea es interpretar un paquete YA VALIDADO; no debes inventar datos ni recalcular indicadores.',
    'Escribe la síntesis general en español profesional, sobrio y preciso, en 4 a 6 párrafos breves.',
    'Además genera cinco lecturas breves para acompañar visualizaciones: novedades, territorio, crimen/proxies, sectores y capacidad.',
    'Cada lectura debe agregar valor explicando qué patrón domina, qué elemento explica el movimiento observado, qué concentración o quiebre es visible y qué cautela metodológica corresponde.',
    'En sectores, usa chart_context si está disponible para identificar expresamente qué industrias explican los mayores aumentos o caídas de ROS; no calcules diferencias por tu cuenta.',
    'En capacidad, conecta tendencia de padrón, ROS, dotación, IIF y requerimientos sólo con los indicadores ya entregados.',
    'En territorio y crimen, distingue evidencia directa de proxies. No describas rankings territoriales como prevalencia de lavado o crimen organizado.',
    'Una noticia o sanción debe presentarse como hecho público o señal de contexto, nunca como prueba de lavado, delito o culpabilidad.',
    'Usa EXCLUSIVAMENTE hechos, cifras, señales y derivados presentes en validated_data. Puedes redondear sólo para presentación, sin cambiar el sentido del dato.',
    'Cuando menciones una cifra, conserva su signo. No conviertas disminuciones negativas en magnitudes positivas.',
    'No completes datos faltantes, no cites fuentes externas y no agregues recomendaciones políticas, presupuestarias o de voto.',
    'Si el paquete no permite explicar un movimiento, dilo expresamente.',
  ].join(' ');

  const input = JSON.stringify({ profile: body.profile, validated_data: body.validated_data });
  const schema = {
    type: 'object',
    properties: {
      narrative: { type: 'string' },
      insights: {
        type: 'object',
        properties: {
          novelties: { type: 'string' },
          territory: { type: 'string' },
          crime: { type: 'string' },
          sectors: { type: 'string' },
          capacity: { type: 'string' },
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
        input,
        max_output_tokens: 1400,
        text: { format: { type: 'json_schema', name: 'atlas_report_analysis', strict: true, schema } },
      }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const errorType = typeof payload?.error?.type === 'string' ? payload.error.type : undefined;
      const errorCode = typeof payload?.error?.code === 'string' ? payload.error.code : undefined;
      console.error('Groq response error', response.status, errorType ?? 'unknown', errorCode ?? 'unknown');
      return json({
        ai_used: false,
        narrative: null,
        insights: null,
        reason: providerReason(response.status, errorType ?? errorCode),
        diagnostic: { stage: 'provider', provider: 'groq', provider_status: response.status, provider_error_type: errorType ?? null, provider_error_code: errorCode ?? null },
      });
    }

    const raw = extractOutputText(payload);
    if (!raw) {
      return json({ ai_used: false, narrative: null, insights: null, reason: 'La respuesta de Groq llegó sin texto; Atlas conserva la síntesis determinística.', diagnostic: { stage: 'response', provider: 'groq', code: 'empty_output' } });
    }

    let parsed: { narrative?: unknown; insights?: Partial<AiInsights> };
    try { parsed = JSON.parse(raw); }
    catch {
      return json({ ai_used: false, narrative: null, insights: null, reason: 'Groq devolvió una estructura no utilizable; Atlas conserva la síntesis determinística.', diagnostic: { stage: 'response', provider: 'groq', code: 'invalid_structured_output' } });
    }

    const narrative = typeof parsed.narrative === 'string' ? parsed.narrative.trim() : '';
    const i = parsed.insights ?? {};
    const insights: AiInsights | null = ['novelties','territory','crime','sectors','capacity'].every((k) => typeof (i as any)[k] === 'string')
      ? { novelties: String(i.novelties).trim(), territory: String(i.territory).trim(), crime: String(i.crime).trim(), sectors: String(i.sectors).trim(), capacity: String(i.capacity).trim() }
      : null;

    if (!narrative || !insights) {
      return json({ ai_used: false, narrative: null, insights: null, reason: 'La respuesta estructurada de Groq quedó incompleta; Atlas conserva la síntesis determinística.', diagnostic: { stage: 'response', provider: 'groq', code: 'incomplete_structured_output' } });
    }

    const combined = [narrative, insights.novelties, insights.territory, insights.crime, insights.sectors, insights.capacity].join('\n');
    const numericCheck = checkAllowedNumbers(combined, body.validated_data);
    if (!numericCheck.ok) {
      console.warn('Narrative rejected: introduced numeric value outside validated package', numericCheck.invalid);
      const first = numericCheck.invalid[0]?.token;
      return json({
        ai_used: false,
        narrative: null,
        insights: null,
        reason: `La síntesis IA fue descartada porque introdujo una cifra fuera del paquete validado${first ? ` (${first})` : ''}; Atlas conserva la síntesis determinística.`,
        diagnostic: { stage: 'guardrail', provider: 'groq', code: 'numeric_guardrail_rejection', invalid_numbers: numericCheck.invalid },
      });
    }

    return json({
      ai_used: true,
      narrative,
      insights,
      model,
      provider: 'groq',
      generated_at: new Date().toISOString(),
      diagnostic: { stage: 'success', provider: 'groq', code: 'ai_narrative_and_insights_generated' },
    });
  } catch (error) {
    console.error('Groq narrative generation failed', error instanceof Error ? error.message : 'unknown');
    return json({ ai_used: false, narrative: null, insights: null, reason: 'No fue posible generar la síntesis IA con Groq; Atlas conserva la síntesis determinística.', diagnostic: { stage: 'runtime', provider: 'groq', code: 'provider_call_failed' } });
  }
});
