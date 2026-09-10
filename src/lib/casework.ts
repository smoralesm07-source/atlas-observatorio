/* La mesa de casos del fiscalizador
   ─────────────────────────────────
   Atlas detecta y ubica; la tramitación ocurre fuera. Entre las dos cosas hay
   un trabajo que hoy se hace en una planilla suelta: marcar qué caso está en
   qué estado, anotar el contacto que se encontró y armar el lote que se lleva
   al proceso institucional. Eso es lo que guarda este módulo.

   LÍMITES DECLARADOS:
    * Vive en el navegador de quien trabaja (localStorage). No es un registro
      institucional, no se comparte entre personas y una sesión privada o un
      equipo distinto empieza en blanco. El CSV es la salida que sí viaja.
    * El estado describe el avance de la ubicación, no una decisión sobre la
      obligación de inscribirse ni sobre el término de giro.
    * El contacto lo escribe el fiscalizador desde fuentes abiertas: es una
      propuesta verificable, no un dato acreditado. */

import type { UafSubjectRow, UafPotentialCandidate } from './contracts';
import { fecha, rutFormat, titleCase } from './format';

export type CaseKind = 'POTENCIAL' | 'TERMINO';

export type CaseState =
  | 'SIN_TRABAJAR'
  | 'EN_UBICACION'
  | 'CONTACTO_OBTENIDO'
  | 'LISTO_REQUERIMIENTO'
  | 'SIN_UBICAR'
  | 'DESCARTADO';

export type CasePriority = 'ALTA' | 'MEDIA' | 'BAJA';

export interface CaseContact {
  telefono: string;
  correo: string;
  sitio: string;
  direccion: string;
  persona: string;
  fuente: string;
}

/** Lo mínimo para que un caso siga siendo legible en la cartera aunque su cola
 *  no esté cargada: quién es, dónde está y por qué entró. */
export interface CaseSubject {
  rut: string;
  name: string;
  sector: string | null;
  region: string | null;
  commune: string | null;
  entityId: string | null;
  motive: string;
}

export interface CaseRecord {
  kind: CaseKind;
  rut: string;
  subject: CaseSubject;
  state: CaseState;
  priority: CasePriority;
  note: string;
  contact: CaseContact;
  updatedAt: string;
}

export type CaseMap = Record<string, CaseRecord>;

const KEY = 'atlas-observatorio-universo-so-casework-v1';
/** Claves de las dos iteraciones anteriores de la mesa. Sólo guardaban el
 *  estado, así que se recuperan los estados y la identidad se rehidrata cuando
 *  la cola vuelve a cargar al sujeto. Perder las marcas de alguien porque la
 *  pantalla cambió no es una opción. */
const LEGACY_KEYS = [
  'atlas-observatorio-universo-so-management-v1',
  'atlas-universo-so-case-status-v3',
];

export const STATES: { key: CaseState; label: string; short: string; tone: string; step: number }[] = [
  { key: 'SIN_TRABAJAR', label: 'Sin trabajar', short: 'Sin trabajar', tone: 'var(--ink-4)', step: 0 },
  { key: 'EN_UBICACION', label: 'En ubicación', short: 'Ubicando', tone: 'var(--sig-watch)', step: 1 },
  { key: 'CONTACTO_OBTENIDO', label: 'Contacto obtenido', short: 'Con contacto', tone: 'var(--unknown)', step: 2 },
  { key: 'LISTO_REQUERIMIENTO', label: 'Listo para requerimiento', short: 'Listo', tone: 'var(--present)', step: 3 },
  { key: 'SIN_UBICAR', label: 'No se pudo ubicar', short: 'No ubicable', tone: 'var(--sig-high)', step: 3 },
  { key: 'DESCARTADO', label: 'Descartado en revisión', short: 'Descartado', tone: 'var(--sig-none)', step: 3 },
];

export const STATE_META: Record<CaseState, { label: string; short: string; tone: string; step: number }> =
  Object.fromEntries(STATES.map((s) => [s.key, s])) as Record<CaseState, typeof STATES[number]>;

/** Los tres pasos que sí son una secuencia. Los dos cierres alternativos
 *  —no ubicable y descartado— no son un paso más adelante y no entran al
 *  recorrido: se eligen aparte. */
export const STATE_FLOW: CaseState[] = ['SIN_TRABAJAR', 'EN_UBICACION', 'CONTACTO_OBTENIDO', 'LISTO_REQUERIMIENTO'];

export const PRIORITIES: { key: CasePriority; label: string; tone: string }[] = [
  { key: 'ALTA', label: 'Alta', tone: 'var(--sig-critical)' },
  { key: 'MEDIA', label: 'Media', tone: 'var(--sig-medium)' },
  { key: 'BAJA', label: 'Baja', tone: 'var(--ink-3)' },
];

export const PRIORITY_META: Record<CasePriority, { label: string; tone: string }> =
  Object.fromEntries(PRIORITIES.map((p) => [p.key, p])) as Record<CasePriority, typeof PRIORITIES[number]>;

export const KIND_META: Record<CaseKind, { label: string; short: string; action: string; tone: string }> = {
  POTENCIAL: {
    label: 'Potencial sujeto obligado',
    short: 'Potencial SO',
    action: 'Revisar inscripción',
    tone: 'var(--unknown)',
  },
  TERMINO: {
    label: 'Sujeto obligado con término de giro',
    short: 'Término de giro',
    action: 'Revisar desinscripción',
    tone: 'var(--sig-high)',
  },
};

export const EMPTY_CONTACT: CaseContact = {
  telefono: '', correo: '', sitio: '', direccion: '', persona: '', fuente: '',
};

export const caseKey = (kind: CaseKind, rut: string) => `${kind}|${rut}`;

const asContact = (raw: unknown): CaseContact => {
  const c = (raw ?? {}) as Partial<CaseContact>;
  return {
    telefono: typeof c.telefono === 'string' ? c.telefono : '',
    correo: typeof c.correo === 'string' ? c.correo : '',
    sitio: typeof c.sitio === 'string' ? c.sitio : '',
    direccion: typeof c.direccion === 'string' ? c.direccion : '',
    persona: typeof c.persona === 'string' ? c.persona : '',
    fuente: typeof c.fuente === 'string' ? c.fuente : '',
  };
};

const LEGACY_STATE: Record<string, CaseState> = {
  PENDIENTE: 'SIN_TRABAJAR',
  CONTACTO_REVISADO: 'EN_UBICACION',
  LISTO_SOLICITUD: 'LISTO_REQUERIMIENTO',
  REVISADO: 'EN_UBICACION',
  LISTO: 'LISTO_REQUERIMIENTO',
};

const LEGACY_KIND: Record<string, CaseKind> = {
  DESINSCRIPCION: 'TERMINO',
  INSCRIPCION: 'POTENCIAL',
  termino: 'TERMINO',
  potenciales: 'POTENCIAL',
};

function migrateLegacy(): CaseMap {
  const out: CaseMap = {};
  for (const key of LEGACY_KEYS) {
    let raw: string | null = null;
    try { raw = localStorage.getItem(key); } catch { return out; }
    if (!raw) continue;
    let parsed: Record<string, string>;
    try { parsed = JSON.parse(raw) as Record<string, string>; } catch { continue; }
    for (const [legacyKey, legacyState] of Object.entries(parsed)) {
      const [legacyKind, rut] = legacyKey.split('|');
      const kind = LEGACY_KIND[legacyKind];
      const state = LEGACY_STATE[legacyState];
      if (!kind || !rut || !state || state === 'SIN_TRABAJAR') continue;
      out[caseKey(kind, rut)] = {
        kind,
        rut,
        // La identidad se rehidrata en cuanto la cola vuelve a traer el sujeto.
        subject: { rut, name: '', sector: null, region: null, commune: null, entityId: null, motive: '' },
        state,
        priority: 'MEDIA',
        note: '',
        contact: { ...EMPTY_CONTACT },
        updatedAt: new Date().toISOString(),
      };
    }
  }
  return out;
}

export function loadCases(): CaseMap {
  let raw: string | null = null;
  try { raw = localStorage.getItem(KEY); } catch { return {}; }
  if (!raw) return migrateLegacy();
  try {
    const parsed = JSON.parse(raw) as Record<string, Partial<CaseRecord>>;
    const out: CaseMap = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (!value || typeof value !== 'object') continue;
      const kind = value.kind === 'POTENCIAL' || value.kind === 'TERMINO' ? value.kind : null;
      const rut = typeof value.rut === 'string' ? value.rut : null;
      if (!kind || !rut) continue;
      const subject = (value.subject ?? {}) as Partial<CaseSubject>;
      out[key] = {
        kind,
        rut,
        subject: {
          rut,
          name: typeof subject.name === 'string' ? subject.name : '',
          sector: subject.sector ?? null,
          region: subject.region ?? null,
          commune: subject.commune ?? null,
          entityId: subject.entityId ?? null,
          motive: typeof subject.motive === 'string' ? subject.motive : '',
        },
        state: STATE_META[value.state as CaseState] ? (value.state as CaseState) : 'SIN_TRABAJAR',
        priority: PRIORITY_META[value.priority as CasePriority] ? (value.priority as CasePriority) : 'MEDIA',
        note: typeof value.note === 'string' ? value.note : '',
        contact: asContact(value.contact),
        updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date().toISOString(),
      };
    }
    return out;
  } catch {
    return {};
  }
}

export function saveCases(map: CaseMap): void {
  try { localStorage.setItem(KEY, JSON.stringify(map)); } catch { /* sesión privada o cuota */ }
}

/** Un caso existe en la mesa desde que alguien lo toca. Antes de eso se muestra
 *  con los valores por defecto sin ocupar espacio en el almacenamiento. */
export function defaultRecord(kind: CaseKind, subject: CaseSubject): CaseRecord {
  return {
    kind,
    rut: subject.rut,
    subject,
    state: 'SIN_TRABAJAR',
    priority: 'MEDIA',
    note: '',
    contact: { ...EMPTY_CONTACT },
    updatedAt: new Date().toISOString(),
  };
}

export function recordFor(map: CaseMap, kind: CaseKind, subject: CaseSubject): CaseRecord {
  const stored = map[caseKey(kind, subject.rut)];
  if (!stored) return defaultRecord(kind, subject);
  // La identidad viva del corte manda sobre la copia guardada: un sector que
  // cambió en el padrón no debe quedar congelado en la mesa.
  return { ...stored, subject: { ...subject } };
}

export function applyPatch(
  map: CaseMap,
  kind: CaseKind,
  subject: CaseSubject,
  patch: Partial<Pick<CaseRecord, 'state' | 'priority' | 'note'>> & { contact?: Partial<CaseContact> },
): CaseMap {
  const key = caseKey(kind, subject.rut);
  const base = map[key] ?? defaultRecord(kind, subject);
  const next: CaseRecord = {
    ...base,
    subject: { ...subject },
    state: patch.state ?? base.state,
    priority: patch.priority ?? base.priority,
    note: patch.note ?? base.note,
    contact: patch.contact ? { ...base.contact, ...patch.contact } : base.contact,
    updatedAt: new Date().toISOString(),
  };
  return { ...map, [key]: next };
}

/** Rehidrata la identidad de los casos ya guardados con lo que trae el corte.
 *  Recupera además los que llegaron de una versión anterior sin razón social. */
export function hydrate(map: CaseMap, kind: CaseKind, subjects: CaseSubject[]): CaseMap {
  let changed = false;
  const out = { ...map };
  for (const subject of subjects) {
    const key = caseKey(kind, subject.rut);
    const stored = out[key];
    if (!stored) continue;
    const same = stored.subject.name === subject.name
      && stored.subject.sector === subject.sector
      && stored.subject.region === subject.region
      && stored.subject.commune === subject.commune
      && stored.subject.entityId === subject.entityId
      && stored.subject.motive === subject.motive;
    if (same) continue;
    out[key] = { ...stored, subject: { ...subject } };
    changed = true;
  }
  return changed ? out : map;
}

export const isTracked = (record: CaseRecord) =>
  record.state !== 'SIN_TRABAJAR'
  || record.note.trim().length > 0
  || contactFilled(record.contact) > 0;

export const contactFilled = (contact: CaseContact) =>
  (Object.keys(EMPTY_CONTACT) as (keyof CaseContact)[])
    .filter((field) => contact[field].trim().length > 0).length;

export const CONTACT_FIELDS: { key: keyof CaseContact; label: string; placeholder: string; type: string }[] = [
  { key: 'telefono', label: 'Teléfono', placeholder: '+56 2 2345 6789', type: 'tel' },
  { key: 'correo', label: 'Correo', placeholder: 'contacto@entidad.cl', type: 'email' },
  { key: 'sitio', label: 'Sitio web', placeholder: 'https://', type: 'url' },
  { key: 'direccion', label: 'Domicilio observado', placeholder: 'Calle 123, comuna', type: 'text' },
  { key: 'persona', label: 'Persona de contacto', placeholder: 'Nombre y cargo', type: 'text' },
  { key: 'fuente', label: 'Fuente del dato', placeholder: 'Dónde se encontró', type: 'text' },
];

/* ─────────────────────────────────────────────────────── salidas del trabajo */

const csvCell = (value: string | number | null | undefined) =>
  `"${String(value ?? '').replace(/"/g, '""')}"`;

export function casesToCsv(records: CaseRecord[]): string {
  const head = [
    'cola', 'accion_sugerida', 'rut', 'razon_social', 'sector', 'region', 'comuna',
    'motivo', 'estado_gestion', 'prioridad', 'telefono', 'correo', 'sitio_web',
    'domicilio', 'persona_contacto', 'fuente_contacto', 'nota', 'actualizado',
  ];
  const rows = records.map((r) => [
    KIND_META[r.kind].short,
    KIND_META[r.kind].action,
    rutFormat(r.rut),
    r.subject.name,
    r.subject.sector ?? '',
    r.subject.region ?? '',
    r.subject.commune ?? '',
    r.subject.motive,
    STATE_META[r.state].label,
    PRIORITY_META[r.priority].label,
    r.contact.telefono,
    r.contact.correo,
    r.contact.sitio,
    r.contact.direccion,
    r.contact.persona,
    r.contact.fuente,
    r.note.replace(/\s+/g, ' ').trim(),
    r.updatedAt,
  ]);
  return [head, ...rows].map((row) => row.map(csvCell).join(';')).join('\r\n');
}

export function downloadCsv(csv: string, name: string): void {
  const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** La ficha en texto plano: lo que un fiscalizador pega en un correo o en el
 *  sistema donde sí se tramita. */
export function caseSummaryText(record: CaseRecord): string {
  const c = record.contact;
  const lines = [
    `${titleCase(record.subject.name) || rutFormat(record.rut)} · ${rutFormat(record.rut)}`,
    `${KIND_META[record.kind].label} — ${KIND_META[record.kind].action}`,
    record.subject.sector ? `Sector: ${titleCase(record.subject.sector)}` : null,
    [record.subject.commune, record.subject.region].filter(Boolean).length
      ? `Territorio: ${titleCase([record.subject.commune, record.subject.region].filter(Boolean).join(', '))}`
      : null,
    record.subject.motive ? `Motivo: ${record.subject.motive}` : null,
    `Estado de gestión: ${STATE_META[record.state].label} · prioridad ${PRIORITY_META[record.priority].label.toLowerCase()}`,
    '',
    'Contacto propuesto por fuentes abiertas (por verificar):',
    c.telefono ? `  Teléfono: ${c.telefono}` : null,
    c.correo ? `  Correo: ${c.correo}` : null,
    c.sitio ? `  Sitio: ${c.sitio}` : null,
    c.direccion ? `  Domicilio: ${c.direccion}` : null,
    c.persona ? `  Persona: ${c.persona}` : null,
    c.fuente ? `  Fuente: ${c.fuente}` : null,
    contactFilled(c) === 0 ? '  Sin datos capturados todavía.' : null,
    record.note.trim() ? '' : null,
    record.note.trim() ? `Nota: ${record.note.trim()}` : null,
    '',
    `Actualizado ${fecha(record.updatedAt)} · preparado en ATLAS Observatorio. El dato de contacto proviene de fuentes abiertas y no está acreditado.`,
  ];
  return lines.filter((line) => line != null).join('\n');
}

/* ──────────────────────────────────────────── de la fila del corte a un caso */

export function subjectFromTermination(row: UafSubjectRow): CaseSubject {
  return {
    rut: row.rut,
    name: row.name,
    sector: row.uaf_sector,
    region: row.region,
    commune: row.commune,
    entityId: row.entity_id,
    motive: row.sii_termination_date
      ? `Término de giro ante el SII el ${fecha(row.sii_termination_date)}`
      : 'Término de giro observado ante el SII, sin fecha publicada',
  };
}

export function subjectFromCandidate(row: UafPotentialCandidate): CaseSubject {
  return {
    rut: row.rut,
    name: row.name,
    sector: row.implied_sector,
    region: row.region,
    commune: row.commune,
    entityId: row.entity_id,
    motive: row.matched_activity
      ? `Giro característico del sector: ${titleCase(row.matched_activity)}`
      : 'Hipótesis de inscripción derivada de la conciliación SII ↔ UAF',
  };
}
