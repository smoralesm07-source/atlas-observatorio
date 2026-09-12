import {
  asContact, caseKey, workflowFromContact,
  type CaseKind, type CaseMap, type CasePriority, type CaseState, type ManagementResult,
} from './casework';

export interface SharedCaseRow {
  case_id: string;
  case_kind: CaseKind;
  rut: string;
  rut_key: string;
  entity_id: string | null;
  entity_name: string | null;
  sector: string | null;
  region: string | null;
  commune: string | null;
  motive: string | null;
  state: string;
  priority: CasePriority;
  note: string | null;
  contact: Record<string, unknown> | null;
  assigned_to: string;
  assigned_email: string;
  assigned_name: string | null;
  assigned_at: string;
  updated_by: string;
  updated_email: string;
  contacted_at: string | null;
  updated_at: string;
  is_mine: boolean;
}

function normalizeState(kind: CaseKind, state: string): CaseState {
  switch (state) {
    case 'GESTIONANDO':
    case 'PENDIENTE_GESTION':
    case 'DAR_DE_BAJA':
    case 'CANDIDATO':
    case 'DESCARTADO':
    case 'DEVUELTO':
      return state;
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

function legacyWorkflow(state: string): { workflowStep: 1 | 2; managementResult: ManagementResult | null } {
  if (state === 'CONTACTADO' || state === 'FINALIZADO') {
    return { workflowStep: 2, managementResult: 'UBICABLE' };
  }
  if (state === 'SIN_UBICAR') {
    return { workflowStep: 2, managementResult: 'NO_UBICABLE' };
  }
  return { workflowStep: 1, managementResult: null };
}

export function sharedRowsToCases(rows: SharedCaseRow[]): CaseMap {
  const out: CaseMap = {};
  for (const row of rows) {
    const kind = row.case_kind;
    const subject = {
      rut: row.rut,
      name: row.entity_name ?? '',
      sector: row.sector,
      region: row.region,
      commune: row.commune,
      entityId: row.entity_id,
      motive: row.motive ?? '',
    };
    const workflow = workflowFromContact(row.contact);
    const legacy = legacyWorkflow(row.state);
    const hasWorkflowMeta = Boolean(row.contact && Object.prototype.hasOwnProperty.call(row.contact, '_workflow_step'));
    const state = normalizeState(kind, row.state);
    out[caseKey(kind, row.rut)] = {
      kind,
      rut: row.rut,
      subject,
      state,
      priority: row.priority,
      note: row.note ?? '',
      contact: asContact(row.contact),
      workflowStep: hasWorkflowMeta ? workflow.workflowStep : legacy.workflowStep,
      managementResult: workflow.managementResult ?? legacy.managementResult,
      noContact: workflow.noContact,
      updatedAt: row.updated_at,
      caseId: row.case_id,
      assignedTo: row.assigned_to,
      assignedEmail: row.assigned_email,
      assignedName: row.assigned_name,
      assignedAt: row.assigned_at,
      updatedByEmail: row.updated_email,
      contactedAt: row.contacted_at,
      isMine: row.is_mine,
    };
  }
  return out;
}
