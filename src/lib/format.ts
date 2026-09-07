const nf = new Intl.NumberFormat('es-CL');
const nf1 = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 1 });

export const n = (v: number | null | undefined) => (v == null ? '—' : nf.format(v));
export const n1 = (v: number | null | undefined) => (v == null ? '—' : nf1.format(v));

export const pct = (v: number | null | undefined) => (v == null ? '—' : `${nf1.format(v)}%`);

export function fecha(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function fechaHora(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('es-CL', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

/** "hace 3 h" — an operations monitor is read for recency, not for timestamps. */
export function desde(iso: string | null | undefined): string {
  if (!iso) return 'sin registro';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 'sin registro';
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 0) return 'programado';
  if (s < 90) return 'hace instantes';
  const m = Math.floor(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 45) return `hace ${d} d`;
  const mo = Math.floor(d / 30);
  if (mo < 24) return `hace ${mo} meses`;
  return `hace ${Math.floor(mo / 12)} años`;
}

/** 976543210 -> 97.654.321-0 */
export function rutFormat(rut: string | null | undefined): string {
  if (!rut) return '—';
  const clean = rut.replace(/[^0-9kK]/g, '').toUpperCase();
  if (clean.length < 2) return rut;
  const body = clean.slice(0, -1);
  const dv = clean.slice(-1);
  return `${body.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}-${dv}`;
}

/* Acronyms that must survive title-casing, and the Spanish particles that must
   not be capitalised mid-phrase. Without these, "SEÑALES AML" reads "Señales Aml"
   and "BANCO DE CHILE" reads "Banco De Chile". */
const ACRONYMS = new Set([
  'AML', 'ROS', 'UAF', 'SII', 'OSFL', 'CGR', 'RUT', 'PEP', 'FATF', 'OFAC', 'ONU',
  'BID', 'UE', 'UK', 'UN', 'EU', 'IPA3', 'IPF', 'IVO', 'SCJ', 'CMF', 'DIPRES',
  'RES', 'ICIJ', 'OSINT', 'LAFT', 'SA', 'SPA', 'LTDA', 'EIRL', 'SAC', 'RNPJSFL',
  'IGR', 'CEAD', 'PJSFL', 'SADP', 'FAU',
]);
const PARTICLES = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e', 'en', 'el', 'a', 'al', 'con', 'por']);

/* Las regiones del SII llegan como "XIII REGION METROPOLITANA". Capitalizar sin
   mirar convierte el numeral romano en "Xiii", que se lee como una errata. */
const ROMAN = /^(?:X{0,3})(?:IX|IV|V?I{0,3})$/;

export function titleCase(s: string | null | undefined): string {
  if (!s) return '';
  let first = true;
  return s.replace(/[\p{L}\p{N}.]+/gu, (word) => {
    const bare = word.replace(/\./g, '').toUpperCase();
    if (bare.length > 0 && ROMAN.test(bare)) {
      first = false;
      return bare;
    }
    if (ACRONYMS.has(bare)) {
      first = false;
      return word.toUpperCase();
    }
    const lower = word.toLowerCase();
    if (!first && PARTICLES.has(lower)) return lower;
    first = false;
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  });
}

/** Finding types arrive as producer codes. Analysts read Spanish. */
const FINDING_LABEL: Record<string, string> = {
  ENTITY_CONVERGENCE: 'Convergencia de entidad',
  CONTEXTUAL_ANOMALY: 'Anomalía contextual',
  PRESS_TERRITORIAL_CONVERGENCE: 'Convergencia territorial en prensa',
  PRESS_ENTITY_CONVERGENCE: 'Convergencia de entidad en prensa',
  SUPERVISORY_GAP: 'Brecha de supervisión',
  PRUDENTIAL_SANCTION: 'Sanción prudencial',
  GOVERNED_AML_SIGNAL: 'Señal AML gobernada',
};
export const findingLabel = (t: string) =>
  FINDING_LABEL[t] ?? titleCase(t.replace(/_/g, ' '));

/** Priority bands arrive as shadow-model codes; SIN_MARCA_SHADOW is not a band
 *  the analyst should have to decode. */
const BAND_LABEL: Record<string, string> = {
  SIN_MARCA_SHADOW: 'Sin marca activa',
  MUY_ALTA: 'Muy alta',
  ALTA: 'Alta',
  MEDIA: 'Media',
  BAJA: 'Baja',
};
export const bandLabel = (b: string | null | undefined) =>
  !b ? 'sin banda' : BAND_LABEL[b] ?? titleCase(b.replace(/_/g, ' '));

export type Tone = 'critical' | 'high' | 'medium' | 'watch' | 'none';

export function priorityTone(p: string | null | undefined): Tone {
  switch ((p ?? '').toUpperCase()) {
    case 'MUY ALTA': return 'critical';
    case 'ALTA': return 'high';
    case 'MEDIA': return 'medium';
    case 'OBSERVAR': return 'watch';
    default: return 'none';
  }
}

export const toneVar = (t: Tone) =>
  ({ critical: 'var(--sig-critical)', high: 'var(--sig-high)', medium: 'var(--sig-medium)',
     watch: 'var(--sig-watch)', none: 'var(--sig-none)' }[t]);

export const sourceClassVar = (c: string | null | undefined) =>
  ({ producer: 'var(--class-producer)', official_list: 'var(--class-official)',
     connector: 'var(--class-connector)', osint_on_demand: 'var(--class-osint)',
     investigative_dataset: 'var(--class-dataset)' } as Record<string, string>)[c ?? ''] ??
  'var(--ink-3)';

export const sourceClassLabel = (c: string | null | undefined) =>
  ({ producer: 'Productor gobernado', official_list: 'Lista oficial',
     connector: 'Conector', osint_on_demand: 'OSINT bajo demanda',
     investigative_dataset: 'Dataset investigativo' } as Record<string, string>)[c ?? ''] ??
  (c ?? 'Sin clase');

export const statusLabel = (s: string) =>
  ({ PRESENT: 'Con registro', ABSENT: 'Sin registro', NOT_CONSULTED: 'No consultada',
     ERROR: 'Error de consulta' } as Record<string, string>)[s] ?? s;

export const shortSource = (code: string) =>
  code.replace(/^RADAR_/, '').replace(/_/g, ' ');

/** Event and identity vocabularies arrive partly in English from the producers.
 *  The analyst reads Spanish, so unmapped codes fall back to title case rather
 *  than being shown raw. */
const EVENT_LABEL: Record<string, string> = {
  REGULATORY_SANCTION: 'Sanción regulatoria',
  PRESS_CONTEXT_EVENT: 'Mención en prensa',
  PRESS_MENTION: 'Mención en prensa',
  ENTITY_CONVERGENCE: 'Convergencia de fuentes',
  CONTEXTUAL_ANOMALY: 'Anomalía contextual',
  SUPERVISORY_GAP: 'Brecha de supervisión',
  PRUDENTIAL_SANCTION: 'Sanción prudencial',
};
export function eventLabel(tipo: string | null, tipoEs: string | null): string {
  if (tipo && EVENT_LABEL[tipo]) return EVENT_LABEL[tipo];
  // A tipo_es that is still English (the producer echoed the code) is no better
  // than the code itself.
  if (tipoEs && !/^[A-Z_]+$/.test(tipoEs) && !EVENT_LABEL[tipoEs.toUpperCase().replace(/ /g, '_')]) {
    return tipoEs;
  }
  if (tipoEs) return EVENT_LABEL[tipoEs.toUpperCase().replace(/ /g, '_')] ?? tipoEs;
  return tipo ? titleCase(tipo.replace(/_/g, ' ')) : 'Evento';
}

const IDENTITY_LABEL: Record<string, string> = {
  RUT_EXACT: 'RUT exacto',
  RUT_EXACTO: 'RUT exacto',
  NAME_MATCH: 'Coincidencia por nombre',
  NAME_CANDIDATE: 'Candidata por nombre',
  UNRESOLVED: 'Sin resolver',
};
export const identityLabel = (s: string | null | undefined) =>
  !s ? '—' : IDENTITY_LABEL[s.toUpperCase()] ?? titleCase(s.replace(/_/g, ' '));
