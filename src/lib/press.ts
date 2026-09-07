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

export async function searchPress(query: string, limit = 12): Promise<PressMatch[]> {
  const queryText = normalizePressText(query);
  const queryRut = normalizeRut(query);
  if (queryText.length < 3 && queryRut.length < 4) return [];

  const { bridge, articleById, mentionsByEntity } = await loadBridge();
  const candidates = (bridge.entities ?? [])
    .map((entity) => ({ entity, ...bestEntityScore(entity, queryText, queryRut) }))
    .filter((row) => row.score >= 0.74)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if ((b.entity.article_count ?? 0) !== (a.entity.article_count ?? 0)) {
        return (b.entity.article_count ?? 0) - (a.entity.article_count ?? 0);
      }
      return String(b.entity.last_seen ?? '').localeCompare(String(a.entity.last_seen ?? ''));
    })
    .slice(0, Math.max(1, Math.min(limit, 30)));

  return candidates.map(({ entity, score, kind }) => {
    const mentions = mentionsByEntity.get(entity.press_entity_id) ?? [];
    const articles = mentions
      .map((mention) => {
        const article = articleById.get(mention.article_id);
        if (!article) return null;
        return {
          ...article,
          role: mention.role ?? null,
          mention_confidence: mention.confidence ?? null,
        } satisfies PressArticleMatch;
      })
      .filter((row): row is PressArticleMatch => row != null)
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
      articles,
      bridge_generated_at: bridge.generated_at ?? null,
    };
  });
}
