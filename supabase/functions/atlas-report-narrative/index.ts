import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

type NarrativeRequest = {
  profile?: { id?: string; audience?: string; purpose?: string; question?: string };
  validated_data?: unknown;
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

function collectNumbers(value: unknown, out: number[] = []): number[] {
  if (typeof value === 'number' && Number.isFinite(value)) out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => collectNumbers(v, out));
  else if (value && typeof value === 'object') Object.values(value as Record<string, unknown>).forEach((v) => collectNumbers(v, out));
  return out;
}

function parseNumericToken(token: string): number | null {
  let raw = token.trim().replace(/%$/, '');
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(raw)) raw = raw.replace(/\./g, '').replace(',', '.');
  else raw = raw.replace(',', '.');
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function hasOnlyAllowedNumbers(text: string, data: unknown): boolean {
  const allowed = [...collectNumbers(data), 0, 1, 100];
  const tokens = text.match(/\b\d+(?:[.,]\d+)*(?:%)?/g) ?? [];
  return tokens.every((token) => {
    const value = parseNumericToken(token);
    if (value == null) return false;
    return allowed.some((candidate) => Math.abs(candidate - value) < 0.0005);
  });
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
      reason: 'GROQ_API_KEY no está configurada en los secretos de la función; Atlas conserva la síntesis determinística.',
      diagnostic: { stage: 'secret', code: 'missing_groq_api_key' },
    });
  }

  const instructions = [
    'Eres la capa de redacción estratégica de ATLAS Observatorio para informes AML/ALA-CFT de alto nivel.',
    'Escribe en español profesional, sobrio y preciso, en 4 a 6 párrafos breves. No uses listas ni títulos.',
    'La redacción debe adaptarse a la audiencia indicada y responder directamente la pregunta, propósito o foco del perfil seleccionado.',
    'Usa EXCLUSIVAMENTE los hechos, cifras, señales, preguntas estratégicas y derivados presentes en validated_data.',
    'No calcules cifras nuevas, no redondees a valores diferentes, no completes datos faltantes y no introduzcas números ausentes.',
    'Ordena la síntesis por materialidad: primero la principal conclusión estructural; luego las novedades recientes; después territorio o sectores relevantes; y finalmente las limitaciones que condicionan la lectura.',
    'Distingue siempre entre tendencia estructural y coyuntura reciente. Una noticia o sanción debe presentarse como hecho público o señal de contexto, nunca como prueba de lavado, delito o culpabilidad.',
    'Cuando validated_data incluya territorio o crimen organizado, distingue evidencia directa de proxies. No describas rankings territoriales como prevalencia de lavado o crimen organizado.',
    'Cuando existan preguntas estratégicas, usa sus respuestas determinísticas como guía y explica por qué importan para la audiencia sin alterar su contenido.',
    'Distingue presión de entrada, capacidad institucional observable y productos de inteligencia. No trates la dotación total como dotación de la División de Inteligencia Financiera.',
    'No interpretes el número de IIF como productividad directa: un IIF puede consolidar múltiples ROS y antecedentes.',
    'No infieras prevalencia de criminalidad a partir del volumen de ROS.',
    'Para audiencias legislativas o presupuestarias, describe evidencia, tensiones observables y preguntas de capacidad sin recomendar votos, montos presupuestarios, aumentos o recortes específicos ni otras decisiones políticas.',
    'Para ciudadanía, privilegia lenguaje comprensible y explica los límites metodológicos sin perder precisión.',
    'No cites, busques ni agregues fuentes externas: las únicas fuentes válidas son las incorporadas en validated_data.',
    'Si el paquete no permite sostener una conclusión, dilo expresamente en vez de rellenar el vacío.',
  ].join(' ');

  const input = JSON.stringify({ profile: body.profile, validated_data: body.validated_data });

  try {
    const response = await fetch('https://api.groq.com/openai/v1/responses', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, reasoning: { effort: 'low' }, instructions, input, max_output_tokens: 1000 }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const errorType = typeof payload?.error?.type === 'string' ? payload.error.type : undefined;
      const errorCode = typeof payload?.error?.code === 'string' ? payload.error.code : undefined;
      console.error('Groq response error', response.status, errorType ?? 'unknown', errorCode ?? 'unknown');
      return json({
        ai_used: false,
        narrative: null,
        reason: providerReason(response.status, errorType ?? errorCode),
        diagnostic: {
          stage: 'provider',
          provider: 'groq',
          provider_status: response.status,
          provider_error_type: errorType ?? null,
          provider_error_code: errorCode ?? null,
        },
      });
    }

    const narrative = extractOutputText(payload);
    if (!narrative) {
      return json({
        ai_used: false,
        narrative: null,
        reason: 'La respuesta de Groq llegó sin texto; Atlas conserva la síntesis determinística.',
        diagnostic: { stage: 'response', provider: 'groq', code: 'empty_output' },
      });
    }

    if (!hasOnlyAllowedNumbers(narrative, body.validated_data)) {
      console.warn('Narrative rejected: introduced or transformed numeric value');
      return json({
        ai_used: false,
        narrative: null,
        reason: 'La síntesis IA fue descartada porque introdujo o transformó una cifra fuera del paquete validado; Atlas conserva la síntesis determinística.',
        diagnostic: { stage: 'guardrail', provider: 'groq', code: 'numeric_guardrail_rejection' },
      });
    }

    return json({
      ai_used: true,
      narrative,
      model,
      provider: 'groq',
      generated_at: new Date().toISOString(),
      diagnostic: { stage: 'success', provider: 'groq', code: 'ai_narrative_generated' },
    });
  } catch (error) {
    console.error('Groq narrative generation failed', error instanceof Error ? error.message : 'unknown');
    return json({
      ai_used: false,
      narrative: null,
      reason: 'No fue posible generar la síntesis IA con Groq; Atlas conserva la síntesis determinística.',
      diagnostic: { stage: 'runtime', provider: 'groq', code: 'provider_call_failed' },
    });
  }
});
