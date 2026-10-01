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

function compactRut(value: unknown): string {
  return String(value ?? '').toUpperCase().replace(/[^0-9K]/g, '');
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

  const [rawByRut, rawByName] = await Promise.all([
    rut ? searchPressDossier(rut, limit) : Promise.resolve([] as PressMatch[]),
    usableName ? searchPressDossier(name, limit) : Promise.resolve([] as PressMatch[]),
  ]);

  const byRut = resolveEntityPressMatches(rut, rawByRut);
  const byName = resolveEntityPressMatches(rut, rawByName);

  // El vínculo por RUT nunca puede desaparecer por una variante de nombre.
  // La búsqueda nominal sólo agrega evidencia/contexto que pase la misma regla.
  return mergePressMatches([byRut, byName], limit);
}
