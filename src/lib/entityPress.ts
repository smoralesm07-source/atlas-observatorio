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

/**
 * Única regla de enlace Entidad Atlas -> Radar Prensa para las vistas de entidad.
 * Conserva el umbral histórico de Entidad 360: RUT exacto o nombre con score >= .94.
 */
export function resolveEntityPressMatches(entityRut: string | null | undefined, matches: PressMatch[]): PressMatch[] {
  const rut = compactRut(entityRut);
  const strongName = matches.filter((match) => Number(match.match_score ?? 0) >= 0.94);
  if (!rut) return strongName;

  const byRut = matches.filter((match) => (match.ruts ?? []).some((candidate) => compactRut(candidate) === rut));
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
 * Se consulta primero la razón social y, sólo si no resuelve una identidad,
 * se usa el RUT como fallback. De esta forma ambas pantallas parten del mismo
 * conjunto de coincidencias y no pueden divergir por usar rutas de búsqueda distintas.
 */
export async function searchEntityPress(
  entityName: string | null | undefined,
  entityRut: string | null | undefined,
  limit = 10,
): Promise<PressMatch[]> {
  const name = String(entityName ?? '').trim();
  const rut = String(entityRut ?? '').trim();

  if (name && !/^consultar rut\b/i.test(name) && compactRut(name) !== compactRut(rut)) {
    const byName = resolveEntityPressMatches(rut, await searchPressDossier(name, limit));
    if (byName.length) return byName;
  }

  if (!rut) return [];
  return resolveEntityPressMatches(rut, await searchPressDossier(rut, limit));
}
