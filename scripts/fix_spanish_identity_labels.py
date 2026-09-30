from pathlib import Path

path = Path('src/views/Sanciones.tsx')
text = path.read_text(encoding='utf-8')

anchor = """const EVENT_KIND_LABELS: Record<string, string> = {\n  DISCIPLINARY: 'Procedimiento disciplinario',\n  CRIMINAL_REFERRAL: 'Remisión al Ministerio Público',\n  CDE_REFERRAL: 'Remisión al CDE',\n  REPARO: 'Reparo',\n};\n"""
insert = anchor + """\n// Los estados internos de resolución de identidad son códigos técnicos del\n// pipeline. La interfaz no debe exponerlos en inglés ni obligar al usuario a\n// interpretar conceptos como \"Resolved Conservative\".\nconst IDENTITY_STATUS_LABELS: Record<string, string> = {\n  RESOLVED_CONSERVATIVE: 'Identidad resuelta',\n  RESOLVED_STRONG: 'Identidad confirmada',\n  RESOLVED_EXACT: 'Identidad confirmada',\n  RESOLVED: 'Identidad resuelta',\n  MATCHED: 'Identidad vinculada',\n  VERIFIED: 'Identidad verificada',\n  AMBIGUOUS: 'Identidad por revisar',\n  PENDING: 'Identidad por revisar',\n  UNRESOLVED: 'Identidad no resuelta',\n  UNMATCHED: 'Sin coincidencia de identidad',\n  SOURCE_ONLY: 'Identidad según fuente',\n};\n\nfunction identityStatusLabel(status?: string | null): string {\n  if (!status) return 'Sin RUT resuelto';\n  const key = status.trim().toUpperCase().replace(/[\\s-]+/g, '_');\n  return IDENTITY_STATUS_LABELS[key] ?? 'Identidad por revisar';\n}\n"""

if anchor not in text:
    raise SystemExit('No se encontró el bloque EVENT_KIND_LABELS')
text = text.replace(anchor, insert, 1)

old_row = "{item.rut || item.identity_status || 'Sin RUT'}"
new_row = "{item.rut || identityStatusLabel(item.identity_status)}"
if old_row not in text:
    raise SystemExit('No se encontró la etiqueta de identidad de la tabla')
text = text.replace(old_row, new_row, 1)

old_detail = "{e.rut || e.identity_status || 'Sin RUT resuelto'}"
new_detail = "{e.rut || identityStatusLabel(e.identity_status)}"
if old_detail not in text:
    raise SystemExit('No se encontró la etiqueta de identidad de la ficha')
text = text.replace(old_detail, new_detail, 1)

path.write_text(text, encoding='utf-8')
print('Etiquetas de identidad visibles traducidas y normalizadas al español.')
