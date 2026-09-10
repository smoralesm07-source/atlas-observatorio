import { createClient } from 'npm:@supabase/supabase-js@2.111.0';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};

type Role = 'viewer' | 'analyst' | 'admin';
type Action = 'list' | 'grant' | 'set_role' | 'set_enabled';

class AppError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function asRole(value: unknown): Role {
  if (value === 'viewer' || value === 'analyst' || value === 'admin') return value;
  throw new AppError('INVALID_ROLE', 'El rol solicitado no es válido.');
}

function readBearer(req: Request) {
  const header = req.headers.get('authorization') ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new AppError('AUTH_REQUIRED', 'Se requiere una sesión autenticada.', 401);
  return match[1];
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Método no permitido.' } }, 405);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceKey) throw new AppError('SERVER_CONFIG', 'Configuración de administración incompleta.', 500);

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    const token = readBearer(req);
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    const actor = authData.user;
    if (authError || !actor) throw new AppError('AUTH_INVALID', 'La sesión no pudo validarse.', 401);

    const { data: actorAccess, error: accessError } = await admin
      .from('aml_allowed_users')
      .select('role, enabled, email')
      .eq('user_id', actor.id)
      .maybeSingle();
    if (accessError) throw new AppError('ACCESS_LOOKUP_FAILED', accessError.message, 500);
    if (!actorAccess?.enabled || actorAccess.role !== 'admin') {
      throw new AppError('ADMIN_REQUIRED', 'Esta operación requiere rol administrador.', 403);
    }

    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch {
      throw new AppError('INVALID_JSON', 'La solicitud no contiene JSON válido.');
    }

    const action = body.action as Action;
    if (!['list', 'grant', 'set_role', 'set_enabled'].includes(action)) {
      throw new AppError('INVALID_ACTION', 'La acción solicitada no es válida.');
    }

    async function snapshot() {
      const authUsers = [] as Array<any>;
      for (let page = 1; page <= 20; page += 1) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
        if (error) throw new AppError('LIST_USERS_FAILED', error.message, 500);
        authUsers.push(...data.users);
        if (data.users.length < 200) break;
      }

      const { data: allowed, error: allowedError } = await admin
        .from('aml_allowed_users')
        .select('user_id, email, role, enabled, created_at, updated_at');
      if (allowedError) throw new AppError('LIST_ACCESS_FAILED', allowedError.message, 500);

      const { data: audit, error: auditError } = await admin
        .from('atlas_user_access_audit')
        .select('id, actor_user_id, actor_email, target_user_id, target_email, action, old_role, new_role, old_enabled, new_enabled, created_at')
        .order('created_at', { ascending: false })
        .limit(50);
      if (auditError) throw new AppError('LIST_AUDIT_FAILED', auditError.message, 500);

      const byId = new Map((allowed ?? []).map((row: any) => [row.user_id, row]));
      const users = authUsers.map((user: any) => ({
        id: user.id,
        email: user.email ?? byId.get(user.id)?.email ?? '',
        created_at: user.created_at ?? null,
        last_sign_in_at: user.last_sign_in_at ?? null,
        provider: user.app_metadata?.provider ?? null,
        authorization: byId.get(user.id) ?? null,
      }));

      users.sort((a: any, b: any) => {
        const rank = (u: any) => !u.authorization ? 0 : !u.authorization.enabled ? 1 : 2;
        return rank(a) - rank(b) || String(a.email).localeCompare(String(b.email));
      });

      return {
        ok: true,
        actor: { id: actor.id, email: actor.email ?? actorAccess.email, role: actorAccess.role },
        users,
        audit: audit ?? [],
      };
    }

    if (action === 'list') return json(await snapshot());

    const targetId = typeof body.target_user_id === 'string' ? body.target_user_id : '';
    if (!targetId) throw new AppError('TARGET_REQUIRED', 'Falta identificar al usuario objetivo.');

    const { data: targetData, error: targetError } = await admin.auth.admin.getUserById(targetId);
    const target = targetData.user;
    if (targetError || !target?.email) throw new AppError('TARGET_NOT_FOUND', 'El usuario no existe en Microsoft Entra/Supabase Auth.', 404);

    const { data: current, error: currentError } = await admin
      .from('aml_allowed_users')
      .select('role, enabled')
      .eq('user_id', target.id)
      .maybeSingle();
    if (currentError) throw new AppError('TARGET_ACCESS_FAILED', currentError.message, 500);

    let role: Role;
    let enabled: boolean;
    let auditAction: 'grant' | 'role_change' | 'enable' | 'disable';

    if (action === 'grant') {
      role = asRole(body.role ?? 'viewer');
      enabled = true;
      auditAction = 'grant';
    } else if (action === 'set_role') {
      if (!current) throw new AppError('NOT_AUTHORIZED_YET', 'Primero debes habilitar al usuario.');
      role = asRole(body.role);
      enabled = Boolean(current.enabled);
      auditAction = 'role_change';
    } else {
      if (!current) throw new AppError('NOT_AUTHORIZED_YET', 'Primero debes habilitar al usuario.');
      role = asRole(current.role);
      if (typeof body.enabled !== 'boolean') throw new AppError('INVALID_ENABLED', 'El estado solicitado no es válido.');
      enabled = body.enabled;
      auditAction = enabled ? 'enable' : 'disable';
    }

    const { error: mutationError } = await admin.rpc('atlas_admin_apply_access_change', {
      p_actor_user_id: actor.id,
      p_actor_email: actor.email ?? actorAccess.email ?? '',
      p_target_user_id: target.id,
      p_target_email: target.email,
      p_role: role,
      p_enabled: enabled,
      p_action: auditAction,
    });

    if (mutationError) {
      if (mutationError.message.includes('ATLAS_LAST_ADMIN_PROTECTED')) {
        throw new AppError('LAST_ADMIN_PROTECTED', 'No puedes deshabilitar ni degradar al último administrador activo.');
      }
      throw new AppError('ACCESS_CHANGE_FAILED', mutationError.message, 500);
    }

    return json(await snapshot());
  } catch (error) {
    const appError = error instanceof AppError
      ? error
      : new AppError('UNEXPECTED', error instanceof Error ? error.message : String(error), 500);
    return json({ ok: false, error: { code: appError.code, message: appError.message } }, appError.status);
  }
});
