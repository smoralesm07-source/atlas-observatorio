import { useState } from 'react';
import {
  SOURCE_STATE_LABEL, WATCHLIST_LABEL, WATCHLIST_ORDER,
  evidenceLabel, evidenceValue,
  flattenWatchlist, type WatchlistRecord, type WatchlistResult,
} from '../lib/connectors';
import { Badge, Empty, Panel, Semantics } from './primitives';
import { desde, n, n1 } from '../lib/format';

/** Un candidato de lista internacional no es una coincidencia acreditada.
 *  La interfaz lo dice en cada tarjeta, no sólo en el pie de página. */
export function WatchlistResults({
  result,
  query,
}: {
  result: WatchlistResult;
  query: string;
}) {
  const records = flattenWatchlist(result);
  const exact = records.filter((r) => (r.match_confidence ?? 0) >= 0.95);
  const approx = records.filter((r) => (r.match_confidence ?? 0) < 0.95);
  const [showApprox, setShowApprox] = useState(exact.length === 0);

  const consulted = WATCHLIST_ORDER.map((code) => ({
    code,
    src: result.sources[code],
  })).filter((x) => x.src);

  return (
    <div className="grid" style={{ gap: 14 }}>
      <Panel
        title="Cobertura de la consulta"
        meta={result.routing.fallback_used ? 'vía fuentes oficiales directas' : 'vía agregador'}
      >
        <div className="grid grid-4" style={{ gap: 8 }}>
          {consulted.map(({ code, src }) => {
            const ok = src.status === 'fresh';
            const hits = src.records?.length ?? 0;
            return (
              <div
                key={code}
                className="source-tile"
                data-status={ok ? (hits ? 'PRESENT' : 'ABSENT') : 'NOT_CONSULTED'}
                title={src.error ?? undefined}
              >
                <i
                  style={{
                    width: 8, height: 8, borderRadius: 2, marginTop: 4, flexShrink: 0,
                    background: hits ? 'var(--sig-critical)' : ok ? 'var(--present)' : 'var(--line-strong)',
                  }}
                />
                <div style={{ minWidth: 0 }}>
                  <div className="sname">{WATCHLIST_LABEL[code] ?? code}</div>
                  <div className="sdesc">
                    {hits > 0
                      ? `${n(hits)} ${hits === 1 ? 'candidato' : 'candidatos'}`
                      : SOURCE_STATE_LABEL[src.status] ?? src.status}
                    {src.checked_at && ok ? ` · ${desde(src.checked_at)}` : ''}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        {result.routing.fallback_used && (
          <div className="note" style={{ marginTop: 12 }}>
            OpenSanctions no estuvo disponible ({SOURCE_STATE_LABEL[result.routing.fallback_reason ?? ''] ??
              result.routing.fallback_reason}). Se consultaron directamente las fuentes oficiales:{' '}
            {result.routing.direct_sources.map((c) => WATCHLIST_LABEL[c] ?? c).join(', ')}.
          </div>
        )}
      </Panel>

      {records.length === 0 ? (
        <Panel title="Sin candidatos">
          <Empty
            title={`Ninguna lista internacional devuelve candidatos para “${query}”`}
            hint="Eso no acredita ausencia: sólo las fuentes marcadas como consultadas respondieron, y la coincidencia se busca por nombre normalizado."
          />
        </Panel>
      ) : (
        <>
          {exact.length > 0 && (
            <Panel
              title={`Coincidencia exacta de nombre · ${exact.length}`}
              meta="requiere revisión del analista"
              pad={false}
            >
              <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {exact.map((r) => <WatchlistCard key={cardKey(r)} record={r} exact />)}
              </div>
            </Panel>
          )}

          {approx.length > 0 && (
            <Panel
              title={`Candidatos aproximados · ${approx.length}`}
              meta={
                <button className="chip" onClick={() => setShowApprox((v) => !v)}>
                  {showApprox ? 'Ocultar' : 'Revisar'}
                </button>
              }
              pad={false}
            >
              {showApprox && (
                <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {approx.map((r) => <WatchlistCard key={cardKey(r)} record={r} />)}
                </div>
              )}
            </Panel>
          )}
        </>
      )}

      <Semantics>
        <strong>Qué es y qué no es este resultado.</strong> Cada fila es un{' '}
        <em>candidato por nombre</em> en una fuente internacional. No se persiste, no crea
        identidad canónica, no transfiere riesgo y no modifica la prioridad analítica de
        ninguna entidad del universo. Homónimos y transliteraciones son frecuentes: la
        atribución la decide el analista contra la evidencia de la fuente original.
      </Semantics>
    </div>
  );
}

const cardKey = (r: WatchlistRecord) =>
  `${r.source_code}|${r.source_record_id}|${r.related_entity_name}`;

function WatchlistCard({ record, exact = false }: { record: WatchlistRecord; exact?: boolean }) {
  const conf = record.match_confidence;
  const tone = exact ? 'critical' : conf != null && conf >= 0.8 ? 'high' : 'medium';
  const ev = record.evidence ?? {};
  const facts = Object.entries(ev).filter(
    ([k, v]) => v != null && typeof v !== 'object' && k !== 'identity_guardrail',
  );

  return (
    <article className="alert-card">
      <div
        className="alert-rail"
        style={{ background: exact ? 'var(--sig-critical)' : 'var(--sig-medium)' }}
      />
      <div className="alert-body">
        <div className="alert-top">
          <Badge tone={tone as 'critical'} dot>
            {WATCHLIST_LABEL[record.source_code] ?? record.source_code}
          </Badge>
          <Badge tone="unknown">{exact ? 'Nombre exacto' : 'Aproximado'}</Badge>
          {conf != null && (
            <span className="num" style={{ marginLeft: 'auto', fontSize: 11.5, fontWeight: 650 }}>
              {n1(conf * 100)}%
            </span>
          )}
        </div>

        <h4 className="alert-title">{record.related_entity_name}</h4>
        {record.summary && <p className="alert-summary">{record.summary}</p>}

        {facts.length > 0 && (
          <dl className="kv" style={{ marginTop: 10 }}>
            {facts.slice(0, 6).map(([k, v]) => (
              <div key={k} style={{ display: 'contents' }}>
                <dt>{evidenceLabel(k)}</dt>
                <dd>{evidenceValue(v)}</dd>
              </div>
            ))}
          </dl>
        )}

        <div className="alert-foot">
          <span className="mono" style={{ fontSize: 11, color: 'var(--ink-4)' }}>
            {record.match_method}
          </span>
          {record.source_url && (
            <a
              href={record.source_url}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: 'var(--accent)', fontWeight: 550, marginLeft: 'auto' }}
            >
              Ver en la fuente ↗
            </a>
          )}
        </div>
      </div>
    </article>
  );
}
