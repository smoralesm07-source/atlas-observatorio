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

const RETRY_DELAYS_MS = [0, 450, 1200] as const;

function isTransportError(message: string) {
  return /failed to fetch|networkerror|network request failed|load failed|fetch failed/i.test(message);
}

function delay(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

function asAtlasRole(value: unknown): AtlasRole {
  return value === 'admin' || value === 'analyst' || value === 'viewer' ? value : 'viewer';
}

async function signInWithMicrosoft() {
  return (
    await supabase.auth.signInWithOAuth({
      provider: 'azure',
      options: {
        scopes: 'email',
        redirectTo,
        // El selector de cuenta se solicita únicamente cuando el usuario llega
        // al flujo de login (primera entrada, sesión vencida o cierre explícito).
        // Una sesión válida persistida nunca vuelve a pasar por este flujo.
        queryParams: { prompt: 'select_account' },
      },
    })
  ).error;
}

/** Microsoft Entra prueba identidad y aml_allowed_users decide autorización.
 *  La sesión se persiste en el navegador: recargar la página no debe volver a
 *  pedir una cuenta mientras esa sesión siga siendo válida. */
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

  // Una pérdida temporal de conectividad no debe dejar a un analista ya
  // autenticado atrapado en error. RLS continúa siendo la autoridad.
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
              // La identidad ya fue autenticada por Microsoft y queda visible
              // para Administración a través de Supabase Auth. La ausencia en
              // aml_allowed_users equivale a una solicitud aún no resuelta.
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

  // Sin sesión: recién aquí se ofrece iniciar con Microsoft. Como el OAuth
  // usa prompt=select_account, después de cerrar sesión se puede escoger otra
  // cuenta aunque Microsoft mantenga otras identidades abiertas en el navegador.
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
    return (
      <Card title="Solicitud de acceso registrada">
        <p style={{ color: 'var(--ink-2)', fontSize: 13, lineHeight: 1.6 }}>
          Microsoft verificó correctamente tu identidad. Tu solicitud quedó disponible para
          revisión por un administrador de ATLAS Observatorio.
        </p>
        <div className="note">
          <strong style={{ display: 'block', marginBottom: 5, color: 'var(--ink-1)' }}>Cuenta Microsoft</strong>
          {session.user.email ?? 'Correo no informado por Microsoft'}
        </div>
        <p style={{ color: 'var(--ink-3)', fontSize: 12, lineHeight: 1.55, marginBottom: 0 }}>
          La autenticación no entrega acceso automático a los datos. Cuando un administrador
          habilite esta identidad, podrás comprobar la autorización sin volver a iniciar sesión.
        </p>
        <button
          className="btn btn-primary"
          style={{ width: '100%', marginTop: 18 }}
          onClick={() => setValidationKey((value) => value + 1)}
        >
          Comprobar autorización
        </button>
        <SignOutButton marginTop={10} />
      </Card>
    );
  }

  if (access.state === 'disabled') {
    return (
      <Card title="Acceso deshabilitado">
        <p style={{ color: 'var(--ink-2)', fontSize: 13, lineHeight: 1.6 }}>
          Tu identidad Microsoft sigue siendo válida, pero el acceso a ATLAS Observatorio fue
          deshabilitado por la administración.
        </p>
        <div className="note note-warn">
          Cuenta: {session.user.email ?? 'Correo no informado por Microsoft'}
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
        Puedes autenticar tu identidad Microsoft para solicitar acceso. La autenticación no
        habilita automáticamente los datos: un administrador de ATLAS debe autorizar la cuenta.
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
