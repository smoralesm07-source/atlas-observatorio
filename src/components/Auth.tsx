import { useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, configError, redirectTo } from '../lib/supabase';
import { Mark } from './Mark';

type Access =
  | { state: 'checking' }
  | { state: 'granted'; role: string }
  | { state: 'pending' }
  | { state: 'error'; message: string; transport: boolean };

const RETRY_DELAYS_MS = [0, 450, 1200] as const;
const FRESH_LOGIN_KEY = 'atlas-observatorio-fresh-login';

function isTransportError(message: string) {
  return /failed to fetch|networkerror|network request failed|load failed|fetch failed/i.test(message);
}

function delay(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

async function signInWithMicrosoft() {
  // This flag survives the round-trip through Microsoft in the same tab. It
  // lets AuthGate distinguish a session that was just chosen explicitly from
  // an older persisted session restored from localStorage.
  sessionStorage.setItem(FRESH_LOGIN_KEY, '1');

  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'azure',
    options: {
      scopes: 'email',
      redirectTo,
      // Entra otherwise tends to reuse the account already active in the
      // browser. select_account makes testing and shared-workstation use safe
      // and explicit without forcing users to type credentials every time.
      queryParams: { prompt: 'select_account' },
    },
  });

  if (error) sessionStorage.removeItem(FRESH_LOGIN_KEY);
  return error;
}

/** The Observatorio reuses the ATLAS identity model exactly: Microsoft Entra
 *  proves who you are, and the aml_allowed_users allowlist decides whether you
 *  read anything. Authenticating is not authorization, so the two outcomes are
 *  shown as two different screens. */
export function AuthGate({ children }: { children: (session: Session) => ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [confirmStoredSession, setConfirmStoredSession] = useState(false);
  const [access, setAccess] = useState<Access>({ state: 'checking' });
  const [validationKey, setValidationKey] = useState(0);

  useEffect(() => {
    let live = true;
    const freshLogin = sessionStorage.getItem(FRESH_LOGIN_KEY) === '1';
    if (freshLogin) sessionStorage.removeItem(FRESH_LOGIN_KEY);

    supabase.auth.getSession().then(({ data }) => {
      if (!live) return;
      setSession(data.session);
      setConfirmStoredSession(Boolean(data.session && !freshLogin));
      setReady(true);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      if (!live) return;
      setSession(s);
      if (!s) setConfirmStoredSession(false);
    });

    return () => {
      live = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // A temporary loss of connectivity must not strand an already authenticated
  // analyst on the error screen. When the browser reports that connectivity is
  // back, validate authorization again. RLS is still the authority: there is no
  // client-side bypass or cached grant.
  useEffect(() => {
    const retryWhenOnline = () => setValidationKey((value) => value + 1);
    window.addEventListener('online', retryWhenOnline);
    return () => window.removeEventListener('online', retryWhenOnline);
  }, []);

  useEffect(() => {
    if (!session || confirmStoredSession) {
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
            if (data?.enabled) {
              setAccess({ state: 'granted', role: data.role ?? 'viewer' });
            } else {
              setAccess({ state: 'pending' });
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
  }, [session, confirmStoredSession, validationKey]);

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

  if (confirmStoredSession) {
    return (
      <StoredSessionChoice
        session={session}
        onContinue={() => setConfirmStoredSession(false)}
      />
    );
  }

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
    return (
      <Card title="Acceso pendiente de habilitación">
        <p style={{ color: 'var(--ink-2)', fontSize: 13, lineHeight: 1.6 }}>
          Tu identidad quedó autenticada correctamente, pero el Observatorio mantiene los
          datos cerrados hasta que la cuenta esté habilitada en la lista de acceso.
        </p>
        <div className="note">
          Autenticarse no otorga acceso: la autorización se valida por separado, en la
          base de datos, con la misma lista que gobierna ATLAS.
        </div>
        <SignOutButton />
      </Card>
    );
  }

  return <>{children(session)}</>;
}

function StoredSessionChoice({
  session,
  onContinue,
}: {
  session: Session;
  onContinue: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const email = session.user.email ?? 'cuenta actual';

  async function useAnotherAccount() {
    setBusy(true);
    setError(null);

    const { error: signOutError } = await supabase.auth.signOut({ scope: 'local' });
    if (signOutError) {
      setError(signOutError.message);
      setBusy(false);
      return;
    }

    const signInError = await signInWithMicrosoft();
    if (signInError) {
      setError(signInError.message);
      setBusy(false);
    }
  }

  return (
    <Card title="ATLAS Observatorio" eyebrow="Sesión encontrada">
      <p style={{ color: 'var(--ink-2)', fontSize: 13, lineHeight: 1.6, marginTop: 0 }}>
        Hay una sesión guardada en este navegador. ¿Quieres continuar con esta cuenta o
        ingresar con un usuario distinto?
      </p>

      <div className="note" style={{ marginBottom: 14 }}>
        <span style={{ display: 'block', color: 'var(--ink-3)', fontSize: 10.5, marginBottom: 4 }}>
          CUENTA ACTUAL
        </span>
        <strong style={{ color: 'var(--ink-1)', fontSize: 13 }}>{email}</strong>
      </div>

      {error && <div className="note note-warn">{error}</div>}

      <button
        className="btn btn-primary"
        style={{ width: '100%' }}
        onClick={onContinue}
        disabled={busy}
      >
        Continuar como {email}
      </button>

      <button
        className="btn"
        style={{ width: '100%', marginTop: 10 }}
        onClick={useAnotherAccount}
        disabled={busy}
      >
        <MicrosoftLogo />
        {busy ? 'Abriendo selector…' : 'Usar otra cuenta'}
      </button>
    </Card>
  );
}

function SignIn() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn() {
    setBusy(true);
    setError(null);
    const err = await signInWithMicrosoft();
    if (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Card title="ATLAS Observatorio" eyebrow="Monitor de fuentes abiertas">
      <p style={{ color: 'var(--ink-2)', fontSize: 13, lineHeight: 1.6, marginTop: 0 }}>
        Entorno de análisis sobre fuentes abiertas gobernadas, protegido por Microsoft
        Entra, lista de habilitación y Row Level Security.
      </p>

      {error && <div className="note note-warn">{error}</div>}

      <button className="btn btn-primary" onClick={signIn} disabled={busy}>
        <MicrosoftLogo />
        {busy ? 'Redirigiendo…' : 'Ingresar con Microsoft'}
      </button>

      <div className="note">
        Autenticarse no otorga acceso automático: la autorización se valida por separado
        contra la lista de habilitación.
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

function Card({
  title,
  eyebrow,
  children,
}: {
  title: string;
  eyebrow?: string;
  children: ReactNode;
}) {
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
