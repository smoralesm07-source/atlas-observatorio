import { useRpc } from '../lib/rpc';
import type { SourceStatusRow } from '../lib/contracts';
import { Meter } from '../components/charts';
import { Badge, Empty, ErrorBox, Loading, Panel, Semantics } from '../components/primitives';
import { desde, n, n1, sourceClassLabel, sourceClassVar } from '../lib/format';

const DATA_TONE: Record<string, 'present' | 'high' | 'unknown'> = {
  fresh: 'present',
  silent: 'high',
  unknown: 'unknown',
};

const DATA_LABEL: Record<string, string> = {
  fresh: 'Al día',
  silent: 'En silencio',
  unknown: 'Sin señal',
};

export function Fuentes() {
  const { data, error, loading, reload } = useRpc<SourceStatusRow[]>('obs_source_status', {});

  if (loading) return <Loading label="Consultando el estado de las fuentes…" />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data?.length) return <Empty title="Sin catálogo de fuentes" />;

  const byClass = data.reduce<Record<string, SourceStatusRow[]>>((acc, r) => {
    (acc[r.source_class] ??= []).push(r);
    return acc;
  }, {});

  const order = ['producer', 'official_list', 'connector', 'investigative_dataset', 'osint_on_demand'];
  const classes = Object.keys(byClass).sort((a, b) => order.indexOf(a) - order.indexOf(b));

  return (
    <div className="fade-in">
      <header className="view-head">
        <h1 className="view-title">Fuentes</h1>
        <p className="view-lede">
          Qué alimenta al observatorio, con qué cadencia y desde cuándo no responde. Una
          fuente en silencio es una afirmación sobre nuestro canal de ingesta, no sobre la
          realidad que esa fuente describe.
        </p>
      </header>

      <div className="grid" style={{ gap: 16 }}>
        {classes.map((cls) => (
          <Panel
            key={cls}
            title={sourceClassLabel(cls)}
            meta={`${byClass[cls].length} fuentes`}
            pad={false}
          >
            <div className="grid grid-2" style={{ gap: 0 }}>
              {byClass[cls].map((s) => (
                <article
                  key={s.source_code}
                  style={{
                    padding: '15px 18px',
                    borderTop: '1px solid var(--line-soft)',
                    borderRight: '1px solid var(--line-soft)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <i
                      style={{
                        width: 9, height: 9, borderRadius: 2, marginTop: 5, flexShrink: 0,
                        background: sourceClassVar(s.source_class),
                      }}
                    />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <strong style={{ fontSize: 13.5, letterSpacing: '-0.012em' }}>
                          {s.source_name}
                        </strong>
                        <Badge tone={DATA_TONE[s.data_status ?? 'unknown'] ?? 'unknown'} dot>
                          {DATA_LABEL[s.data_status ?? 'unknown'] ?? s.data_status}
                        </Badge>
                        {s.integration_mode === 'on_demand' && (
                          <Badge tone="neutral">Bajo demanda</Badge>
                        )}
                      </div>

                      <div className="mono" style={{ fontSize: 10.5, color: 'var(--ink-4)', marginTop: 3 }}>
                        {s.source_code}
                      </div>

                      {s.authoritative_source && !s.authoritative_source.startsWith('http') && (
                        <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 5 }}>
                          Autoridad: {s.authoritative_source}
                        </div>
                      )}
                      {s.notes && (
                        <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 5, lineHeight: 1.5 }}>
                          {s.notes}
                        </div>
                      )}

                      {s.source_class === 'producer' && (
                        <div style={{ marginTop: 11 }}>
                          <Meter
                            value={Number(s.coverage_share ?? 0)}
                            label="Cobertura del universo"
                            hint={`${n(s.entity_coverage)} entidades con registro de esta fuente`}
                          />
                        </div>
                      )}

                      <div style={{ marginTop: 10, display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 11.5, color: 'var(--ink-3)' }}>
                        <span>Último registro: {desde(s.last_source_record_at)}</span>
                        {s.last_successful_ingest_at && (
                          <span>Última ingesta: {desde(s.last_successful_ingest_at)}</span>
                        )}
                        {s.records_24h != null && s.records_24h > 0 && (
                          <span className="num">{n(s.records_24h)} registros 24 h</span>
                        )}
                        {s.error_rate_24h != null && s.error_rate_24h > 0 && (
                          <span style={{ color: 'var(--sig-high)' }}>
                            error {n1(s.error_rate_24h * 100)}%
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </Panel>
        ))}
      </div>

      <div style={{ marginTop: 24 }}>
        <Semantics>
          <strong>Cobertura no es calidad.</strong> El porcentaje mide cuántas entidades
          del universo observado tienen registro en esa fuente, no cuán completo es ese
          registro. Universos distintos no se suman: el padrón UAF, el universo OSFL y el
          gasto público describen poblaciones diferentes y sólo se conectan cuando la
          relación de identidad y de grano está documentada.
        </Semantics>
      </div>
    </div>
  );
}
