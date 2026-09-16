import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

type NarrativeRequest = {
  profile?: {
    id?: string;
    audience?: string;
    purpose?: string;
    question?: string;
  };
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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const auth = req.headers.get('authorization') ?? '';
  const token = auth.replace(/^Bearer\s+/i, '');
  // verify_jwt is enabled at the platform layer. Requiring a JWT-shaped bearer
  // here prevents a publishable key by itself from being treated as a user.
  if (token.split('.').length !== 3) return json({ error: 'authenticated_user_required' }, 401);

  let body: NarrativeRequest;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  if (!body.validated_data || !body.profile?.id) {
    return json({ error: 'validated_data_and_profile_required' }, 400);
  }

  const apiKey = Deno.env.get('OPENAI_API_KEY');
  const model = Deno.env.get('ATLAS_REPORT_MODEL') || 'gpt-5.6-luna';
  if (!apiKey) {
    return json({
      ai_used: false,
      narrative: null,
      reason: 'OPENAI_API_KEY no está configurada en los secretos de la función; Atlas conserva la síntesis determinística.',
    });
  }

  const instructions = [
    'Eres la capa de redacción interpretativa de ATLAS Observatorio.',
    'Escribe en español profesional y sobrio, en 2 a 4 párrafos breves.',
    'Usa EXCLUSIVAMENTE las cifras presentes en validated_data. No calcules cifras nuevas, no redondees cifras a valores distintos y no introduzcas números ausentes.',
    'No cambies, corrijas ni reemplaces los datos. Si una inferencia no está sustentada, exprésala como limitación y no como conclusión.',
    'Distingue presión de entrada, capacidad institucional observable y productos de inteligencia. No trates la dotación total como dotación de la División de Inteligencia Financiera.',
    'No interpretes el número de IIF como productividad directa: un IIF puede consolidar múltiples ROS.',
    'No infieras prevalencia de criminalidad a partir del volumen de ROS.',
    'Para audiencias legislativas o presupuestarias, describe evidencia y posibles implicancias de capacidad sin recomendar votos, montos presupuestarios ni decisiones políticas.',
    'No cites fuentes externas: las fuentes válidas son las incorporadas en validated_data.',
  ].join(' ');

  const input = JSON.stringify({ profile: body.profile, validated_data: body.validated_data });

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        reasoning: { effort: 'low' },
        instructions,
        input,
        max_output_tokens: 700,
      }),
    });

    const payload = await response.json();
    if (!response.ok) {
      console.error('OpenAI response error', response.status, payload?.error?.type ?? 'unknown');
      return json({ ai_used: false, narrative: null, reason: 'El proveedor de IA no devolvió una síntesis utilizable.' }, 502);
    }

    const narrative = extractOutputText(payload);
    if (!narrative) {
      return json({ ai_used: false, narrative: null, reason: 'La respuesta de IA llegó sin texto.' }, 502);
    }

    if (!hasOnlyAllowedNumbers(narrative, body.validated_data)) {
      console.warn('Narrative rejected: introduced or transformed numeric value');
      return json({
        ai_used: false,
        narrative: null,
        reason: 'La síntesis IA fue descartada porque introdujo o transformó una cifra fuera del paquete validado.',
      }, 422);
    }

    return json({
      ai_used: true,
      narrative,
      model,
      generated_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Narrative generation failed', error instanceof Error ? error.message : 'unknown');
    return json({ ai_used: false, narrative: null, reason: 'No fue posible generar la síntesis IA; Atlas conserva la síntesis determinística.' }, 502);
  }
});
