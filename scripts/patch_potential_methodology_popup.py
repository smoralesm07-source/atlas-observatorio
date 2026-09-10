from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TSX = ROOT / "src/views/universo/CasosAxis.tsx"
CSS = ROOT / "src/styles/universo-so-management.css"

old_queue = '''        <button data-on={queue === 'potenciales'} onClick={() => changeQueue('potenciales')}>
          <span>Potenciales SO</span>
          <b className="num">{potentialLoading && !potential ? '…' : n(potentialCount)}</b>
          <em>Muestra operativa priorizada · {n(potential?.totales?.detectados ?? potential?.totales?.observadas ?? 0)} detectados</em>
        </button>'''

new_queue = '''        <div className="uso-queue-with-help">
          <button className="uso-queue-main" data-on={queue === 'potenciales'} onClick={() => changeQueue('potenciales')}>
            <span>Potenciales SO</span>
            <b className="num">{potentialLoading && !potential ? '…' : n(potentialCount)}</b>
            <em>Muestra operativa priorizada · {n(potential?.totales?.detectados ?? potential?.totales?.observadas ?? 0)} detectados</em>
          </button>
          <details className="uso-potential-help">
            <summary aria-label="Ayuda metodológica sobre Potenciales SO" title="Cómo se selecciona la muestra de Potenciales SO">?</summary>
            <div className="uso-potential-help-popover" role="note">
              <div className="uso-potential-help-head">
                <div>
                  <span className="uso-kicker">Ayuda metodológica</span>
                  <h3>Cómo se construye la muestra de Potenciales SO</h3>
                </div>
                <em>{potential?.metodologia?.version ?? 'GESTION_SO_SAMPLE_1.0'}</em>
              </div>

              <p className="uso-potential-help-lede">
                Atlas parte de un <strong>universo amplio de detección</strong>: RUT activos publicados por el SII que presentan al menos una actividad económica coincidente con actividades observadas en sectores sujetos a obligación UAF y que, por RUT exacto, no aparecen en el padrón UAF del corte vigente. Esa coincidencia es una <strong>señal para revisar</strong>, no una conclusión de que exista obligación de inscripción o incumplimiento.
              </p>

              <div className="uso-potential-help-metrics" aria-label="Cifras del corte metodológico">
                <span><b className="num">{n(potential?.totales?.detectados ?? potential?.totales?.observadas ?? 0)}</b><em>RUT detectados</em></span>
                <span><b className="num">{n(potential?.totales?.evidencia_2_mas ?? 0)}</b><em>con 2+ actividades coincidentes</em></span>
                <span><b className="num">{n(potential?.totales?.evidencia_3_mas ?? 0)}</b><em>con 3+ actividades coincidentes</em></span>
                <span><b className="num">{n(potential?.totales?.con_res ?? 0)}</b><em>con respaldo RES</em></span>
                <span><b className="num">{n(potential?.totales?.muestra_gestion ?? potential?.totales?.accionables ?? 0)}</b><em>en muestra de Gestión SO</em></span>
              </div>

              <div className="uso-potential-help-section">
                <h4>¿Por qué no se envían todos a Gestión SO?</h4>
                <p>
                  El screening privilegia cobertura y puede incluir actividades que también desarrollan entidades que no son sujetos obligados. Revisar el universo completo no sería una carga humana razonable. Por eso Gestión SO trabaja una <strong>muestra operativa estratificada</strong> que reduce volumen sin concentrar todo el trabajo en los sectores más numerosos.
                </p>
              </div>

              <div className="uso-potential-help-section">
                <h4>Regla de selección reproducible</h4>
                <ol>
                  <li><strong>Fuerza de coincidencia:</strong> se priorizan RUT con mayor número de actividades coincidentes.</li>
                  <li><strong>Existencia verificable:</strong> a igualdad de evidencia, se prioriza presencia en el Registro de Empresas y Sociedades (RES).</li>
                  <li><strong>Contexto territorial:</strong> después se privilegia disponer de comuna/región observable para facilitar revisión.</li>
                  <li><strong>IVO sólo cuando existe:</strong> el índice se usa como desempate complementario; no se imputa ni se calcula artificialmente para completar la muestra.</li>
                  <li><strong>Desempate determinístico:</strong> el RUT fija el orden final para que el resultado pueda reproducirse.</li>
                </ol>
                <p>
                  Con ese orden se toman <strong>hasta 25 RUT por cada sector UAF sugerido</strong> y se agregan los <strong>250 primeros a nivel nacional</strong>. Luego se eliminan duplicados por RUT. El tamaño final puede cambiar en cada actualización según la composición del universo.
                </p>
              </div>

              <div className="uso-potential-help-section uso-potential-help-meaning">
                <h4>Cómo interpretar la muestra</h4>
                <p><strong>Estar seleccionado</strong> significa que el RUT quedó relativamente mejor posicionado para revisión dentro del corte vigente. <strong>No estar seleccionado</strong> no elimina la entidad del universo potencial: permanece detectada y puede entrar a Gestión SO en futuras actualizaciones si cambian sus antecedentes o la composición del universo.</p>
              </div>

              <div className="uso-potential-help-warning">
                <strong>No interpretar esta muestra como:</strong>
                <span>muestra estadísticamente representativa</span>
                <span>estimación del número de incumplidores</span>
                <span>probabilidad de obligación jurídica</span>
                <span>indicador de riesgo LA/FT</span>
              </div>

              <footer>
                Corte SII {potential?.corte?.sii_periodo ?? '—'} · padrón UAF {potential?.corte?.uaf_corte ?? '—'} · actualización automática del universo y de la muestra.
              </footer>
            </div>
          </details>
        </div>'''

old_details = '''          {potential.metodologia && (
            <details className="uso-method-help">
              <summary>¿Por qué Gestión SO trabaja una muestra y cómo se selecciona?</summary>
              <div>
                <p><strong>Objetivo.</strong> {potential.metodologia.objetivo}</p>
                <p><strong>Universo de partida.</strong> {potential.metodologia.universo}</p>
                <p><strong>Regla de selección.</strong> {potential.metodologia.regla}</p>
                <p><strong>Orden de prioridad.</strong> {potential.metodologia.orden}</p>
                <p><strong>Límite metodológico.</strong> {potential.metodologia.no_es}</p>
                <em>Versión {potential.metodologia.version}</em>
              </div>
            </details>
          )}
'''

text = TSX.read_text()
if 'className="uso-queue-with-help"' not in text:
    if old_queue not in text:
        raise SystemExit('No se encontró el bloque Potenciales SO esperado')
    text = text.replace(old_queue, new_queue, 1)

if old_details in text:
    text = text.replace(old_details, '', 1)

TSX.write_text(text)

marker = '/* ayuda metodológica contextual · Potenciales SO */'
css = CSS.read_text()
if marker not in css:
    css += r'''

/* ayuda metodológica contextual · Potenciales SO */
.uso-mode-casos .uso-queue-with-help {
  position: relative;
  min-width: 0;
}

.uso-mode-casos .uso-queue-with-help > .uso-queue-main {
  width: 100%;
  height: 100%;
  padding-right: 44px;
}

.uso-mode-casos .uso-potential-help {
  position: static;
}

.uso-mode-casos .uso-potential-help > summary {
  position: absolute;
  top: 9px;
  right: 10px;
  z-index: 3;
  display: grid;
  place-items: center;
  width: 25px;
  height: 25px;
  min-height: 25px !important;
  padding: 0 !important;
  border: 1px solid color-mix(in srgb, var(--accent) 42%, var(--line));
  border-radius: 50%;
  background: color-mix(in srgb, var(--accent) 9%, var(--bg-panel-2));
  color: var(--accent);
  font-size: 12px;
  font-weight: 800;
  line-height: 1;
  text-align: center;
  cursor: help;
  list-style: none;
  box-shadow: none;
}

.uso-mode-casos .uso-potential-help > summary::-webkit-details-marker { display: none; }
.uso-mode-casos .uso-potential-help > summary:hover,
.uso-mode-casos .uso-potential-help[open] > summary {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 16%, var(--bg-panel-2));
  color: var(--ink);
}

.uso-mode-casos .uso-potential-help-popover {
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  z-index: 70;
  width: min(640px, calc(100vw - 42px));
  max-height: min(74vh, 720px);
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 18px 20px 16px;
  border: 1px solid color-mix(in srgb, var(--accent) 38%, var(--line-strong));
  border-radius: 12px;
  background: color-mix(in srgb, var(--bg-panel) 97%, var(--accent));
  box-shadow: 0 24px 70px rgba(0, 0, 0, .42);
  color: var(--ink-2);
}

.uso-mode-casos .uso-potential-help-popover::before {
  content: '';
  position: absolute;
  top: -6px;
  left: 18px;
  width: 10px;
  height: 10px;
  transform: rotate(45deg);
  border-top: 1px solid color-mix(in srgb, var(--accent) 38%, var(--line-strong));
  border-left: 1px solid color-mix(in srgb, var(--accent) 38%, var(--line-strong));
  background: var(--bg-panel);
}

.uso-mode-casos .uso-potential-help-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--line);
}

.uso-mode-casos .uso-potential-help-head h3 {
  margin: 4px 0 0;
  color: var(--ink);
  font-size: 16px;
  line-height: 1.25;
  letter-spacing: -.02em;
}

.uso-mode-casos .uso-potential-help-head > em {
  flex: 0 0 auto;
  padding: 4px 7px;
  border: 1px solid var(--line);
  border-radius: 999px;
  color: var(--ink-4);
  font-family: var(--mono);
  font-size: 8px;
  font-style: normal;
}

.uso-mode-casos .uso-potential-help-lede {
  margin: 14px 0;
  font-size: 11.5px;
  line-height: 1.68;
  color: var(--ink-2);
}

.uso-mode-casos .uso-potential-help-lede strong,
.uso-mode-casos .uso-potential-help-section strong,
.uso-mode-casos .uso-potential-help-warning strong {
  color: var(--ink);
}

.uso-mode-casos .uso-potential-help-metrics {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 6px;
  margin: 0 0 15px;
}

.uso-mode-casos .uso-potential-help-metrics > span {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  padding: 8px 9px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--bg-panel-2);
}

.uso-mode-casos .uso-potential-help-metrics b {
  color: var(--ink);
  font-size: 15px;
}

.uso-mode-casos .uso-potential-help-metrics em {
  color: var(--ink-4);
  font-size: 8.5px;
  font-style: normal;
  line-height: 1.3;
}

.uso-mode-casos .uso-potential-help-section {
  padding: 12px 0;
  border-top: 1px solid var(--line-soft);
}

.uso-mode-casos .uso-potential-help-section h4 {
  margin: 0 0 6px;
  color: var(--ink);
  font-size: 11.5px;
  font-weight: 720;
}

.uso-mode-casos .uso-potential-help-section p,
.uso-mode-casos .uso-potential-help-section li {
  margin: 0;
  font-size: 10.5px;
  line-height: 1.62;
  color: var(--ink-3);
}

.uso-mode-casos .uso-potential-help-section ol {
  margin: 7px 0 9px;
  padding-left: 20px;
}

.uso-mode-casos .uso-potential-help-section li + li { margin-top: 4px; }

.uso-mode-casos .uso-potential-help-warning {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 4px;
  padding: 11px 12px;
  border: 1px solid color-mix(in srgb, var(--sig-high) 30%, var(--line));
  border-radius: 8px;
  background: color-mix(in srgb, var(--sig-high) 6%, var(--bg-panel-2));
}

.uso-mode-casos .uso-potential-help-warning strong {
  flex: 0 0 100%;
  margin-bottom: 2px;
  font-size: 10.5px;
}

.uso-mode-casos .uso-potential-help-warning span {
  padding: 3px 6px;
  border: 1px solid var(--line);
  border-radius: 999px;
  color: var(--ink-3);
  font-size: 8.5px;
}

.uso-mode-casos .uso-potential-help-popover footer {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--line);
  color: var(--ink-4);
  font-size: 9px;
  line-height: 1.5;
}

@media (max-width: 760px) {
  .uso-mode-casos .uso-potential-help-popover {
    position: fixed;
    top: 72px;
    right: 12px;
    bottom: 12px;
    left: 12px;
    width: auto;
    max-height: none;
  }

  .uso-mode-casos .uso-potential-help-popover::before { display: none; }
  .uso-mode-casos .uso-potential-help-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
'''
    CSS.write_text(css)

print('Ayuda metodológica Potenciales SO aplicada')
