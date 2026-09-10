import { useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, configError, redirectTo } from '../lib/supabase';
import { Mark } from './Mark';

export type AtlasRole = 'viewer' | 'analyst' | 'admin';

type Access =
  | { state: 'checking' }
  | { state: 'granted'; role: AtlasRole }
  | { state: 'pending' }
  | { state: 'disabled' }
  | { state: 'error'; message: string; transport: boolean };

type RequestState =
  | { state: 'saving' }
  | { state: 'saved' }
  | { state: 'error'; message: string };

const RETRY_DELAYS_MS = [0, 450, 1200] as const;
const EMAIL_FALLBACK_DOMAIN = 'uaf.gob.cl';

function isTransportError(message: string) {
  return /failed to fetch|networkerror|network request failed|load failed|fetch failed/i.test(message);
}

function delay(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

function asAtlasRole(value: unknown): AtlasRole {
  return value === 'admin' || value === 'analyst' || value === 'viewer' ? value : 'viewer';
}

function normalizedEmail(value: string) {
  return value.trim().toLowerCase();
}

function validInstitutionalEmail(value: string) {
  const email = normalizedEmail(value);
  const [local, domain, extra] = email.split('@');
  return Boolean(local && domain === EMAIL_FALLBACK_DOMAIN && !extra);
}

function identityLabel(session: Session) {
  const providers = Array.isArray(session.user.app_metadata?.providers)
    ? session.user.app_metadata.providers.map(String)
    : [];
  const primary = String(session.user.app_metadata?.provider ?? '');
  return primary === 'azure' || providers.includes('azure')
    ? 'Microsoft Entra'
    : 'Correo institucional verificado';
}

async function signInWithMicrosoft() {
  return (
    await supabase.auth.signInWithOAuth({
      provider: 'azure',
      options: {
        scopes: 'email',
        redirectTo,
        queryParams: { prompt: 'select_account' },
      },
    })
  ).error;
}

export function AuthGate({ children }: { children: (session: Session, role: AtlasRole) => ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [access, setAccess] = useState<Access>({ state: 'checking' });
  const [validationKey, setValidationKey] = useState(0);

  useEffect(() => {
    let live = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!live) return;
      setSession(data.session);
      setReady(true);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!live) return;
      setSession(nextSession);
      setReady(true);
    });

    return () => {
      live = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const retryWhenOnline = () => setValidationKey((value) => value + 1);
    window.addEventListener('online', retryWhenOnline);
    return () => window.removeEventListener('online', retryWhenOnline);
  }, []);

  useEffect(() => {
    if (!session) {
      setAccess({ state: 'checking' });
      return;
    }

    const userId = session.user.id;
    let live = true;

    async function validateAccess() {
      setAccess({ state: 'checking' });
      let lastMessage = 'No fue posible consultar la lista de habilitación.';
      let transport = false;

      for (const waitMs of RETRY_DELAYS_MS) {
        if (waitMs) await delay(waitMs);
        if (!live) return;

        try {
          const { data, error } = await supabase
            .from('aml_allowed_users')
            .select('role, enabled')
            .eq('user_id', userId)
            .maybeSingle();

          if (!live) return;

          if (!error) {
            if (!data) {
              setAccess({ state: 'pending' });
            } else if (data.enabled) {
              setAccess({ state: 'granted', role: asAtlasRole(data.role) });
            } else {
              setAccess({ state: 'disabled' });
            }
            return;
          }

          lastMessage = error.message;
          transport = isTransportError(lastMessage);
          if (!transport) {
            setAccess({ state: 'error', message: lastMessage, transport: false });
            return;
          }
        } catch (error) {
          lastMessage = error instanceof Error ? error.message : String(error);
          transport = isTransportError(lastMessage);
          if (!transport) {
            setAccess({ state: 'error', message: lastMessage, transport: false });
            return;
          }
        }
      }

      if (live) setAccess({ state: 'error', message: lastMessage, transport });
    }

    void validateAccess();

    return () => {
      live = false;
    };
  }, [session, validationKey]);

  if (configError) {
    return (
      <Card title="Configuración incompleta">
        <div className="note note-warn">{configError}</div>
      </Card>
    );
  }

  if (!ready) {
    return (
      <div className="auth-wrap">
        <Mark size={40} animated />
      </div>
    );
  }

  if (!session) return <SignIn />;

  if (access.state === 'checking') {
    return (
      <div className="auth-wrap">
        <Mark size={40} animated />
      </div>
    );
  }

  if (access.state === 'error') {
    return (
      <Card title="No fue posible validar el acceso">
        <p style={{ color: 'var(--ink-2)', fontSize: 13, lineHeight: 1.6 }}>
          {access.transport
            ? 'La sesión está autenticada, pero la comunicación con la capa de datos falló después de varios intentos. Esto no significa que tu cuenta esté deshabilitada.'
            : 'La sesión está autenticada, pero la capa de autorización respondió con un error.'}
        </p>
        <div className="note note-warn">{access.message}</div>
        <button
          className="btn btn-primary"
          style={{ width: '100%', marginTop: 18 }}
          onClick={() => setValidationKey((value) => value + 1)}
        >
          Reintentar validación
        </button>
        <SignOutButton marginTop={10} />
      </Card>
    );
  }

  if (access.state === 'pending') {
    return <PendingAccess session={session} onRecheck={() => setValidationKey((value) => value + 1)} />;
  }

  if (access.state === 'disabled') {
    return (
      <Card title="Acceso deshabilitado">
        <p style={{ color: 'var(--ink-2)', fontSize: 13, lineHeight: 1.6 }}>
          Tu identidad sigue siendo válida, pero el acceso a ATLAS Observatorio fue deshabilitado por la administración.
        </p>
        <div className="note note-warn">
          Cuenta: {session.user.email ?? 'Correo no informado'}
        </div>
        <button
          className="btn"
          style={{ width: '100%', marginTop: 18 }}
          onClick={() => setValidationKey((value) => value + 1)}
        >
          Comprobar nuevamente
        </button>
        <SignOutButton marginTop={10} />
      </Card>
    );
  }

  return <>{children(session, access.role)}</>;
}

function PendingAccess({ session, onRecheck }: { session: Session; onRecheck: () => void }) {
  const [request, setRequest] = useState<RequestState>({ state: 'saving' });
  const [retryKey, setRetryKey] = useState(0);
  const identity = identityLabel(session);

  useEffect(() => {
    let live = true;

    async function register() {
      setRequest({ state: 'saving' });
      const { data, error } = await supabase.functions.invoke<{
        ok?: boolean;
        state?: 'pending' | 'granted' | 'disabled';
        message?: string;
        error?: string;
      }>('atlas-access-request', { body: {} });

      if (!live) return;

      if (error) {
        let message = error.message || 'No fue posible registrar la solicitud.';
        const context = (error as { context?: unknown }).context;
        if (context instanceof Response) {
          try {
            const payload = await context.clone().json() as { message?: string };
            message = payload.message ?? message;
          } catch {
            // Conserva el mensaje de transporte.
          }
        }
        setRequest({ state: 'error', message });
        return;
      }

      if (data?.state === 'granted' || data?.state === 'disabled') {
        onRecheck();
        return;
      }

      if (data?.ok && data.state === 'pending') {
        setRequest({ state: 'saved' });
        return;
      }

      setRequest({ state: 'error', message: data?.message ?? 'La solicitud no pudo confirmarse en el servidor.' });
    }

    void register();
    return () => {
      live = false;
    };
  }, [session.user.id, retryKey]);

  const saved = request.state === 'saved';

  return (
    <Card title={saved ? 'Solicitud de acceso registrada' : request.state === 'saving' ? 'Registrando solicitud…' : 'No fue posible registrar la solicitud'}>
      <p style={{ color: 'var(--ink-2)', fontSize: 13, lineHeight: 1.6 }}>
        Tu identidad fue verificada mediante {identity}. ATLAS mantiene los datos cerrados hasta que un administrador autorice esta cuenta.
      </p>
      <div className="note">
        <strong style={{ display: 'block', marginBottom: 5, color: 'var(--ink-1)' }}>{identity}</strong>
        {session.user.email ?? 'Correo no informado'}
      </div>

      {request.state === 'saving' && (
        <p style={{ color: 'var(--ink-3)', fontSize: 12, lineHeight: 1.55, marginBottom: 0 }}>
          Confirmando la solicitud en la cola administrativa…
        </p>
      )}

      {request.state === 'saved' && (
        <p style={{ color: 'var(--ink-3)', fontSize: 12, lineHeight: 1.55, marginBottom: 0 }}>
          La solicitud ya puede ser revisada desde Administración. Cuando sea aprobada, podrás comprobar la autorización sin volver a iniciar sesión.
        </p>
      )}

      {request.state === 'error' && (
        <>
          <div className="note note-warn" style={{ marginTop: 12 }}>{request.message}</div>
          <button
            className="btn btn-primary"
            style={{ width: '100%', marginTop: 18 }}
            onClick={() => setRetryKey((value) => value + 1)}
          >
            Reintentar solicitud
          </button>
        </>
      )}

      {request.state === 'saved' && (
        <button className="btn btn-primary" style={{ width: '100%', marginTop: 18 }} onClick={onRecheck}>
          Comprobar autorización
        </button>
      )}
      <SignOutButton marginTop={10} />
    </Card>
  );
}

function SignIn() {
  const [microsoftBusy, setMicrosoftBusy] = useState(false);
  const [emailBusy, setEmailBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [emailSent, setEmailSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signInMicrosoft() {
    setMicrosoftBusy(true);
    setError(null);
    const err = await signInWithMicrosoft();
    if (err) {
      setError(err.message);
      setMicrosoftBusy(false);
    }
  }

  async function signInEmail() {
    const value = normalizedEmail(email);
    if (!validInstitutionalEmail(value)) {
      setError(`Por ahora el acceso alternativo está habilitado únicamente para correos @${EMAIL_FALLBACK_DOMAIN}.`);
      return;
    }

    setEmailBusy(true);
    setError(null);
    setEmailSent(false);

    const { error: otpError } = await supabase.auth.signInWithOtp({
      email: value,
      options: {
        shouldCreateUser: true,
        emailRedirectTo: redirectTo,
      },
    });

    if (otpError) {
      setError(otpError.message);
      setEmailBusy(false);
      return;
    }

    setEmailSent(true);
    setEmailBusy(false);
  }

  return (
    <Card title="ATLAS Observatorio" eyebrow="Monitor de fuentes abiertas">
      <p style={{ color: 'var(--ink-2)', fontSize: 13, lineHeight: 1.6, marginTop: 0 }}>
        Autentica tu identidad. El ingreso a los datos solo se habilita después de la autorización de un administrador de ATLAS.
      </p>

      {error && <div className="note note-warn">{error}</div>}

      <button className="btn btn-primary" style={{ width: '100%' }} onClick={signInMicrosoft} disabled={microsoftBusy || emailBusy}>
        <MicrosoftLogo />
        {microsoftBusy ? 'Redirigiendo…' : 'Ingresar con Microsoft'}
      </button>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '16px 0', color: 'var(--ink-3)', fontSize: 11 }}>
        <span style={{ height: 1, background: 'var(--line)', flex: 1 }} />
        <span>o</span>
        <span style={{ height: 1, background: 'var(--line)', flex: 1 }} />
      </div>

      <div style={{ display: 'grid', gap: 9 }}>
        <label style={{ fontSize: 11, color: 'var(--ink-3)', fontWeight: 600 }}>Correo institucional UAF</label>
        <input
          type="email"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
            setEmailSent(false);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !emailBusy) void signInEmail();
          }}
          placeholder={`nombre@${EMAIL_FALLBACK_DOMAIN}`}
          autoComplete="email"
          style={{
            width: '100%',
            boxSizing: 'border-box',
            border: '1px solid var(--line)',
            borderRadius: 9,
            background: 'var(--surface-2)',
            color: 'var(--ink-1)',
            padding: '10px 12px',
            outline: 'none',
            font: 'inherit',
            fontSize: 13,
          }}
        />
        <button className="btn" style={{ width: '100%' }} onClick={() => void signInEmail()} disabled={emailBusy || microsoftBusy}>
          {emailBusy ? 'Enviando…' : 'Enviar enlace seguro al correo'}
        </button>
      </div>

      {emailSent && (
        <div className="note" style={{ marginTop: 12 }}>
          Revisa <strong>{normalizedEmail(email)}</strong> y abre el enlace de verificación. Al volver a ATLAS, la solicitud quedará registrada automáticamente para revisión.
        </div>
      )}

      <div className="note" style={{ marginTop: 12 }}>
        Si Microsoft exige aprobación del administrador de tu organización, usa el correo institucional. Ninguno de los dos métodos otorga acceso automático a los datos.
      </div>
    </Card>
  );
}

function SignOutButton({ marginTop = 18 }: { marginTop?: number }) {
  return (
    <button
      className="btn"
      style={{ width: '100%', marginTop }}
      onClick={() => supabase.auth.signOut({ scope: 'local' })}
    >
      Cerrar sesión
    </button>
  );
}

function Card({ title, eyebrow, children }: { title: string; eyebrow?: string; children: ReactNode }) {
  return (
    <div className="auth-wrap">
      <div className="auth-card fade-in">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <Mark size={36} animated />
          <div>
            <div style={{ fontWeight: 700, fontSize: 17, letterSpacing: '-0.02em' }}>{title}</div>
            {eyebrow && (
              <div style={{ fontSize: 10.5, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-3)', fontWeight: 600 }}>
                {eyebrow}
              </div>
            )}
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

function MicrosoftLogo() {
  return (
    <svg width="15" height="15" viewBox="0 0 23 23" aria-hidden style={{ flexShrink: 0 }}>
      <path fill="#f25022" d="M1 1h10v10H1z" />
      <path fill="#7fba00" d="M12 1h10v10H12z" />
      <path fill="#00a4ef" d="M1 12h10v10H1z" />
      <path fill="#ffb900" d="M12 12h10v10H12z" />
    </svg>
  );
}
