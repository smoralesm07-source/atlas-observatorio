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
const OTP_RESEND_COOLDOWN_SECONDS = 60;

function isTransportError(message: string) {
  return /failed to fetch|networkerror|network request failed|load failed|fetch failed/i.test(message);
}

function isRateLimitError(error: { code?: string; message?: string } | null | undefined) {
  const code = String(error?.code ?? '').toLowerCase();
  const message = String(error?.message ?? '').toLowerCase();
  return code === 'over_email_send_rate_limit'
    || code === 'over_request_rate_limit'
    || /rate limit|too many requests/.test(message);
}

function emailAuthErrorMessage(error: { code?: string; message?: string } | null | undefined) {
  if (isRateLimitError(error)) {
    return 'Se alcanzó temporalmente el límite de envío de códigos. Espera antes de solicitar otro. Si el aviso continúa después de unos minutos, la cuota horaria de correo del proyecto todavía no se ha liberado.';
  }
  return error?.message || 'No fue posible completar la autenticación por correo.';
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
  const sessionUserId = session?.user.id ?? null;

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
    if (!sessionUserId) {
      setAccess({ state: 'checking' });
      return;
    }

    const userId = sessionUserId;
    let live = true;

    async function validateAccess() {
      // Una renovación ordinaria del token no cambia la identidad del usuario y
      // no debe desmontar toda la aplicación. En revalidaciones explícitas se
      // mantiene la vista montada si el acceso ya estaba concedido.
      setAccess((current) => current.state === 'granted' ? current : { state: 'checking' });
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
  }, [sessionUserId, validationKey]);

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
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = window.setTimeout(() => {
      setResendCooldown((seconds) => Math.max(0, seconds - 1));
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [resendCooldown]);

  async function signInMicrosoft() {
    setMicrosoftBusy(true);
    setError(null);
    const err = await signInWithMicrosoft();
    if (err) {
      setError(err.message);
      setMicrosoftBusy(false);
    }
  }

  async function sendCode() {
    const value = normalizedEmail(email);
    if (!validInstitutionalEmail(value)) {
      setError(`Por ahora el acceso alternativo está habilitado únicamente para correos @${EMAIL_FALLBACK_DOMAIN}.`);
      return;
    }
    if (resendCooldown > 0) return;

    setEmailBusy(true);
    setError(null);

    const { error: otpError } = await supabase.auth.signInWithOtp({
      email: value,
      options: {
        shouldCreateUser: true,
      },
    });

    if (otpError) {
      if (isRateLimitError(otpError)) {
        setResendCooldown(OTP_RESEND_COOLDOWN_SECONDS);
      }
      setError(emailAuthErrorMessage(otpError));
      setEmailBusy(false);
      return;
    }

    setCode('');
    setCodeSent(true);
    setResendCooldown(OTP_RESEND_COOLDOWN_SECONDS);
    setEmailBusy(false);
  }

  async function verifyCode() {
    const value = normalizedEmail(email);
    const token = code.replace(/\D/g, '').slice(0, 6);

    if (!validInstitutionalEmail(value)) {
      setError('El correo institucional no es válido.');
      return;
    }
    if (token.length !== 6) {
      setError('Ingresa el código de 6 dígitos enviado a tu correo.');
      return;
    }

    setVerifyBusy(true);
    setError(null);

    const { error: verifyError } = await supabase.auth.verifyOtp({
      email: value,
      token,
      type: 'email',
    });

    if (verifyError) {
      setError(emailAuthErrorMessage(verifyError));
      setVerifyBusy(false);
      return;
    }

    setVerifyBusy(false);
  }

  const locked = microsoftBusy || emailBusy || verifyBusy;

  return (
    <Card title="ATLAS Observatorio" eyebrow="Monitor de fuentes abiertas">
      <p style={{ color: 'var(--ink-2)', fontSize: 13, lineHeight: 1.6, marginTop: 0 }}>
        Autentica tu identidad. Si tu cuenta ya fue autorizada, entrarás directamente; si es nueva, ATLAS registrará una solicitud para revisión.
      </p>

      {error && <div className="note note-warn" role="alert">{error}</div>}

      <button className="btn btn-primary" style={{ width: '100%' }} onClick={signInMicrosoft} disabled={locked}>
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
          disabled={codeSent || locked}
          onChange={(event) => {
            setEmail(event.target.value);
            setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !locked && !codeSent && resendCooldown === 0) void sendCode();
          }}
          placeholder={`nombre@${EMAIL_FALLBACK_DOMAIN}`}
          autoComplete="email"
          style={inputStyle}
        />

        {!codeSent ? (
          <button className="btn" style={{ width: '100%' }} onClick={() => void sendCode()} disabled={locked || resendCooldown > 0}>
            {emailBusy
              ? 'Enviando…'
              : resendCooldown > 0
                ? `Intentar nuevamente en ${resendCooldown}s`
                : 'Enviar código de 6 dígitos'}
          </button>
        ) : (
          <>
            <label style={{ fontSize: 11, color: 'var(--ink-3)', fontWeight: 600, marginTop: 4 }}>
              Código de verificación
            </label>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              autoFocus
              autoComplete="one-time-code"
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !locked) void verifyCode();
              }}
              placeholder="000000"
              aria-label="Código de verificación de 6 dígitos"
              style={{ ...inputStyle, letterSpacing: '0.28em', textAlign: 'center', fontWeight: 700, fontSize: 18 }}
            />
            <button
              className="btn btn-primary"
              style={{ width: '100%' }}
              onClick={() => void verifyCode()}
              disabled={locked || code.length !== 6}
            >
              {verifyBusy ? 'Verificando…' : 'Verificar e ingresar'}
            </button>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className="btn"
                style={{ flex: 1 }}
                onClick={() => {
                  setCodeSent(false);
                  setCode('');
                  setError(null);
                }}
                disabled={locked}
              >
                Cambiar correo
              </button>
              <button className="btn" style={{ flex: 1 }} onClick={() => void sendCode()} disabled={locked || resendCooldown > 0}>
                {emailBusy
                  ? 'Reenviando…'
                  : resendCooldown > 0
                    ? `Reenviar en ${resendCooldown}s`
                    : 'Reenviar código'}
              </button>
            </div>
            <div className="note">
              Enviamos un código de 6 dígitos a <strong>{normalizedEmail(email)}</strong>. Escríbelo aquí; no necesitas abrir ATLAS desde el correo.
            </div>
          </>
        )}
      </div>

      <div className="note" style={{ marginTop: 12 }}>
        Microsoft y el correo institucional solo acreditan identidad. El acceso a los datos sigue sujeto a la autorización de ATLAS.
      </div>
    </Card>
  );
}

const inputStyle = {
  width: '100%',
  boxSizing: 'border-box' as const,
  border: '1px solid var(--line)',
  borderRadius: 9,
  background: 'var(--surface-2)',
  color: 'var(--ink-1)',
  padding: '10px 12px',
  outline: 'none',
  font: 'inherit',
  fontSize: 13,
};

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
