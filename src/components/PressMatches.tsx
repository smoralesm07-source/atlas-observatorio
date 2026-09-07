import type { PressMatch } from '../lib/press';
import { titleCase } from '../lib/format';
import { Badge } from './primitives';

function dateLabel(value: string | null): string {
  if (!value) return 'fecha no informada';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return new Intl.DateTimeFormat('es-CL', {
    day: '2-digit', month: 'short', year: 'numeric',
  }).format(date);
}

function matchLabel(kind: PressMatch['match_kind']): string | null {
  if (kind === 'APROXIMADA') return 'Coincidencia aproximada';
  if (kind === 'RUT') return 'RUT coincidente';
  return null;
}

export function PressMatches({ matches, loading }: { matches: PressMatch[]; loading?: boolean }) {
  if (!matches.length && !loading) return null;

  return (
    <section style={{ marginTop: 18 }} aria-label="Coincidencias de prensa">
      <div className="section-title" style={{ marginBottom: 10 }}>
        Prensa coincidente
        {loading ? <span className="hint">actualizando…</span> : <span className="hint">Radar Prensa · Monitor UAF</span>}
      </div>

      <div style={{ display: 'grid', gap: 12 }}>
        {matches.map((match) => (
          <article className="panel" key={match.press_entity_id} style={{ padding: 16 }}>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', alignItems: 'center' }}>
                  <strong style={{ fontSize: 16 }}>{titleCase(match.name)}</strong>
                  <Badge tone="present">Prensa</Badge>
                  <Badge tone="neutral">
                    {match.article_count} {match.article_count === 1 ? 'noticia' : 'noticias'}
                  </Badge>
                  {matchLabel(match.match_kind) && <Badge tone="unknown">{matchLabel(match.match_kind)}</Badge>}
                  {match.resolution_status === 'PRESS_ONLY' && (
                    <Badge
                      tone="unknown"
                      title="La identidad fue detectada en prensa y todavía no está conciliada con una identidad canónica de Atlas."
                    >
                      Identidad sin resolver
                    </Badge>
                  )}
                </div>

                <div className="row-meta" style={{ marginTop: 7 }}>
                  {match.entity_type && <span>{titleCase(match.entity_type)}</span>}
                  {match.roles[0] && <span>{match.roles[0]}</span>}
                  {match.last_seen && <span>última mención {dateLabel(match.last_seen)}</span>}
                  {match.media.length > 0 && <span>{match.media.slice(0, 3).join(' · ')}</span>}
                </div>
              </div>
            </div>

            {match.articles.length > 0 ? (
              <div style={{ display: 'grid', gap: 8, marginTop: 13 }}>
                {match.articles.map((article, index) => (
                  <details
                    key={`${match.press_entity_id}-${article.id}`}
                    open={index === 0}
                    style={{
                      borderTop: '1px solid var(--line)',
                      paddingTop: 10,
                    }}
                  >
                    <summary style={{ cursor: 'pointer', listStyle: 'none' }}>
                      <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', alignItems: 'baseline' }}>
                        <span style={{ fontWeight: 650, lineHeight: 1.35 }}>{article.title}</span>
                        <span style={{ whiteSpace: 'nowrap', fontSize: 11, color: 'var(--ink-4)' }}>
                          {dateLabel(article.date)}
                        </span>
                      </div>
                      <div className="row-meta" style={{ marginTop: 4 }}>
                        {article.media && <span>{article.media}</span>}
                        {article.role && <span>{article.role}</span>}
                      </div>
                    </summary>

                    <div style={{ paddingTop: 9, fontSize: 13, lineHeight: 1.55, color: 'var(--ink-2)' }}>
                      {article.summary ? (
                        <p style={{ margin: 0 }}>{article.summary}</p>
                      ) : (
                        <p style={{ margin: 0, color: 'var(--ink-4)' }}>La fuente no entregó un resumen en este corte.</p>
                      )}
                      {article.url && (
                        <a
                          className="btn"
                          href={article.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ display: 'inline-flex', marginTop: 10, textDecoration: 'none' }}
                          onClick={(event) => event.stopPropagation()}
                        >
                          Abrir noticia ↗
                        </a>
                      )}
                    </div>
                  </details>
                ))}
                {match.article_count > match.articles.length && (
                  <div className="hint">
                    Se muestran las {match.articles.length} menciones más recientes de {match.article_count} noticias asociadas.
                  </div>
                )}
              </div>
            ) : (
              <div className="note" style={{ marginTop: 12 }}>
                La entidad está en el índice de prensa, pero este corte no pudo enlazar el detalle de la noticia.
              </div>
            )}
          </article>
        ))}
      </div>

      <div className="note" style={{ marginTop: 10 }}>
        Una coincidencia de prensa entrega contexto de fuente abierta. No acredita identidad, participación ni responsabilidad por sí sola.
      </div>
    </section>
  );
}
