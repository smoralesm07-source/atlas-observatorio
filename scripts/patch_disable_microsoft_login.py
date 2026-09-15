from pathlib import Path

PATH = Path("src/components/Auth.tsx")
text = PATH.read_text(encoding="utf-8")

replacements = [
    (
        "import { supabase, configError, redirectTo } from '../lib/supabase';",
        "import { supabase, configError } from '../lib/supabase';",
    ),
    (
        """async function signInWithMicrosoft() {\n  return (\n    await supabase.auth.signInWithOAuth({\n      provider: 'azure',\n      options: {\n        scopes: 'email',\n        redirectTo,\n        queryParams: { prompt: 'select_account' },\n      },\n    })\n  ).error;\n}\n\n""",
        "",
    ),
    (
        "  const [microsoftBusy, setMicrosoftBusy] = useState(false);\n",
        "",
    ),
    (
        """  async function signInMicrosoft() {\n    setMicrosoftBusy(true);\n    setError(null);\n    const err = await signInWithMicrosoft();\n    if (err) {\n      setError(err.message);\n      setMicrosoftBusy(false);\n    }\n  }\n\n""",
        "",
    ),
    (
        "  const locked = microsoftBusy || emailBusy || verifyBusy;",
        "  const locked = emailBusy || verifyBusy;",
    ),
    (
        """      <button className=\"btn btn-primary\" style={{ width: '100%' }} onClick={signInMicrosoft} disabled={locked}>\n        <MicrosoftLogo />\n        {microsoftBusy ? 'Redirigiendo…' : 'Ingresar con Microsoft'}\n      </button>\n\n      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '16px 0', color: 'var(--ink-3)', fontSize: 11 }}>\n        <span style={{ height: 1, background: 'var(--line)', flex: 1 }} />\n        <span>o</span>\n        <span style={{ height: 1, background: 'var(--line)', flex: 1 }} />\n      </div>\n\n""",
        "",
    ),
    (
        "        Autentica tu identidad. Si tu cuenta ya fue autorizada, entrarás directamente; si es nueva, ATLAS registrará una solicitud para revisión.",
        "        Ingresa con tu correo institucional UAF. Si tu cuenta ya fue autorizada, entrarás directamente; si es nueva, ATLAS registrará una solicitud para revisión.",
    ),
    (
        "        Microsoft y el correo institucional solo acreditan identidad. El acceso a los datos sigue sujeto a la autorización de ATLAS.",
        "        El correo institucional acredita tu identidad. El acceso a los datos sigue sujeto a la autorización de ATLAS.",
    ),
    (
        """\nfunction MicrosoftLogo() {\n  return (\n    <svg width=\"15\" height=\"15\" viewBox=\"0 0 23 23\" aria-hidden style={{ flexShrink: 0 }}>\n      <path fill=\"#f25022\" d=\"M1 1h10v10H1z\" />\n      <path fill=\"#7fba00\" d=\"M12 1h10v10H12z\" />\n      <path fill=\"#00a4ef\" d=\"M1 12h10v10H1z\" />\n      <path fill=\"#ffb900\" d=\"M12 12h10v10H12z\" />\n    </svg>\n  );\n}\n""",
        "\n",
    ),
]

for old, new in replacements:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"Patrón esperado exactamente una vez ({count}): {old[:120]!r}")
    text = text.replace(old, new, 1)

for forbidden in (
    "Ingresar con Microsoft",
    "signInMicrosoft",
    "signInWithMicrosoft",
    "microsoftBusy",
    "MicrosoftLogo",
    "redirectTo",
    "provider: 'azure'",
):
    if forbidden in text:
        raise SystemExit(f"La opción Microsoft sigue expuesta en login: {forbidden}")

# El soporte de sesiones Azure existentes se conserva deliberadamente en identityLabel.
if "Microsoft Entra" not in text:
    raise SystemExit("Se eliminó accidentalmente el reconocimiento de sesiones Azure existentes")

if "const OTP_CODE_LENGTH = 8;" not in text:
    raise SystemExit("Se alteró accidentalmente la configuración OTP de 8 dígitos")

PATH.write_text(text, encoding="utf-8")
print("Login Microsoft oculto; correo OTP de 8 dígitos queda como único método visible.")
