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
  /** Fuerza con que el texto marcó la comuna resuelta. */
  commune_confidence?: 'alta' | 'media' | null;
  commune_basis?: string | null;
  /** Todas las comunas nombradas, resueltas o no. */
  communes?: { name: string; region?: string | null; basis?: string | null }[];
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
  mention_requires_validation?: boolean;
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

const GENERIC_ENTITY_TOKENS = new Set([
  'de', 'del', 'la', 'las', 'los', 'y', 'e', 'en', 'para', 'por',
  'spa', 'ltda', 'limitada', 'sa', 'eirl',
  'sociedad', 'sociedades', 'empresa', 'empresas', 'compania', 'companias', 'cia',
  'grupo', 'holding', 'inversion', 'inversiones',
  'servicio', 'servicios', 'financiero', 'financieros', 'financiera', 'financieras',
  'cooperativa', 'cooperativas', 'comercial', 'comerciales',
  'administradora', 'administracion', 'gestion', 'asesoria', 'asesorias',
  'consultora', 'consultores', 'fundacion', 'corporacion', 'asociacion',
  'organizacion', 'instituto',
]);

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

function nameTokens(value: string): string[] {
  return value.split(' ').map((token) => token.trim()).filter((token) => token.length >= 2);
}

function distinctiveTokens(value: string): string[] {
  const tokens = nameTokens(value);
  const distinctive = tokens.filter((token) => token.length >= 3 && !GENERIC_ENTITY_TOKENS.has(token));
  if (distinctive.length) return distinctive;
  return tokens.filter((token) => token.length >= 4);
}

function containsAllTokens(candidate: string, required: string[]): boolean {
  if (!required.length) return false;
  const candidateTokens = new Set(nameTokens(candidate));
  return required.every((token) => candidateTokens.has(token));
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

  const lexicalScore = dice(query, candidate);
  const queryDistinctive = distinctiveTokens(query);
  const isPrefix = candidate.startsWith(query) || query.startsWith(candidate);
  const isContained = candidate.includes(query) || query.includes(candidate);

  if (isPrefix || isContained) {
    // Una razón social genérica contenida en otra no acredita identidad. Para
    // aceptar una coincidencia parcial deben sobrevivir los tokens que realmente
    // individualizan a la entidad (p. ej. "Bancame").
    if (!containsAllTokens(candidate, queryDistinctive)) {
      return { score: Math.min(0.70, lexicalScore * 0.72), kind: 'APROXIMADA' };
    }
    return { score: isPrefix ? 0.97 : 0.95, kind: 'CONTENIDA' };
  }

  return { score: lexicalScore, kind: 'APROXIMADA' };
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

function articleSupportsIdentity(queryText: string, article: PressArticle): boolean {
  const fields = [article.title, article.summary, ...(article.search_terms ?? [])]
    .map(normalizePressText)
    .filter(Boolean);
  if (!fields.length) return false;
  if (fields.some((field) => field.includes(queryText))) return true;

  const required = distinctiveTokens(queryText);
  if (!required.length) return false;
  const articleTokens = new Set(fields.flatMap((field) => nameTokens(field)));
  return required.every((token) => articleTokens.has(token));
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
  queryText: string,
  mentionsByEntity: Map<string, PressMention[]>,
  articleById: Map<string, PressArticle>,
  generatedAt: string | null,
): PressMatch {
  const mentions = mentionsByEntity.get(entity.press_entity_id) ?? [];
  const strongEntityIdentity = kind === 'RUT' || kind === 'EXACTA';
  const articles = mentions
    .reduce<PressArticleMatch[]>((rows, mention) => {
      const article = articleById.get(mention.article_id);
      if (!article) return rows;

      const textualEvidence = articleSupportsIdentity(queryText, article);
      const mentionConfidence = Number.isFinite(mention.confidence) ? mention.confidence : null;
      const governedMention = mentionConfidence != null && mentionConfidence >= 0.90 && !mention.requires_validation;

      // Segunda barrera: una coincidencia parcial de nombre sólo puede aportar
      // noticias que vuelvan a mostrar evidencia textual de la identidad. Para
      // RUT/nombre exacto se permite además una mención ya gobernada por Radar
      // Prensa, evitando perder artículos cuyo resumen no repite la razón social.
      if (!textualEvidence && !(strongEntityIdentity && governedMention)) return rows;

      rows.push({
        ...article,
        role: mention.role ?? null,
        mention_confidence: mentionConfidence,
        mention_requires_validation: Boolean(mention.requires_validation),
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
    article_count: articles.length,
    mention_count: articles.length,
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
      queryText,
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


/* ── Prensa por comuna ──────────────────────────────────────────────────────
   El puente geoetiqueta cada noticia desde el catálogo comunal: `commune` es
   la comuna que el texto marca, y `communes` las que sólo nombra. Se separan
   porque no dicen lo mismo, y ninguna de las dos atribuye conducta al
   territorio: sitúan la mención. */

export interface PressCommuneHit extends PressArticle {
  basis: 'resuelta' | 'mencionada';
}

export interface PressCommuneResult {
  articles: PressCommuneHit[];
  resolved: number;
  mentioned: number;
  /** El puente publica noticias, pero ninguna trae comuna: falta el corte
   *  geoetiquetado, no la comuna consultada. */
  bridgeHasGeo: boolean;
  generatedAt: string | null;
}

export async function pressForCommune(
  commune: string,
  limit = 10,
): Promise<PressCommuneResult> {
  const { bridge } = await loadBridge();
  const target = normalizePressText(commune);
  const resolved: PressCommuneHit[] = [];
  const mentioned: PressCommuneHit[] = [];
  let bridgeHasGeo = false;

  (bridge.articles ?? []).forEach((article) => {
    const own = normalizePressText(article.commune ?? '');
    const others = (article.communes ?? []).map((c) => normalizePressText(c.name));
    if (own || others.length) bridgeHasGeo = true;
    if (!target) return;
    if (own && own === target) resolved.push({ ...article, basis: 'resuelta' });
    else if (others.includes(target)) mentioned.push({ ...article, basis: 'mencionada' });
  });

  const byDate = (a: PressArticle, b: PressArticle) =>
    String(b.date ?? '').localeCompare(String(a.date ?? ''));
  resolved.sort(byDate);
  mentioned.sort(byDate);

  return {
    articles: [...resolved, ...mentioned].slice(0, limit),
    resolved: resolved.length,
    mentioned: mentioned.length,
    bridgeHasGeo,
    generatedAt: bridge.generated_at ?? null,
  };
}
