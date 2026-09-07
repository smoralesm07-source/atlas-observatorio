import { useState } from 'react';
import { useRpc } from '../lib/rpc';
import type { TerritoryDetail, TerritoryMap } from '../lib/contracts';
import { Bars, Meter, OrderedDistribution } from '../components/charts';
import { Badge, Empty, ErrorBox, Loading, Panel, Semantics } from '../components/primitives';
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

export function Territorio({ onNavigate }: { onNavigate: (hash: string) => void }) {
  const [commune, setCommune] = useState<string | null>(null);
  const { data, error, loading, reload } = useRpc<TerritoryMap>('obs_territory_map', {});

  if (commune) {
    return <ComunaDetalle territoryId={commune} onBack={() => setCommune(null)} onNavigate={onNavigate} />;
  }

  if (loading) return <Loading label="Leyendo el índice territorial…" />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Empty title="Sin territorio publicado" />;

  const m = data.metodologia;
  const cob = data.cobertura;

  return (
    <div className="fade-in">
      <header className="view-head">
        <h1 className="view-title">Territorio</h1>
        <p className="view-lede">
          Dónde hay mayor amenaza territorial relevante para lavado de activos. El indicador
          vigente es <strong>{m.indicador} {m.version.replace(/^IGR-/, '')}</strong>, en el que{' '}
          <span className="mono">{m.formula}</span>. Describe el territorio, no a las
          entidades domiciliadas en él.
        </p>
      </header>

      {/* La cobertura de delitos base condiciona toda lectura del índice, así que
          va arriba y no escondida en una nota al pie. */}
      <div className="semantics" style={{ marginBottom: 16 }}>
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, marginTop: 1 }} aria-hidden>
          <circle cx="8" cy="8" r="6.6" stroke="currentColor" strokeWidth="1.3" opacity=".55" />
          <path d="M8 7.2v4M8 4.9v.9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <div>
          <strong>Qué alcanza a ver hoy este índice.</strong> La capa de amenazas precedentes
          está materializada principalmente con{' '}
          {m.cobertura_delitos_base.materializadas.join(', ')}. Todavía{' '}
          <em>no</em> incorpora {m.cobertura_delitos_base.no_materializadas.join(', ')}, y el
          Observatorio no las presenta como si tuvieran cobertura territorial suficiente. Un
          IGR bajo significa poca amenaza de las familias medidas, no ausencia de amenaza.
        </div>
      </div>

      <div className="grid grid-4" style={{ marginBottom: 16 }}>
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
      </div>

      <div className="grid grid-main" style={{ marginBottom: 16 }}>
        <Panel title="Regiones" meta="media comunal ponderada por confianza">
          <Bars
            data={data.regiones.map((r) => ({
              label: r.region_name,
              value: Number(r.igr_ponderado ?? 0),
              sub: `máx ${n1(r.igr_max)}`,
            }))}
            max={100}
          />
          <div className="note" style={{ marginTop: 14 }}>
            El IGR regional no es un promedio simple: cada comuna pesa según su confianza
            CEAD, de modo que una comuna mal cubierta no arrastra a su región.
          </div>
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
              <th className="right">IGR</th><th className="right">Confianza</th>
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
                <td className="right num" style={{ color: 'var(--ink-3)' }}>{n1(c.igr_confidence)}</td>
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
              confianza {n1(t.igr_confidence)}
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

function Stat({ label, value, foot, tone }: { label: string; value: string; foot?: string; tone?: string }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value num" style={tone ? { color: tone } : undefined}>{value}</div>
      {foot && <div className="stat-foot">{foot}</div>}
    </div>
  );
}
