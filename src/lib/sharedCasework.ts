import {
  EMPTY_CONTACT, caseKey,
  type CaseContact, type CaseKind, type CaseMap, type CasePriority, type CaseState,
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
  state: Exclude<CaseState, 'SIN_TRABAJAR'>;
  priority: CasePriority;
  note: string | null;
  contact: Partial<CaseContact> | null;
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
    out[caseKey(kind, row.rut)] = {
      kind,
      rut: row.rut,
      subject,
      state: row.state,
      priority: row.priority,
      note: row.note ?? '',
      contact: { ...EMPTY_CONTACT, ...(row.contact ?? {}) },
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
