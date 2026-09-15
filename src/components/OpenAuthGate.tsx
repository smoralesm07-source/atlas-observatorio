import { useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { AuthGate as AuthorizationGate, type AtlasRole } from './Auth';
import { Mark } from './Mark';
import { configError, supabase } from '../lib/supabase';

export type { AtlasRole } from './Auth';

const OTP_RESEND_COOLDOWN_SECONDS = 60;
const OTP_CODE_LENGTH = 8;
const EMAIL_FALLBACK_DOMAIN = 'uaf.gob.cl';
const SESSION_BOOT_TIMEOUT_MS = 6000;

function normalizedEmail(value: string) {
  return value.trim().toLowerCase();
}

function validInstitutionalEmail(value: string) {
  const email = normalizedEmail(value);
  const [local, domain, extra] = email.split('@');
  return Boolean(local && domain === EMAIL_FALLBACK_DOMAIN && !extra);
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
    return 'Se alcanzó temporalmente el límite de envío de códigos. Espera antes de solicitar otro. Si continúa, la cuota horaria de correo todavía no se ha liberado.';
  }
  if (/token has expired or is invalid/i.test(String(error?.message ?? ''))) {
    return `El código venció o no es válido. Solicita uno nuevo e ingresa los ${OTP_CODE_LENGTH} dígitos.`;
  }
  return error?.message || 'No fue posible completar la autenticación por correo.';
}

export function AuthGate({ children }: { children: (session: Session, role: AtlasRole) => ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    let live = true;
    const bootTimeout = window.setTimeout(() => {
      if (!live) return;
      // Nunca dejar la aplicación bloqueada indefinidamente en el splash si
      // la restauración/renovación de una sesión persistida no responde. El
      // usuario vuelve a la puerta de acceso y puede autenticarse de nuevo.
      setSession(null);
    }, SESSION_BOOT_TIMEOUT_MS);

    supabase.auth.getSession()
      .then(({ data }) => {
        if (!live) return;
        window.clearTimeout(bootTimeout);
        setSession(data.session);
      })
      .catch(() => {
        if (!live) return;
        window.clearTimeout(bootTimeout);
        setSession(null);
      });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!live) return;
      window.clearTimeout(bootTimeout);
      setSession(nextSession);
    });

    return () => {
      live = false;
      window.clearTimeout(bootTimeout);
      listener.subscription.unsubscribe();
    };
  }, []);

  if (session === undefined) {
    return <div className="auth-wrap"><Mark size={40} animated /></div>;
  }

  if (!session) return <OpenSignIn />;

  return <AuthorizationGate>{children}</AuthorizationGate>;
}

function OpenSignIn() {
  const [emailBusy, setEmailBusy] = useState(false);
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = window.setTimeout(() => setResendCooldown((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [resendCooldown]);

  async function sendCode() {
    const value = normalizedEmail(email);
    if (!validInstitutionalEmail(value)) {
      setError(`El acceso por correo está habilitado únicamente para cuentas @${EMAIL_FALLBACK_DOMAIN}.`);
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
      if (isRateLimitError(otpError)) setResendCooldown(OTP_RESEND_COOLDOWN_SECONDS);
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
    const token = code.replace(/\D/g, '').slice(0, OTP_CODE_LENGTH);
    if (!validInstitutionalEmail(value)) {
      setError('El correo institucional no es válido.');
      return;
    }
    if (token.length !== OTP_CODE_LENGTH) {
      setError(`Ingresa el código de ${OTP_CODE_LENGTH} dígitos enviado a tu correo.`);
      return;
    }

    setVerifyBusy(true);
    setError(null);
    const { error: verifyError } = await supabase.auth.verifyOtp({ email: value, token, type: 'email' });
    if (verifyError) {
      setError(emailAuthErrorMessage(verifyError));
      setVerifyBusy(false);
      return;
    }
    setVerifyBusy(false);
  }

  if (configError) {
    return <Card title="Configuración incompleta"><div className="note note-warn">{configError}</div></Card>;
  }

  const locked = emailBusy || verifyBusy;
  const codeReady = code.length === OTP_CODE_LENGTH;

  return (
    <Card title="ATLAS Observatorio" eyebrow="Monitor de fuentes abiertas">
      <p style={{ color: 'var(--ink-2)', fontSize: 13, lineHeight: 1.6, marginTop: 0 }}>
        Ingresa con tu correo institucional UAF. Si tu cuenta ya fue autorizada, entrarás directamente; si es nueva, ATLAS registrará una solicitud para revisión.
      </p>

      {error && <div className="note note-warn" role="alert">{error}</div>}

      <div style={{ display: 'grid', gap: 9 }}>
        <label style={{ fontSize: 11, color: 'var(--ink-3)', fontWeight: 600 }}>Correo institucional UAF</label>
        <input
          type="email"
          value={email}
          disabled={codeSent || locked}
          onChange={(event) => { setEmail(event.target.value); setError(null); }}
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
                : `Enviar código de ${OTP_CODE_LENGTH} dígitos`}
          </button>
        ) : (
          <>
            <label style={{ fontSize: 11, color: 'var(--ink-3)', fontWeight: 600, marginTop: 4 }}>Código de verificación</label>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={OTP_CODE_LENGTH}
              autoFocus
              autoComplete="one-time-code"
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, OTP_CODE_LENGTH))}
              onKeyDown={(event) => { if (event.key === 'Enter' && !locked && codeReady) void verifyCode(); }}
              placeholder="00000000"
              aria-label="Código de verificación de 8 dígitos"
              style={{ ...inputStyle, letterSpacing: '0.28em', textAlign: 'center', fontWeight: 700, fontSize: 18 }}
            />
            <button className="btn btn-primary" style={{ width: '100%' }} onClick={() => void verifyCode()} disabled={locked || !codeReady}>
              {verifyBusy ? 'Verificando…' : 'Verificar e ingresar'}
            </button>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" style={{ flex: 1 }} onClick={() => { setCodeSent(false); setCode(''); setError(null); }} disabled={locked}>
                Cambiar correo
              </button>
              <button className="btn" style={{ flex: 1 }} onClick={() => void sendCode()} disabled={locked || resendCooldown > 0}>
                {emailBusy ? 'Reenviando…' : resendCooldown > 0 ? `Reenviar en ${resendCooldown}s` : 'Reenviar código'}
              </button>
            </div>
            <div className="note">
              Enviamos un código de {OTP_CODE_LENGTH} dígitos a <strong>{normalizedEmail(email)}</strong>. Escríbelo aquí; no necesitas abrir ATLAS desde el correo.
            </div>
          </>
        )}
      </div>

      <div className="note" style={{ marginTop: 12 }}>
        El correo institucional verifica tu identidad. El acceso a los datos sigue sujeto a la autorización de ATLAS.
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

function Card({ title, eyebrow, children }: { title: string; eyebrow?: string; children: ReactNode }) {
  return (
    <div className="auth-wrap">
      <div className="auth-card fade-in">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <Mark size={36} animated />
          <div>
            <div style={{ fontWeight: 700, fontSize: 17, letterSpacing: '-0.02em' }}>{title}</div>
            {eyebrow && <div style={{ fontSize: 10.5, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-3)', fontWeight: 600 }}>{eyebrow}</div>}
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}
