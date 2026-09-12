import type { UafSubjectRow, UafPotentialCandidate } from './contracts';
import { fecha, rutFormat, titleCase } from './format';

export type CaseKind = 'POTENCIAL' | 'TERMINO';

export type CaseState =
  | 'SIN_TRABAJAR'
  | 'GESTIONANDO'
  | 'PENDIENTE_GESTION'
  | 'DAR_DE_BAJA'
  | 'CANDIDATO'
  | 'DESCARTADO';

export type CasePriority = 'ALTA' | 'MEDIA' | 'BAJA';
export type CaseWorkflowStep = 1 | 2;
export type ManagementResult = 'UBICABLE' | 'NO_UBICABLE' | 'BAJA_OFICIO';

export interface CaseContact {
  telefono: string;
  correo: string;
  sitio: string;
  direccion: string;
  persona: string;
  fuente: string;
}

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
  workflowStep: CaseWorkflowStep;
  managementResult: ManagementResult | null;
  noContact: boolean;
  updatedAt: string;
  caseId?: string | null;
  assignedTo?: string | null;
  assignedEmail?: string | null;
  assignedName?: string | null;
  assignedAt?: string | null;
  updatedByEmail?: string | null;
  contactedAt?: string | null;
  isMine?: boolean;
}

export type CasePatch = Partial<Pick<
  CaseRecord,
  'state' | 'priority' | 'note' | 'workflowStep' | 'managementResult' | 'noContact'
>> & { contact?: Partial<CaseContact> };

export type CaseMap = Record<string, CaseRecord>;

const KEY = 'atlas-observatorio-universo-so-casework-v2';
const LEGACY_KEYS = [
  'atlas-observatorio-universo-so-casework-v1',
  'atlas-observatorio-universo-so-management-v1',
  'atlas-universo-so-case-status-v3',
];

export const STATES: { key: CaseState; label: string; short: string; tone: string; step: number }[] = [
  { key: 'SIN_TRABAJAR', label: 'Sin trabajar', short: 'Sin trabajar', tone: 'var(--ink-4)', step: 0 },
  { key: 'GESTIONANDO', label: 'Gestionando', short: 'Gestionando', tone: 'var(--sig-watch)', step: 1 },
  { key: 'PENDIENTE_GESTION', label: 'Pendiente de gestión', short: 'Pendiente', tone: 'var(--sig-medium)', step: 2 },
  { key: 'DAR_DE_BAJA', label: 'Dar de baja', short: 'Dar de baja', tone: 'var(--sig-high)', step: 3 },
  { key: 'CANDIDATO', label: 'Candidato', short: 'Candidato', tone: 'var(--present)', step: 3 },
  { key: 'DESCARTADO', label: 'Descartado', short: 'Descartado', tone: 'var(--sig-none)', step: 3 },
];

export const STATE_META: Record<CaseState, { label: string; short: string; tone: string; step: number }> =
  Object.fromEntries(STATES.map((s) => [s.key, s])) as Record<CaseState, typeof STATES[number]>;

/** Se conserva para consumidores antiguos. La ficha nueva usa dos pasos explícitos. */
export const STATE_FLOW: CaseState[] = ['GESTIONANDO', 'PENDIENTE_GESTION'];

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
    action: 'Evaluar candidatura de inscripción',
    tone: 'var(--unknown)',
  },
  TERMINO: {
    label: 'Sujeto obligado con término de giro',
    short: 'Término de giro',
    action: 'Preparar regularización de baja',
    tone: 'var(--sig-high)',
  },
};

export const RESULT_LABEL: Record<ManagementResult, string> = {
  UBICABLE: 'Ubicable',
  NO_UBICABLE: 'No ubicable',
  BAJA_OFICIO: 'Baja de oficio',
};

export const EMPTY_CONTACT: CaseContact = {
  telefono: '', correo: '', sitio: '', direccion: '', persona: '', fuente: '',
};

export const caseKey = (kind: CaseKind, rut: string) => `${kind}|${rut}`;

export const asContact = (raw: unknown): CaseContact => {
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

export function workflowFromContact(raw: unknown): Pick<CaseRecord, 'workflowStep' | 'managementResult' | 'noContact'> {
  const data = (raw ?? {}) as Record<string, unknown>;
  const rawResult = data._management_result;
  const managementResult: ManagementResult | null =
    rawResult === 'UBICABLE' || rawResult === 'NO_UBICABLE' || rawResult === 'BAJA_OFICIO'
      ? rawResult
      : null;
  return {
    workflowStep: Number(data._workflow_step) === 2 ? 2 : 1,
    managementResult,
    noContact: data._no_contact === true || data._no_contact === 'true',
  };
}

export function workflowPatchToContact(patch: CasePatch): Record<string, unknown> | null {
  const meta: Record<string, unknown> = {};
  if (patch.workflowStep != null) meta._workflow_step = patch.workflowStep;
  if (patch.managementResult !== undefined) meta._management_result = patch.managementResult;
  if (patch.noContact !== undefined) meta._no_contact = patch.noContact;
  const contact = patch.contact ? { ...patch.contact } : {};
  const combined = { ...contact, ...meta };
  return Object.keys(combined).length ? combined : null;
}

function normalizeLegacyState(kind: CaseKind, value: unknown): CaseState {
  switch (value) {
    case 'GESTIONANDO':
    case 'PENDIENTE_GESTION':
    case 'DAR_DE_BAJA':
    case 'CANDIDATO':
    case 'DESCARTADO':
      return value;
    case 'FINALIZADO':
      return kind === 'TERMINO' ? 'DAR_DE_BAJA' : 'CANDIDATO';
    case 'SIN_UBICAR':
      return 'PENDIENTE_GESTION';
    case 'EN_UBICACION':
    case 'CONTACTO_OBTENIDO':
    case 'CONTACTADO':
      return 'GESTIONANDO';
    default:
      return 'SIN_TRABAJAR';
  }
}

function migrateLegacy(): CaseMap {
  for (const key of LEGACY_KEYS) {
    let raw: string | null = null;
    try { raw = localStorage.getItem(key); } catch { return {}; }
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as Record<string, Partial<CaseRecord>>;
      const out: CaseMap = {};
      for (const [storageKey, value] of Object.entries(parsed)) {
        if (!value || typeof value !== 'object') continue;
        const kind = value.kind === 'POTENCIAL' || value.kind === 'TERMINO'
          ? value.kind
          : storageKey.toLowerCase().includes('termino') ? 'TERMINO' : 'POTENCIAL';
        const rut = typeof value.rut === 'string' ? value.rut : storageKey.split('|').pop() ?? '';
        if (!rut) continue;
        const subject = (value.subject ?? {}) as Partial<CaseSubject>;
        const workflow = workflowFromContact(value.contact);
        out[caseKey(kind, rut)] = {
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
          state: normalizeLegacyState(kind, value.state),
          priority: PRIORITY_META[value.priority as CasePriority] ? (value.priority as CasePriority) : 'MEDIA',
          note: typeof value.note === 'string' ? value.note : '',
          contact: asContact(value.contact),
          workflowStep: value.workflowStep === 2 ? 2 : workflow.workflowStep,
          managementResult: value.managementResult ?? workflow.managementResult,
          noContact: value.noContact ?? workflow.noContact,
          updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date().toISOString(),
        };
      }
      if (Object.keys(out).length) return out;
    } catch { /* probar la siguiente clave */ }
  }
  return {};
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
        state: normalizeLegacyState(kind, value.state),
        priority: PRIORITY_META[value.priority as CasePriority] ? (value.priority as CasePriority) : 'MEDIA',
        note: typeof value.note === 'string' ? value.note : '',
        contact: asContact(value.contact),
        workflowStep: value.workflowStep === 2 ? 2 : 1,
        managementResult: value.managementResult ?? null,
        noContact: value.noContact ?? false,
        updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date().toISOString(),
      };
    }
    return out;
  } catch {
    return migrateLegacy();
  }
}

export function saveCases(map: CaseMap): void {
  try { localStorage.setItem(KEY, JSON.stringify(map)); } catch { /* cuota o sesión privada */ }
}

export function defaultRecord(kind: CaseKind, subject: CaseSubject): CaseRecord {
  return {
    kind,
    rut: subject.rut,
    subject,
    state: 'SIN_TRABAJAR',
    priority: 'MEDIA',
    note: '',
    contact: { ...EMPTY_CONTACT },
    workflowStep: 1,
    managementResult: null,
    noContact: false,
    updatedAt: new Date().toISOString(),
  };
}

export function recordFor(map: CaseMap, kind: CaseKind, subject: CaseSubject): CaseRecord {
  const stored = map[caseKey(kind, subject.rut)];
  return stored ? { ...stored, subject: { ...subject } } : defaultRecord(kind, subject);
}

export function applyPatch(map: CaseMap, kind: CaseKind, subject: CaseSubject, patch: CasePatch): CaseMap {
  const key = caseKey(kind, subject.rut);
  const base = map[key] ?? defaultRecord(kind, subject);
  const next: CaseRecord = {
    ...base,
    subject: { ...subject },
    state: patch.state ?? base.state,
    priority: patch.priority ?? base.priority,
    note: patch.note ?? base.note,
    contact: patch.contact ? { ...base.contact, ...patch.contact } : base.contact,
    workflowStep: patch.workflowStep ?? base.workflowStep,
    managementResult: patch.managementResult === undefined ? base.managementResult : patch.managementResult,
    noContact: patch.noContact ?? base.noContact,
    updatedAt: new Date().toISOString(),
  };
  return { ...map, [key]: next };
}

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
  { key: 'direccion', label: 'Dirección', placeholder: 'Calle 123, comuna', type: 'text' },
  { key: 'correo', label: 'Correo electrónico', placeholder: 'contacto@entidad.cl', type: 'email' },
  { key: 'sitio', label: 'Sitio web', placeholder: 'https://', type: 'url' },
  { key: 'telefono', label: 'Teléfono', placeholder: '+56 2 2345 6789', type: 'tel' },
  { key: 'persona', label: 'Persona de contacto', placeholder: 'Nombre y cargo (opcional)', type: 'text' },
  { key: 'fuente', label: 'Fuente / referencia', placeholder: 'Dónde se verificó el dato', type: 'text' },
];

const csvCell = (value: string | number | boolean | null | undefined) =>
  `"${String(value ?? '').replace(/"/g, '""')}"`;

function nextAction(record: CaseRecord): string {
  if (record.state === 'DAR_DE_BAJA') return 'Fiscalización: regularizar baja del registro';
  if (record.state === 'CANDIDATO') return 'Fiscalización: contactar y tramitar inscripción';
  if (record.state === 'PENDIENTE_GESTION') return 'Analista: continuar gestión';
  if (record.state === 'DESCARTADO') return 'Sin trámite posterior';
  return 'Analista: gestión en curso';
}

export function casesToCsv(records: CaseRecord[]): string {
  const head = [
    'cola', 'estado_gestion', 'accion_siguiente', 'rut', 'razon_social', 'sector', 'region', 'comuna',
    'motivo', 'paso_flujo', 'resultado_ubicacion', 'sin_contacto', 'prioridad',
    'direccion', 'correo', 'sitio_web', 'telefono', 'persona_contacto', 'fuente_contacto',
    'responsable', 'correo_responsable', 'asignado_el', 'nota_gestion', 'actualizado',
  ];
  const rows = records.map((r) => [
    KIND_META[r.kind].short,
    STATE_META[r.state].label,
    nextAction(r),
    rutFormat(r.rut),
    r.subject.name,
    r.subject.sector ?? '',
    r.subject.region ?? '',
    r.subject.commune ?? '',
    r.subject.motive,
    r.workflowStep,
    r.managementResult ? RESULT_LABEL[r.managementResult] : '',
    r.noContact ? 'Sí' : 'No',
    PRIORITY_META[r.priority].label,
    r.contact.direccion,
    r.contact.correo,
    r.contact.sitio,
    r.contact.telefono,
    r.contact.persona,
    r.contact.fuente,
    r.assignedName ?? '',
    r.assignedEmail ?? '',
    r.assignedAt ?? '',
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

export function caseSummaryText(record: CaseRecord): string {
  const c = record.contact;
  const lines = [
    `${titleCase(record.subject.name) || rutFormat(record.rut)} · ${rutFormat(record.rut)}`,
    `${KIND_META[record.kind].label}`,
    `Estado: ${STATE_META[record.state].label}`,
    record.managementResult ? `Resultado de ubicación: ${RESULT_LABEL[record.managementResult]}` : null,
    record.subject.sector ? `Sector: ${titleCase(record.subject.sector)}` : null,
    record.subject.motive ? `Motivo: ${record.subject.motive}` : null,
    '',
    'Contacto:',
    c.direccion ? `  Dirección: ${c.direccion}` : null,
    c.correo ? `  Correo: ${c.correo}` : null,
    c.sitio ? `  Web: ${c.sitio}` : null,
    c.telefono ? `  Teléfono: ${c.telefono}` : null,
    c.persona ? `  Persona: ${c.persona}` : null,
    c.fuente ? `  Fuente: ${c.fuente}` : null,
    record.noContact ? '  Marcado sin contacto.' : null,
    contactFilled(c) === 0 && !record.noContact ? '  Sin datos capturados.' : null,
    record.note.trim() ? '' : null,
    record.note.trim() ? `Comentario: ${record.note.trim()}` : null,
  ];
  return lines.filter((line) => line != null).join('\n');
}

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
