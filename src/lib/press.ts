const PRESS_BRIDGE_URL =
  'https://raw.githubusercontent.com/smoralesm07-source/Monitor/atlas-press-state/atlas_prensa.json';

export interface PressArticle {
  id: string;
  date: string | null;
  title: string;
  media: string | null;
  url: string | null;
  summary: string | null;
  region?: string | null;
  commune?: string | null;
  search_terms?: string[];
}

interface PressEntity {
  press_entity_id: string;
  name: string;
  normalized_name: string;
  entity_type: string | null;
  nature: string | null;
  ruts: string[];
  aliases: string[];
  first_seen: string | null;
  last_seen: string | null;
  article_count: number;
  mention_count: number;
  media: string[];
  roles: string[];
  confidence: number;
  requires_validation: boolean;
  resolution_status: string;
  source: string;
}

interface PressMention {
  mention_id: string;
  press_entity_id: string;
  article_id: string;
  role: string | null;
  roles?: string[];
  mentions: number;
  confidence: number;
  requires_validation: boolean;
}

interface PressBridge {
  generated_at?: string;
  entities?: PressEntity[];
  mentions?: PressMention[];
  articles?: PressArticle[];
}

export interface PressArticleMatch extends PressArticle {
  role: string | null;
  mention_confidence: number | null;
}

export interface PressMatch {
  press_entity_id: string;
  name: string;
  entity_type: string | null;
  nature: string | null;
  ruts: string[];
  aliases: string[];
  first_seen: string | null;
  last_seen: string | null;
  article_count: number;
  mention_count: number;
  media: string[];
  roles: string[];
  confidence: number;
  requires_validation: boolean;
  resolution_status: string;
  match_kind: 'EXACTA' | 'CONTENIDA' | 'APROXIMADA' | 'RUT';
  match_score: number;
  match_source: 'ENTITY_INDEX' | 'ARTICLE_TEXT';
  articles: PressArticleMatch[];
  bridge_generated_at: string | null;
}

interface PreparedBridge {
  bridge: PressBridge;
  articleById: Map<string, PressArticle>;
  mentionsByEntity: Map<string, PressMention[]>;
}

let preparedPromise: Promise<PreparedBridge> | null = null;

export function normalizePressText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es-CL')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeRut(value: unknown): string {
  return String(value ?? '').toUpperCase().replace(/[^0-9K]/g, '');
}

function bigrams(value: string): Set<string> {
  const compact = value.replace(/\s+/g, ' ');
  const out = new Set<string>();
  if (compact.length < 2) {
    if (compact) out.add(compact);
    return out;
  }
  for (let i = 0; i < compact.length - 1; i += 1) out.add(compact.slice(i, i + 2));
  return out;
}

function dice(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const aa = bigrams(a);
  const bb = bigrams(b);
  if (!aa.size || !bb.size) return 0;
  let intersection = 0;
  aa.forEach((x) => {
    if (bb.has(x)) intersection += 1;
  });
  return (2 * intersection) / (aa.size + bb.size);
}

function scoreName(query: string, candidate: string): { score: number; kind: PressMatch['match_kind'] } {
  if (!query || !candidate) return { score: 0, kind: 'APROXIMADA' };
  if (query === candidate) return { score: 1, kind: 'EXACTA' };
  if (candidate.startsWith(query) || query.startsWith(candidate)) {
    return { score: 0.97, kind: 'CONTENIDA' };
  }
  if (candidate.includes(query) || query.includes(candidate)) {
    return { score: 0.94, kind: 'CONTENIDA' };
  }
  return { score: dice(query, candidate), kind: 'APROXIMADA' };
}

function tokenPrefixMatch(query: string, candidate: string): boolean {
  const queryTokens = query.split(' ').filter((token) => token.length >= 3);
  const candidateTokens = candidate.split(' ').filter(Boolean);
  if (queryTokens.length < 2) return false;
  return queryTokens.every((queryToken) => candidateTokens.some((candidateToken) => {
    if (queryToken === candidateToken) return true;
    if (Math.min(queryToken.length, candidateToken.length) < 4) return false;
    return candidateToken.startsWith(queryToken) || queryToken.startsWith(candidateToken);
  }));
}

function scoreArticle(queryText: string, article: PressArticle): number {
  const fields = [article.title, article.summary, ...(article.search_terms ?? [])]
    .map(normalizePressText)
    .filter(Boolean);
  let best = 0;
  fields.forEach((field) => {
    if (field === queryText) best = Math.max(best, 1);
    else if (field.includes(queryText)) best = Math.max(best, 0.98);
    else if (tokenPrefixMatch(queryText, field)) best = Math.max(best, 0.90);
  });
  return best;
}

async function loadBridge(): Promise<PreparedBridge> {
  if (!preparedPromise) {
    preparedPromise = fetch(PRESS_BRIDGE_URL, {
      headers: { Accept: 'application/json' },
      cache: 'no-cache',
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Radar Prensa respondió HTTP ${response.status}.`);
        const bridge = (await response.json()) as PressBridge;
        if (!Array.isArray(bridge.entities) || !Array.isArray(bridge.mentions) || !Array.isArray(bridge.articles)) {
          throw new Error('El índice de Radar Prensa no tiene el formato esperado.');
        }
        const articleById = new Map<string, PressArticle>();
        bridge.articles.forEach((article) => {
          if (article?.id) articleById.set(article.id, article);
        });
        const mentionsByEntity = new Map<string, PressMention[]>();
        bridge.mentions.forEach((mention) => {
          if (!mention?.press_entity_id || !mention.article_id) return;
          const rows = mentionsByEntity.get(mention.press_entity_id) ?? [];
          rows.push(mention);
          mentionsByEntity.set(mention.press_entity_id, rows);
        });
        return { bridge, articleById, mentionsByEntity };
      })
      .catch((error) => {
        preparedPromise = null;
        throw error;
      });
  }
  return preparedPromise;
}

function bestEntityScore(entity: PressEntity, queryText: string, queryRut: string) {
  if (queryRut.length >= 4) {
    const rutHit = (entity.ruts ?? []).some((rut) => normalizeRut(rut).startsWith(queryRut));
    if (rutHit) return { score: 1, kind: 'RUT' as const };
  }

  const candidates = [entity.normalized_name, entity.name, ...(entity.aliases ?? [])]
    .map(normalizePressText)
    .filter(Boolean);
  let best: { score: number; kind: PressMatch['match_kind'] } = { score: 0, kind: 'APROXIMADA' };
  candidates.forEach((candidate) => {
    const current = scoreName(queryText, candidate);
    if (current.score > best.score) best = current;
  });
  return best;
}

function indexedMatch(
  entity: PressEntity,
  score: number,
  kind: PressMatch['match_kind'],
  mentionsByEntity: Map<string, PressMention[]>,
  articleById: Map<string, PressArticle>,
  generatedAt: string | null,
): PressMatch {
  const mentions = mentionsByEntity.get(entity.press_entity_id) ?? [];
  const articles = mentions
    .reduce<PressArticleMatch[]>((rows, mention) => {
      const article = articleById.get(mention.article_id);
      if (!article) return rows;
      rows.push({
        ...article,
        role: mention.role ?? null,
        mention_confidence: Number.isFinite(mention.confidence) ? mention.confidence : null,
      });
      return rows;
    }, [])
    .sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')))
    .slice(0, 6);

  return {
    press_entity_id: entity.press_entity_id,
    name: entity.name,
    entity_type: entity.entity_type ?? null,
    nature: entity.nature ?? null,
    ruts: entity.ruts ?? [],
    aliases: entity.aliases ?? [],
    first_seen: entity.first_seen ?? null,
    last_seen: entity.last_seen ?? null,
    article_count: entity.article_count ?? articles.length,
    mention_count: entity.mention_count ?? articles.length,
    media: entity.media ?? [],
    roles: entity.roles ?? [],
    confidence: Number(entity.confidence ?? 0),
    requires_validation: Boolean(entity.requires_validation),
    resolution_status: entity.resolution_status || 'PRESS_ONLY',
    match_kind: kind,
    match_score: score,
    match_source: 'ENTITY_INDEX',
    articles,
    bridge_generated_at: generatedAt,
  };
}

function articleFallbackMatch(
  query: string,
  queryText: string,
  articles: Array<{ article: PressArticle; score: number }>,
  generatedAt: string | null,
): PressMatch {
  const sorted = articles
    .sort((a, b) => String(b.article.date ?? '').localeCompare(String(a.article.date ?? '')))
    .slice(0, 6);
  const dates = sorted.map(({ article }) => String(article.date ?? '').slice(0, 10)).filter(Boolean);
  const media = Array.from(new Set(sorted.map(({ article }) => article.media).filter((value): value is string => Boolean(value))));
  const bestScore = sorted.reduce((best, row) => Math.max(best, row.score), 0);
  const safeId = queryText.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 72) || 'consulta';

  return {
    press_entity_id: `PRESS-TEXT-${safeId}`,
    name: query.trim(),
    entity_type: null,
    nature: null,
    ruts: [],
    aliases: [],
    first_seen: dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : null,
    last_seen: dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : null,
    article_count: articles.length,
    mention_count: articles.length,
    media,
    roles: [],
    confidence: bestScore,
    requires_validation: true,
    resolution_status: 'PRESS_ONLY',
    match_kind: bestScore >= 0.98 ? 'CONTENIDA' : 'APROXIMADA',
    match_score: bestScore,
    match_source: 'ARTICLE_TEXT',
    articles: sorted.map(({ article }) => ({
      ...article,
      role: null,
      mention_confidence: null,
    })),
    bridge_generated_at: generatedAt,
  };
}

export async function searchPress(query: string, limit = 12): Promise<PressMatch[]> {
  const queryText = normalizePressText(query);
  const queryRut = normalizeRut(query);
  if (queryText.length < 3 && queryRut.length < 4) return [];

  const { bridge, articleById, mentionsByEntity } = await loadBridge();
  const maxResults = Math.max(1, Math.min(limit, 30));
  const indexed = (bridge.entities ?? [])
    .map((entity) => ({ entity, ...bestEntityScore(entity, queryText, queryRut) }))
    .filter((row) => row.score >= 0.74)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if ((b.entity.article_count ?? 0) !== (a.entity.article_count ?? 0)) {
        return (b.entity.article_count ?? 0) - (a.entity.article_count ?? 0);
      }
      return String(b.entity.last_seen ?? '').localeCompare(String(a.entity.last_seen ?? ''));
    })
    .slice(0, maxResults)
    .map(({ entity, score, kind }) => indexedMatch(
      entity,
      score,
      kind,
      mentionsByEntity,
      articleById,
      bridge.generated_at ?? null,
    ));

  if (queryRut.length >= 4) return indexed;

  const coveredArticleIds = new Set(indexed.flatMap((match) => match.articles.map((article) => article.id)));
  const directArticleHits = (bridge.articles ?? [])
    .map((article) => ({ article, score: scoreArticle(queryText, article) }))
    .filter((row) => row.score >= 0.90 && !coveredArticleIds.has(row.article.id));

  if (!directArticleHits.length) return indexed;

  const fallback = articleFallbackMatch(
    query,
    queryText,
    directArticleHits,
    bridge.generated_at ?? null,
  );
  return [fallback, ...indexed].slice(0, maxResults);
}

/* ══════════════════════════════════════════════════════════════════════════
   Adhesión de menciones de prensa a un sujeto

   La misma regla que aplica obs_press_attaches en la base, reimplementada aquí
   porque la evidencia periodística —titular, medio, fecha y URL— vive en el
   puente y no en el corte materializado. Las dos implementaciones tienen que
   coincidir: si la base agrupó "Grupo Sartor" bajo una razón social, la ficha
   de esa razón social debe mostrar sus notas.

   Una coincidencia sigue siendo un CANDIDATO. No acredita identidad canónica
   ni participación: sólo dice que la prensa usó ese nombre.
   ══════════════════════════════════════════════════════════════════════════ */

const NAME_STOPWORDS = new Set([
  'sociedad', 'sociedades', 'limitada', 'ltda', 'spa', 'eirl', 'anonima',
  'compania', 'cia', 'grupo', 'group', 'caso', 'casos', 'para', 'este', 'esta',
  'esto', 'estos', 'estas', 'como', 'sobre', 'entre', 'desde', 'hasta', 'contra',
  'segun', 'tras', 'ante', 'bajo', 'cabe', 'sino', 'pero', 'porque', 'cuando',
  'donde', 'quien', 'cual', 'cuales', 'otro', 'otra', 'otros', 'otras',
]);

/** Términos distintivos de un nombre. Descarta formas jurídicas, conectores y
 *  términos de menos de cuatro letras, que producen colisiones absurdas. */
export function nameTokens(value: string): string[] {
  const seen = new Set<string>();
  normalizePressText(value)
    .split(' ')
    .forEach((t) => {
      if (t.length >= 4 && !NAME_STOPWORDS.has(t)) seen.add(t);
    });
  return [...seen];
}

/** La palabra con la que empieza la razón social: su marca, antes del giro. */
export function nameHead(value: string): string {
  const parts = normalizePressText(value).split(' ').filter(Boolean);
  return parts.find((t) => t.length >= 4) ?? parts[0] ?? '';
}

/** Una mención se adhiere cuando NOMBRA a la razón social, no cuando aparece
 *  dentro del nombre de un tercero que la menciona: sin exigir la palabra
 *  cabecera, "Codelco" se pegaría a "Sindicato de Trabajadores de Codelco". */
export function pressAttaches(pressName: string, canonicalName: string): boolean {
  const press = nameTokens(pressName);
  if (press.length === 0) return false;
  const canonical = nameTokens(canonicalName);
  if (canonical.length === 0) return false;
  if (canonical.length > press.length + 4) return false;
  const canonicalSet = new Set(canonical);
  if (!press.every((t) => canonicalSet.has(t))) return false;
  return press.includes(nameHead(canonicalName));
}

export interface PressForSubject {
  matches: PressMatch[];
  /** Notas distintas: dos menciones de la misma nota no son dos notas. */
  articleCount: number;
  roles: string[];
  articles: PressArticleMatch[];
}

const GENERIC_ROLE = 'mencionada en la publicación';

/** Roles que califican la aparición. "Mencionada en la publicación" no dice
 *  nada que el conteo de notas no diga ya, así que no se muestra. */
function meaningfulRoles(matches: PressMatch[]): string[] {
  const seen = new Set<string>();
  matches.forEach((m) => {
    (m.roles ?? []).forEach((r) => {
      const role = String(r ?? '').trim();
      if (!role || role === GENERIC_ROLE) return;
      // Los roles compuestos que el reconocedor emite ("objeto de «sanciona a»
      // por…") son demasiado largos para una fila de resultados.
      if (role.length > 26) return;
      seen.add(role);
    });
  });
  return [...seen];
}

function collect(matches: PressMatch[]): PressForSubject {
  const articles = new Map<string, PressArticleMatch>();
  matches.forEach((m) => m.articles.forEach((a) => articles.set(a.id, a)));
  const list = [...articles.values()].sort((a, b) =>
    String(b.date ?? '').localeCompare(String(a.date ?? '')));
  return {
    matches,
    articleCount: list.length,
    roles: meaningfulRoles(matches),
    articles: list,
  };
}

/** Reparte las coincidencias de prensa entre los sujetos de la página. Lo que
 *  no se adhiere a ninguno se devuelve aparte: perderlo sería peor que
 *  mostrarlo suelto. */
export function groupPressBySubject(
  matches: PressMatch[],
  subjects: { entity_id: string; name: string; rut: string | null }[],
): { bySubject: Map<string, PressForSubject>; loose: PressMatch[] } {
  const buckets = new Map<string, PressMatch[]>();
  const attached = new Set<string>();

  matches.forEach((match) => {
    const matchRuts = new Set(match.ruts.map((r) => r.toUpperCase().replace(/[^0-9K]/g, '')));
    subjects.forEach((subject) => {
      const rut = String(subject.rut ?? '').toUpperCase().replace(/[^0-9K]/g, '');
      const byRut = rut !== '' && matchRuts.has(rut);
      const byName = pressAttaches(match.name, subject.name)
        || match.aliases.some((alias) => pressAttaches(alias, subject.name));
      if (!byRut && !byName) return;
      const bucket = buckets.get(subject.entity_id) ?? [];
      bucket.push(match);
      buckets.set(subject.entity_id, bucket);
      attached.add(match.press_entity_id);
    });
  });

  const bySubject = new Map<string, PressForSubject>();
  buckets.forEach((value, key) => bySubject.set(key, collect(value)));
  return {
    bySubject,
    loose: matches.filter((m) => !attached.has(m.press_entity_id)),
  };
}

/** Evidencia periodística de un sujeto ya conocido, para la ficha. Se consulta
 *  por la razón social y por cada alias que la base ya agrupó. */
export async function pressForEntity(
  name: string,
  aliases: string[] = [],
  rut: string | null = null,
): Promise<PressForSubject> {
  // La razón social completa rara vez coincide con el nombre corto que usa la
  // prensa, así que también se consulta por su palabra cabecera: "sartor"
  // encuentra "Grupo Sartor", "Sartor AGF" y "Sartor Group"; el filtro de
  // adhesión posterior descarta lo que sólo comparte esa palabra.
  const head = nameHead(name);
  const queries = [name, ...aliases, ...(head && head.length >= 4 ? [head] : [])];
  const seen = new Map<string, PressMatch>();
  const results = await Promise.all(queries.map((q) => searchPress(q, 30).catch(() => [])));
  const subject = [{ entity_id: 'self', name, rut }];
  results.flat().forEach((m) => seen.set(m.press_entity_id, m));
  const grouped = groupPressBySubject([...seen.values()], subject);
  return grouped.bySubject.get('self') ?? { matches: [], articleCount: 0, roles: [], articles: [] };
}
