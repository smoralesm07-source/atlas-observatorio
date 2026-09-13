from pathlib import Path

path = Path('src/views/pulso/NewEntitiesDirectory.tsx')
text = path.read_text(encoding='utf-8')

old = "    p_q: deferredQ || null,"
new = "    p_q: normalizeDirectoryQuery(deferredQ) || null,"
if old not in text:
    raise SystemExit('No se encontró p_q para normalizar')
text = text.replace(old, new, 1)

marker = "\nfunction displayDate(value: string | null | undefined) {"
helper = r'''

function normalizeDirectoryQuery(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (!/^[0-9.kK\-]+$/.test(trimmed)) return trimmed;
  const cleaned = trimmed.replace(/[^0-9kK]/g, '').toUpperCase();
  if (cleaned.length < 2) return cleaned;
  return `${cleaned.slice(0, -1)}-${cleaned.slice(-1)}`;
}
'''
if marker not in text:
    raise SystemExit('No se encontró punto de inserción de helper')
text = text.replace(marker, helper + marker, 1)
path.write_text(text, encoding='utf-8')
print('Búsqueda RUT normalizada para formatos con puntos o sin guion')
