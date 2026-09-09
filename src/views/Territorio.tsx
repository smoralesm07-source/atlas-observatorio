import { useEffect, useMemo, useState } from 'react';
import { useRpc } from '../lib/rpc';
import type { TerritoryCommune, TerritoryDetail, TerritoryMap } from '../lib/contracts';
import { Bars, Meter, OrderedDistribution } from '../components/charts';
import { Badge, Empty, ErrorBox, Loading, Panel, Semantics } from '../components/primitives';
import { ChileMap } from '../components/ChileMap';
import { pressForCommune, type PressCommuneResult } from '../lib/press';
import { hrefFor } from '../lib/router';
import { n, n1, rutFormat, titleCase } from '../lib/format';

/** Paso de la rampa secuencial por nivel. El nombre del nivel acompaña siempre
 *  al color, porque los pasos bajos no alcanzan 3:1 contra la superficie. */
const LEVEL_STEP: Record<string, number> = {
  'Muy bajo': 1, Bajo: 2, Moderado: 2, Medio: 3, Alto: 4, 'Muy alto': 5,
};
const levelStep = (l: string | null | undefined) => LEVEL_STEP[l ?? ''] ?? 1;

/** Un puntaje de amenaza alto no es "bueno": el semáforo por umbral del Meter
 *  lo pintaría verde. La rampa del IGR mantiene la lectura correcta. */
const scoreStep = (v: number) => (v >= 80 ? 5 : v >= 60 ? 4 : v >= 40 ? 3 : v >= 20 ? 2 : 1);
const scoreTone = (v: number) => `var(--igr-${scoreStep(v)})`;

/** Islas oceánicas: quedan fuera del encuadre continental y se ofrecen aparte
 *  para que no desaparezcan de la vista por una decisión cartográfica. */
const INSULARES = ['05201', '05104'];

interface TerritoryIgrComparisonRow {
  territory_id: string;
  region_code: string | null;
  region_name: string;
  commune_code: string | null;
  commune_name: string;
  vigente_score: number;
  candidate_score: number;
  candidate_percentile: number | null;
  score_delta: number;
  vigente_level: string | null;
  candidate_level: string | null;
  candidate_level_status: 'comparison_only';
  provisional_level: string | null;
  provisional_level_status: 'diagnostic_only' | null;
  provisional_boundary_distance: number | null;
  provisional_boundary_status: 'borderline' | 'stable_relative_to_thresholds' | 'unavailable' | null;
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
  status: 'EXPERIMENTAL' | 'RC1';
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
    cambios_nivel_provisional: number;
    provisional_borderline: number;
    provisional_estables: number;
    correlacion_score: number | null;
    correlacion_ranking: number | null;
    sesgo_poblacion_vigente: number | null;
    sesgo_poblacion_candidate: number | null;
    refreshed_at: string | null;
  };
  rows: TerritoryIgrComparisonRow[];
  semantics: string;
}

export function Territorio({ onNavigate }: { onNavigate: (hash: string) => void }) {
  const [commune, setCommune] = useState<string | null>(null);
  const [region, setRegion] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const { data, error, loading, reload } = useRpc<TerritoryMap>('obs_territory_map', {});
  const { data: igrCompare } = useRpc<TerritoryIgrComparison>('obs_territory_igr_comparison', {});

  // El corte comunal completo llega desde 0014. Si el contrato aún no lo trae,
  // el mapa lo dice en vez de pintar un país en blanco.
  const comunas = useMemo<TerritoryCommune[]>(() => data?.comunas ?? [], [data]);
  const regiones = useMemo(() => {
    const m = new Map<string, string>();
    comunas.forEach((c) => { if (c.region_code) m.set(c.region_code, c.region_name); });
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], 'es'));
  }, [comunas]);
  const enRegion = useMemo(
    () => (region ? comunas.filter((c) => c.region_code === region) : comunas),
    [comunas, region],
  );
  const porNivel = useMemo(() => {
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
  }

  if (loading) return <Loading label="Leyendo el índice territorial…" />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Empty title="Sin territorio publicado" />;

  const m = data.metodologia;
  const cob = data.cobertura as TerritoryMap['cobertura'] & {
    cobertura_metodologica_media?: number | null;
    cobertura_incompleta?: number;
  };
  const cmp = igrCompare?.summary;

  return (
    <div className="fade-in">
      <header className="view-head territory-view-head">
        <h1 className="view-title">Territorio</h1>
      </header>

      <details className="territory-method">
        <summary className="territory-method-summary">
          <div className="territory-method-summary-copy">
            <strong>IGR · cobertura y confianza</strong>
            <span>
              IGR = amenaza territorial comunal · 86% vigente = cobertura metodológica · confianza RC1 = robustez de la estimación, separada del tamaño poblacional.
            </span>
          </div>
          <span className="territory-method-open">Metodología</span>
          <span className="territory-method-chevron" aria-hidden>⌄</span>
        </summary>

        <div className="territory-method-body">
          <div className="territory-method-lead">
            <div>
              <span className="territory-method-kicker">Lectura esencial</span>
              <strong>El IGR describe el territorio, no a las entidades domiciliadas en él.</strong>
              <p>
                Un valor alto orienta dónde existe mayor amenaza territorial observada para LA. En el IGR vigente,
                el 86% que antes se mostraba como “confianza” es en realidad <strong>cobertura metodológica</strong>:
                indica cuánto del catálogo previsto está materializado y no diferencia por sí solo a una comuna de otra.
              </p>
            </div>
            <div className="territory-method-scale">
              <span>IGR</span>
              <strong>0–100</strong>
              <small>mayor valor = mayor amenaza observada</small>
            </div>
          </div>

          <div className="territory-method-grid">
            <section className="territory-method-card territory-method-card-wide">
              <span className="territory-method-kicker">1 · Fórmula publicada</span>
              <div className="territory-method-formula mono">{m.formula}</div>
              <p>
                El IGR vigente es <strong>{m.indicador} {m.version.replace(/^IGR-/, '')}</strong>. La fórmula y
                los pesos se leen desde el contrato metodológico vigente, de modo que esta ayuda se mantiene
                sincronizada con el cálculo publicado.
              </p>
            </section>

            <section className="territory-method-card">
              <span className="territory-method-kicker">2 · Composición del IGR</span>
              <div className="territory-method-equation mono">
                IGR = Σ (capa × peso)
              </div>
              <dl className="territory-method-dl">
                <dt>Amenazas precedentes LA</dt>
                <dd>{n1(m.capas.amenazas_precedentes_la * 100)}%</dd>
                <dt>Economía criminal y facilitadores</dt>
                <dd>{n1(m.capas.economia_criminal_facilitadores * 100)}%</dd>
                <dt>Contexto criminógeno</dt>
                <dd>{n1(m.capas.contexto_criminogeno * 100)}%</dd>
              </dl>
            </section>

            <section className="territory-method-card">
              <span className="territory-method-kicker">3 · Caracterización de cada capa</span>
              <div className="territory-method-equation mono">
                C = I×{n1(m.caracterizacion.intensidad * 100)}% + P×{n1(m.caracterizacion.persistencia * 100)}% + T×{n1(m.caracterizacion.tendencia * 100)}% + A×{n1(m.caracterizacion.anomalia * 100)}%
              </div>
              <dl className="territory-method-dl compact">
                <dt>I · Intensidad</dt><dd>{n1(m.caracterizacion.intensidad * 100)}%</dd>
                <dt>P · Persistencia</dt><dd>{n1(m.caracterizacion.persistencia * 100)}%</dd>
                <dt>T · Tendencia</dt><dd>{n1(m.caracterizacion.tendencia * 100)}%</dd>
                <dt>A · Anomalía</dt><dd>{n1(m.caracterizacion.anomalia * 100)}%</dd>
              </dl>
            </section>

            <section className="territory-method-card">
              <span className="territory-method-kicker">4 · Cobertura metodológica vigente</span>
              <p>
                El <strong>86%</strong> actual se obtiene por disponibilidad de capas y componentes. Es útil para
                advertir que el catálogo está incompleto, pero como hoy es igual para las 345 comunas
                <strong> no debe usarse para ordenarlas ni para expresar certeza estadística</strong>.
              </p>
              <div className="territory-method-callout">
                Cobertura ≠ confianza. Ausencia de una familia de datos tampoco equivale a menor amenaza.
              </div>
            </section>

            <section className="territory-method-card">
              <span className="territory-method-kicker">5 · Agregado regional</span>
              <div className="territory-method-equation mono">
                IGR región = Σ IGR comuna / n comunas
              </div>
              <p>
                El agregado regional usa ahora <strong>media comunal simple</strong>. La cobertura se informa por
                separado: reducir el peso de una comuna por saber menos de ella podría ocultar justamente un territorio
                donde la evidencia es más débil.
              </p>
            </section>

            <section className="territory-method-card territory-method-card-wide">
              <span className="territory-method-kicker">6 · Cobertura y límites actuales</span>
              <div className="territory-method-coverage">
                <div>
                  <strong>Materializado hoy</strong>
                  <p>{m.cobertura_delitos_base.materializadas.join(', ')}.</p>
                </div>
                <div>
                  <strong>Aún no materializado con cobertura territorial suficiente</strong>
                  <p>{m.cobertura_delitos_base.no_materializadas.join(', ')}.</p>
                </div>
              </div>
              <p className="territory-method-muted">
                Fuera del índice: {m.excluido_del_indice.join(', ')}. Las cifras de entidades, padrón y sanciones
                que aparecen junto a cada comuna son contexto descriptivo y no entran en el cálculo.
              </p>
            </section>

            <section className="territory-method-card territory-method-card-wide">
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
                  <strong>Confianza v1.1 RC1</strong>
                  <span>Combina cobertura temática, cobertura temporal, calidad de fuente y estabilidad; la confiabilidad del denominador se muestra aparte y no pondera la confianza.</span>
                </div>
                <div>
                  <strong>Percentil nacional RC1</strong>
                  <span>Posición relativa dentro de las 345 comunas: 100 = extremo superior del score RC1 y 0 = extremo inferior. No es probabilidad ni una segunda fórmula.</span>
                </div>
                <div>
                  <strong>Banda v1.1 provisional</strong>
                  <span>Contexto secundario de lectura. Cerca de una frontera deben prevalecer el score continuo y el percentil nacional.</span>
                </div>
              </div>
              <p className="territory-method-muted">
                La confianza RC1 nunca modifica el score ni transforma menor evidencia en menor amenaza. La confiabilidad del denominador continúa visible, pero ya no entra al compuesto de confianza porque su efecto ya está incorporado al contraer el peso de la tasa.
              </p>
            </section>

            {cmp && cmp.comunas > 0 && (
              <section className="territory-method-card territory-method-card-wide">
                <span className="territory-method-kicker">8 · Validación RC1 · v1.1</span>
                <div className="territory-candidate-method-grid">
                  <div><span>Confianza media</span><strong>{n1(cmp.confianza_candidate_media)}%</strong><small>{n1(cmp.confianza_candidate_min)}–{n1(cmp.confianza_candidate_max)}</small></div>
                  <div><span>Correlación ranking</span><strong>{n1((cmp.correlacion_ranking ?? 0) * 100)}%</strong><small>respecto del IGR vigente</small></div>
                  <div><span>Asociación score-población</span><strong>{n1(cmp.sesgo_poblacion_candidate)}</strong><small>vigente {n1(cmp.sesgo_poblacion_vigente)}</small></div>
                  <div><span>Cambios banda provisional</span><strong>{n(cmp.cambios_nivel_provisional)}</strong><small>{n(cmp.provisional_borderline)} cerca de una frontera</small></div>
                </div>
                <p>
                  El score RC1 es <strong>idéntico a candidate.3</strong>: reemplaza la anomalía transversal por anomalía temporal estabilizada por soporte y combina
                  volumen con tasa por 100 mil usando contracción en comunas pequeñas. La validación de bandas mostró que ninguna regla categórica mejora
                  suficientemente la estabilidad sin introducir otros costos; por eso <strong>score + percentil nacional son la lectura primaria RC1</strong> y la banda queda como apoyo secundario.
                  <strong>El mapa y el ranking oficial siguen usando v1.0.</strong>
                </p>
              </section>
            )}
          </div>
        </div>
      </details>

      <div className="grid grid-4" style={{ marginBottom: 16 }}>
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
            label="Confianza v1.1 RC1"
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
              <strong>Comparar IGR vigente vs v1.1 RC1</strong>
              <span>Compara magnitud del score, posición nacional y robustez; la banda queda como contexto secundario.</span>
            </div>
            <div className="territory-candidate-summary-actions">
              <span className="territory-candidate-badge">{cmp.candidate_version ?? 'v1.1 RC1'} · mapa vigente intacto</span>
              <span className="territory-method-chevron" aria-hidden>⌄</span>
            </div>
          </summary>
          <div className="territory-candidate-body">
            <div className="territory-candidate-kpis">
              <div><span>Correlación score</span><strong>{n1((cmp.correlacion_score ?? 0) * 100)}%</strong></div>
              <div><span>Correlación ranking</span><strong>{n1((cmp.correlacion_ranking ?? 0) * 100)}%</strong></div>
              <div><span>Cambios banda provisional</span><strong>{n(cmp.cambios_nivel_provisional)}</strong><small>de {n(cmp.comunas)} comunas</small></div>
              <div><span>Cerca de frontera</span><strong>{n(cmp.provisional_borderline)}</strong><small>{n(cmp.provisional_estables)} estables respecto de cortes</small></div>
            </div>
            <div className="territory-candidate-note">
              <strong>Lectura recomendada:</strong> RC1 conserva el score validado y añade el <strong>percentil nacional</strong> para mostrar posición relativa sin crear otra fórmula de amenaza.
              La banda recalibrada queda como apoyo secundario con alerta de frontera. La histéresis y las bandas puramente relativas fueron descartadas como lectura principal por su dependencia temporal o escasa mejora de estabilidad.
            </div>
            <div className="territory-candidate-table-title">Mayores movimientos de puntaje · muestra de diagnóstico</div>
            <div className="territory-candidate-table-wrap">
              <table className="table">
                <thead><tr><th>Comuna</th><th>Región</th><th className="right">IGR v1</th><th className="right">v1.1</th><th className="right">Percentil</th><th>Banda secundaria</th><th className="right">Δ score</th><th className="right">Confianza</th></tr></thead>
                <tbody>
                  {largestCandidateMoves.map((r) => (
                    <tr key={r.territory_id} onClick={() => setCommune(r.territory_id)} style={{ cursor: 'pointer' }}>
                      <td style={{ fontWeight: 600 }}>{r.commune_name}</td>
                      <td style={{ color: 'var(--ink-3)' }}>{r.region_name}</td>
                      <td className="right num">{n1(r.vigente_score)}</td>
                      <td className="right num">{n1(r.candidate_score)}</td>
                      <td className="right num">{r.candidate_percentile == null ? '—' : `P${n1(r.candidate_percentile)}`}</td>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <i style={{ width: 8, height: 8, borderRadius: 2, background: `var(--igr-${levelStep(r.provisional_level)})` }} />
                          {r.provisional_level ?? '—'}
                          {r.provisional_boundary_status === 'borderline' && <span title="Cerca de una frontera provisional">· frontera</span>}
                        </span>
                      </td>
                      <td className="right num" style={{ fontWeight: 650 }}>{r.score_delta > 0 ? '+' : ''}{n1(r.score_delta)}</td>
                      <td className="right num">{n1(r.candidate_confidence)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </details>
      )}

      {/* El mapa reemplazó al panel de barras regionales: la unidad del índice es
          la comuna, y un agregado regional no deja ver dónde está la amenaza. */}
      <div className="grid grid-main" style={{ marginBottom: 16 }}>
        <Panel
          title={region ? (regiones.find(([c]) => c === region)?.[1] ?? 'Región') : 'Mapa comunal del IGR'}
          pad={false}
          actions={<AggMeta filas={enRegion} />}
        >
          <div className="map-tools">
            <span className="map-tools-label">Ámbito</span>
            <select
              className="fsel-region"
              value={region ?? ''}
              onChange={(e) => setRegion(e.target.value || null)}
              aria-label="Ámbito territorial del mapa"
            >
              <option value="">Todo Chile</option>
              {regiones.map(([code, nombre]) => (
                <option key={code} value={code}>{nombre}</option>
              ))}
            </select>
            <input
              className="map-search"
              type="search"
              placeholder="Resaltar comuna…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Resaltar comuna en el mapa"
            />
          </div>

          {comunas.length === 0 ? (
            <div className="map-fallback">
              El contrato no está entregando el corte comunal (<span className="mono">comunas</span>).
              Aplica la migración <span className="mono">0014</span> para habilitar el mapa; la
              tabla y el agregado regional siguen operativos.
            </div>
          ) : (
            <ChileMap
              comunas={comunas}
              region={region}
              selected={null}
              query={query}
              onSelect={(c) => setCommune(c.territory_id)}
              onExitRegion={() => setRegion(null)}
            />
          )}

          <MapLegend porNivel={porNivel} comunas={comunas} onSelect={setCommune} />
        </Panel>

        <div className="grid" style={{ gap: 16, alignContent: 'start' }}>
          <Panel title="Distribución por nivel" meta={`${n(cob.comunas)} comunas`}>
            <OrderedDistribution
              total={cob.comunas}
              rows={data.niveles.map((x) => ({
                label: x.igr_level,
                value: x.comunas,
                step: levelStep(x.igr_level),
              }))}
            />
          </Panel>

          <Panel title="Cómo se compone el índice">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* Son pesos de composición, no puntajes: color constante. */}
              <Meter value={m.capas.amenazas_precedentes_la * 100}
                label="Amenazas precedentes LA" tone="var(--accent)" />
              <Meter value={m.capas.economia_criminal_facilitadores * 100}
                label="Economía criminal y facilitadores" tone="var(--accent)" />
              <Meter value={m.capas.contexto_criminogeno * 100}
                label="Contexto criminógeno" tone="var(--accent)" />
            </div>
            <div className="note" style={{ marginTop: 14 }}>
              Cada capa se caracteriza con {n1(m.caracterizacion.intensidad * 100)}% intensidad,{' '}
              {n1(m.caracterizacion.persistencia * 100)}% persistencia,{' '}
              {n1(m.caracterizacion.tendencia * 100)}% tendencia y{' '}
              {n1(m.caracterizacion.anomalia * 100)}% anomalía.
            </div>
          </Panel>
        </div>
      </div>

      <Panel title="Comunas con mayor amenaza" meta="clic para abrir el detalle" pad={false}>
        <table className="table">
          <thead>
            <tr>
              <th>Comuna</th><th>Región</th><th>Nivel</th>
              <th className="right">IGR</th><th className="right">Cobertura</th>
              <th className="right">Entidades</th><th className="right">Padrón UAF</th>
            </tr>
          </thead>
          <tbody>
            {data.comunas_top.map((c) => (
              <tr
                key={c.territory_id}
                onClick={() => setCommune(c.territory_id)}
                style={{ cursor: 'pointer' }}
              >
                <td style={{ fontWeight: 600 }}>{c.commune_name}</td>
                <td style={{ color: 'var(--ink-3)' }}>{c.region_name}</td>
                <td>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <i style={{ width: 9, height: 9, borderRadius: 2, background: `var(--igr-${levelStep(c.igr_level)})` }} />
                    {c.igr_level}
                  </span>
                </td>
                <td className="right num" style={{ fontWeight: 650 }}>{n1(c.igr_score)}</td>
                <td className="right num" style={{ color: 'var(--ink-3)' }}>{n1(c.igr_confidence)}%</td>
                <td className="right num">{n(c.ctx_entities)}</td>
                <td className="right num">{n(c.ctx_uaf_observed)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <div style={{ marginTop: 24 }}>
        <Semantics>
          <strong>Qué queda deliberadamente fuera del índice.</strong>{' '}
          {m.excluido_del_indice.join(', ')}. Desde {m.version} el territorio se separó del
          riesgo sectorial y del riesgo individual para no contar dos veces el mismo
          fenómeno. Las cifras de entidades, padrón y sanciones que ves junto a cada comuna
          son contexto descriptivo: no entran en el cálculo. {data.semantics}
        </Semantics>
      </div>
    </div>
  );
}

function ComunaDetalle({
  territoryId, candidate, onBack, onNavigate,
}: {
  territoryId: string;
  candidate: TerritoryIgrComparisonRow | null;
  onBack: () => void;
  onNavigate: (hash: string) => void;
}) {
  const { data, error, loading, reload } = useRpc<TerritoryDetail | null>(
    'obs_territory_detail', { p_territory_id: territoryId },
  );

  if (loading) return <Loading label="Abriendo el detalle territorial…" />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Empty title="Comuna no encontrada en el corte" />;

  const t = data.territorio;
  const p = data.posicion;
  const layers = Object.entries(t.layers ?? {});

  return (
    <div className="fade-in">
      <nav style={{ marginBottom: 14, fontSize: 12.5 }}>
        <button
          onClick={onBack}
          style={{ background: 'none', border: 0, color: 'var(--ink-3)', cursor: 'pointer', padding: 0 }}
        >
          ← Territorio
        </button>
      </nav>

      <header className="ficha-head">
        <div style={{ minWidth: 0, flex: '1 1 340px' }}>
          <h1 className="ficha-title">{t.commune_name}</h1>
          <div className="ficha-sub">
            <span>{t.region_name}</span>
            {t.commune_code && <span className="mono">{t.commune_code}</span>}
            <span>año {t.year}</span>
            <span className="mono">{t.score_version ? `CEAD ${t.score_version}` : ''}</span>
          </div>
          {t.interpretation && (
            <p style={{ margin: '12px 0 0', fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.6, maxWidth: '70ch' }}>
              {t.interpretation}
            </p>
          )}
        </div>

        <div className="ficha-scores">
          <div style={{ minWidth: 130, padding: '12px 15px', borderRadius: 'var(--radius)', background: 'var(--bg-panel)', border: '1px solid var(--line)' }}>
            <div className="num" style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.035em', color: `var(--igr-${levelStep(t.igr_level)})` }}>
              {n1(t.igr_score)}
            </div>
            <div style={{ fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--ink-3)', fontWeight: 650, marginTop: 3 }}>
              IGR · {t.igr_level}
            </div>
            <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 3 }}>
              cobertura metodológica {n1(t.igr_confidence)}%
            </div>
          </div>
          <div style={{ minWidth: 118, padding: '12px 15px', borderRadius: 'var(--radius)', background: 'var(--bg-panel)', border: '1px solid var(--line)' }}>
            <div className="num" style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.035em' }}>
              {n(p.posicion_nacional)}
            </div>
            <div style={{ fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--ink-3)', fontWeight: 650, marginTop: 3 }}>
              en el país
            </div>
            <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 3 }}>
              de {n(p.comunas_pais)} comunas
            </div>
          </div>
          <div style={{ minWidth: 118, padding: '12px 15px', borderRadius: 'var(--radius)', background: 'var(--bg-panel)', border: '1px solid var(--line)' }}>
            <div className="num" style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.035em' }}>
              {n(p.posicion_en_region)}
            </div>
            <div style={{ fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--ink-3)', fontWeight: 650, marginTop: 3 }}>
              en su región
            </div>
            <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 3 }}>
              de {n(p.comunas_region)} · media {n1(p.igr_region)}
            </div>
          </div>
        </div>
      </header>

      <div className="grid grid-main" style={{ marginTop: 16 }}>
        <div className="grid" style={{ gap: 16, alignContent: 'start' }}>
          {layers.map(([key, layer]) => (
            <Panel
              key={key}
              title={layer.label}
              meta={`peso ${n1(layer.configured_weight * 100)}% · cobertura ${n1(layer.coverage * 100)}%`}
              pad={false}
            >
              <div style={{ padding: '14px 20px' }}>
                <Meter
                  value={Number(layer.score ?? 0)}
                  label="Puntaje de la capa"
                  tone={scoreTone(Number(layer.score ?? 0))}
                />
              </div>
              <table className="table">
                <thead>
                  <tr>
                    <th>Componente</th>
                    <th className="right">Puntaje</th>
                    <th className="right">Intensidad</th>
                    <th className="right">Persistencia</th>
                    <th className="right">Tendencia</th>
                    <th className="right">Anomalía</th>
                    <th className="right">Años</th>
                  </tr>
                </thead>
                <tbody>
                  {(layer.components ?? []).map((c) => (
                    <tr key={c.id}>
                      <td>{titleCase(c.label)}</td>
                      <td className="right num" style={{ fontWeight: 650 }}>{n1(c.score)}</td>
                      <td className="right num">{n1(c.intensity)}</td>
                      <td className="right num">{n1(c.persistence)}</td>
                      <td className="right num">{n1(c.trend)}</td>
                      <td className="right num">{n1(c.anomaly)}</td>
                      <td className="right num">{n(c.years_observed)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          ))}
        </div>

        <div className="grid" style={{ gap: 16, alignContent: 'start' }}>
          {candidate && (
            <Panel title="IGR v1.1 RC1" meta={`score + percentil · banda ${candidate.provisional_level ?? '—'}`}>
              <div className="territory-candidate-detail-scores">
                <div><span>Vigente</span><strong>{n1(candidate.vigente_score)}</strong><small>rango {n(candidate.vigente_rank)}</small></div>
                <div><span>RC1</span><strong>{n1(candidate.candidate_score)}</strong><small>percentil {candidate.candidate_percentile == null ? '—' : n1(candidate.candidate_percentile)}</small></div>
                <div><span>Confianza</span><strong>{n1(candidate.candidate_confidence)}%</strong><small>{candidate.candidate_confidence_level ?? '—'}</small></div>
              </div>
              <dl className="kv" style={{ marginTop: 12 }}>
                <dt>Δ puntaje</dt><dd className="num">{candidate.score_delta > 0 ? '+' : ''}{n1(candidate.score_delta)}</dd>
                <dt>Δ ranking</dt><dd className="num">{candidate.rank_delta > 0 ? '+' : ''}{n(candidate.rank_delta)}</dd>
                <dt>Percentil nacional RC1</dt><dd className="num">{candidate.candidate_percentile == null ? '—' : `P${n1(candidate.candidate_percentile)}`}</dd>
                <dt>Banda secundaria</dt><dd>{candidate.provisional_level ?? '—'}</dd>
                <dt>Lectura de frontera</dt><dd>{candidate.provisional_boundary_status === 'borderline' ? 'Cerca de frontera' : candidate.provisional_boundary_status === 'stable_relative_to_thresholds' ? 'Estable respecto de cortes' : '—'}</dd>
                <dt>Distancia a frontera</dt><dd className="num">{candidate.provisional_boundary_distance == null ? '—' : n1(candidate.provisional_boundary_distance)}</dd>
                <dt>Estabilidad</dt><dd className="num">{n1(candidate.confidence_components.stability)}%</dd>
                <dt>Cobertura temática</dt><dd className="num">{n1(candidate.confidence_components.thematic_coverage)}%</dd>
                <dt>Cobertura temporal</dt><dd className="num">{n1(candidate.confidence_components.temporal_coverage)}%</dd>
                <dt>Calidad de fuente</dt><dd className="num">{n1(candidate.confidence_components.source_quality)}%</dd>
                <dt>Confiabilidad denominador</dt><dd className="num">{n1(candidate.confidence_components.denominator_reliability)}%</dd>
                <dt>Población Censo 2024</dt><dd className="num">{n(candidate.population)}</dd>
              </dl>
              <div className="note" style={{ marginTop: 12 }}>
                La lectura primaria RC1 combina el <strong>score continuo</strong> con el <strong>percentil nacional</strong>. El percentil expresa posición relativa entre comunas y no una probabilidad de LA/FT.
                La banda “{candidate.provisional_level ?? '—'}” queda como contexto secundario.
                {candidate.provisional_boundary_status === 'borderline' && ' Está cerca de una frontera según su estabilidad: no debe interpretarse un cambio de etiqueta sin revisar score, percentil y evidencia.'}
                {' '}No modifica todavía el mapa vigente. El nivel legado “{candidate.candidate_level ?? '—'}” se conserva sólo para comparar con v1.0.
              </div>
            </Panel>
          )}

          <Panel title="Universo observado aquí" meta="contexto, fuera del índice">
            <dl className="kv">
              <dt>Entidades</dt><dd className="num">{n(t.ctx_entities)}</dd>
              <dt>Padrón UAF</dt><dd className="num">{n(t.ctx_uaf_observed)}</dd>
              <dt>Con sanción</dt><dd className="num">{n(t.ctx_sanctioned)}</dd>
              <dt>Con señal</dt><dd className="num">{n(t.ctx_alerted)}</dd>
              <dt>Hallazgos</dt><dd className="num">{n(t.ctx_findings)}</dd>
            </dl>
            <div className="note" style={{ marginTop: 12 }}>
              Estar domiciliado en una comuna de amenaza alta no es un indicio sobre la
              entidad. Estas cifras describen el territorio, no imputan nada.
            </div>
          </Panel>

          <PrensaComunal comuna={t.commune_name} />

          {data.sectores.length > 0 && (
            <Panel title="Sectores obligados presentes">
              <Bars
                data={data.sectores.map((s) => ({ label: titleCase(s.uaf_sector), value: s.n }))}
              />
            </Panel>
          )}
        </div>
      </div>

      {data.entidades.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <Panel
            title={`Entidades domiciliadas · ${data.entidades.length}`}
            meta="orden por prioridad analítica"
            pad={false}
          >
            <table className="table">
              <thead>
                <tr>
                  <th>Entidad</th><th>RUT</th><th>Sector UAF</th>
                  <th className="right">Prioridad</th><th className="right">Fuentes</th>
                  <th className="right">Señales</th>
                </tr>
              </thead>
              <tbody>
                {data.entidades.map((e) => (
                  <tr
                    key={e.entity_id}
                    onClick={() => onNavigate(hrefFor({ view: 'ficha', entityId: e.entity_id }))}
                    style={{ cursor: 'pointer' }}
                  >
                    <td style={{ fontWeight: 600 }}>
                      {titleCase(e.name)}
                      {e.is_sanctioned && <Badge tone="critical" dot>Sancionada</Badge>}
                    </td>
                    <td className="mono">{e.rut ? rutFormat(e.rut) : 'sin RUT'}</td>
                    <td style={{ color: 'var(--ink-3)' }}>{e.uaf_sector ? titleCase(e.uaf_sector) : '—'}</td>
                    <td className="right num">{n1(e.ipa3_score)}</td>
                    <td className="right num">{n(e.source_count)}</td>
                    <td className="right num">{n(e.alert_count)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </div>
      )}

      <div style={{ marginTop: 24 }}>
        <Semantics>
          <strong>Alcance.</strong> {data.semantics}
        </Semantics>
      </div>
    </div>
  );
}

/** Cifras del ámbito dibujado. La cobertura metodológica se informa aparte
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
}

/** La rampa se lee con el nombre del nivel al lado: el color no codifica solo. */
function MapLegend({ porNivel, comunas, onSelect }: {
  porNivel: Map<string, number>;
  comunas: TerritoryCommune[];
  onSelect: (territoryId: string) => void;
}) {
  const pasos = [
    { step: 5, label: 'Muy alto' }, { step: 4, label: 'Alto' }, { step: 3, label: 'Medio' },
    { step: 2, label: 'Bajo' }, { step: 1, label: 'Muy bajo' },
  ];
  const islas = comunas.filter((c) => c.commune_code && INSULARES.includes(c.commune_code));
  return (
    <div className="map-legend">
      <div className="map-legend-steps">
        {pasos.map((p) => (
          <div className="map-legend-step" key={p.step}>
            <div className="map-legend-sw" style={{ background: `var(--igr-${p.step})` }} />
            <div className="map-legend-lb">{p.label}</div>
            <div className="map-legend-n">{n(porNivel.get(p.label) ?? 0)}</div>
          </div>
        ))}
      </div>
      <div style={{ maxWidth: '32ch', lineHeight: 1.45 }}>
        Cada franja tiene su propia escala y la cifra bajo cada paso es el número de comunas.
        El agregado regional es una media comunal simple; la cobertura metodológica se publica aparte
        y no reduce matemáticamente el peso de una comuna.
      </div>
      {islas.length > 0 && (
        <div className="map-islands">
          <span>Insulares, fuera del encuadre:</span>
          {islas.map((c) => (
            <button key={c.territory_id} type="button" className="map-island"
                    onClick={() => onSelect(c.territory_id)}>
              <i style={{ background: `var(--igr-${levelStep(c.igr_level)})` }} />
              {c.commune_name} · <span className="num">{n1(c.igr_score)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Prensa que sitúa su mención en esta comuna.
 *
 *  El puente distingue la comuna que el texto marca de las que sólo nombra, y
 *  aquí se mantiene esa distinción: una noticia que menciona la comuna de paso
 *  no es una noticia sobre la comuna. Ninguna de las dos imputa nada al
 *  territorio ni a quien esté domiciliado en él. */
function PrensaComunal({ comuna }: { comuna: string }) {
  const [estado, setEstado] = useState<PressCommuneResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    setEstado(null);
    setError(null);
    pressForCommune(comuna)
      .then((r) => { if (vivo) setEstado(r); })
      .catch((e: Error) => { if (vivo) setError(e.message); });
    return () => { vivo = false; };
  }, [comuna]);

  const meta = estado
    ? `${n(estado.resolved)} sitúan aquí · ${n(estado.mentioned)} la mencionan`
    : undefined;

  return (
    <Panel title="Prensa" meta={meta}>
      {error && <div className="note note-warn">{error}</div>}
      {!error && !estado && <div className="note">Leyendo el puente de prensa…</div>}
      {estado && !estado.bridgeHasGeo && (
        <div className="note">
          El puente de prensa aún no publica noticias geoetiquetadas. El corte vigente viaja
          sin comuna, así que no hay prensa comunal que mostrar todavía.
        </div>
      )}
      {estado && estado.bridgeHasGeo && estado.articles.length === 0 && (
        <div className="note">Sin noticias que sitúen su mención en esta comuna.</div>
      )}
      {estado && estado.articles.length > 0 && (
        <div className="timeline" style={{ marginTop: 4 }}>
          {estado.articles.map((a) => (
            <div className="tl-item" key={a.id} data-clase={a.basis === 'resuelta' ? 'hito' : 'prensa'}>
              <div className="tl-when">
                {a.date ? String(a.date).slice(0, 10) : 'sin fecha'} · {a.media ?? 'medio no informado'}
                {a.basis === 'mencionada' && ' · sólo mencionada'}
              </div>
              <div className="tl-what">
                {a.url
                  ? <a href={a.url} target="_blank" rel="noreferrer noopener">{a.title}</a>
                  : a.title}
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="note">
        Una mención en prensa es contexto abierto: no acredita delito ni identidad, y situarla
        en la comuna no atribuye conducta al territorio.
      </div>
    </Panel>
  );
}

function Stat({ label, value, foot, tone }: { label: string; value: string; foot?: string; tone?: string }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value num" style={tone ? { color: tone } : undefined}>{value}</div>
      {foot && <div className="stat-foot">{foot}</div>}
    </div>
  );
}