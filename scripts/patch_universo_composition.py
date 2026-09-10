from pathlib import Path
import re

VIEW = Path('src/views/universo/PadronAxis.tsx')
CSS = Path('src/styles/universo-so.css')

text = VIEW.read_text(encoding='utf-8')

old_foot = 'foot="personas naturales u organismos sin nómina PJ"'
new_foot = 'foot="personas naturales sin perfil de persona jurídica"'
if old_foot in text:
    text = text.replace(old_foot, new_foot, 1)
elif new_foot not in text:
    raise SystemExit('No se encontró el texto esperado de Sin perfil SII')

anchor = "  const potentialTotal = potential?.totales?.accionables ?? 0;\n"
insert = (
    "  const potentialTotal = potential?.totales?.accionables ?? 0;\n"
    "  const stateTotal = u.activos + u.terminados + u.sin_perfil;\n"
    "  const natureTotal = u.juridicas + u.naturales + u.organismos;\n"
    "  const withoutTerritory = Math.max(0, total - u.con_territorio);\n"
)
if 'const stateTotal = u.activos + u.terminados + u.sin_perfil;' not in text:
    if anchor not in text:
        raise SystemExit('No se encontró el ancla de totales')
    text = text.replace(anchor, insert, 1)

pattern = re.compile(
    r'        <SectionHead\n'
    r'          kicker="1 · Composición"\n'
    r'          title="De qué está hecho el padrón vigente"\n'
    r'          hint="Estado registral ante el SII y naturaleza jurídica de los inscritos\. Cada franja abre sus entidades\."\n'
    r'        />\n'
    r'        <div className="uso-composition">.*?'
    r'        </div>\n'
    r'      </section>\n\n'
    r'      <section className="uso-panel">',
    re.S,
)

replacement = '''        <SectionHead
          kicker="1 · Composición"
          title="De qué está hecho el padrón vigente"
          hint={`Dos lecturas del mismo padrón: situación publicada ante el SII y naturaleza del inscrito. Todos los porcentajes usan como denominador los ${n(total)} sujetos.`}
        />
        <div className="uso-composition uso-composition-context">
          <div className="uso-composition-block">
            <div className="uso-composition-label">
              <span>Situación publicada ante el SII</span>
              <em className="num">{n(stateTotal)} de {n(total)} sujetos</em>
            </div>
            <div className="uso-statebar" role="group" aria-label="Situación publicada ante el SII">
              <div className="uso-statebar-track">
                <button
                  data-tone="active" style={{ width: `${share(u.activos, total) ?? 0}%` }}
                  onClick={() => onCohort({ cohort: 'ACTIVO', title: 'Sujetos activos ante el SII' })}
                  aria-label={`Activos ante el SII: ${n(u.activos)}`}
                />
                <button
                  data-tone="terminated" style={{ width: `${share(u.terminados, total) ?? 0}%` }}
                  onClick={() => onCohort({ cohort: 'TERMINO_GIRO', title: 'Sujetos con término de giro' })}
                  aria-label={`Con término de giro: ${n(u.terminados)}`}
                />
                <button
                  data-tone="unknown" style={{ width: `${share(u.sin_perfil, total) ?? 0}%` }}
                  onClick={() => onCohort({ cohort: 'SIN_PERFIL_SII', title: 'Sujetos sin perfil SII' })}
                  aria-label={`Sin perfil de persona jurídica en SII: ${n(u.sin_perfil)}`}
                />
              </div>
              <div className="uso-statebar-legend">
                <button onClick={() => onCohort({ cohort: 'ACTIVO', title: 'Sujetos activos ante el SII' })}>
                  <i data-tone="active" />Activos <b className="num">{n(u.activos)}</b>
                  <em>{n1(share(u.activos, total))}% del padrón</em>
                </button>
                <button onClick={() => onCohort({ cohort: 'TERMINO_GIRO', title: 'Sujetos con término de giro' })}>
                  <i data-tone="terminated" />Término de giro <b className="num">{n(u.terminados)}</b>
                  <em>{n1(share(u.terminados, total))}% del padrón</em>
                </button>
                <button onClick={() => onCohort({ cohort: 'SIN_PERFIL_SII', title: 'Sujetos sin perfil SII' })}>
                  <i data-tone="unknown" />Sin perfil PJ SII <b className="num">{n(u.sin_perfil)}</b>
                  <em>{n1(share(u.sin_perfil, total))}% del padrón</em>
                </button>
              </div>
            </div>
            <p className="uso-composition-note">
              Los tres estados son excluyentes y deben sumar el padrón completo.{' '}
              {u.sin_perfil === u.naturales
                ? `En este corte, los ${n(u.sin_perfil)} sin perfil SII coinciden con las personas naturales: no significa inactividad ni término de giro.`
                : 'Sin perfil SII significa que la nómina tributaria de personas jurídicas no entrega perfil para ese inscrito; no acredita inactividad.'}
            </p>
            {stateTotal !== total && (
              <p className="uso-data-warning">
                Inconsistencia del corte: los estados SII suman {n(stateTotal)} y el padrón informa {n(total)}. Diferencia: {n(Math.abs(total - stateTotal))}.
              </p>
            )}
          </div>

          <div className="uso-composition-block">
            <div className="uso-composition-label">
              <span>Naturaleza del inscrito</span>
              <em className="num">{n(natureTotal)} de {n(total)} sujetos</em>
            </div>
            <dl className="uso-nature-grid">
              <div>
                <dt>Personas jurídicas</dt>
                <dd className="num">{n(u.juridicas)}</dd>
                <em>{n1(share(u.juridicas, total))}% del padrón</em>
              </div>
              <div>
                <dt>Personas naturales</dt>
                <dd className="num">{n(u.naturales)}</dd>
                <em>{n1(share(u.naturales, total))}% del padrón</em>
              </div>
              <div>
                <dt>Organismos públicos</dt>
                <dd className="num">{n(u.organismos)}</dd>
                <em>{n1(share(u.organismos, total))}% del padrón</em>
              </div>
            </dl>
            <p className="uso-composition-note">
              Esta es otra partición de los mismos {n(total)} inscritos. No se suma a la barra de estado SII: responde una pregunta distinta.
            </p>
            {natureTotal !== total && (
              <p className="uso-data-warning">
                Inconsistencia del corte: la naturaleza identificada suma {n(natureTotal)} y difiere del padrón en {n(Math.abs(total - natureTotal))} sujetos.
              </p>
            )}
          </div>
        </div>

        <div className="uso-context-strip" aria-label="Cobertura de caracterización del padrón">
          <div>
            <span>Antigüedad media</span>
            <b className="num">{u.antiguedad_media == null ? '—' : `${n1(u.antiguedad_media)} años`}</b>
            <em>media sobre {n(u.con_inicio)} sujetos con fecha de inicio SII</em>
          </div>
          <div>
            <span>Trabajadores informados</span>
            <b className="num">{n(u.trabajadores)}</b>
            <em>suma de dotación declarada en perfiles SII; no es número de sujetos</em>
          </div>
          <div>
            <span>Territorio observado</span>
            <b className="num">{n(u.con_territorio)}</b>
            <em>{n1(share(u.con_territorio, total))}% del padrón · {n(withoutTerritory)} sin territorio observado</em>
          </div>
        </div>
      </section>

      <section className="uso-panel">'''

if 'uso-composition-context' not in text:
    text, count = pattern.subn(replacement, text, count=1)
    if count != 1:
        raise SystemExit(f'Reemplazo de composición aplicado {count} veces')

VIEW.write_text(text, encoding='utf-8')

css_text = CSS.read_text(encoding='utf-8')
marker = '/* Contexto explícito para la composición del padrón */'
if marker not in css_text:
    css_text += r'''

/* Contexto explícito para la composición del padrón */
.uso-composition-context { align-items: stretch; }

.uso-composition-block {
  min-width: 0;
  padding: 13px 14px 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--bg-panel-2);
}

.uso-composition-label {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 4px 12px;
  margin-bottom: 11px;
}

.uso-composition-label > span {
  font-size: 11px;
  font-weight: 680;
  letter-spacing: .055em;
  text-transform: uppercase;
  color: var(--ink-3);
}

.uso-composition-label > em {
  font-size: 10.5px;
  font-style: normal;
  color: var(--ink-4);
}

.uso-composition-note,
.uso-data-warning {
  margin: 10px 0 0;
  font-size: 10.8px;
  line-height: 1.5;
  color: var(--ink-4);
}

.uso-data-warning {
  padding: 7px 9px;
  border: 1px solid color-mix(in srgb, var(--sig-high) 45%, var(--line));
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--sig-high) 8%, transparent);
  color: var(--sig-high);
}

.uso-nature-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin: 0;
}

.uso-nature-grid > div {
  min-width: 0;
  padding: 9px 10px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--bg-panel);
}

.uso-nature-grid dt { font-size: 10.7px; color: var(--ink-3); }
.uso-nature-grid dd { margin: 3px 0 0; font-size: 18px; font-weight: 680; color: var(--ink); }
.uso-nature-grid em { display: block; margin-top: 2px; font-size: 10.2px; font-style: normal; color: var(--ink-4); }

.uso-context-strip {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin-top: 10px;
}

.uso-context-strip > div {
  min-width: 0;
  padding: 10px 12px;
  border-top: 1px solid var(--line);
}

.uso-context-strip span { display: block; font-size: 10.7px; color: var(--ink-4); }
.uso-context-strip b { display: block; margin-top: 2px; font-size: 16px; font-weight: 680; color: var(--ink); }
.uso-context-strip em { display: block; margin-top: 2px; font-size: 10.3px; line-height: 1.4; font-style: normal; color: var(--ink-4); }

@media (max-width: 820px) {
  .uso-nature-grid,
  .uso-context-strip { grid-template-columns: 1fr; }
}
'''
    CSS.write_text(css_text, encoding='utf-8')
