import { useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, configError } from '../lib/supabase';
import { Mark } from './Mark';

/** The Observatorio reuses the Atlas allowlist: same accounts, same governance,
 *  new surface. Sign-in only proves identity; RLS decides what is readable. */
export function AuthGate({ children }: { children: (session: Session) => ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (configError) {
    return (
      <div className="auth-wrap">
        <div className="auth-card">
          <h1 style={{ fontSize: 18, margin: 0 }}>Configuración incompleta</h1>
          <div className="note note-warn">{configError}</div>
        </div>
      </div>
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
  return <>{children(session)}</>;
}

function SignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    if (err) setError(err.message === 'Invalid login credentials'
      ? 'Credenciales inválidas.'
      : err.message);
    setBusy(false);
  }

  return (
    <div className="auth-wrap">
      <form className="auth-card fade-in" onSubmit={submit}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 22 }}>
          <Mark size={36} animated />
          <div>
            <div style={{ fontWeight: 700, fontSize: 17, letterSpacing: '-0.02em' }}>
              ATLAS Observatorio
            </div>
            <div style={{ fontSize: 10.5, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-3)', fontWeight: 600 }}>
              Monitor de fuentes abiertas
            </div>
          </div>
        </div>

        <div className="field">
          <label htmlFor="email">Correo institucional</label>
          <input
            id="email" type="email" autoComplete="username" required
            value={email} onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="password">Contraseña</label>
          <input
            id="password" type="password" autoComplete="current-password" required
            value={password} onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        {error && <div className="note note-warn">{error}</div>}

        <button className="btn btn-primary" disabled={busy}>
          {busy ? 'Verificando…' : 'Entrar'}
        </button>

        <div className="note">
          El acceso se rige por la misma lista de habilitación que ATLAS. Iniciar sesión
          acredita identidad; lo que puedes leer lo decide la política de la base de datos.
        </div>
      </form>
    </div>
  );
}
