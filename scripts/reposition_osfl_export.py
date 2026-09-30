from pathlib import Path

p = Path('src/views/Osfl.tsx')
text = p.read_text()
old = '''            <div className="osfl-results-head"><div><b>Resultados</b><span>{search.loading ? 'Actualizando…' : `${formatNumber(totalResults)} entidades`}</span></div><div className="atlas-export-actions"><ExportButton exporting={exporting} count={totalResults} onClick={exportUniverse} /><div className="osfl-page-info">Página {Math.min(page + 1, pages)} de {pages}</div></div></div>'''
new = '''            <div className="osfl-results-head"><div><b>Resultados</b><span>{search.loading ? 'Actualizando…' : `${formatNumber(totalResults)} entidades`}</span></div><div className="osfl-page-info">Página {Math.min(page + 1, pages)} de {pages}</div></div>'''
if old not in text:
    raise SystemExit('No se encontró el encabezado actual de resultados OSFL')
text = text.replace(old, new, 1)
old2 = '''            <div className="osfl-pagination">
              <button disabled={page === 0} onClick={() => setPage((current) => Math.max(0, current - 1))}>‹</button>
              {pageButtons(page, pages).map((item) => <button key={item} data-active={item === page} onClick={() => setPage(item)}>{item + 1}</button>)}
              <button disabled={page + 1 >= pages} onClick={() => setPage((current) => Math.min(pages - 1, current + 1))}>›</button>
            </div>'''
new2 = '''            <div className="osfl-pagination">
              <button disabled={page === 0} onClick={() => setPage((current) => Math.max(0, current - 1))}>‹</button>
              {pageButtons(page, pages).map((item) => <button key={item} data-active={item === page} onClick={() => setPage(item)}>{item + 1}</button>)}
              <button disabled={page + 1 >= pages} onClick={() => setPage((current) => Math.min(pages - 1, current + 1))}>›</button>
            </div>
            <div className="osfl-export-below"><ExportButton exporting={exporting} count={totalResults} onClick={exportUniverse} /></div>'''
if old2 not in text:
    raise SystemExit('No se encontró la paginación OSFL')
text = text.replace(old2, new2, 1)
p.write_text(text)

css = Path('src/styles/export-button.css')
styles = css.read_text()
addition = '''

/* OSFL: exportación asociada a la navegación de resultados */
.osfl-export-below {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 1px 8px 9px;
}

.osfl-export-below .atlas-export-button {
  min-width: 190px;
  height: 28px;
  min-height: 28px;
  padding: 0 14px;
  border: 1px solid #b85a16;
  border-radius: 5px;
  background: linear-gradient(180deg, #e56c16, #bf5410);
  color: #fff;
  font-size: 8.5px;
  font-weight: 650;
  box-shadow: none;
  transform: none;
}

.osfl-export-below .atlas-export-button:hover:not(:disabled) {
  border-color: #c7651c;
  background: linear-gradient(180deg, #ef761c, #c95c13);
  color: #fff;
  filter: brightness(1.04);
  transform: none;
}
'''
if '.osfl-export-below {' not in styles:
    styles += addition
css.write_text(styles)
