from pathlib import Path

PATH = Path("src/components/Auth.tsx")
text = PATH.read_text(encoding="utf-8")

for forbidden in (
    "código de 6 dígitos",
    "Código de verificación de 6 dígitos",
    "maxLength={6}",
    ".slice(0, 6)",
    "code.length !== 6",
    "token.length !== 6",
    'placeholder="000000"',
):
    if forbidden in text:
        raise SystemExit(f"ATLAS todavía contiene una referencia incompatible con OTP de 8 dígitos: {forbidden}")

required = (
    "const OTP_CODE_LENGTH = 8;",
    ".slice(0, OTP_CODE_LENGTH)",
    "token.length !== OTP_CODE_LENGTH",
    "maxLength={OTP_CODE_LENGTH}",
    "code.length !== OTP_CODE_LENGTH",
    'placeholder="00000000"',
    'aria-label="Código de verificación de 8 dígitos"',
    "Enviamos un código de 8 dígitos a",
)

missing = [pattern for pattern in required if pattern not in text]
if missing:
    raise SystemExit("Faltan garantías OTP de 8 dígitos en Auth.tsx: " + ", ".join(missing))

if text.count("const OTP_CODE_LENGTH = 8;") != 1:
    raise SystemExit("OTP_CODE_LENGTH debe estar definido exactamente una vez y con valor 8")

print("Auth.tsx validado: OTP de 8 dígitos consistente en envío, entrada, validación y mensajes.")
