from pathlib import Path

p = Path('src/components/CohortDrawer.tsx')
text = p.read_text(encoding='utf-8')

# Cargar más filas de entrada: la vista compacta permite revisar más sin paginar.
text = text.replace('const PAGE = 40;', 'const PAGE = 80;', 1)

needle = '''            <>
              <div className="rows">
                {visibles.map((s) => (
'''
replacement = '''            <>
              <div className="subject-columns" aria-hidden="true">
                <span className="subject-columns-main">
                  <span>Entidad · identificación · ubicación</span>
                  <span>Marcas</span>
                </span>
                <span>IPF</span>
                <span />
              </div>
              <div className="rows">
                {visibles.map((s) => (
'''

if needle not in text:
    raise SystemExit('No se encontró el inicio de la lista de sujetos')
text = text.replace(needle, replacement, 1)

p.write_text(text, encoding='utf-8')
