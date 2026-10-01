from pathlib import Path

path = Path(__file__).resolve().parents[1] / 'src/views/EntityExpediente.tsx'
text = path.read_text(encoding='utf-8')
block = """function coverageByCode(data: EntityDetail, ...codes: string[]): CoverageRow | undefined {\n  return data.coverage.find((row) => codes.includes(row.source_code));\n}\n\n"""
if block not in text:
    raise SystemExit('coverageByCode helper not found after Huella pública patch')
path.write_text(text.replace(block, '', 1), encoding='utf-8')
print('Removed unused coverageByCode helper after Huella pública patch.')
