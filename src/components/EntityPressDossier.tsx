import { useEffect, useMemo, useState } from 'react';
import { Empty } from './primitives';
import { fecha, n, titleCase } from '../lib/format';
import type { PressArticleMatch, PressMatch } from '../lib/press';

type PressStatus = 'idle' | 'loading' | 'done' | 'error';
type EvidenceKind = 'directa' | 'contexto' | 'revision';
type ArticleRow = PressArticleMatch & { match: PressMatch; evidence: EvidenceKind };

const EVIDENCE_RANK: Record<EvidenceKind, number> = {
  directa: 3,
  contexto: 2,
  revision: 1,
};

function evidenceKind(article: PressArticleMatch, match: PressMatch): EvidenceKind {
  if (
    match.resolution_status === 'GROUP_CONTEXT'
    || match.nature === 'GROUP_CONTEXT'
    || /contexto de grupo/i.test(article.role ?? '')
  ) return 'contexto';

  const governed = !match.requires_validation && !article.mention_requires_validation;
  const strongIdentity = match.match_kind === 'RUT' || match.match_kind === 'EXACTA' || match.match_score >= 0.98;
  const strongMention = article.mention_confidence == null || article.mention_confidence >= 0.90;
  return governed && strongIdentity && strongMention ? 'directa' : 'revision';
}

function evidenceLabel(kind: EvidenceKind): string {
  if (kind === 'directa') return 'Coincidencia directa';
  if (kind === 'contexto') return 'Contexto de marca / grupo';
  return 'Revisar identidad';
}

function evidenceReason(article: ArticleRow): string {
  if (article.evidence === 'contexto') {
    return 'La nota menciona una marca o grupo relacionado; no se atribuye el hecho a esta razón social.';
  }
  if (article.evidence === 'revision') {
    return article.match.match_source === 'ARTICLE_TEXT'
      ? 'Coincidencia textual de fuente abierta. Conviene corroborar que corresponda a esta entidad.'
      : 'La identidad periodística no queda completamente resuelta y requiere corroboración analítica.';
  }
  if (article.match.match_kind === 'RUT') return 'Coincidencia enlazada por RUT en el índice de prensa.';
  if (article.match.match_kind === 'EXACTA') return 'Coincidencia por razón social exacta en el índice de prensa.';
  return 'Coincidencia de identidad gobernada por Radar Prensa.';
}

function articleRows(matches: PressMatch[]): ArticleRow[] {
  const byId = new Map<string, ArticleRow>();
  matches.forEach((match) => {
    match.articles.forEach((article) => {
      const candidate: ArticleRow = { ...article, match, evidence: evidenceKind(article, match) };
      const current = byId.get(article.id);
      if (!current || EVIDENCE_RANK[candidate.evidence] > EVIDENCE_RANK[current.evidence]) {
        byId.set(article.id, candidate);
      }
    });
  });
  return Array.from(byId.values()).sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')));
}

function monthBuckets(rows: ArticleRow[]) {
  const counts = new Map<string, number>();
  rows.forEach((article) => {
    const match = String(article.date ?? '').match(/^(\d{4})-(\d{2})/);
    if (!match) return;
    const key = `${match[1]}-${match[2]}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  const formatter = new Intl.DateTimeFormat('es-CL', { month: 'short', year: '2-digit' });
  return Array.from(counts.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-18)
    .map(([key, count]) => ({
      key,
      count,
      label: formatter.format(new Date(`${key}-01T12:00:00`)).replace('.', ''),
    }));
}

export function EntityPressDossier({
  entityName,
  status,
  matches,
  error,
}: {
  entityName: string;
  status: PressStatus;
  matches: PressMatch[];
  error?: string;
}) {
  const [kind, setKind] = useState<'todas' | EvidenceKind>('todas');
  const [media, setMedia] = useState('todas');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [term, setTerm] = useState('');
  const [visible, setVisible] = useState(20);

  const articles = useMemo(() => articleRows(matches), [matches]);
  const mediaOptions = useMemo(() => Array.from(new Set(articles
    .map((article) => article.media)
    .filter((value): value is string => Boolean(value))))
    .sort((a, b) => a.localeCompare(b, 'es')), [articles]);

  const counts = useMemo(() => ({
    directa: articles.filter((article) => article.evidence === 'directa').length,
    contexto: articles.filter((article) => article.evidence === 'contexto').length,
    revision: articles.filter((article) => article.evidence === 'revision').length,
  }), [articles]);

  const filtered = useMemo(() => {
    const needle = term.trim().toLocaleLowerCase('es-CL');
    return articles.filter((article) => {
      if (kind !== 'todas' && article.evidence !== kind) return false;
      if (media !== 'todas' && article.media !== media) return false;
      const day = String(article.date ?? '').slice(0, 10);
      if (fromDate && (!day || day < fromDate)) return false;
      if (toDate && (!day || day > toDate)) return false;
      if (needle) {
        const haystack = `${article.title ?? ''} ${article.summary ?? ''} ${article.media ?? ''}`.toLocaleLowerCase('es-CL');
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
  }, [articles, kind, media, fromDate, toDate, term]);

  useEffect(() => setVisible(20), [kind, media, fromDate, toDate, term]);

  const buckets = useMemo(() => monthBuckets(filtered), [filtered]);
  const maxBucket = Math.max(1, ...buckets.map((bucket) => bucket.count));
  const firstDate = articles.length ? articles[articles.length - 1]?.date : null;
  const lastDate = articles.length ? articles[0]?.date : null;
  const hasFilters = kind !== 'todas' || media !== 'todas' || fromDate || toDate || term;

  const clearFilters = () => {
    setKind('todas');
    setMedia('todas');
    setFromDate('');
    setToDate('');
    setTerm('');
  };

  return <div className="entity360-press-dossier">
    <section className="entity360-press-overview">
      <div className="entity360-press-overview-copy">
        <div className="entity360-press-overline">Radar Prensa Entidades</div>
        <h2>Expediente periodístico</h2>
        <p>Histórico de menciones de fuente abierta asociado a <strong>{titleCase(entityName)}</strong>. La vista separa identidad resuelta, contexto de marca o grupo y coincidencias que requieren corroboración.</p>
        <div className="entity360-press-range">{firstDate && lastDate ? `${fecha(firstDate)} → ${fecha(lastDate)}` : 'Sin rango temporal disponible'}</div>
      </div>
      <div className="entity360-press-kpis">
        <div><span>Noticias</span><strong>{n(articles.length)}</strong><small>{n(mediaOptions.length)} medios</small></div>
        <div data-kind="directa"><span>Directas</span><strong>{n(counts.directa)}</strong><small>identidad resuelta</small></div>
        <div data-kind="contexto"><span>Contexto</span><strong>{n(counts.contexto)}</strong><small>marca / grupo</small></div>
        <div data-kind="revision"><span>Por revisar</span><strong>{n(counts.revision)}</strong><small>corroboración</small></div>
      </div>
    </section>

    <section className="entity360-press-controls" aria-label="Filtros del expediente de prensa">
      <div className="entity360-press-kind-filter">
        <button type="button" data-active={kind === 'todas'} onClick={() => setKind('todas')}>Todas <span>{n(articles.length)}</span></button>
        <button type="button" data-active={kind === 'directa'} onClick={() => setKind('directa')}>Directas <span>{n(counts.directa)}</span></button>
        <button type="button" data-active={kind === 'contexto'} onClick={() => setKind('contexto')}>Contexto <span>{n(counts.contexto)}</span></button>
        <button type="button" data-active={kind === 'revision'} onClick={() => setKind('revision')}>Por revisar <span>{n(counts.revision)}</span></button>
      </div>
      <label>Medio<select value={media} onChange={(event) => setMedia(event.target.value)}><option value="todas">Todos los medios</option>{mediaOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
      <label>Desde<input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></label>
      <label>Hasta<input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} /></label>
      <label className="entity360-press-search">Buscar<input value={term} onChange={(event) => setTerm(event.target.value)} placeholder="Titular, extracto o medio" /></label>
      {hasFilters && <button type="button" className="entity360-press-clear" onClick={clearFilters}>Limpiar filtros</button>}
    </section>

    <section className="entity360-press-timeline-card">
      <header><div><span>Actividad periodística</span><strong>{n(filtered.length)} noticias en la selección</strong></div><small>últimos 18 meses con menciones</small></header>
      {buckets.length ? <div className="entity360-press-timeline" role="img" aria-label="Distribución mensual de menciones de prensa">
        {buckets.map((bucket) => <div className="entity360-press-month" key={bucket.key} title={`${bucket.label}: ${bucket.count} noticia${bucket.count === 1 ? '' : 's'}`}><div><i style={{ height: `${Math.max(10, Math.round((bucket.count / maxBucket) * 100))}%` }} /></div><strong>{bucket.count}</strong><span>{bucket.label}</span></div>)}
      </div> : <Empty title="Sin fechas en la selección" hint="Ajusta los filtros para volver a mostrar la actividad temporal." />}
    </section>

    <section className="entity360-press-results">
      <header><div><span>Noticias asociadas</span><strong>{n(filtered.length)} resultados</strong></div>{status === 'loading' && <small>Actualizando Radar Prensa…</small>}</header>
      {status === 'error' ? <div className="entity360-card-message">Radar Prensa no respondió en esta consulta. {error}</div>
        : filtered.length ? <div className="entity360-press-feed">{filtered.slice(0, visible).map((article) => <article key={`${article.id}-${article.match.press_entity_id}`} data-evidence={article.evidence}>
          <div className="entity360-press-feed-meta"><span className="entity360-press-evidence">{evidenceLabel(article.evidence)}</span><time>{fecha(article.date)}</time><span>{article.media ?? 'Prensa abierta'}</span></div>
          <h3>{article.title}</h3>
          <p>{article.summary ?? 'La fuente no entrega un extracto en el corte vigente.'}</p>
          <div className="entity360-press-identity-note"><i />{evidenceReason(article)}</div>
          <div className="entity360-press-feed-foot">{article.role && <span>{article.role}</span>}{article.url && <a href={article.url} target="_blank" rel="noopener noreferrer">Abrir nota ↗</a>}</div>
        </article>)}</div>
        : status === 'loading' ? <div className="entity360-card-message">Construyendo el expediente periodístico…</div>
          : <Empty title="Sin noticias para estos filtros" hint="No hay coincidencias suficientemente precisas dentro de la selección actual." />}
      {filtered.length > visible && <button type="button" className="entity360-press-more" onClick={() => setVisible((value) => value + 20)}>Mostrar 20 noticias más · quedan {n(filtered.length - visible)}</button>}
    </section>

    <div className="entity360-press-governance"><strong>Regla de lectura.</strong> Una noticia es evidencia de una publicación, no de la veracidad del hecho ni de responsabilidad de la entidad. Las coincidencias “Contexto” y “Por revisar” se muestran deliberadamente separadas para evitar atribuciones automáticas.</div>
  </div>;
}
