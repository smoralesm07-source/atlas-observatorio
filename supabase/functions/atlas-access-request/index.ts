import { createClient } from 'npm:@supabase/supabase-js@2.111.0';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};

const PERSONAL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
  'yahoo.com', 'yahoo.es', 'icloud.com', 'me.com', 'mac.com', 'proton.me', 'protonmail.com',
  'aol.com', 'gmx.com', 'gmx.es', 'zoho.com', 'mail.com', 'yandex.com', 'hey.com',
]);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function bearer(req: Request) {
  const value = req.headers.get('authorization') ?? '';
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

function classifyEmail(email: string) {
  const domain = email.toLowerCase().trim().split('@').pop() ?? '';
  if (domain === 'uaf.gob.cl') return 'uaf';
  if (PERSONAL_DOMAINS.has(domain)) return 'personal';
  return 'external_org';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) return json({ ok: false, error: 'SERVER_CONFIG' }, 500);

  const token = bearer(req);
  if (!token) return json({ ok: false, error: 'AUTH_REQUIRED' }, 401);

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const { data: authData, error: authError } = await admin.auth.getUser(token);
  const user = authData.user;
  if (authError || !user?.id || !user.email) {
    return json({ ok: false, error: 'AUTH_INVALID', message: 'No fue posible validar la identidad autenticada.' }, 401);
  }

  const providers = Array.isArray(user.app_metadata?.providers) ? user.app_metadata.providers.map(String) : [];
  const primaryProvider = String(user.app_metadata?.provider ?? '');
  const hasAzure = primaryProvider === 'azure' || providers.includes('azure');
  const hasEmail = primaryProvider === 'email' || providers.includes('email');

  if (!hasAzure && !hasEmail) {
    return json({ ok: false, error: 'IDENTITY_PROVIDER_NOT_ALLOWED', message: 'ATLAS solo acepta identidad Microsoft o correo electrónico verificado.' }, 403);
  }

  const { data: access, error: accessError } = await admin
    .from('aml_allowed_users')
    .select('role, enabled')
    .eq('user_id', user.id)
    .maybeSingle();
  if (accessError) return json({ ok: false, error: 'ACCESS_LOOKUP_FAILED', message: accessError.message }, 500);

  if (access) {
    return json({ ok: true, state: access.enabled ? 'granted' : 'disabled', role: access.role ?? null });
  }

  let requestProvider = 'azure';
  let tenantId: string | null = null;

  if (hasAzure) {
    const azureIdentity = user.identities?.find((identity) => identity.provider === 'azure');
    const rawTenant = azureIdentity?.identity_data?.custom_claims?.tid;
    tenantId = typeof rawTenant === 'string' ? rawTenant : null;
  } else {
    requestProvider = 'email';
    if (!user.email_confirmed_at) {
      return json({ ok: false, error: 'EMAIL_NOT_VERIFIED', message: 'El correo todavía no ha sido verificado.' }, 403);
    }
  }

  const email = user.email.toLowerCase().trim();
  const identityClass = classifyEmail(email);
  const now = new Date().toISOString();

  const { data: existingRequest, error: existingRequestError } = await admin
    .from('atlas_access_requests')
    .select('user_id, email, provider, tenant_id, status, requested_at, last_seen_at, resolved_at')
    .eq('user_id', user.id)
    .maybeSingle();
  if (existingRequestError) {
    return json({ ok: false, error: 'REQUEST_LOOKUP_FAILED', message: existingRequestError.message }, 500);
  }

  if (existingRequest?.status === 'rejected') {
    const { error: touchError } = await admin
      .from('atlas_access_requests')
      .update({ last_seen_at: now })
      .eq('user_id', user.id);
    if (touchError) {
      return json({ ok: false, error: 'REQUEST_TOUCH_FAILED', message: touchError.message }, 500);
    }

    return json({
      ok: true,
      state: 'rejected',
      identity_class: identityClass,
      request: { ...existingRequest, last_seen_at: now },
    });
  }

  const { data: requestRow, error: requestError } = await admin
    .from('atlas_access_requests')
    .upsert({
      user_id: user.id,
      email,
      provider: requestProvider,
      tenant_id: tenantId,
      status: 'pending',
      last_seen_at: now,
      resolved_at: null,
      resolved_by: null,
      resolved_by_email: null,
    }, { onConflict: 'user_id' })
    .select('user_id, email, provider, tenant_id, status, requested_at, last_seen_at')
    .single();

  if (requestError) {
    return json({ ok: false, error: 'REQUEST_SAVE_FAILED', message: requestError.message }, 500);
  }

  return json({ ok: true, state: 'pending', identity_class: identityClass, request: requestRow });
});
