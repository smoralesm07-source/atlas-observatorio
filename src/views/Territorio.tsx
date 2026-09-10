import { useMemo, useState } from 'react';
import { useRpc } from '../lib/rpc';
import type { TerritoryCommune, TerritoryDetail, TerritoryMap } from '../lib/contracts';
import { Meter, OrderedDistribution } from '../components/charts';
import { Empty, ErrorBox, Loading, Panel, Semantics } from '../components/primitives';
import { ChileMap } from '../components/ChileMap';
import { TerritoryCommuneWorkspace } from '../components/TerritoryCommuneWorkspace';
import { n, n1 } from '../lib/format';

/** Paso de la rampa secuencial por nivel. El nombre del nivel acompaña siempre
 *  al color, porque los pasos bajos no alcanzan 3:1 contra la superficie. */
const LEVEL_STEP: Record<string, number> = {
  'Muy bajo': 1, Bajo: 2, Moderado: 2, Medio: 3, Alto: 4, 'Muy alto': 5,
};
const levelStep = (l: string | null | undefined) => LEVEL_STEP[l ?? ''] ?? 1;

/** Islas oceánicas: quedan fuera del encuadre continental y se ofrecen aparte
 *  para que no desaparezcan de la vista por una decisión cartográfica. */
const INSULARES = ['05201', '05104'];

export function Territorio({ onNavigate }: { onNavigate: (hash: string) => void }) {
  const [commune, setCommune] = useState<string | null>(null);
  const [region, setRegion] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const { data, error, loading, reload } = useRpc<TerritoryMap>('obs_territory_map', {});

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


  if (commune) {
    return (
      <ComunaDetalle
        territoryId={commune}
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
              IGR = amenaza territorial comunal · score + percentil nacional = lectura principal · confianza = robustez de la estimación.
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
                La fórmula y los pesos se leen desde el contrato metodológico vigente. El <strong>score 0–100</strong> expresa magnitud
                de amenaza observada y el <strong>percentil nacional</strong> sitúa a cada comuna frente al resto del país sin crear una segunda fórmula.
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
              <span className="territory-method-kicker">7 · Cómo leer el IGR</span>
              <div className="territory-read-grid">
                <div>
                  <strong>IGR · score</strong>
                  <span>Magnitud de amenaza territorial observada en escala 0–100. Es la señal principal.</span>
                </div>
                <div>
                  <strong>Percentil nacional</strong>
                  <span>Posición relativa entre las comunas: P100 corresponde al extremo superior y P0 al inferior. No es probabilidad.</span>
                </div>
                <div>
                  <strong>Confianza</strong>
                  <span>Robustez de la estimación según cobertura temática, temporal, calidad de fuente y estabilidad. No modifica el score.</span>
                </div>
                <div>
                  <strong>Banda</strong>
                  <span>Apoyo secundario de lectura. Cerca de una frontera deben prevalecer score, percentil y evidencia.</span>
                </div>
                <div>
                  <strong>Cobertura metodológica</strong>
                  <span>Documenta cuánto del catálogo está materializado. No equivale a confianza ni a menor amenaza.</span>
                </div>
              </div>
              <p className="territory-method-muted">
                El IGR describe el territorio. Ninguno de estos elementos atribuye conducta, incumplimiento o probabilidad de LA/FT a una entidad domiciliada en la comuna.
              </p>
            </section>
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
          label="Confianza IGR"
          value={cob.confianza_media == null ? '—' : `${n1(cob.confianza_media)}%`}
          foot={`${n(cob.baja_confianza)} comunas bajo el umbral medio de robustez`}
        />
        <Stat
          label="Cobertura metodológica"
          value={cob.cobertura_metodologica_media == null ? '—' : `${n1(cob.cobertura_metodologica_media)}%`}
          foot="disponibilidad del catálogo · no es confianza"
        />
      </div>

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
          <Panel title="Distribución por banda" meta={`${n(cob.comunas)} comunas`}>
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
              <th>Comuna</th><th>Región</th><th>Banda</th>
              <th className="right">IGR</th><th className="right">Percentil</th>
              <th className="right">Confianza</th><th className="right">Padrón UAF</th>
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
                <td className="right num" style={{ fontWeight: 650 }}>{c.igr_percentile == null ? '—' : `P${n1(c.igr_percentile)}`}</td>
                <td className="right num" style={{ color: 'var(--ink-3)' }}>{n1(c.igr_confidence)}%</td>
                <td className="right num">{n(c.ctx_uaf_observed)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <div style={{ marginTop: 24 }}>
        <Semantics>
          <strong>Qué queda deliberadamente fuera del índice.</strong>{' '}
          {m.excluido_del_indice.join(', ')}. El territorio se mantiene separado del
          riesgo sectorial y del riesgo individual para no contar dos veces el mismo
          fenómeno. Las cifras de entidades, padrón y sanciones que ves junto a cada comuna
          son contexto descriptivo: no entran en el cálculo. {data.semantics}
        </Semantics>
      </div>
    </div>
  );
}

function ComunaDetalle({
  territoryId, onBack, onNavigate,
}: {
  territoryId: string;
  onBack: () => void;
  onNavigate: (hash: string) => void;
}) {
  const { data, error, loading, reload } = useRpc<TerritoryDetail | null>(
    'obs_territory_detail', { p_territory_id: territoryId },
  );

  if (loading) return <Loading label="Abriendo el detalle territorial…" />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Empty title="Comuna no encontrada en el corte" />;

  return (
    <TerritoryCommuneWorkspace
      data={data}
      onBack={onBack}
      onNavigate={onNavigate}
    />
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
  const altas = filas.filter((c) => ['Alto', 'Muy alto'].includes(c.igr_level ?? '')).length;
  const uaf = filas.reduce((a, c) => a + c.ctx_uaf_observed, 0);
  return (
    <span>
      {n(filas.length)} comunas · IGR medio{' '}
      <span className="num">{n1(media)}</span> · {n(altas)} en banda Alta o Muy alta · padrón UAF{' '}
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
        Cada franja tiene su propia escala y la cifra bajo cada paso es el número de comunas. Las bandas son una ayuda secundaria: score y percentil son la lectura principal.
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

function Stat({ label, value, foot, tone }: { label: string; value: string; foot?: string; tone?: string }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value num" style={tone ? { color: tone } : undefined}>{value}</div>
      {foot && <div className="stat-foot">{foot}</div>}
    </div>
  );
}