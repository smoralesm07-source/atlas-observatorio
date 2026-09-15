from pathlib import Path

PATH = Path("src/components/Auth.tsx")
text = PATH.read_text(encoding="utf-8")

replacements = [
    (
        "const OTP_RESEND_COOLDOWN_SECONDS = 60;\n",
        "const OTP_RESEND_COOLDOWN_SECONDS = 60;\nconst OTP_CODE_LENGTH = 8;\n",
    ),
    (
        "const token = code.replace(/\\D/g, '').slice(0, 6);",
        "const token = code.replace(/\\D/g, '').slice(0, OTP_CODE_LENGTH);",
    ),
    (
        "if (token.length !== 6) {",
        "if (token.length !== OTP_CODE_LENGTH) {",
    ),
    (
        "setError('Ingresa el código de 6 dígitos enviado a tu correo.');",
        "setError(`Ingresa el código de ${OTP_CODE_LENGTH} dígitos enviado a tu correo.`);",
    ),
    (
        ": 'Enviar código de 6 dígitos'}",
        ": `Enviar código de ${OTP_CODE_LENGTH} dígitos`}",
    ),
    (
        "maxLength={6}",
        "maxLength={OTP_CODE_LENGTH}",
    ),
    (
        "onChange={(event) => setCode(event.target.value.replace(/\\D/g, '').slice(0, 6))}",
        "onChange={(event) => setCode(event.target.value.replace(/\\D/g, '').slice(0, OTP_CODE_LENGTH))}",
    ),
    (
        'placeholder="000000"',
        'placeholder="00000000"',
    ),
    (
        'aria-label="Código de verificación de 6 dígitos"',
        'aria-label="Código de verificación de 8 dígitos"',
    ),
    (
        "disabled={locked || code.length !== 6}",
        "disabled={locked || code.length !== OTP_CODE_LENGTH}",
    ),
    (
        "Enviamos un código de 6 dígitos a",
        "Enviamos un código de 8 dígitos a",
    ),
]

for old, new in replacements:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"Patrón esperado exactamente una vez ({count}): {old}")
    text = text.replace(old, new, 1)

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
        raise SystemExit(f"Quedó una referencia incompatible con OTP de 8 dígitos: {forbidden}")

if text.count("const OTP_CODE_LENGTH = 8;") != 1:
    raise SystemExit("OTP_CODE_LENGTH no quedó definido exactamente una vez en 8")

PATH.write_text(text, encoding="utf-8")
print("Auth.tsx alineado completamente a OTP de 8 dígitos.")
