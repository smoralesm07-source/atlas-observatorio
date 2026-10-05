import { searchPressDossier, type PressArticleMatch, type PressMatch } from './press';

export type PressEvidenceKind = 'directa' | 'contexto' | 'revision';

export type EntityPressArticle = PressArticleMatch & {
  match: PressMatch;
  evidence: PressEvidenceKind;
};

const EVIDENCE_RANK: Record<PressEvidenceKind, number> = {
  directa: 3,
  contexto: 2,
  revision: 1,
};

const VERIFIED_PRESS_SEEDS_URL =
  'https://raw.githubusercontent.com/smoralesm07-source/Monitor/main/semillas_prensa_atlas.json';

interface VerifiedPressSeed {
  id?: string;
  date?: string | null;
  title?: string;
  media?: string | null;
  url?: string | null;
  summary?: string | null;
  search_terms?: string[];
  verified_entity?: {
    name?: string | null;
    rut?: string | null;
  } | null;
}

let verifiedSeedsPromise: Promise<VerifiedPressSeed[]> | null = null;

function compactRut(value: unknown): string {
  return String(value ?? '').toUpperCase().replace(/[^0-9K]/g, '');
}

function normalizeName(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es-CL')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function loadVerifiedSeeds(): Promise<VerifiedPressSeed[]> {
  if (!verifiedSeedsPromise) {
    verifiedSeedsPromise = fetch(VERIFIED_PRESS_SEEDS_URL, {
      headers: { Accept: 'application/json' },
      cache: 'no-cache',
    })
      .then(async (response) => {
        if (!response.ok) return [];
        const payload = await response.json() as { articles?: VerifiedPressSeed[] };
        return Array.isArray(payload.articles) ? payload.articles : [];
      })
      .catch(() => []);
  }
  return verifiedSeedsPromise;
}

async function verifiedSeedMatches(
  entityName: string,
  entityRut: string,
  articleLimit: number,
): Promise<PressMatch[]> {
  const seeds = await loadVerifiedSeeds();
  const rut = compactRut(entityRut);
  const name = normalizeName(entityName);
  const hits = seeds.filter((seed) => {
    const seedRut = compactRut(seed.verified_entity?.rut);
    if (rut && seedRut) return rut === seedRut;
    const seedName = normalizeName(seed.verified_entity?.name);
    return Boolean(name && seedName && name === seedName);
  });
  if (!hits.length) return [];

  const verifiedName = String(hits[0].verified_entity?.name || entityName || 'Entidad verificada').trim();
  const verifiedRut = String(hits[0].verified_entity?.rut || entityRut || '').trim();
  const dates = hits.map((seed) => String(seed.date ?? '').slice(0, 10)).filter(Boolean);
  const media = Array.from(new Set(hits.map((seed) => seed.media).filter((value): value is string => Boolean(value))));
  const articles = hits
    .map<PressArticleMatch>((seed) => ({
      id: String(seed.id || `ATLAS-SEED-${compactRut(verifiedRut) || normalizeName(verifiedName).replace(/\s+/g, '-')}`),
      date: seed.date ?? null,
      title: String(seed.title || 'Mención verificada en prensa'),
      media: seed.media ?? null,
      url: seed.url ?? null,
      summary: seed.summary ?? null,
      search_terms: seed.search_terms ?? [],
      role: 'Mención verificada en fuente abierta',
      mention_confidence: 1,
      mention_requires_validation: false,
    }))
    .sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')))
    .slice(0, Math.max(1, articleLimit));

  return [{
    press_entity_id: `PRESS-VERIFIED-${compactRut(verifiedRut) || normalizeName(verifiedName).replace(/\s+/g, '-')}`,
    name: verifiedName,
    entity_type: 'EMPRESA',
    nature: 'PERSONA_JURIDICA',
    ruts: verifiedRut ? [verifiedRut] : [],
    aliases: [verifiedName],
    first_seen: dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : null,
    last_seen: dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : null,
    article_count: hits.length,
    mention_count: hits.length,
    media,
    roles: ['Mención verificada en fuente abierta'],
    confidence: 1,
    requires_validation: false,
    resolution_status: 'VERIFIED_SEED',
    match_kind: verifiedRut ? 'RUT' : 'EXACTA',
    match_score: 1,
    match_source: 'ENTITY_INDEX',
    articles,
    bridge_generated_at: null,
  }];
}

function hasExactRut(match: PressMatch, rut: string): boolean {
  return Boolean(rut) && (match.ruts ?? []).some((candidate) => compactRut(candidate) === rut);
}

function mergePressMatches(groups: PressMatch[][], limit: number): PressMatch[] {
  const byId = new Map<string, PressMatch>();
  for (const group of groups) {
    for (const match of group) {
      const current = byId.get(match.press_entity_id);
      if (!current) {
        byId.set(match.press_entity_id, match);
        continue;
      }
      const articleById = new Map((current.articles ?? []).map((article) => [article.id, article]));
      for (const article of match.articles ?? []) articleById.set(article.id, article);
      byId.set(match.press_entity_id, {
        ...current,
        ...match,
        match_score: Math.max(Number(current.match_score ?? 0), Number(match.match_score ?? 0)),
        articles: [...articleById.values()].sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? ''))),
      });
    }
  }
  return [...byId.values()]
    .sort((a, b) => Number(b.match_score ?? 0) - Number(a.match_score ?? 0))
    .slice(0, Math.max(1, limit));
}

/**
 * Única regla de enlace Entidad Atlas -> Radar Prensa para las vistas de entidad.
 * Conserva el umbral histórico de Entidad 360: RUT exacto o nombre con score >= .94.
 */
export function resolveEntityPressMatches(entityRut: string | null | undefined, matches: PressMatch[]): PressMatch[] {
  const rut = compactRut(entityRut);
  const strongName = matches.filter((match) => Number(match.match_score ?? 0) >= 0.94);
  if (!rut) return strongName;

  const byRut = matches.filter((match) => hasExactRut(match, rut));
  const seen = new Set(byRut.map((match) => match.press_entity_id));
  return [...byRut, ...strongName.filter((match) => !seen.has(match.press_entity_id))];
}

/**
 * Replica la taxonomía del expediente periodístico de Entidad 360.
 * La relación existe aunque la evidencia quede como contexto o por revisar;
 * sólo la categoría "directa" acredita una identidad suficientemente resuelta.
 */
export function pressEvidenceKind(article: PressArticleMatch, match: PressMatch): PressEvidenceKind {
  if (
    match.resolution_status === 'GROUP_CONTEXT'
    || match.nature === 'GROUP_CONTEXT'
    || /contexto de grupo/i.test(article.role ?? '')
  ) return 'contexto';

  const governed = !match.requires_validation && !article.mention_requires_validation;
  const strongIdentity = match.match_kind === 'RUT' || match.match_kind === 'EXACTA' || Number(match.match_score ?? 0) >= 0.98;
  const strongMention = article.mention_confidence == null || Number(article.mention_confidence) >= 0.90;
  return governed && strongIdentity && strongMention ? 'directa' : 'revision';
}

export function pressEvidenceLabel(kind: PressEvidenceKind): string {
  if (kind === 'directa') return 'Coincidencia directa';
  if (kind === 'contexto') return 'Contexto de marca / grupo';
  return 'Revisar identidad';
}

export function pressEvidenceReason(article: EntityPressArticle): string {
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

export function entityPressArticleRows(matches: PressMatch[]): EntityPressArticle[] {
  const byId = new Map<string, EntityPressArticle>();
  for (const match of matches) {
    for (const article of match.articles ?? []) {
      const candidate: EntityPressArticle = { ...article, match, evidence: pressEvidenceKind(article, match) };
      const current = byId.get(article.id);
      if (!current || EVIDENCE_RANK[candidate.evidence] > EVIDENCE_RANK[current.evidence]) {
        byId.set(article.id, candidate);
      }
    }
  }
  return [...byId.values()].sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')));
}

/**
 * Recuperación común para Entidad 360 y Huella pública.
 * El RUT es el ancla estable entre fuentes. Cuando existe también una razón social
 * útil, se consulta para conservar alias y contexto de grupo; ambos resultados se
 * fusionan y deduplican. Así una etiqueta distinta en Mercado Público o Presupuesto
 * Abierto no puede ocultar una relación que Entidad 360 ya resuelve por el mismo RUT.
 *
 * Las semillas verificadas son una capa de recuperación gobernada para artículos
 * que el radar descubrió tarde o cuyo título/snippet no contiene la razón social.
 * Sólo ingresan aquí si fueron asociadas explícitamente a una entidad por RUT/nombre.
 */
export async function searchEntityPress(
  entityName: string | null | undefined,
  entityRut: string | null | undefined,
  limit = 10,
): Promise<PressMatch[]> {
  const name = String(entityName ?? '').trim();
  const rut = String(entityRut ?? '').trim();
  const rutKey = compactRut(rut);
  const usableName = Boolean(name && !/^consultar rut\b/i.test(name) && compactRut(name) !== rutKey);

  const [rawByRut, rawByName, verified] = await Promise.all([
    rut ? searchPressDossier(rut, limit) : Promise.resolve([] as PressMatch[]),
    usableName ? searchPressDossier(name, limit) : Promise.resolve([] as PressMatch[]),
    verifiedSeedMatches(name, rut, limit),
  ]);

  const byRut = resolveEntityPressMatches(rut, rawByRut);
  const byName = resolveEntityPressMatches(rut, rawByName);
  const byVerifiedSeed = resolveEntityPressMatches(rut, verified);

  // El vínculo por RUT nunca puede desaparecer por una variante de nombre.
  // La búsqueda nominal sólo agrega evidencia/contexto que pase la misma regla.
  // Una semilla verificada se fusiona como evidencia directa y auditable, sin
  // reemplazar el índice principal ni relajar sus umbrales de identidad.
  return mergePressMatches([byVerifiedSeed, byRut, byName], limit);
}
