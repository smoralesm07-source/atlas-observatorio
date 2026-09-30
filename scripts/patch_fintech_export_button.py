from pathlib import Path


def replace_once(path: str, old: str, new: str):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f'Anchor not found in {path}: {old[:160]!r}')
    p.write_text(text.replace(old, new, 1))

# Remove header export button.
replace_once(
    'src/views/Fintech.tsx',
    "        <span><b>Atlas actualizado</b>{formatDateTime(n.refreshed_at)}</span>\n        <ExportButton exporting={exporting} count={totalResults} onClick={exportSnapshot} />",
    "        <span><b>Atlas actualizado</b>{formatDateTime(n.refreshed_at)}</span>",
)

# Remove export button from results header, leaving only page information.
replace_once(
    'src/views/Fintech.tsx',
    "          <div className=\"fintech-results-head\"><div><b>Resultados</b><span>{search.loading ? 'Actualizando…' : `${formatNumber(totalResults)} entidades`}</span></div><div className=\"atlas-export-actions\"><ExportButton exporting={exporting} count={totalResults} onClick={exportSnapshot} /><span>Página {Math.min(page + 1,pages)} de {pages}</span></div></div>",
    "          <div className=\"fintech-results-head\"><div><b>Resultados</b><span>{search.loading ? 'Actualizando…' : `${formatNumber(totalResults)} entidades`}</span></div><span>Página {Math.min(page + 1,pages)} de {pages}</span></div>",
)

# Add the single export button directly below pagination.
replace_once(
    'src/views/Fintech.tsx',
    "          <div className=\"fintech-pagination\">\n            <button disabled={page===0} onClick={() => setPage((current) => Math.max(0,current-1))}>‹</button>\n            {pageButtons(page,pages).map((item) => <button key={item} data-active={item===page} onClick={() => setPage(item)}>{item+1}</button>)}\n            <button disabled={page+1>=pages} onClick={() => setPage((current) => Math.min(pages-1,current+1))}>›</button>\n          </div>",
    "          <div className=\"fintech-pagination\">\n            <button disabled={page===0} onClick={() => setPage((current) => Math.max(0,current-1))}>‹</button>\n            {pageButtons(page,pages).map((item) => <button key={item} data-active={item===page} onClick={() => setPage(item)}>{item+1}</button>)}\n            <button disabled={page+1>=pages} onClick={() => setPage((current) => Math.min(pages-1,current+1))}>›</button>\n          </div>\n          <div className=\"fintech-export-below\"><ExportButton exporting={exporting} count={totalResults} onClick={exportSnapshot} /></div>",
)

css_path = Path('src/styles/export-button.css')
css = css_path.read_text()
addition = r'''

/* FINTECH: misma jerarquía visual que OSFL, bajo la paginación */
.fintech-export-below {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 1px 8px 9px;
}

.fintech-export-below .atlas-export-button {
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

.fintech-export-below .atlas-export-button:hover:not(:disabled) {
  border-color: #c7651c;
  background: linear-gradient(180deg, #ef761c, #c95c13);
  color: #fff;
  filter: brightness(1.04);
  transform: none;
}
'''
if '.fintech-export-below {' not in css:
    css_path.write_text(css.rstrip() + addition + '\n')
