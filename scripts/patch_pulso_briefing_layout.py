from pathlib import Path
import re

VIEW = Path('src/views/Pulso.tsx')
CSS = Path('src/styles/pulso.css')

text = VIEW.read_text(encoding='utf-8')

pattern = re.compile(
    r"      /\* ── 3\. Lectura del corte .*?\*/\n"
    r".*?"
    r"      /\* ── 5\. Cruces relevantes, sin compras públicas .*?\*/",
    re.S,
)

replacement = r'''      {/* ── 3. Lectura del corte + panorama reorganizado ─────────────── */}
      <section className="pulse-briefing">
        <div className="pulse-briefing-head">
          <div>
            <h2>La lectura del corte</h2>
            <p>Una síntesis del corte junto a las dos distribuciones que mejor lo contextualizan.</p>
          </div>
          <span>{data.snapshot ? fecha(data.snapshot.published_at ?? data.snapshot.generated_at) : 'corte vigente'}</span>
        </div>

        <div className="pulse-briefing-top">
          <div className="pulse-briefing-insight" aria-label="Lectura principal del corte">
            <div className="pulse-summary-grid">
              {scr?.disponible && scr.corte && (
                <button
                  className="pulse-summary-item pulse-summary-primary"
                  style={{ ['--summary-tone' as string]: 'var(--sig-high)' }}
                  onClick={() => onNavigate(hrefFor({ view: 'cobertura' }))}
                >
                  <span className="pulse-summary-figure">{n(scr.corte.universo_declarado)}</span>
                  <span className="pulse-summary-title">Universo observable fuera del padrón</span>
                  <span className="pulse-summary-copy">
                    Equivale a {n1(scr.corte.universo_declarado / Math.max(1, u.total))} veces el padrón; un giro alcanzado no prueba obligación de inscripción.
                  </span>
                  <span className="pulse-summary-go">Abrir Cobertura →</span>
                </button>
              )}

              {lectura.map((r) => (
                <button
                  key={r.orden}
                  className="pulse-summary-item"
                  style={{ ['--summary-tone' as string]: tono(r.tono) }}
                  onClick={r.destino ? () => elegir(r.destino as UafLens) : undefined}
                  disabled={!r.destino}
                >
                  <span className="pulse-summary-figure">{r.cifra}</span>
                  <span className="pulse-summary-title">{r.titulo}</span>
                  <span className="pulse-summary-copy">{r.glosa}</span>
                  {r.destino && <span className="pulse-summary-go">Profundizar →</span>}
                </button>
              ))}

              {!lectura.length && !(scr?.disponible && scr.corte) && (
                <div className="pulse-mini-empty">Sin lectura curada publicada para este corte.</div>
              )}
            </div>
          </div>

          <MiniPanel title="Distribución por estado" action="Ciclo →" onAction={() => elegir('ciclo')}>
            <div className="pulse-status-total">{n(u.total)}</div>
            <div className="pulse-status-track" aria-label="Distribución del padrón por estado ante el SII">
              {status.map((s) => (
                <span
                  key={s.key}
                  className="pulse-status-segment"
                  data-state={s.key}
                  style={{ width: `${share(s.value, u.total)}%` }}
                  title={`${s.label}: ${n(s.value)}`}
                >
                  {share(s.value, u.total) >= 8 ? `${n1(share(s.value, u.total))}%` : ''}
                </span>
              ))}
            </div>
            <div className="pulse-status-legend">
              {status.map((s) => (
                <button
                  key={s.key}
                  onClick={() => open({ cohort: s.cohort, title: s.label === 'Activos' ? 'Sujetos activos ante el SII' : s.label === 'Término de giro' ? 'Sujetos con término de giro' : 'Sujetos sin perfil SII de persona jurídica' })}
                >
                  <i style={{ background: s.tone }} />
                  <span>{s.label}</span>
                  <b>{n(s.value)}</b>
                </button>
              ))}
            </div>
          </MiniPanel>

          <MiniPanel title="Distribución territorial" action="Territorio →" onAction={() => elegir('territorio')}>
            <div className="pulse-rank-list">
              {topRegions.map((r) => (
                <button
                  key={r.region}
                  className="pulse-rank-row"
                  onClick={() => open({ cohort: 'REGION', value: r.region, title: `Sujetos obligados en ${r.region}` })}
                  title={r.region}
                >
                  <span className="pulse-rank-name">{r.region}</span>
                  <span className="pulse-rank-track"><i style={{ width: `${(r.sujetos / maxRegion) * 100}%` }} /></span>
                  <span className="pulse-rank-value num">{n(r.sujetos)}</span>
                </button>
              ))}
            </div>
            <p className="pulse-mini-note">{n(u.con_territorio)} sujetos con territorio observado.</p>
          </MiniPanel>
        </div>

        <div className="pulse-briefing-bottom">
          <MiniPanel title="Evolución publicada del padrón" action="Serie →" onAction={() => elegir('reportabilidad')}>
            {trendPoints.length > 1 ? (
              <>
                <MiniLine points={trendPoints} />
                <p className="pulse-mini-note">
                  Serie del Informe Estadístico UAF; no reconstruye altas y bajas del registro operativo.
                </p>
              </>
            ) : <div className="pulse-mini-empty">Sin serie histórica publicada en este corte.</div>}
          </MiniPanel>

          <MiniPanel title="Top 5 sectores" meta="por nº de sujetos" action="Ver análisis →" onAction={() => elegir('ciclo')}>
            <div className="pulse-rank-list">
              {topSectors.map((s) => (
                <button
                  key={s.sector}
                  className="pulse-rank-row"
                  onClick={() => open({ cohort: 'SECTOR', value: s.sector, title: s.sector })}
                  title={titleCase(s.sector)}
                >
                  <span className="pulse-rank-name">{titleCase(s.sector)}</span>
                  <span className="pulse-rank-track"><i style={{ width: `${(s.sujetos / maxSector) * 100}%` }} /></span>
                  <span className="pulse-rank-value num">{n(s.sujetos)}</span>
                </button>
              ))}
            </div>
            <p className="pulse-mini-note">Selecciona un sector para abrir sus sujetos.</p>
          </MiniPanel>
        </div>
      </section>

      {/* ── 5. Cruces relevantes, sin compras públicas ───────────────── */}'''

text, count = pattern.subn(replacement, text, count=1)
if count != 1:
    raise SystemExit(f'No se pudo reemplazar el bloque de briefing de Pulso (reemplazos={count})')

VIEW.write_text(text, encoding='utf-8')

css = CSS.read_text(encoding='utf-8')
marker = '/* ── briefing reorganizado: lectura + contexto en una sola retícula ── */'
if marker not in css:
    css += r'''

/* ── briefing reorganizado: lectura + contexto en una sola retícula ── */
.pulse-briefing {
  margin-bottom: 9px;
}

.pulse-briefing-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  margin-bottom: 8px;
  padding: 9px 12px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--bg-panel);
}

.pulse-briefing-head h2 {
  margin: 0;
  font-size: 11px;
  font-weight: 680;
  color: var(--ink-2);
}

.pulse-briefing-head p {
  margin: 2px 0 0;
  font-size: 8.9px;
  line-height: 1.35;
  color: var(--ink-4);
}

.pulse-briefing-head > span {
  flex-shrink: 0;
  padding-top: 1px;
  font-family: var(--mono);
  font-size: 8.8px;
  color: var(--ink-4);
}

.pulse-briefing-top {
  display: grid;
  grid-template-columns: minmax(0, 1.12fr) minmax(0, .98fr) minmax(0, 1fr);
  gap: 8px;
  align-items: stretch;
  margin-bottom: 8px;
}

.pulse-briefing-bottom {
  display: grid;
  grid-template-columns: minmax(0, 1.08fr) minmax(0, 1fr);
  gap: 8px;
  align-items: stretch;
}

.pulse-briefing-top > .pulse-mini-panel,
.pulse-briefing-bottom > .pulse-mini-panel,
.pulse-briefing-insight {
  min-height: 188px;
  height: 100%;
}

.pulse-briefing-bottom > .pulse-mini-panel {
  min-height: 202px;
}

.pulse-briefing-insight {
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 10px;
  background:
    radial-gradient(420px 160px at 0% 0%, color-mix(in srgb, var(--sig-high) 7%, transparent), transparent 72%),
    var(--bg-panel);
}

.pulse-briefing-insight .pulse-summary-grid {
  display: flex;
  height: 100%;
  gap: 0;
  overflow-x: auto;
  scroll-snap-type: x proximity;
  scrollbar-width: thin;
}

.pulse-briefing-insight .pulse-summary-item {
  flex: 0 0 100%;
  scroll-snap-align: start;
  min-height: 188px;
  padding: 18px 20px;
  border: 0;
  border-radius: 0;
  background: transparent;
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: auto auto auto auto;
  align-content: center;
  row-gap: 7px;
}

.pulse-briefing-insight button.pulse-summary-item:hover {
  background: color-mix(in srgb, var(--summary-tone, var(--accent)) 4%, transparent);
}

.pulse-briefing-insight .pulse-summary-figure {
  grid-row: auto;
  min-width: 0;
  font-size: clamp(28px, 2.35vw, 40px);
  line-height: 1;
}

.pulse-briefing-insight .pulse-summary-title {
  font-size: 11.6px;
  line-height: 1.3;
}

.pulse-briefing-insight .pulse-summary-copy {
  max-width: 52ch;
  font-size: 9.6px;
  line-height: 1.5;
}

.pulse-briefing-insight .pulse-summary-go {
  margin-top: 1px;
  font-size: 9.2px;
}

.pulse-briefing-insight .pulse-mini-empty {
  flex: 1 0 100%;
  min-height: 188px;
}

.pulse-briefing-bottom .pulse-trend-svg {
  height: 136px;
}

.pulse-briefing-bottom .pulse-rank-row {
  grid-template-columns: minmax(180px, .9fr) minmax(130px, 1.3fr) 46px;
  gap: 9px;
  padding: 3px 0;
}

.pulse-briefing-bottom .pulse-rank-name {
  font-size: 9.8px;
}

.pulse-briefing-bottom .pulse-rank-track {
  height: 10px;
}

.pulse-briefing-top .pulse-rank-row {
  grid-template-columns: minmax(0, 1.15fr) minmax(74px, .85fr) 40px;
}

@media (max-width: 1280px) {
  .pulse-briefing-top { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
  .pulse-briefing-insight { grid-column: 1 / -1; min-height: 150px; }
  .pulse-briefing-insight .pulse-summary-item,
  .pulse-briefing-insight .pulse-mini-empty { min-height: 150px; }
  .pulse-briefing-bottom { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
}

@media (max-width: 760px) {
  .pulse-briefing-head { align-items: flex-start; }
  .pulse-briefing-head p { display: none; }
  .pulse-briefing-top,
  .pulse-briefing-bottom { grid-template-columns: minmax(0, 1fr); }
  .pulse-briefing-insight { grid-column: auto; }
  .pulse-briefing-bottom .pulse-rank-row {
    grid-template-columns: minmax(0, 1fr) minmax(72px, .8fr) 42px;
  }
}
'''
    CSS.write_text(css, encoding='utf-8')
