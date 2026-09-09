from pathlib import Path

TSX = Path('src/views/Territorio.tsx')
CSS = Path('src/styles/territorio-map.css')


def replace_once(text: str, old: str, new: str, label: str) -> str:
    n = text.count(old)
    if n != 1:
        raise SystemExit(f'{label}: expected 1 match, got {n}')
    return text.replace(old, new, 1)


text = TSX.read_text(encoding='utf-8')

text = replace_once(text,
"const INSULARES = ['05201', '05104'];\n\nexport function Territorio",
"""const INSULARES = ['05201', '05104'];

interface TerritoryIgrComparisonRow {
  territory_id: string;
  region_code: string | null;
  region_name: string;
  commune_code: string | null;
  commune_name: string;
  vigente_score: number;
  candidate_score: number;
  score_delta: number;
  vigente_level: string | null;
  candidate_level: string | null;
  candidate_level_status: 'comparison_only';
  vigente_rank: number;
  candidate_rank: number;
  rank_delta: number;
  vigente_methodological_coverage: number | null;
  candidate_methodological_coverage: number | null;
  candidate_confidence: number | null;
  candidate_confidence_level: string | null;
  confidence_components: {
    thematic_coverage?: number;
    temporal_coverage?: number;
    source_quality?: number;
    stability?: number;
    denominator_reliability?: number;
  };
  stability_sd: number | null;
  population: number | null;
  population_coverage: number | null;
}

interface TerritoryIgrComparison {
  contract: 'ATLAS_OBS_TERRITORY_IGR_COMPARE_V1';
  status: 'EXPERIMENTAL';
  production_replaced: false;
  summary: {
    comunas: number;
    candidate_version: string | null;
    base_score_version: string | null;
    cobertura_vigente_media: number | null;
    cobertura_candidate_media: number | null;
    confianza_candidate_media: number | null;
    confianza_candidate_min: number | null;
    confianza_candidate_max: number | null;
    confianza_alta: number;
    confianza_media: number;
    confianza_baja: number;
    cambios_nivel_comparativo: number;
    correlacion_score: number | null;
    correlacion_ranking: number | null;
    sesgo_poblacion_vigente: number | null;
    sesgo_poblacion_candidate: number | null;
    refreshed_at: string | null;
  };
  rows: TerritoryIgrComparisonRow[];
  semantics: string;
}

export function Territorio""", 'comparison types')

text = replace_once(text,
"  const { data, error, loading, reload } = useRpc<TerritoryMap>('obs_territory_map', {});",
"""  const { data, error, loading, reload } = useRpc<TerritoryMap>('obs_territory_map', {});
  const { data: igrCompare } = useRpc<TerritoryIgrComparison>('obs_territory_igr_comparison', {});""", 'comparison rpc')

text = replace_once(text,
"""  const porNivel = useMemo(() => {
    const m = new Map<string, number>();
    comunas.forEach((c) => {
      if (!c.igr_level) return;
      m.set(c.igr_level, (m.get(c.igr_level) ?? 0) + 1);
    });
    return m;
  }, [comunas]);

  if (commune) {
    return <ComunaDetalle territoryId={commune} onBack={() => setCommune(null)} onNavigate={onNavigate} />;
  }""",
"""  const porNivel = useMemo(() => {
    const m = new Map<string, number>();
    comunas.forEach((c) => {
      if (!c.igr_level) return;
      m.set(c.igr_level, (m.get(c.igr_level) ?? 0) + 1);
    });
    return m;
  }, [comunas]);
  const candidateById = useMemo(
    () => new Map((igrCompare?.rows ?? []).map((r) => [r.territory_id, r])),
    [igrCompare],
  );
  const largestCandidateMoves = useMemo(
    () => [...(igrCompare?.rows ?? [])]
      .sort((a, b) => Math.abs(b.score_delta) - Math.abs(a.score_delta))
      .slice(0, 10),
    [igrCompare],
  );

  if (commune) {
    return (
      <ComunaDetalle
        territoryId={commune}
        candidate={candidateById.get(commune) ?? null}
        onBack={() => setCommune(null)}
        onNavigate={onNavigate}
      />
    );
  }""", 'comparison memos')

text = replace_once(text,
"""  const m = data.metodologia;
  const cob = data.cobertura;""",
"""  const m = data.metodologia;
  const cob = data.cobertura as TerritoryMap['cobertura'] & {
    cobertura_metodologica_media?: number | null;
    cobertura_incompleta?: number;
  };
  const cmp = igrCompare?.summary;""", 'coverage cast')

text = replace_once(text,
"""            <strong>IGR y confianza CEAD</strong>
            <span>
              IGR = amenaza territorial comunal · Confianza CEAD = solidez del dato delictual para interpretar ese resultado.
            </span>""",
"""            <strong>IGR · cobertura y confianza</strong>
            <span>
              IGR = amenaza territorial comunal · 86% vigente = cobertura metodológica · confianza v1.1 = evaluación experimental de solidez.
            </span>""", 'method summary')

text = replace_once(text,
"""                Un valor alto orienta dónde existe mayor amenaza territorial observada para LA. La confianza CEAD
                acompaña esa lectura como medida de cobertura y consistencia del dato: una confianza baja exige
                cautela y nunca debe interpretarse como menor amenaza.""",
"""                Un valor alto orienta dónde existe mayor amenaza territorial observada para LA. En el IGR vigente,
                el 86% que antes se mostraba como “confianza” es en realidad <strong>cobertura metodológica</strong>:
                indica cuánto del catálogo previsto está materializado y no diferencia por sí solo a una comuna de otra.""", 'essential reading')

text = replace_once(text,
"""            <section className="territory-method-card">
              <span className="territory-method-kicker">4 · Confianza CEAD</span>
              <p>
                Es un <strong>calificador de la evidencia territorial</strong>, no un componente de riesgo.
                Resume cuánta cobertura y consistencia tiene el dato delictual disponible para la comuna y se
                publica separado del score.
              </p>
              <div className="territory-method-callout">
                Confianza baja → interpretar el IGR con mayor cautela y buscar corroboración adicional.
              </div>
            </section>""",
"""            <section className="territory-method-card">
              <span className="territory-method-kicker">4 · Cobertura metodológica vigente</span>
              <p>
                El <strong>86%</strong> actual se obtiene por disponibilidad de capas y componentes. Es útil para
                advertir que el catálogo está incompleto, pero como hoy es igual para las 345 comunas
                <strong> no debe usarse para ordenarlas ni para expresar certeza estadística</strong>.
              </p>
              <div className="territory-method-callout">
                Cobertura ≠ confianza. Ausencia de una familia de datos tampoco equivale a menor amenaza.
              </div>
            </section>""", 'coverage methodology')

text = replace_once(text,
"""            <section className="territory-method-card">
              <span className="territory-method-kicker">5 · Agregado regional</span>
              <div className="territory-method-equation mono">
                IGR región = Σ(IGR comuna × confianza) / Σ(confianza)
              </div>
              <p>
                La vista regional usa una media comunal ponderada por confianza CEAD. Así, una comuna con menor
                cobertura pesa menos en el agregado y no arrastra artificialmente la lectura de su región.
              </p>
            </section>""",
"""            <section className="territory-method-card">
              <span className="territory-method-kicker">5 · Agregado regional</span>
              <div className="territory-method-equation mono">
                IGR región = Σ IGR comuna / n comunas
              </div>
              <p>
                El agregado regional usa ahora <strong>media comunal simple</strong>. La cobertura se informa por
                separado: reducir el peso de una comuna por saber menos de ella podría ocultar justamente un territorio
                donde la evidencia es más débil.
              </p>
            </section>""", 'regional aggregation')

text = replace_once(text,
"""            <section className="territory-method-card territory-method-card-wide">
              <span className="territory-method-kicker">7 · Regla práctica para discriminar</span>
              <div className="territory-read-grid">
                <div>
                  <strong>IGR alto + confianza alta</strong>
                  <span>Lectura territorial más robusta: prioriza revisión del territorio.</span>
                </div>
                <div>
                  <strong>IGR alto + confianza baja</strong>
                  <span>Señal relevante, pero exige corroborar antes de concluir.</span>
                </div>
                <div>
                  <strong>IGR bajo + confianza alta</strong>
                  <span>Menor amenaza observada en las familias efectivamente medidas.</span>
                </div>
                <div>
                  <strong>IGR bajo + confianza baja</strong>
                  <span>No permite concluir baja amenaza: la lectura es débil por cobertura.</span>
                </div>
              </div>
              <p className="territory-method-muted">
                Esta matriz es una guía de interpretación analítica, no un nuevo umbral ni una regla automática de clasificación.
              </p>
            </section>""",
"""            <section className="territory-method-card territory-method-card-wide">
              <span className="territory-method-kicker">7 · Qué puede discriminar el analista hoy</span>
              <div className="territory-read-grid">
                <div>
                  <strong>IGR</strong>
                  <span>Sí discrimina amenaza observada entre comunas y mantiene la lectura oficial vigente.</span>
                </div>
                <div>
                  <strong>Cobertura metodológica · 86%</strong>
                  <span>No discrimina comunas: documenta un límite común del catálogo actualmente materializado.</span>
                </div>
                <div>
                  <strong>Confianza v1.1 · experimental</strong>
                  <span>Varía por comuna según cobertura temática/temporal, fuente, estabilidad y denominador.</span>
                </div>
                <div>
                  <strong>Nivel v1.1</strong>
                  <span>Se conserva sólo para comparar. Sus cortes deben recalibrarse antes de cualquier promoción.</span>
                </div>
              </div>
              <p className="territory-method-muted">
                La confianza experimental nunca modifica el score ni transforma menor evidencia en menor amenaza.
              </p>
            </section>

            {cmp && cmp.comunas > 0 && (
              <section className="territory-method-card territory-method-card-wide">
                <span className="territory-method-kicker">8 · Evaluación experimental v1.1</span>
                <div className="territory-candidate-method-grid">
                  <div><span>Confianza media</span><strong>{n1(cmp.confianza_candidate_media)}%</strong><small>{n1(cmp.confianza_candidate_min)}–{n1(cmp.confianza_candidate_max)}</small></div>
                  <div><span>Correlación ranking</span><strong>{n1((cmp.correlacion_ranking ?? 0) * 100)}%</strong><small>respecto del IGR vigente</small></div>
                  <div><span>Sesgo población</span><strong>{n1(cmp.sesgo_poblacion_candidate)}</strong><small>vigente {n1(cmp.sesgo_poblacion_vigente)}</small></div>
                  <div><span>Cambios de nivel</span><strong>{n(cmp.cambios_nivel_comparativo)}</strong><small>sólo comparación; cortes no promovidos</small></div>
                </div>
                <p>
                  El candidato reemplaza la anomalía transversal por <strong>anomalía temporal</strong>, combina
                  volumen y tasa por 100 mil con contracción del peso de tasa en comunas pequeñas, y calcula una
                  confianza comunal separada del IGR. <strong>El mapa y el ranking oficial siguen usando v1.0.</strong>
                </p>
              </section>
            )}""", 'candidate methodology')

text = replace_once(text,
"""      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <Stat label="Comunas evaluadas" value={n(cob.comunas)} foot={`año ${cob.anio ?? '—'}`} />
        <Stat
          label="Con universo observado"
          value={n(cob.con_universo)}
          foot={`${n(cob.comunas - cob.con_universo)} sin entidades en el corte`}
        />
        <Stat
          label="Confianza CEAD media"
          value={cob.confianza_media == null ? '—' : `${n1(cob.confianza_media)}`}
          foot="se publica aparte del score"
        />
        <Stat
          label="Comunas de baja confianza"
          value={n(cob.baja_confianza)}
          foot="menor cobertura no es menor riesgo"
          tone={cob.baja_confianza > 0 ? 'var(--sig-high)' : undefined}
        />
      </div>""",
"""      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <Stat label="Comunas evaluadas" value={n(cob.comunas)} foot={`año ${cob.anio ?? '—'}`} />
        <Stat
          label="Con universo observado"
          value={n(cob.con_universo)}
          foot={`${n(cob.comunas - cob.con_universo)} sin entidades en el corte`}
        />
        <Stat
          label="Cobertura metodológica CEAD"
          value={(cob.cobertura_metodologica_media ?? cob.confianza_media) == null
            ? '—' : `${n1(cob.cobertura_metodologica_media ?? cob.confianza_media)}%`}
          foot="catálogo materializado · no es confianza"
        />
        {cmp && cmp.comunas > 0 ? (
          <Stat
            label="Confianza v1.1 · experimental"
            value={cmp.confianza_candidate_media == null ? '—' : `${n1(cmp.confianza_candidate_media)}%`}
            foot={`${n1(cmp.confianza_candidate_min)}–${n1(cmp.confianza_candidate_max)} · no altera el IGR vigente`}
          />
        ) : (
          <Stat
            label="Cobertura < 100%"
            value={n(cob.cobertura_incompleta ?? 0)}
            foot="límite común del catálogo actual"
          />
        )}
      </div>

      {igrCompare && cmp && cmp.comunas > 0 && (
        <details className="territory-candidate">
          <summary className="territory-candidate-summary">
            <div>
              <strong>Comparar IGR vigente vs candidato v1.1</strong>
              <span>Revisa cuánto cambia el ranking y por qué la nueva confianza sí discrimina entre comunas.</span>
            </div>
            <div className="territory-candidate-summary-actions">
              <span className="territory-candidate-badge">Experimental · mapa vigente intacto</span>
              <span className="territory-method-chevron" aria-hidden>⌄</span>
            </div>
          </summary>
          <div className="territory-candidate-body">
            <div className="territory-candidate-kpis">
              <div><span>Correlación score</span><strong>{n1((cmp.correlacion_score ?? 0) * 100)}%</strong></div>
              <div><span>Correlación ranking</span><strong>{n1((cmp.correlacion_ranking ?? 0) * 100)}%</strong></div>
              <div><span>Confianza candidata</span><strong>{n1(cmp.confianza_candidate_media)}%</strong><small>{n1(cmp.confianza_candidate_min)}–{n1(cmp.confianza_candidate_max)}</small></div>
              <div><span>Sesgo por tamaño</span><strong>{n1(cmp.sesgo_poblacion_candidate)}</strong><small>antes {n1(cmp.sesgo_poblacion_vigente)}</small></div>
            </div>
            <div className="territory-candidate-note">
              <strong>Qué cambió:</strong> anomalía temporal en vez de anomalía transversal; intensidad con volumen + tasa
              estabilizada; confianza separada en cinco dimensiones. Los {n(cmp.cambios_nivel_comparativo)} cambios de nivel
              se muestran sólo como diagnóstico: las bandas candidatas aún no están calibradas para promoción.
            </div>
            <div className="territory-candidate-table-title">Mayores movimientos de puntaje · muestra de diagnóstico</div>
            <div className="territory-candidate-table-wrap">
              <table className="table">
                <thead><tr><th>Comuna</th><th>Región</th><th className="right">IGR v1</th><th className="right">v1.1</th><th className="right">Δ score</th><th className="right">Δ ranking</th><th className="right">Confianza</th></tr></thead>
                <tbody>
                  {largestCandidateMoves.map((r) => (
                    <tr key={r.territory_id} onClick={() => setCommune(r.territory_id)} style={{ cursor: 'pointer' }}>
                      <td style={{ fontWeight: 600 }}>{r.commune_name}</td>
                      <td style={{ color: 'var(--ink-3)' }}>{r.region_name}</td>
                      <td className="right num">{n1(r.vigente_score)}</td>
                      <td className="right num">{n1(r.candidate_score)}</td>
                      <td className="right num" style={{ fontWeight: 650 }}>{r.score_delta > 0 ? '+' : ''}{n1(r.score_delta)}</td>
                      <td className="right num">{r.rank_delta > 0 ? '+' : ''}{n(r.rank_delta)}</td>
                      <td className="right num">{n1(r.candidate_confidence)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </details>
      )}""", 'visible stats and comparison')

text = replace_once(text,
"<th className=\"right\">IGR</th><th className=\"right\">Confianza</th>",
"<th className=\"right\">IGR</th><th className=\"right\">Cobertura</th>", 'top table header')
text = replace_once(text,
"<td className=\"right num\" style={{ color: 'var(--ink-3)' }}>{n1(c.igr_confidence)}</td>",
"<td className=\"right num\" style={{ color: 'var(--ink-3)' }}>{n1(c.igr_confidence)}%</td>", 'top table coverage')

text = replace_once(text,
"""function ComunaDetalle({
  territoryId, onBack, onNavigate,
}: {
  territoryId: string;
  onBack: () => void;
  onNavigate: (hash: string) => void;
}) {""",
"""function ComunaDetalle({
  territoryId, candidate, onBack, onNavigate,
}: {
  territoryId: string;
  candidate: TerritoryIgrComparisonRow | null;
  onBack: () => void;
  onNavigate: (hash: string) => void;
}) {""", 'detail props')

text = replace_once(text,
"""            <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 3 }}>
              confianza {n1(t.igr_confidence)}
            </div>""",
"""            <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 3 }}>
              cobertura metodológica {n1(t.igr_confidence)}%
            </div>""", 'detail coverage label')

text = replace_once(text,
"""        <div className="grid" style={{ gap: 16, alignContent: 'start' }}>
          <Panel title="Universo observado aquí" meta="contexto, fuera del índice">""",
"""        <div className="grid" style={{ gap: 16, alignContent: 'start' }}>
          {candidate && (
            <Panel title="IGR v1.1 · experimental" meta="comparación · no reemplaza vigente">
              <div className="territory-candidate-detail-scores">
                <div><span>Vigente</span><strong>{n1(candidate.vigente_score)}</strong><small>rango {n(candidate.vigente_rank)}</small></div>
                <div><span>Candidato</span><strong>{n1(candidate.candidate_score)}</strong><small>rango {n(candidate.candidate_rank)}</small></div>
                <div><span>Confianza</span><strong>{n1(candidate.candidate_confidence)}%</strong><small>{candidate.candidate_confidence_level ?? '—'}</small></div>
              </div>
              <dl className="kv" style={{ marginTop: 12 }}>
                <dt>Δ puntaje</dt><dd className="num">{candidate.score_delta > 0 ? '+' : ''}{n1(candidate.score_delta)}</dd>
                <dt>Δ ranking</dt><dd className="num">{candidate.rank_delta > 0 ? '+' : ''}{n(candidate.rank_delta)}</dd>
                <dt>Estabilidad</dt><dd className="num">{n1(candidate.confidence_components.stability)}%</dd>
                <dt>Cobertura temática</dt><dd className="num">{n1(candidate.confidence_components.thematic_coverage)}%</dd>
                <dt>Cobertura temporal</dt><dd className="num">{n1(candidate.confidence_components.temporal_coverage)}%</dd>
                <dt>Calidad de fuente</dt><dd className="num">{n1(candidate.confidence_components.source_quality)}%</dd>
                <dt>Confiabilidad denominador</dt><dd className="num">{n1(candidate.confidence_components.denominator_reliability)}%</dd>
                <dt>Población Censo 2024</dt><dd className="num">{n(candidate.population)}</dd>
              </dl>
              <div className="note" style={{ marginTop: 12 }}>
                El nivel candidato “{candidate.candidate_level ?? '—'}” usa los cortes antiguos sólo para comparar.
                No es una nueva clasificación aprobada y no modifica el mapa vigente.
              </div>
            </Panel>
          )}

          <Panel title="Universo observado aquí" meta="contexto, fuera del índice">""", 'candidate commune detail')

text = replace_once(text,
"""/** Cifras del ámbito dibujado. La agregación regional es media ponderada por
 *  confianza, no promedio simple: se dice donde se muestra. */
function AggMeta({ filas }: { filas: TerritoryCommune[] }) {
  if (!filas.length) return <span>sin corte comunal</span>;
  const conf = filas.reduce((a, c) => a + (c.igr_confidence ?? 0), 0);
  const pond = conf
    ? filas.reduce((a, c) => a + (c.igr_score ?? 0) * (c.igr_confidence ?? 0), 0) / conf
    : null;
  const altas = filas.filter((c) => (c.igr_score ?? 0) >= 60).length;
  const uaf = filas.reduce((a, c) => a + c.ctx_uaf_observed, 0);
  return (
    <span>
      {n(filas.length)} comunas · IGR ponderado{' '}
      <span className="num">{n1(pond)}</span> · {n(altas)} en nivel Alto o superior · padrón UAF{' '}
      <span className="num">{n(uaf)}</span>
    </span>
  );
}""",
"""/** Cifras del ámbito dibujado. La cobertura metodológica se informa aparte
 *  y no reduce el peso de una comuna en el agregado. */
function AggMeta({ filas }: { filas: TerritoryCommune[] }) {
  if (!filas.length) return <span>sin corte comunal</span>;
  const conScore = filas.filter((c) => c.igr_score != null);
  const media = conScore.length
    ? conScore.reduce((a, c) => a + Number(c.igr_score), 0) / conScore.length
    : null;
  const altas = filas.filter((c) => (c.igr_score ?? 0) >= 60).length;
  const uaf = filas.reduce((a, c) => a + c.ctx_uaf_observed, 0);
  return (
    <span>
      {n(filas.length)} comunas · IGR medio{' '}
      <span className="num">{n1(media)}</span> · {n(altas)} en nivel Alto o superior · padrón UAF{' '}
      <span className="num">{n(uaf)}</span>
    </span>
  );
}""", 'aggregate meta')

text = replace_once(text,
"""        Cada franja tiene su propia escala y la cifra bajo cada paso es el número de comunas.
        El agregado regional es una media comunal ponderada por confianza CEAD: una comuna mal
        cubierta no arrastra a su región.""",
"""        Cada franja tiene su propia escala y la cifra bajo cada paso es el número de comunas.
        El agregado regional es una media comunal simple; la cobertura metodológica se publica aparte
        y no reduce matemáticamente el peso de una comuna.""", 'legend aggregation')

TSX.write_text(text, encoding='utf-8')

css = CSS.read_text(encoding='utf-8')
marker = '/* IGR v1.1 comparison */'
if marker not in css:
    css += r'''

/* IGR v1.1 comparison */
.territory-candidate {
  margin: 0 0 16px;
  border: 1px solid color-mix(in srgb, var(--accent) 28%, var(--line-soft));
  border-radius: var(--radius);
  background: color-mix(in srgb, var(--bg-panel) 88%, transparent);
  overflow: hidden;
}
.territory-candidate-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 13px 15px;
  cursor: pointer;
  list-style: none;
  user-select: none;
}
.territory-candidate-summary::-webkit-details-marker { display: none; }
.territory-candidate-summary::marker { display: none; content: ''; }
.territory-candidate-summary > div:first-child { display: grid; gap: 3px; min-width: 0; }
.territory-candidate-summary strong { color: var(--ink); font-size: 12.5px; }
.territory-candidate-summary span { color: var(--ink-3); font-size: 11.5px; line-height: 1.4; }
.territory-candidate-summary-actions { display: flex; align-items: center; gap: 9px; flex-shrink: 0; }
.territory-candidate-badge {
  display: inline-flex;
  align-items: center;
  padding: 5px 9px;
  border: 1px solid color-mix(in srgb, var(--accent) 34%, var(--line));
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 9%, transparent);
  color: var(--ink-2) !important;
  font-size: 10px !important;
  font-weight: 700;
  letter-spacing: .035em;
  text-transform: uppercase;
}
.territory-candidate[open] .territory-method-chevron { transform: rotate(180deg); }
.territory-candidate-body { border-top: 1px solid var(--line-soft); padding: 14px; }
.territory-candidate-kpis,
.territory-candidate-method-grid,
.territory-candidate-detail-scores {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}
.territory-candidate-detail-scores { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.territory-candidate-kpis > div,
.territory-candidate-method-grid > div,
.territory-candidate-detail-scores > div {
  min-width: 0;
  padding: 10px 11px;
  border: 1px solid var(--line-soft);
  border-radius: 7px;
  background: var(--bg-raised);
  display: grid;
  gap: 3px;
}
.territory-candidate-kpis span,
.territory-candidate-method-grid span,
.territory-candidate-detail-scores span {
  color: var(--ink-4);
  font-size: 9.8px;
  font-weight: 700;
  letter-spacing: .065em;
  text-transform: uppercase;
}
.territory-candidate-kpis strong,
.territory-candidate-method-grid strong,
.territory-candidate-detail-scores strong {
  color: var(--ink);
  font-family: var(--mono);
  font-size: 18px;
  line-height: 1.1;
}
.territory-candidate-kpis small,
.territory-candidate-method-grid small,
.territory-candidate-detail-scores small {
  color: var(--ink-4);
  font-size: 10px;
  line-height: 1.3;
}
.territory-candidate-note {
  margin-top: 10px;
  padding: 9px 11px;
  border-left: 2px solid var(--accent);
  background: color-mix(in srgb, var(--accent) 6%, transparent);
  color: var(--ink-3);
  font-size: 11.5px;
  line-height: 1.5;
}
.territory-candidate-table-title {
  margin: 14px 2px 7px;
  color: var(--ink-4);
  font-size: 9.8px;
  font-weight: 700;
  letter-spacing: .08em;
  text-transform: uppercase;
}
.territory-candidate-table-wrap { overflow-x: auto; border: 1px solid var(--line-soft); border-radius: 7px; }
.territory-candidate-table-wrap .table { margin: 0; }
@media (max-width: 900px) {
  .territory-candidate-kpis,
  .territory-candidate-method-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .territory-candidate-summary { align-items: flex-start; flex-direction: column; }
  .territory-candidate-summary-actions { width: 100%; justify-content: space-between; }
}
@media (max-width: 560px) {
  .territory-candidate-kpis,
  .territory-candidate-method-grid,
  .territory-candidate-detail-scores { grid-template-columns: 1fr; }
}
'''
    CSS.write_text(css, encoding='utf-8')

print('Territorio IGR v1.1 UI patched')
