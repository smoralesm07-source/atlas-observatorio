from pathlib import Path

case_path = Path('src/views/universo/CaseFile.tsx')
case = case_path.read_text(encoding='utf-8')

case = case.replace(
    "const SII_THIRD_PARTY_URL = 'https://zeus.sii.cl/cvc/stc/stc.html';",
    "const SII_THIRD_PARTY_URL = 'https://www2.sii.cl/stc/noauthz/consulta';",
)

old_block = '''      <div className="uso-case-review" data-mode={!tracked ? 'preclaim' : 'active'}>
        <div className="uso-case-review-copy">
          <span className="uso-kicker">{tracked ? 'Revisión complementaria' : 'Antes de tomar el caso'}</span>
          <b>Revisa la Ficha 360 y contrasta el estado tributario actual antes de gestionar.</b>
          <em>
            Atlas resuelve automáticamente la entidad 360 por RUT cuando todavía no viene vinculada. La consulta SII se abre en el sitio oficial y copia el RUT para pegarlo allí.
          </em>
        </div>
        <div className="uso-case-review-actions">
          <button className="btn btn-sm uso-case-review-360" onClick={openAtlas360} disabled={resolving360}>
            {resolving360 ? 'Abriendo Ficha 360…' : 'Abrir Ficha 360 ↗'}
          </button>
          <button
            className="btn btn-sm uso-case-review-sii"
            data-copied={siiCopied ? 'true' : undefined}
            onClick={openSiiThirdParty}
            title="Abrir Consulta situación tributaria de terceros del SII"
          >
            {siiCopied ? 'SII abierto · RUT copiado' : 'Consulta SII ↗'}
          </button>
        </div>
      </div>
'''

new_block = '''      <div className="uso-case-review-actions uso-case-review-actions-only">
        <button className="btn btn-sm uso-case-review-360" onClick={openAtlas360} disabled={resolving360}>
          {resolving360 ? 'Abriendo Ficha 360…' : 'Abrir Ficha 360 ↗'}
        </button>
        <button
          className="btn btn-sm uso-case-review-sii"
          data-copied={siiCopied ? 'true' : undefined}
          onClick={openSiiThirdParty}
          title="Abrir Consulta situación tributaria de terceros del SII"
        >
          {siiCopied ? 'SII abierto · RUT copiado' : 'Consulta SII ↗'}
        </button>
      </div>
'''

if old_block not in case:
    raise SystemExit('No se encontró el bloque de revisión previa esperado en CaseFile.tsx')
case = case.replace(old_block, new_block, 1)
case_path.write_text(case, encoding='utf-8')

css_path = Path('src/styles/universo-case-review.css')
css_path.write_text('''/* Gestión SO · accesos rápidos previos y complementarios. */

.uso-case-review-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;
}

.uso-case-review-actions-only {
  margin: 0 18px 14px;
}

.uso-case-review-360 {
  border-color: color-mix(in srgb, var(--unknown) 50%, var(--line-strong));
}

.uso-case-review-sii {
  border-color: color-mix(in srgb, var(--class-official) 46%, var(--line-strong));
}

.uso-case-review-sii[data-copied='true'] {
  border-color: color-mix(in srgb, var(--present) 62%, var(--line-strong));
}

@media (max-width: 760px) {
  .uso-case-review-actions-only {
    margin-inline: 12px;
    justify-content: flex-start;
  }
}
''', encoding='utf-8')

osint_path = Path('src/lib/osint.ts')
osint = osint_path.read_text(encoding='utf-8')
osint = osint.replace(
    "url: 'https://www2.sii.cl/stc/noauthz',",
    "url: 'https://www2.sii.cl/stc/noauthz/consulta',",
)
osint = osint.replace(
    "url: 'https://zeus.sii.cl/cvc/stc/stc.html',",
    "url: 'https://www2.sii.cl/stc/noauthz/consulta',",
)
osint_path.write_text(osint, encoding='utf-8')

print('Patch Gestión SO / SII aplicado.')
