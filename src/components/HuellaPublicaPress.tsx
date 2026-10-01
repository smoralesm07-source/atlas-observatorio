import { useEffect, useMemo, useState } from 'react';
import { searchPress, type PressArticleMatch, type PressMatch } from '../lib/press';
import '../styles/huella-publica-press.css';

type PressState = {
  status: 'idle' | 'loading' | 'done' | 'error';
  matches: PressMatch[];
};

type DirectArticle = PressArticleMatch & { match: PressMatch };

type Props = {
  entityRut: string;
  entityName: string;
  entityId?: string | null;
  fromYear: number;
  toYear: number;
  onNavigate: (hash: string) => void;
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

function compactRut(value: unknown) {
  return String(value ?? '').toUpperCase().replace(/[^0-9K]/g, '');
}

function isDirectMatch(match: PressMatch, rut: string) {
  if (match.resolution_status === 'GROUP_CONTEXT' || match.nature === 'GROUP_CONTEXT') return false;
  if (match.requires_validation) return false;
  const queryRut = compactRut(rut);
  const rutResolved = Boolean(queryRut) && match.ruts.some((candidate) => compactRut(candidate) === queryRut);
  const strongIdentity = rutResolved || match.match_kind === 'RUT' || match.match_kind === 'EXACTA' || match.match_score >= 0.98;
  return strongIdentity;
}

function articleIsGoverned(article: PressArticleMatch) {
  if (article.mention_requires_validation) return false;
  return article.mention_confidence == null || article.mention_confidence >= 0.90;
}

function directArticles(matches: PressMatch[], rut: string): DirectArticle[] {
  const byId = new Map<string, DirectArticle>();
  for (const match of matches) {
    if (!isDirectMatch(match, rut)) continue;
    for (const article of match.articles) {
      if (!articleIsGoverned(article)) continue;
      const candidate: DirectArticle = { ...article, match };
      const current = byId.get(article.id);
      const candidateRut = match.match_kind === 'RUT' || match.ruts.some((value) => compactRut(value) === compactRut(rut));
      const currentRut = current?.match.match_kind === 'RUT' || current?.match.ruts.some((value) => compactRut(value) === compactRut(rut));
      if (!current || (candidateRut && !currentRut) || match.match_score > current.match.match_score) byId.set(article.id, candidate);
    }
  }
  return [...byId.values()].sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')));
}

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
  return TOPICS.filter((topic) => topic.pattern.test(text)).map((topic) => topic.label).slice(0, 3);
}

function mergeMatches(a: PressMatch[], b: PressMatch[]) {
  const map = new Map<string, PressMatch>();
  for (const item of [...a, ...b]) {
    const previous = map.get(item.press_entity_id);
    if (!previous || item.match_score > previous.match_score) map.set(item.press_entity_id, item);
  }
  return [...map.values()];
}

export function HuellaPublicaPress({ entityRut, entityName, entityId, fromYear, toYear, onNavigate }: Props) {
  const [state, setState] = useState<PressState>({ status: 'idle', matches: [] });

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
        const byRut = await searchPress(rut, 8, 12);
        let combined = byRut;
        if (directArticles(byRut, rut).length === 0 && name && compactRut(name) !== compactRut(rut) && !/^consultar rut\b/i.test(name)) {
          const byName = await searchPress(name, 8, 12);
          combined = mergeMatches(byRut, byName);
        }
        if (!cancelled) setState({ status: 'done', matches: combined });
      } catch {
        if (!cancelled) setState({ status: 'error', matches: [] });
      }
    })();

    return () => { cancelled = true; };
  }, [entityRut, entityName]);

  const allArticles = useMemo(() => directArticles(state.matches, entityRut), [state.matches, entityRut]);
  const articles = useMemo(() => allArticles.filter((article) => inPeriod(article, fromYear, toYear)), [allArticles, fromYear, toYear]);
  const mediaCount = useMemo(() => new Set(articles.map((article) => article.media).filter(Boolean)).size, [articles]);
  const lastArticle = articles[0] ?? null;

  return (
    <section className="state-press-panel" aria-label="Prensa relevante">
      <header className="state-press-head">
        <div className="state-press-heading">
          <span className="state-press-icon" aria-hidden="true">▤</span>
          <div>
            <span className="state-press-overline">Contexto Atlas · Radar Prensa</span>
            <h3>Prensa relevante</h3>
            <p>Menciones periodísticas con identidad resuelta para la entidad seleccionada. La lectura se limita al período {fromYear}–{toYear}.</p>
          </div>
        </div>
        {entityId && <button type="button" className="state-secondary state-press-dossier" onClick={() => onNavigate(`#/entidad/${encodeURIComponent(entityId)}?tab=prensa`)}>Ver expediente completo →</button>}
      </header>

      {state.status === 'loading' && <div className="state-press-status" aria-live="polite"><span className="state-press-loader" />Consultando Radar Prensa sólo para esta entidad…</div>}
      {state.status === 'error' && <div className="state-press-status state-press-status-error">Radar Prensa no está disponible en esta consulta. La huella económica permanece operativa.</div>}

      {state.status === 'done' && articles.length > 0 && <>
        <div className="state-press-metrics">
          <div><span>Menciones directas</span><strong>{articles.length.toLocaleString('es-CL')}</strong><small>identidad gobernada</small></div>
          <div><span>Medios distintos</span><strong>{mediaCount.toLocaleString('es-CL')}</strong><small>en el período</small></div>
          <div><span>Última mención</span><strong>{dateLabel(lastArticle?.date)}</strong><small>{lastArticle?.media || 'Prensa abierta'}</small></div>
        </div>

        <div className="state-press-feed">
          {articles.slice(0, 4).map((article) => {
            const topics = topicsFor(article);
            return <article key={article.id} className="state-press-row">
              <div className="state-press-meta"><time>{dateLabel(article.date)}</time><span>{article.media || 'Prensa abierta'}</span></div>
              <div className="state-press-copy">
                <strong>{article.title}</strong>
                <div className="state-press-tags"><span data-primary="true">Coincidencia directa</span>{topics.map((topic) => <span key={topic}>{topic}</span>)}{article.role && <span>{article.role}</span>}</div>
              </div>
              {article.url ? <a href={article.url} target="_blank" rel="noopener noreferrer" aria-label={`Abrir noticia: ${article.title}`}>Abrir nota ↗</a> : <span className="state-press-no-link">Sin enlace</span>}
            </article>;
          })}
        </div>

        <div className="state-press-rule"><strong>Regla de lectura.</strong> La presencia de una noticia acredita una publicación asociada a la entidad, no la veracidad del hecho ni responsabilidad. Huella pública muestra sólo coincidencias directas; contexto de grupo y casos por revisar quedan en el expediente de Entidad 360.</div>
      </>}

      {state.status === 'done' && articles.length === 0 && <div className="state-press-empty">
        <span>○</span>
        <div><strong>Sin menciones directas en {fromYear}–{toYear}</strong><p>{allArticles.length > 0 ? `Radar Prensa registra ${allArticles.length.toLocaleString('es-CL')} coincidencia${allArticles.length === 1 ? '' : 's'} directa${allArticles.length === 1 ? '' : 's'} fuera del período seleccionado.` : 'No se encontraron coincidencias suficientemente resueltas para mostrarlas automáticamente en Huella pública.'}</p></div>
      </div>}
    </section>
  );
}
