from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TSX = ROOT / "src/views/EntityExpediente.tsx"
CSS = ROOT / "src/styles/entity-expediente.css"

score_vars_old = '''  const score = entity.ipa3_score;
  const scoreBand = bandLabel(entity.ipa3_band ?? data.priority?.priority_band_shadow);
  const scorePct = Math.max(0, Math.min(100, Number(score ?? 0)));
'''

score_vars_new = '''  const score = entity.ipa3_score;
  const scoreBand = bandLabel(entity.ipa3_band ?? data.priority?.priority_band_shadow);
  const scorePct = Math.max(0, Math.min(100, Number(score ?? 0)));
  const priority = record(data.priority);
  const ipaBaseScore = numberValue(priority.ipa3_base_score);
  const ipaPressScore = numberValue(priority.press_group_score) ?? 0;
  const ipaPressConfidence = numberValue(priority.press_confidence_pct);
  const ipaPressDate = text(priority.press_event_at);
  const ipaPressSource = text(priority.press_latest_source);
  const ipaPressTitle = text(priority.press_latest_title);
  const ipaCoverage = numberValue(priority.coverage_index_pct);
  const ipaGroups = [
    { key: 'REGISTRY', label: 'Registro', score: numberValue(priority.registry_group_score) ?? 0 },
    { key: 'ECONOMIC_TRAJECTORY', label: 'Trayectoria económica', score: numberValue(priority.economic_group_score) ?? 0 },
    { key: 'SANCTIONS', label: 'Sanciones', score: numberValue(priority.sanctions_group_score) ?? 0 },
    { key: 'PRESS', label: 'Prensa adversa', score: ipaPressScore },
  ].filter((group) => group.score > 0).sort((a, b) => b.score - a.score);
  const ipaMarks = data.marks
    .filter((mark) => mark.included_in_score && Number(mark.contribution ?? 0) > 0)
    .sort((a, b) => Number(b.contribution ?? 0) - Number(a.contribution ?? 0));
'''

score_card_old = '''        <div className="entity360-score" data-has-score={score != null && score > 0}>
          <div className="entity360-score-label">IPA3 · prioridad analítica</div>
          <div className="entity360-score-value">{score == null ? '—' : n1(score)}<small>/100</small></div>
          <div className="entity360-score-track"><i style={{ width: `${scorePct}%` }} /></div>
          <div className="entity360-score-foot">{scoreBand || 'Sin banda materializada'}</div>
        </div>'''

score_card_new = '''        <div className="entity360-score" data-has-score={score != null && score > 0}>
          <div className="entity360-score-label">
            <span>IPA3 · prioridad analítica</span>
            <details className="entity360-ipa-help">
              <summary aria-label="Ayuda metodológica del IPA3" title="Cómo se calcula e interpreta el IPA3">i</summary>
              <div className="entity360-ipa-help-popover" role="note">
                <header>
                  <div>
                    <span>Ayuda metodológica</span>
                    <h3>IPA3 · Índice de Prioridad Analítica</h3>
                  </div>
                  <em>{text(priority.adjusted_score_version) ?? text(priority.score_version) ?? 'IPA3'}</em>
                </header>

                <p className="entity360-ipa-help-lede">
                  <strong>{score == null ? '—' : n1(score)}/100</strong> ordena la revisión analítica de la entidad. <b>No es una probabilidad de LA/FT</b>, ni acredita delito o incumplimiento.
                </p>

                <div className="entity360-ipa-formula" aria-label="Fórmula de agregación IPA3">
                  <span>Agregación</span>
                  <code>IPA3 = G1 + 0,25·G2 + 0,10·G3</code>
                  <small>G1, G2 y G3 son los tres grupos independientes con mayor aporte. El resultado se acota a 100.</small>
                </div>

                <div className="entity360-ipa-groups">
                  {ipaGroups.length ? ipaGroups.map((group, index) => (
                    <div key={group.key} data-rank={index + 1}>
                      <span>{group.label}</span>
                      <strong>{n1(group.score)}</strong>
                      <small>{index === 0 ? 'conductor' : index === 1 ? '25% en agregación' : index === 2 ? '10% en agregación' : 'visible · no adicional'}</small>
                    </div>
                  )) : <div className="entity360-ipa-empty">Sin grupos puntuables en el corte vigente.</div>}
                </div>

                {ipaMarks.length > 0 && (
                  <div className="entity360-ipa-marks">
                    <span>Marcas que aportan</span>
                    {ipaMarks.slice(0, 4).map((mark) => (
                      <div key={mark.mark_id}>
                        <strong>{mark.mark_name ?? mark.mark_id}</strong>
                        <em>{n1(Number(mark.contribution ?? 0))} pts</em>
                      </div>
                    ))}
                  </div>
                )}

                <section className="entity360-ipa-press" data-active={ipaPressScore > 0}>
                  <div className="entity360-ipa-section-title">
                    <strong>Prensa adversa</strong>
                    <span>{ipaPressScore > 0 ? `P01 · ${n1(ipaPressScore)}/35` : 'Sin aporte'}</span>
                  </div>
                  <p>
                    La <strong>mera figuración en prensa suma 0</strong>. P01 sólo se activa con identidad y mención de alta confianza, la entidad sostenida por el propio titular y contenido reciente materialmente adverso relacionado con LA/FT o delitos base. Repeticiones del mismo hecho no se suman como noticias independientes y la señal pierde intensidad con el tiempo.
                  </p>
                  {ipaPressScore > 0 && (
                    <div className="entity360-ipa-press-evidence">
                      {ipaPressConfidence != null && <span>Confianza {n1(ipaPressConfidence)}%</span>}
                      {ipaPressDate && <span>Última señal {fecha(ipaPressDate)}</span>}
                      {ipaPressSource && <span>{ipaPressSource}</span>}
                      {ipaPressTitle && <small>{ipaPressTitle}</small>}
                    </div>
                  )}
                </section>

                <footer>
                  {ipaPressScore > 0 && ipaBaseScore != null && Number(score ?? 0) !== ipaBaseScore
                    ? <>IPA3 base sin prensa: <strong>{n1(ipaBaseScore)}/100</strong> · </>
                    : null}
                  {ipaCoverage != null ? <>Cobertura del modelo base: <strong>{n1(ipaCoverage)}%</strong> · </> : null}
                  La cobertura y la confianza se informan aparte y no elevan por sí solas el score.
                </footer>
              </div>
            </details>
          </div>
          <div className="entity360-score-value">{score == null ? '—' : n1(score)}<small>/100</small></div>
          <div className="entity360-score-track"><i style={{ width: `${scorePct}%` }} /></div>
          <div className="entity360-score-foot">{scoreBand || 'Sin banda materializada'}</div>
        </div>'''

text = TSX.read_text()
if 'entity360-ipa-help-popover' not in text:
    if score_vars_old not in text:
        raise SystemExit('No se encontró el bloque de variables IPA3 esperado')
    if score_card_old not in text:
        raise SystemExit('No se encontró la tarjeta IPA3 esperada')
    text = text.replace(score_vars_old, score_vars_new, 1)
    text = text.replace(score_card_old, score_card_new, 1)
    TSX.write_text(text)

marker = '/* IPA3 · ayuda metodológica contextual v0.5 */'
css = CSS.read_text()
if marker not in css:
    css += r'''

/* IPA3 · ayuda metodológica contextual v0.5 */
.entity360-hero { overflow: visible; }
.entity360-score { position: relative; z-index: 8; }
.entity360-score-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.entity360-ipa-help { position: relative; }
.entity360-ipa-help > summary {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  min-height: 20px;
  padding: 0;
  border: 1px solid color-mix(in srgb, var(--e360-blue) 45%, var(--e360-blue-line));
  border-radius: 50%;
  background: color-mix(in srgb, var(--e360-blue) 10%, transparent);
  color: var(--e360-blue-2);
  font-family: var(--font);
  font-size: 10px;
  font-weight: 800;
  line-height: 1;
  text-transform: none;
  letter-spacing: 0;
  cursor: help;
  list-style: none;
}
.entity360-ipa-help > summary::-webkit-details-marker { display: none; }
.entity360-ipa-help > summary:hover,
.entity360-ipa-help[open] > summary {
  border-color: var(--e360-blue-2);
  background: var(--e360-blue-dim);
  color: var(--ink);
}

.entity360-ipa-help-popover {
  position: absolute;
  top: calc(100% + 9px);
  right: -10px;
  z-index: 120;
  width: min(530px, calc(100vw - 42px));
  max-height: min(72vh, 670px);
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 16px 17px 14px;
  border: 1px solid color-mix(in srgb, var(--e360-blue) 42%, var(--line-strong));
  border-radius: 12px;
  background: color-mix(in srgb, var(--bg-panel) 97%, #082a48 3%);
  box-shadow: 0 24px 70px rgba(0, 0, 0, .48);
  color: var(--ink-2);
  text-align: left;
  text-transform: none;
  letter-spacing: 0;
}
.entity360-ipa-help-popover::before {
  content: '';
  position: absolute;
  top: -6px;
  right: 15px;
  width: 10px;
  height: 10px;
  transform: rotate(45deg);
  border-top: 1px solid color-mix(in srgb, var(--e360-blue) 42%, var(--line-strong));
  border-left: 1px solid color-mix(in srgb, var(--e360-blue) 42%, var(--line-strong));
  background: var(--bg-panel);
}
.entity360-ipa-help-popover > header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--line);
}
.entity360-ipa-help-popover > header span {
  display: block;
  color: var(--e360-blue-2);
  font-size: 8px;
  font-weight: 750;
  letter-spacing: .12em;
  text-transform: uppercase;
}
.entity360-ipa-help-popover > header h3 {
  margin: 3px 0 0;
  color: var(--ink);
  font-size: 15px;
  line-height: 1.25;
  letter-spacing: -.02em;
}
.entity360-ipa-help-popover > header em {
  flex: 0 0 auto;
  padding: 3px 6px;
  border: 1px solid var(--line);
  border-radius: 999px;
  color: var(--ink-4);
  font-family: var(--mono);
  font-size: 8px;
  font-style: normal;
}
.entity360-ipa-help-lede {
  margin: 12px 0;
  color: var(--ink-2);
  font-size: 11px;
  line-height: 1.55;
}
.entity360-ipa-help-lede > strong { color: var(--ink); font-family: var(--mono); font-size: 14px; }
.entity360-ipa-help-lede b { color: var(--ink); }
.entity360-ipa-formula {
  display: grid;
  gap: 4px;
  padding: 9px 10px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--bg-panel-2);
}
.entity360-ipa-formula > span { color: var(--ink-4); font-size: 8.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .09em; }
.entity360-ipa-formula code { color: var(--ink); font-family: var(--mono); font-size: 12px; }
.entity360-ipa-formula small { color: var(--ink-4); font-size: 9px; line-height: 1.45; }
.entity360-ipa-groups {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
  margin-top: 10px;
}
.entity360-ipa-groups > div:not(.entity360-ipa-empty) {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 2px 8px;
  padding: 8px 9px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg-panel-2) 94%, var(--e360-blue) 6%);
}
.entity360-ipa-groups span { min-width: 0; color: var(--ink-3); font-size: 9px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.entity360-ipa-groups strong { color: var(--ink); font-family: var(--mono); font-size: 14px; }
.entity360-ipa-groups small { grid-column: 1 / -1; color: var(--ink-4); font-size: 8px; }
.entity360-ipa-empty { grid-column: 1 / -1; padding: 8px 0; color: var(--ink-4); font-size: 9px; }
.entity360-ipa-marks {
  display: grid;
  gap: 4px;
  margin-top: 11px;
  padding-top: 10px;
  border-top: 1px solid var(--line-soft);
}
.entity360-ipa-marks > span { color: var(--ink-4); font-size: 8.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; }
.entity360-ipa-marks > div { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
.entity360-ipa-marks strong { min-width: 0; color: var(--ink-2); font-size: 9.5px; font-weight: 620; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.entity360-ipa-marks em { flex: 0 0 auto; color: var(--ink-3); font-family: var(--mono); font-size: 9px; font-style: normal; }
.entity360-ipa-press {
  margin-top: 11px;
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg-panel-2) 96%, var(--e360-blue) 4%);
}
.entity360-ipa-press[data-active='true'] { border-color: color-mix(in srgb, var(--sig-high) 36%, var(--line)); }
.entity360-ipa-section-title { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.entity360-ipa-section-title strong { color: var(--ink); font-size: 10.5px; }
.entity360-ipa-section-title span { color: var(--ink-3); font-family: var(--mono); font-size: 9px; }
.entity360-ipa-press p { margin: 7px 0 0; color: var(--ink-3); font-size: 9.5px; line-height: 1.55; }
.entity360-ipa-press p strong { color: var(--ink-2); }
.entity360-ipa-press-evidence { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 8px; }
.entity360-ipa-press-evidence > span { padding: 3px 6px; border: 1px solid var(--line); border-radius: 999px; color: var(--ink-3); font-size: 8px; }
.entity360-ipa-press-evidence > small { flex: 0 0 100%; margin-top: 2px; color: var(--ink-4); font-size: 8.5px; line-height: 1.4; }
.entity360-ipa-help-popover > footer { margin-top: 11px; padding-top: 9px; border-top: 1px solid var(--line); color: var(--ink-4); font-size: 8.5px; line-height: 1.45; }
.entity360-ipa-help-popover > footer strong { color: var(--ink-3); font-family: var(--mono); }

@media (max-width: 760px) {
  .entity360-ipa-help-popover {
    position: fixed;
    top: 72px;
    left: 12px;
    right: 12px;
    width: auto;
    max-height: calc(100vh - 96px);
  }
  .entity360-ipa-help-popover::before { display: none; }
  .entity360-ipa-groups { grid-template-columns: 1fr; }
}
'''
    CSS.write_text(css)

print('IPA3 press popup patch applied')
