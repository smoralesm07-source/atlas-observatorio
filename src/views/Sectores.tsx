import { useMemo, useState } from 'react';
import { useRpc } from '../lib/rpc';
import type { SectorDetail, SectorOverview, SectorRow } from '../lib/contracts';
import { Bars, Meter, Scatter } from '../components/charts';
import { Badge, Empty, ErrorBox, Loading, Panel, Semantics } from '../components/primitives';
import { hrefFor } from '../lib/router';
import { n, n1, pct, rutFormat, titleCase } from '../lib/format';

type Orden = 'inscritos' | 'vulnerabilidad' | 'ipf' | 'sancion';

const ORDENES: { id: Orden; label: string; get: (s: SectorRow) => number }[] = [
  { id: 'inscritos', label: 'Inscritos', get: (s) => s.subject_count },
  { id: 'vulnerabilidad', label: 'Vulnerabilidad', get: (s) => Number(s.vulnerability_index ?? -1) },
  { id: 'ipf', label: 'IPF medio', get: (s) => Number(s.ipf_mean ?? -1) },
  { id: 'sancion', label: 'Tasa sancionatoria', get: (s) => Number(s.sanction_rate_per_100 ?? -1) },
];

export function Sectores({ onNavigate }: { onNavigate: (hash: string) => void }) {
  const [sector, setSector] = useState<string | null>(null);
  const [orden, setOrden] = useState<Orden>('inscritos');
  const { data, error, loading, reload } = useRpc<SectorOverview>('obs_sector_overview', {});

  const ordenados = useMemo(() => {
    if (!data) return [];
    const g = ORDENES.find((o) => o.id === orden)!.get;
    return [...data.sectores].sort((a, b) => g(b) - g(a));
  }, [data, orden]);

  if (sector) {
    return <SectorDetalle sector={sector} onBack={() => setSector(null)} onNavigate={onNavigate} />;
  }

  if (loading) return <Loading label="Leyendo el padrón por sector…" />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Empty title="Sin sectores publicados" />;

  const t = data.totales;

  return (
    <div className="fade-in">
      <header className="view-head">
        <h1 className="view-title">Sectores obligados</h1>
        <p className="view-lede">
          Los {n(t.sectores)} sectores del padrón UAF, con su vulnerabilidad estructural, la
          presión supervisora observada y la distribución del índice de priorización
          fiscalizadora. Un sector expuesto no contiene entidades más culpables: contiene un
          modelo de negocio más expuesto.
        </p>
      </header>

      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <Stat label="Sujetos inscritos" value={n(t.inscritos)} foot={`en ${n(t.sectores)} sectores`} />
        <Stat
          label="Con evento sancionatorio"
          value={n(t.sancionados)}
          foot={`${n(t.eventos)} eventos publicados`}
          tone="var(--sig-critical)"
        />
        <Stat
          label="Vulnerabilidad media"
          value={n1(t.vulnerabilidad_media)}
          foot="estructural del sector, no conducta"
        />
        <Stat
          label="Cobertura SII media"
          value={t.cobertura_sii_media == null ? '—' : `${n1(t.cobertura_sii_media)}%`}
          foot="inscritos con actividad observable"
        />
      </div>

      <Panel
        title="Exposición estructural frente a presión supervisora"
        meta="tamaño del punto = inscritos · clic para abrir"
      >
        <Scatter
          rows={data.sectores}
          x={(s) => (s.vulnerability_index == null ? null : Number(s.vulnerability_index))}
          y={(s) => (s.ipf_mean == null ? null : Number(s.ipf_mean))}
          size={(s) => s.subject_count}
          label={(s) => titleCase(s.uaf_sector_canonical)}
          xLabel="Vulnerabilidad estructural"
          yLabel="IPF medio"
          highlight={(s) => Number(s.sanction_rate_per_100 ?? 0) > 0}
          highlightLabel="Con sanción"
          baseLabel="Sin sanción"
          onPick={(s) => setSector(s.uaf_sector_canonical)}
        />
        <div className="note" style={{ marginTop: 14 }}>
          Cada punto es un sector. Los marcados en rojo tienen al menos un evento
          sancionatorio publicado. Arriba a la derecha están los sectores estructuralmente
          más expuestos que además concentran mayor priorización fiscalizadora; abajo a la
          derecha, los expuestos que hoy reciben poca presión: esa esquina es la que suele
          valer la pena mirar.
        </div>
      </Panel>

      <div className="filters" style={{ margin: '18px 0 12px' }}>
        <span style={{ fontSize: 11, color: 'var(--ink-4)', letterSpacing: '.08em', textTransform: 'uppercase', fontWeight: 650, marginRight: 2 }}>
          Ordenar por
        </span>
        {ORDENES.map((o) => (
          <button key={o.id} className="chip" data-on={orden === o.id} onClick={() => setOrden(o.id)}>
            {o.label}
          </button>
        ))}
      </div>

      <Panel title={`${n(data.sectores.length)} sectores`} meta="clic para abrir el detalle" pad={false}>
        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Sector</th>
                <th className="right">Inscritos</th>
                <th className="right">Vulnerab.</th>
                <th className="right">IPF medio</th>
                <th className="right">IPF p90</th>
                <th className="right">Sancionados</th>
                <th className="right">Tasa /100</th>
                <th className="right">Cobertura SII</th>
                <th>Región principal</th>
              </tr>
            </thead>
            <tbody>
              {ordenados.map((s) => (
                <tr
                  key={s.uaf_sector_canonical}
                  onClick={() => setSector(s.uaf_sector_canonical)}
                  style={{ cursor: 'pointer' }}
                >
                  <td style={{ fontWeight: 600, minWidth: 220 }}>
                    {titleCase(s.uaf_sector_canonical)}
                  </td>
                  <td className="right num">{n(s.subject_count)}</td>
                  <td className="right num">{n1(s.vulnerability_index)}</td>
                  <td className="right num" style={{ fontWeight: 650 }}>{n1(s.ipf_mean)}</td>
                  <td className="right num" style={{ color: 'var(--ink-3)' }}>{n1(s.ipf_p90)}</td>
                  <td className="right num">{n(s.sanctioned_subjects)}</td>
                  <td className="right num" style={{ color: Number(s.sanction_rate_per_100 ?? 0) > 0 ? 'var(--sig-critical)' : undefined }}>
                    {n1(s.sanction_rate_per_100)}
                  </td>
                  <td className="right num">{s.sii_coverage_pct == null ? '—' : `${n1(s.sii_coverage_pct)}%`}</td>
                  <td style={{ color: 'var(--ink-3)' }}>
                    {s.top_region ?? '—'}
                    {s.top_region_share_pct != null && (
                      <span className="num" style={{ color: 'var(--ink-4)', marginLeft: 6 }}>
                        {n1(s.top_region_share_pct)}%
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <div style={{ marginTop: 24 }}>
        <Semantics>
          <strong>Vulnerabilidad, IPF y tasa sancionatoria no son lo mismo.</strong>{' '}
          {data.metodologia.vulnerabilidad} {data.metodologia.ipf}{' '}
          {data.metodologia.tasa_sancionatoria}
          <br />
          <br />
          <strong>Sobre IRAR-E.</strong> {data.metodologia.irar_e.nota} La fórmula gobernada
          es <span className="mono">{data.metodologia.irar_e.formula}</span>.
        </Semantics>
      </div>
    </div>
  );
}

function SectorDetalle({
  sector, onBack, onNavigate,
}: {
  sector: string;
  onBack: () => void;
  onNavigate: (hash: string) => void;
}) {
  const { data, error, loading, reload } = useRpc<SectorDetail | null>(
    'obs_sector_detail', { p_sector: sector },
  );

  if (loading) return <Loading label="Abriendo el sector…" />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Empty title="Sector no encontrado en el corte" />;

  const s = data.sector;
  const c = data.comparacion;
  const bandas = [
    { label: 'Muy alta', value: s.band_muy_alta ?? 0, tone: 'critical' as const },
    { label: 'Alta', value: s.band_alta ?? 0, tone: 'high' as const },
    { label: 'Media', value: s.band_media ?? 0, tone: 'medium' as const },
    { label: 'Baja', value: s.band_baja ?? 0, tone: 'watch' as const },
    { label: 'Mínima', value: s.band_minima ?? 0, tone: 'none' as const },
  ].filter((b) => b.value > 0);

  return (
    <div className="fade-in">
      <nav style={{ marginBottom: 14, fontSize: 12.5 }}>
        <button
          onClick={onBack}
          style={{ background: 'none', border: 0, color: 'var(--ink-3)', cursor: 'pointer', padding: 0 }}
        >
          ← Sectores
        </button>
      </nav>

      <header className="ficha-head">
        <div style={{ minWidth: 0, flex: '1 1 340px' }}>
          <h1 className="ficha-title">{titleCase(s.uaf_sector_canonical)}</h1>
          <div className="ficha-sub">
            <span>{n(s.subject_count)} inscritos</span>
            {s.natural_person_subjects != null && (
              <span>{n(s.natural_person_subjects)} personas naturales</span>
            )}
            {s.key_role && <span>{s.key_role}</span>}
            {s.top_region && <span>concentra en {s.top_region}</span>}
          </div>
        </div>

        <div className="ficha-scores">
          <ScoreTile
            value={n1(s.vulnerability_index)}
            label="Vulnerabilidad"
            hint={`media del padrón ${n1(c.vulnerabilidad_media)}`}
          />
          <ScoreTile
            value={n1(s.ipf_mean)}
            label="IPF medio"
            hint={`p90 ${n1(s.ipf_p90)} · media ${n1(c.ipf_medio)}`}
          />
          <ScoreTile
            value={n1(s.sanction_rate_per_100)}
            label="Tasa /100"
            hint={`media del padrón ${n1(c.tasa_media)}`}
            tone={Number(s.sanction_rate_per_100 ?? 0) > Number(c.tasa_media ?? 0) ? 'var(--sig-critical)' : undefined}
          />
        </div>
      </header>

      <div className="grid grid-main" style={{ marginTop: 16 }}>
        <div className="grid" style={{ gap: 16, alignContent: 'start' }}>
          {(s.activities?.length ?? 0) > 0 && (
            <Panel title="Giros característicos" meta="mide el padrón vigente" pad={false}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Giro económico</th>
                    <th className="right">Inscritos</th>
                    <th className="right">Universo</th>
                    <th className="right">Concentración</th>
                  </tr>
                </thead>
                <tbody>
                  {s.activities!.map((a) => (
                    <tr key={a.activity_name}>
                      <td>{titleCase(a.activity_name)}</td>
                      <td className="right num">{n(a.registered_count)}</td>
                      <td className="right num" style={{ color: 'var(--ink-3)' }}>{n(a.universe_count)}</td>
                      <td className="right num" style={{ fontWeight: 650 }}>
                        {pct(Number(a.concentration ?? 0) * 100)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="note" style={{ margin: 14 }}>
                No es una tabla normativa de correspondencias: es una medición de qué giros
                declaran quienes ya están inscritos. Un giro atípico para el sector no
                constituye incumplimiento.
              </div>
            </Panel>
          )}

          {data.entidades.length > 0 && (
            <Panel
              title={`Entidades del sector · ${data.entidades.length}`}
              meta="orden por prioridad analítica"
              pad={false}
            >
              <table className="table">
                <thead>
                  <tr>
                    <th>Entidad</th><th>RUT</th><th>Territorio</th>
                    <th className="right">Prioridad</th><th className="right">Fuentes</th>
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
                      <td style={{ color: 'var(--ink-3)' }}>
                        {e.region ?? '—'}{e.commune ? ` · ${e.commune}` : ''}
                      </td>
                      <td className="right num">{n1(e.ipa3_score)}</td>
                      <td className="right num">{n(e.source_count)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          )}
        </div>

        <div className="grid" style={{ gap: 16, alignContent: 'start' }}>
          {bandas.length > 0 && (
            <Panel title="Distribución del IPF" meta={`${n(s.subject_count)} inscritos`}>
              <Bars
                data={bandas.map((b) => ({ label: b.label, value: b.value, tone: b.tone }))}
              />
            </Panel>
          )}

          <Panel title="Observabilidad del sector">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
              {s.sii_coverage_pct != null && (
                <Meter
                  value={Number(s.sii_coverage_pct)}
                  label="Cobertura SII"
                  hint="Inscritos cuya actividad económica es observable."
                />
              )}
              <dl className="kv">
                <dt>Activos en SII</dt><dd className="num">{n(s.sii_active)}</dd>
                <dt>Terminados</dt><dd className="num">{n(s.sii_terminated)}</dd>
                <dt>Ausentes</dt><dd className="num">{n(s.sii_absent)}</dd>
                <dt>Giro atípico</dt><dd className="num">{n(s.atypical_activity_subjects)}</dd>
                <dt>Riesgo inherente</dt>
                <dd>{s.risk_inherent_1_5 == null ? '—' : `${n1(s.risk_inherent_1_5)} de 5`}</dd>
                <dt>Eventos sancionatorios</dt><dd className="num">{n(s.sanction_events)}</dd>
              </dl>
            </div>
          </Panel>

          {data.territorio.length > 0 && (
            <Panel title="Dónde está el sector" meta="por región">
              <Bars
                data={data.territorio.map((r) => ({
                  label: r.region,
                  value: r.n,
                  sub: r.sancionadas > 0 ? `${r.sancionadas} sanc.` : undefined,
                }))}
              />
            </Panel>
          )}
        </div>
      </div>

      <div style={{ marginTop: 24 }}>
        <Semantics>
          <strong>Alcance.</strong> {data.semantics}
        </Semantics>
      </div>
    </div>
  );
}

function ScoreTile({ value, label, hint, tone }: { value: string; label: string; hint?: string; tone?: string }) {
  return (
    <div style={{ minWidth: 122, padding: '12px 15px', borderRadius: 'var(--radius)', background: 'var(--bg-panel)', border: '1px solid var(--line)' }}>
      <div className="num" style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.035em', color: tone }}>
        {value}
      </div>
      <div style={{ fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--ink-3)', fontWeight: 650, marginTop: 3 }}>
        {label}
      </div>
      {hint && <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 3 }}>{hint}</div>}
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
