import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

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

function jwtSub(token: string): string | null {
  try {
    const middle = token.split('.')[1];
    if (!middle) return null;
    const normalized = middle.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const payload = JSON.parse(atob(padded));
    return typeof payload?.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}

async function restJson(url: string, auth: string, anonKey: string) {
  const response = await fetch(url, { headers: { Authorization: auth, apikey: anonKey, Accept: 'application/json' } });
  if (!response.ok) return null;
  return response.json().catch(() => null);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const auth = req.headers.get('authorization') ?? '';
  const token = auth.replace(/^Bearer\s+/i, '');
  const userId = jwtSub(token);
  if (!userId) return json({ error: 'authenticated_user_required' }, 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  if (!supabaseUrl || !anonKey) return json({ error: 'authorization_backend_unavailable' }, 500);

  const accessUrl = `${supabaseUrl}/rest/v1/aml_allowed_users?select=role,enabled&user_id=eq.${encodeURIComponent(userId)}&limit=1`;
  const accessRows = await restJson(accessUrl, auth, anonKey);
  const access = Array.isArray(accessRows) ? accessRows[0] : null;
  const role = String(access?.role ?? '').toLowerCase();
  if (!access?.enabled || (role !== 'admin' && role !== 'analyst')) {
    return json({ error: 'report_ai_requires_analyst_or_admin' }, 403);
  }

  let requestBody: any;
  try { requestBody = await req.json(); }
  catch { return json({ error: 'invalid_json' }, 400); }

  const [potentialTotalRows, potentialSectorRows] = await Promise.all([
    restJson(`${supabaseUrl}/rest/v1/obs_uaf_potential_total?select=observadas,accionables,revisados,sin_revisar,sectores,sii_periodo,uaf_corte,refreshed_at&limit=1`, auth, anonKey),
    restJson(`${supabaseUrl}/rest/v1/obs_uaf_potential_sector?select=sector,observadas,accionables&accionables=gt.0&order=accionables.desc.nullslast,observadas.desc.nullslast&limit=8`, auth, anonKey),
  ]);

  const potentialTotal = Array.isArray(potentialTotalRows) ? potentialTotalRows[0] : null;
  const potentialSectors = Array.isArray(potentialSectorRows) ? potentialSectorRows : [];
  if (potentialTotal && requestBody?.validated_data && typeof requestBody.validated_data === 'object') {
    const potentialSo = {
      total: potentialTotal,
      top_sectors: potentialSectors,
      interpretation: 'Screening económico: observadas es el universo examinado y accionables son hipótesis de inscripción que requieren validación. No acredita obligación jurídica, falta de inscripción ni incumplimiento. Si una hipótesis se confirma, puede ampliar tareas de validación, incorporación registral, orientación, supervisión y futura reportabilidad; estas cifras no estiman una brecha de dotación.',
    };
    requestBody.validated_data = {
      ...requestBody.validated_data,
      potential_so: potentialSo,
      structural: {
        ...(requestBody.validated_data.structural ?? {}),
        potential_so: potentialSo,
      },
    };
    if (requestBody.profile && typeof requestBody.profile === 'object') {
      requestBody.profile = {
        ...requestBody.profile,
        purpose: `${String(requestBody.profile.purpose ?? '')} Considera también el perímetro de potenciales sujetos obligados, distinguiendo universo observado de hipótesis accionables y sus principales sectores.`,
      };
    }
  }

  const upstream = await fetch(`${supabaseUrl}/functions/v1/atlas-report-narrative`, {
    method: 'POST',
    headers: {
      Authorization: auth,
      apikey: anonKey,
      'Content-Type': 'application/json',
      'x-client-info': req.headers.get('x-client-info') ?? 'atlas-report-role-guard',
    },
    body: JSON.stringify(requestBody),
  });

  const responseBody = await upstream.text();
  return new Response(responseBody, {
    status: upstream.status,
    headers: { ...cors, 'Content-Type': upstream.headers.get('content-type') ?? 'application/json; charset=utf-8' },
  });
});
