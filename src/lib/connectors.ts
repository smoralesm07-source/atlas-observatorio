/* Conectores bajo demanda.
 *
 * Estas funciones de borde ya existen en el proyecto y las usa ATLAS. El
 * Observatorio las consume tal cual, sin reimplementarlas: son la misma
 * autoridad, con los mismos guardrails.
 *
 * Regla que gobierna todo este módulo: lo que devuelve una fuente externa es un
 * CANDIDATO. Nunca crea identidad canónica, nunca se persiste, nunca modifica
 * la prioridad analítica de una entidad. La decisión de asociar sigue siendo
 * del analista.
 */
import { supabase } from './supabase';

export const WATCHLIST_FN = 'aml-entity-global-watchlists-live';
export const IDENTITY_RESOLVE_FN = 'aml-digital-identity-resolver-live';
export const IDENTITY_DEEP_FN = 'aml-digital-identity-deep';

/* ─────────────────────────────────────────── listas internacionales */

export type SourceState =
  | 'fresh'
  | 'degraded'
  | 'credential_missing'
  | 'quota_exhausted'
  | 'no_name'
  | 'no_identity'
  | string;

export interface WatchlistRecord {
  source_code: string;
  source_record_id: string;
  signal_type: string;
  signal_status: string;
  match_method: string;
  match_confidence: number | null;
  title: string;
  summary: string;
  related_entity_name: string;
  relationship_type: string;
  event_date: string | null;
  source_url: string;
  evidence: Record<string, unknown>;
}

export interface WatchlistSource {
  status: SourceState;
  source: string;
  records: WatchlistRecord[];
  checked_at: string;
  coverage?: Record<string, unknown>;
  error?: string;
}

export interface WatchlistResult {
  ok: boolean;
  mode: string;
  entity: { name: string | null; rut: string | null; entity_type: string | null };
  sources: Record<string, WatchlistSource>;
  routing: {
    opensanctions_status: string;
    fallback_used: boolean;
    fallback_reason: string | null;
    direct_sources: string[];
  };
  guardrails: Record<string, unknown>;
}

export const WATCHLIST_LABEL: Record<string, string> = {
  UN_SANCTIONS: 'ONU · Consejo de Seguridad',
  OFAC: 'OFAC · Tesoro de EE.UU.',
  EU_SANCTIONS: 'Unión Europea',
  UK_SANCTIONS: 'Reino Unido',
  WORLD_BANK: 'Banco Mundial',
  IDB_SANCTIONS: 'BID',
  ICIJ_OFFSHORE: 'ICIJ Offshore Leaks',
  OPENSANCTIONS: 'OpenSanctions',
};

/** Orden de lectura: primero lo que un fiscalizador mira antes. */
export const WATCHLIST_ORDER = [
  'OFAC', 'UN_SANCTIONS', 'EU_SANCTIONS', 'UK_SANCTIONS',
  'WORLD_BANK', 'IDB_SANCTIONS', 'OPENSANCTIONS', 'ICIJ_OFFSHORE',
];

export const SOURCE_STATE_LABEL: Record<string, string> = {
  fresh: 'Consultada',
  degraded: 'No respondió',
  credential_missing: 'Sin credencial',
  quota_exhausted: 'Cuota agotada',
  no_name: 'Sin nombre para consultar',
  no_identity: 'Sin identidad para consultar',
};

export async function screenWatchlists(input: {
  name: string;
  rut?: string | null;
  entityType?: string | null;
}): Promise<WatchlistResult> {
  const { data, error } = await supabase.functions.invoke<WatchlistResult>(WATCHLIST_FN, {
    body: {
      name: input.name,
      rut: input.rut ?? '',
      entity_type: input.entityType ?? '',
    },
  });
  if (error) throw new Error(error.message);
  if (!data?.ok) throw new Error((data as unknown as { error?: string })?.error ?? 'Screening no disponible');
  return data;
}

/** Aplana las fuentes a una lista ordenada, conservando de qué fuente vino cada
 *  candidato y descartando duplicados exactos entre agregador y fuente directa. */
export function flattenWatchlist(result: WatchlistResult): WatchlistRecord[] {
  const seen = new Set<string>();
  const out: WatchlistRecord[] = [];
  const codes = [...new Set([...WATCHLIST_ORDER, ...Object.keys(result.sources)])];
  for (const code of codes) {
    const src = result.sources[code];
    for (const rec of src?.records ?? []) {
      const key = `${rec.source_code}|${rec.source_record_id}|${rec.related_entity_name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ...rec, source_code: rec.source_code || code });
    }
  }
  return out.sort((a, b) => (b.match_confidence ?? 0) - (a.match_confidence ?? 0));
}

/* ──────────────────────────────────────────────── identidad digital */

export interface AliasCandidate {
  alias: string;
  rule: string;
  profiles: number;
  evidence_strength: number;
  engines?: string[];
}

export interface IdentityProfile {
  source_url: string;
  title?: string;
  related_entity_name?: string;
  evidence?: {
    platform?: string;
    username?: string;
    engines?: string[];
  };
}

export interface IdentityResolution {
  ok: boolean;
  analytics: {
    generated_aliases?: number;
    aliases_with_profiles?: number;
    multi_engine_profiles?: number;
    strong_aliases?: number;
    profiles?: number;
  };
  candidate_aliases: AliasCandidate[];
  records: IdentityProfile[];
  guardrails?: Record<string, unknown>;
}

export interface DeepAttribute {
  field: string;
  value: string;
  source_count?: number;
  corroborated?: boolean;
}

export interface DeepResult {
  ok: boolean;
  records?: IdentityProfile[];
  derived?: {
    intelligence?: {
      summary?: {
        corroborated_attributes?: number;
        link_pivots?: number;
        alias_candidates?: number;
      };
      attributes?: DeepAttribute[];
      links?: { url: string; host?: string; source_count?: number }[];
      alias_candidates?: { alias: string; source_count?: number; corroborated?: boolean }[];
    };
  };
  error?: string;
}

export const ALIAS_RULE_LABEL: Record<string, string> = {
  first_last_compact: 'nombre+apellido',
  first_dot_last: 'nombre.apellido',
  first_underscore_last: 'nombre_apellido',
  first_dash_last: 'nombre-apellido',
  initial_last: 'inicial+apellido',
  first_initial: 'nombre+inicial',
  last_first_compact: 'apellido+nombre',
  first_middleinitial_last: 'nombre+inicial media+apellido',
  literal_username: 'username literal',
};

export const aliasRuleLabel = (r: string) => ALIAS_RULE_LABEL[r] ?? r ?? 'variante';

export async function resolveIdentity(query: string): Promise<IdentityResolution> {
  const { data, error } = await supabase.functions.invoke<IdentityResolution>(
    IDENTITY_RESOLVE_FN,
    { body: { query } },
  );
  if (error) throw new Error(error.message);
  if (!data?.ok) throw new Error((data as unknown as { error?: string })?.error ?? 'Resolver no disponible');
  return data;
}

export async function deepenAlias(
  username: string,
  opts: { topSites?: number; recursive?: boolean } = {},
): Promise<DeepResult> {
  const { data, error } = await supabase.functions.invoke<DeepResult>(IDENTITY_DEEP_FN, {
    body: {
      username,
      top_sites: opts.topSites ?? 650,
      recursive: opts.recursive ?? true,
    },
  });
  if (error) throw new Error(error.message);
  return data ?? { ok: false, error: 'Sin respuesta' };
}

/** Una consulta con espacio se lee como nombre de persona; sin espacio, como
 *  username. Es la misma heurística que usa ATLAS. */
export const looksLikePersonName = (q: string) => /\s/.test(q.trim()) && !/^[0-9.\-kK]+$/.test(q.trim());

/* ──────────────────────────────────────────── fuerza de evidencia */

/** Riqueza y convergencia técnica de un alias. No es probabilidad de identidad:
 *  ordena qué hipótesis merece revisión antes, nada más. */
export function aliasEvidenceScore(
  alias: AliasCandidate,
  quickRows: IdentityProfile[],
  deep?: DeepResult | null,
): number {
  const own = quickRows.filter((r) => r.evidence?.username === alias.alias);
  const multiEngine = own.filter((r) => (r.evidence?.engines ?? []).length >= 2).length;
  const platforms = new Set(own.map((r) => r.evidence?.platform).filter(Boolean)).size;
  const sum = deep?.derived?.intelligence?.summary ?? {};
  const attrs = Number(sum.corroborated_attributes ?? 0);
  const links = Number(sum.link_pivots ?? 0);
  const derived = Number(sum.alias_candidates ?? 0);
  const score =
    10 +
    Math.min(25, platforms * 5) +
    Math.min(15, multiEngine * 8) +
    Math.min(25, attrs * 6) +
    Math.min(15, links * 3) +
    Math.min(10, derived * 2);
  return Math.min(95, score);
}

export const evidenceLevel = (s: number) =>
  s >= 75 ? 'alta' : s >= 55 ? 'media-alta' : s >= 35 ? 'media' : 'inicial';

/** Las fuentes externas devuelven sus claves de evidencia en inglés. El
 *  analista lee en español, y una clave sin traducir parece un error de datos. */
const EVIDENCE_LABEL: Record<string, string> = {
  ofac_id: 'Identificador OFAC',
  list: 'Lista',
  official_direct: 'Consulta directa a la fuente oficial',
  reference_number: 'Número de referencia',
  unique_id: 'Identificador único',
  logical_id: 'Identificador lógico',
  icij_node_id: 'Nodo ICIJ',
  query_type: 'Tipo de consulta',
  reconciliation_score: 'Puntaje de reconciliación',
  opensanctions_id: 'Identificador OpenSanctions',
  idb_row_id: 'Fila BID',
  source: 'Fuente',
  country: 'País',
  nationality: 'Nacionalidad',
  from: 'Desde',
  to: 'Hasta',
  cross_debarment_only: 'Sólo inhabilitación cruzada',
  topics: 'Temas',
  datasets: 'Conjuntos de datos',
};

export function evidenceLabel(key: string): string {
  if (EVIDENCE_LABEL[key]) return EVIDENCE_LABEL[key];
  const words = key.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** true/false crudos en una ficha se leen como dato faltante. */
export function evidenceValue(v: unknown): string {
  if (v === true) return 'Sí';
  if (v === false) return 'No';
  return String(v);
}
