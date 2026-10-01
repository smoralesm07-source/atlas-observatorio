import { useEffect, useMemo, useState } from 'react';
import type { PressMatch } from '../lib/press';
import { entityPressArticleRows, pressEvidenceLabel, searchEntityPress, type EntityPressArticle } from '../lib/entityPress';
import '../styles/huella-publica-press.css';

type PressState = {
  status: 'idle' | 'loading' | 'done' | 'error';
  matches: PressMatch[];
};

type DirectArticle = EntityPressArticle;
type SortMode = 'RECENT' | 'OLDEST';

type Props = {
  entityRut: string;
  entityName: string;
  entityId?: string | null;
  fromYear: number;
  toYear: number;
  onNavigate: (hash: string) => void;
  showPreview?: boolean;
};

const TOPICS: Array<{ label: string; pattern: RegExp }> = [
  { label: 'Contratación pública', pattern: /licitaci[oó]n|contrataci[oó]n p[uú]blica|mercado p[uú]blico|orden(?:es)? de compra|adjudicaci[oó]n/i },
  { label: 'Conflicto de interés', pattern: /conflicto(?:s)? de inter[eé]s|incompatibilidad/i },
  { label: 'Investigación', pattern: /investiga|investigaci[oó]n|fiscal[ií]a|formalizaci[oó]n|querella|denuncia/i },
  { label: 'Fraude / estafa', pattern: /fraude|estafa|defraudaci[oó]n/i },
  { label: 'Corrupción / cohecho', pattern: /corrupci[oó]n|cohecho|soborno/i },
  { label: 'LA/FT', pattern: /lavado de activos|lavado de dinero|financiamiento del terrorismo|blanqueo/i },
  { label: 'Contraloría', pattern: /contralor[ií]a/i },
  { label: 'Sanciones', pattern: /sanci[oó]n|multa|infracci[oó]n/i },
  { label: 'Colusión', pattern: /colusi[oó]n|libre competencia/i },
  { label: 'Materia tributaria', pattern: /tributari|impuesto|factura falsa/i },
];

function inPeriod(article: DirectArticle, fromYear: number, toYear: number) {
  const year = Number(String(article.date ?? '').slice(0, 4));
  if (!Number.isFinite(year) || year < 1900) return true;
  return year >= fromYear && year <= toYear;
}

function dateLabel(value: string | null | undefined) {
  if (!value) return 'Fecha s/d';
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: 'short', year: 'numeric' }).format(date).replace('.', '');
}

function topicsFor(article: DirectArticle) {
  const text = `${article.title ?? ''} ${article.summary ?? ''}`;
  return TOPICS.filter((topic) => topic.pattern.test(text)).map((topic) => topic.label).slice(0, 4);
}

function relevanceFor(article: DirectArticle) {
  const topics = topicsFor(article);
  const highSignals = new Set(['Contratación pública', 'Conflicto de interés', 'Investigación', 'Fraude / estafa', 'Corrupción / cohecho', 'LA/FT', 'Contraloría', 'Sanciones']);
  const hits = topics.filter((topic) => highSignals.has(topic)).length;
  return hits >= 2 ? 'Alta relevancia' : 'Relevancia media';
}

function sourceInitials(value: string | null | undefined) {
  const text = String(value ?? 'Prensa').trim();
  const initials = text.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('');
  return initials || 'P';
}

export function HuellaPublicaPress({ entityRut, entityName, entityId, fromYear, toYear, onNavigate, showPreview = false }: Props) {
  const [state, setState] = useState<PressState>({ status: 'idle', matches: [] });
  const [open, setOpen] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>('RECENT');

  useEffect(() => {
    let cancelled = false;
    const rut = entityRut.trim();
    const name = entityName.trim();
    if (!rut) {
      setState({ status: 'idle', matches: [] });
      return () => { cancelled = true; };
    }

    setState({ status: 'loading', matches: [] });
    void (async () => {
      try {
        const combined = await searchEntityPress(name, rut, 10);
        if (!cancelled) setState({ status: 'done', matches: combined });
      } catch {
        if (!cancelled) setState({ status: 'error', matches: [] });
      }
    })();

    return () => { cancelled = true; };
  }, [entityRut, entityName]);

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const allArticles = useMemo(() => entityPressArticleRows(state.matches), [state.matches]);
  const periodArticles = useMemo(() => allArticles.filter((article) => inPeriod(article, fromYear, toYear)), [allArticles, fromYear, toYear]);
  const articles = useMemo(() => {
    const rows = [...periodArticles];
    return rows.sort((a, b) => sortMode === 'RECENT'
      ? String(b.date ?? '').localeCompare(String(a.date ?? ''))
      : String(a.date ?? '').localeCompare(String(b.date ?? '')));
  }, [periodArticles, sortMode]);
  const previewArticles = periodArticles.length > 0 ? periodArticles : allArticles;
  const lastArticle = allArticles[0] ?? null;
  const historicalDirectCount = allArticles.filter((article) => article.evidence === 'directa').length;
  const directCount = periodArticles.filter((article) => article.evidence === 'directa').length;
  const contextCount = periodArticles.filter((article) => article.evidence === 'contexto').length;
  const reviewCount = periodArticles.filter((article) => article.evidence === 'revision').length;

  const countLabel = state.status === 'loading'
    ? 'Consultando…'
    : state.status === 'error'
      ? 'No disponible'
      : allArticles.length === 0
        ? 'Sin coincidencias de prensa'
        : historicalDirectCount > 0
          ? `${allArticles.length.toLocaleString('es-CL')} coincidencias históricas · ${historicalDirectCount.toLocaleString('es-CL')} directas`
          : `${allArticles.length.toLocaleString('es-CL')} coincidencias históricas`;

  const periodLabel = allArticles.length > 0 && periodArticles.length === 0
    ? `Sin coincidencias en ${fromYear}–${toYear} · última ${dateLabel(lastArticle?.date)}`
    : lastArticle
      ? `Última: ${dateLabel(lastArticle.date)} · ${periodArticles.length.toLocaleString('es-CL')} en ${fromYear}–${toYear}`
      : state.status === 'done'
        ? `Sin coincidencias en ${fromYear}–${toYear}`
        : 'Radar Prensa';

  return (
    <div className="state-press-root">
      <button type="button" className="state-press-alert" onClick={() => setOpen(true)} aria-haspopup="dialog">
        <span className="state-press-alert-icon" aria-hidden="true">▤</span>
        <span className="state-press-alert-copy">
          <small>Contexto Atlas</small>
          <b>Prensa relevante</b>
          <strong>{countLabel}</strong>
          <em>{periodLabel}</em>
        </span>
        <span className="state-press-alert-arrow" aria-hidden="true">›</span>
      </button>

      {showPreview && <section className="state-press-preview" aria-label="Vista previa de prensa relevante">
        <header><div><span>Contexto Atlas</span><h3>Prensa relevante</h3></div><button type="button" onClick={() => setOpen(true)}>Ver todas →</button></header>
        {state.status === 'loading' && <div className="state-press-preview-status">Consultando Radar Prensa…</div>}
        {state.status === 'error' && <div className="state-press-preview-status">Prensa no disponible en esta consulta.</div>}
        {state.status === 'done' && allArticles.length === 0 && <div className="state-press-preview-status">Sin coincidencias de prensa para esta entidad.</div>}
        {state.status === 'done' && allArticles.length > 0 && periodArticles.length === 0 && <div className="state-press-preview-status">Hay {allArticles.length.toLocaleString('es-CL')} coincidencia{allArticles.length === 1 ? '' : 's'} histórica{allArticles.length === 1 ? '' : 's'}; ninguna cae en {fromYear}–{toYear}. Se muestran las más recientes.</div>}
        {state.status === 'done' && previewArticles.length > 0 && <div className="state-press-preview-list">
          {previewArticles.slice(0, 4).map((article) => {
            const relevance = relevanceFor(article);
            return <button type="button" key={article.id} className="state-press-preview-row" onClick={() => setOpen(true)}>
              <span className="state-press-preview-source">{sourceInitials(article.media)}</span>
              <span className="state-press-preview-copy"><small>{article.media || 'Prensa abierta'} · {dateLabel(article.date)}</small><strong>{article.title}</strong></span>
              <span className="state-press-preview-relevance" data-level={relevance === 'Alta relevancia' ? 'high' : 'medium'}><i />{relevance}</span>
            </button>;
          })}
        </div>}
      </section>}

      {open && <div className="state-press-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
        <aside className="state-press-drawer" role="dialog" aria-modal="true" aria-label={`Prensa relevante de ${entityName}`}>
          <header className="state-press-drawer-head">
            <div className="state-press-drawer-title">
              <span aria-hidden="true">▤</span>
              <div>
                <small>Contexto Atlas · Radar Prensa</small>
                <h2>Prensa relevante</h2>
                <p>Coincidencias asociadas a <strong>{entityName}</strong> con la misma resolución de identidad usada por Entidad 360. La relación con prensa es histórica; el período de Huella pública sólo filtra el detalle económico-temporal.</p>
              </div>
            </div>
            <button type="button" className="state-press-close" onClick={() => setOpen(false)} aria-label="Cerrar ficha de prensa">×</button>
          </header>

          <div className="state-press-drawer-actions">
            {entityId && <button type="button" className="state-secondary" onClick={() => { setOpen(false); onNavigate(`#/entidad/${encodeURIComponent(entityId)}?tab=prensa`); }}>Ver expediente completo →</button>}
            <span>{fromYear}–{toYear} · {periodArticles.length.toLocaleString('es-CL')} en período · {allArticles.length.toLocaleString('es-CL')} históricas</span>
          </div>

          <div className="state-press-drawer-metrics">
            <div><i>◎</i><span><strong>{allArticles.length.toLocaleString('es-CL')}</strong><small>Históricas</small></span></div>
            <div><i>●</i><span><strong>{directCount.toLocaleString('es-CL')}</strong><small>Directas en período</small></span></div>
            <div><i>◇</i><span><strong>{(contextCount + reviewCount).toLocaleString('es-CL')}</strong><small>Contexto / revisar</small></span></div>
            <div><i>▦</i><span><strong>{lastArticle ? dateLabel(lastArticle.date) : '—'}</strong><small>Última mención</small></span></div>
          </div>

          <div className="state-press-list-head">
            <div><span>Noticias en período</span><strong>{periodArticles.length.toLocaleString('es-CL')}</strong></div>
            <label>Ordenar por
              <select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)}>
                <option value="RECENT">Fecha (más reciente)</option>
                <option value="OLDEST">Fecha (más antigua)</option>
              </select>
            </label>
          </div>

          <div className="state-press-drawer-body">
            {state.status === 'loading' && <div className="state-press-status"><span className="state-press-loader" />Consultando Radar Prensa para esta entidad…</div>}
            {state.status === 'error' && <div className="state-press-status state-press-status-error">Radar Prensa no está disponible en esta consulta. La información económica de Huella pública permanece operativa.</div>}
            {state.status === 'done' && articles.length === 0 && <div className="state-press-empty"><span>○</span><div><strong>Sin coincidencias de prensa en {fromYear}–{toYear}</strong><p>{allArticles.length > 0 ? `La relación con prensa sí existe: Radar Prensa registra ${allArticles.length.toLocaleString('es-CL')} coincidencia${allArticles.length === 1 ? '' : 's'} histórica${allArticles.length === 1 ? '' : 's'}, fuera del período seleccionado. Entidad 360 conserva el expediente completo.` : 'Entidad 360 y Huella pública no registran coincidencias periodísticas para esta entidad en el índice vigente.'}</p></div></div>}

            {state.status === 'done' && articles.length > 0 && <div className="state-press-drawer-feed">
              {articles.map((article) => {
                const topics = topicsFor(article);
                const relevance = relevanceFor(article);
                return <article key={article.id} className="state-press-drawer-row" data-relevance={relevance === 'Alta relevancia' ? 'high' : 'medium'} data-evidence={article.evidence}>
                  <div className="state-press-source-mark">{sourceInitials(article.media)}</div>
                  <div className="state-press-drawer-copy">
                    <div className="state-press-drawer-meta"><span className="state-press-evidence" data-kind={article.evidence}>{pressEvidenceLabel(article.evidence)}</span><time>{dateLabel(article.date)}</time><span>·</span><span>{article.media || 'Prensa abierta'}</span></div>
                    <h3>{article.title}</h3>
                    {article.summary && <p>{article.summary}</p>}
                    <div className="state-press-tags">{topics.map((topic) => <span key={topic}>{topic}</span>)}{article.role && <span>{article.role}</span>}</div>
                  </div>
                  <div className="state-press-drawer-side">
                    <span className="state-press-relevance"><i />{relevance}</span>
                    {article.url ? <a href={article.url} target="_blank" rel="noopener noreferrer">Abrir nota ↗</a> : <span className="state-press-no-link">Sin enlace</span>}
                  </div>
                </article>;
              })}
            </div>}
          </div>

          <footer className="state-press-rule"><strong>Regla de lectura.</strong> Huella pública y Entidad 360 utilizan la misma resolución de Radar Prensa. La existencia de relación con prensa se evalúa sobre el histórico común; el selector temporal de Huella sólo acota el detalle mostrado. Una noticia acredita una publicación asociada, no la veracidad del hecho ni responsabilidad.</footer>
        </aside>
      </div>}
    </div>
  );
}