import { useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, configError, redirectTo } from '../lib/supabase';
import { Mark } from './Mark';

type Access =
  | { state: 'checking' }
  | { state: 'granted'; role: string }
  | { state: 'pending' }
  | { state: 'error'; message: string };

/** The Observatorio reuses the ATLAS identity model exactly: Microsoft Entra
 *  proves who you are, and the aml_allowed_users allowlist decides whether you
 *  read anything. Authenticating is not authorization, so the two outcomes are
 *  shown as two different screens. */
export function AuthGate({ children }: { children: (session: Session) => ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [access, setAccess] = useState<Access>({ state: 'checking' });

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) {
      setAccess({ state: 'checking' });
      return;
    }
    let live = true;
    supabase
      .from('aml_allowed_users')
      .select('role, enabled')
      .maybeSingle()
      .then(({ data, error }) => {
        if (!live) return;
        if (error) setAccess({ state: 'error', message: error.message });
        else if (data?.enabled) setAccess({ state: 'granted', role: data.role ?? 'viewer' });
        else setAccess({ state: 'pending' });
      });
    return () => {
      live = false;
    };
  }, [session]);

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
          La sesión se autenticó, pero la consulta a la lista de habilitación falló.
        </p>
        <div className="note note-warn">{access.message}</div>
        <SignOutButton />
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

function SignIn() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn() {
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: 'azure',
      options: { scopes: 'email', redirectTo },
    });
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

function SignOutButton() {
  return (
    <button
      className="btn"
      style={{ width: '100%', marginTop: 18 }}
      onClick={() => supabase.auth.signOut()}
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
