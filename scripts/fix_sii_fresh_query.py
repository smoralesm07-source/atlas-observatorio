from pathlib import Path

path = Path('src/views/universo/CaseFile.tsx')
text = path.read_text(encoding='utf-8')

old = """// Consulta pública oficial del SII. Se abre fuera de Atlas porque el formulario\n// exige interacción humana; Atlas sólo facilita el salto y copia el RUT.\nconst SII_THIRD_PARTY_URL = 'https://www2.sii.cl/stc/noauthz/consulta';"""
new = """// La raíz pública del flujo abre una consulta nueva. No enlazar directamente a\n// /consulta: esa ruta corresponde a la vista de resultado y el SII puede\n// reconstruir la consulta anterior de la sesión, mostrando otro contribuyente.\nconst SII_THIRD_PARTY_URL = 'https://www2.sii.cl/stc/noauthz/';"""

if old not in text:
    raise SystemExit('No se encontró la constante SII esperada; no se aplicó ningún cambio.')

text = text.replace(old, new, 1)

old_fn = """  const openSiiThirdParty = () => {\n    // Abrir primero evita que el navegador bloquee la pestaña por esperar una\n    // promesa del portapapeles. El analista pega el RUT y completa el CAPTCHA.\n    window.open(SII_THIRD_PARTY_URL, '_blank', 'noopener,noreferrer');\n    if (!navigator.clipboard?.writeText) return;"""
new_fn = """  const openSiiThirdParty = () => {\n    // Siempre se entra por la raíz del trámite, no por la ruta de resultado.\n    // Así cada entidad de Atlas parte desde un formulario SII limpio aunque el\n    // analista haya consultado otro RUT inmediatamente antes. Abrir primero\n    // evita además que el navegador bloquee la pestaña por esperar clipboard.\n    window.open(SII_THIRD_PARTY_URL, '_blank', 'noopener,noreferrer');\n    if (!navigator.clipboard?.writeText) return;"""

if old_fn not in text:
    raise SystemExit('No se encontró openSiiThirdParty esperado; no se aplicó ningún cambio.')

text = text.replace(old_fn, new_fn, 1)
path.write_text(text, encoding='utf-8')
print('CaseFile.tsx actualizado: Consulta SII inicia siempre desde el formulario raíz.')
