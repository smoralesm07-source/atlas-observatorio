import type { UafPotentialCandidate, UafSubjectRow } from '../../lib/contracts';
import {
  caseKey, recordFor, subjectFromCandidate, subjectFromTermination,
  type CaseKind, type CaseMap, type CaseRecord, type CaseSubject,
} from '../../lib/casework';

/* Las dos colas de la mesa vienen de contratos distintos —la cohorte del padrón
   y la conciliación SII ↔ UAF— y no comparten ni un campo de puntuación. Esta
   proyección las deja comparables para la lista y para los filtros, sin borrar
   lo propio de cada una: el payload original viaja intacto para la ficha. */

export interface CaseMarks {
  press: number;
  sanction: number;
  osfl: boolean;
  supplier: boolean;
  alerts: number;
  evidence: number;
}

export interface CaseRow {
  key: string;
  kind: CaseKind;
  subject: CaseSubject;
  record: CaseRecord;
  /** IVO para los potenciales, IPF para los términos de giro. Escalas distintas
   *  que nunca se suman ni se promedian entre colas. */
  score: number | null;
  scoreLabel: 'IVO' | 'IPF';
  band: string | null;
  date: string | null;
  year: number | null;
  size: string | null;
  sizeRank: number | null;
  workers: number | null;
  years: number | null;
  materiality: number | null;
  reviewState: string | null;
  res: boolean;
  marks: CaseMarks;
  /** Texto plano sobre el que corre el buscador de la cola. */
  haystack: string;
  candidate: UafPotentialCandidate | null;
  termination: UafSubjectRow | null;
}

const bandOrder: Record<string, number> = { MUY_ALTA: 5, ALTA: 4, MEDIA: 3, BAJA: 2, MINIMA: 1 };
export const bandRank = (band: string | null) => (band ? bandOrder[band] ?? 0 : 0);

const hay = (parts: (string | null | undefined)[]) =>
  parts.filter(Boolean).join(' ').toLowerCase();

export function rowFromCandidate(candidate: UafPotentialCandidate, cases: CaseMap): CaseRow {
  const subject = subjectFromCandidate(candidate);
  return {
    key: caseKey('POTENCIAL', candidate.rut),
    kind: 'POTENCIAL',
    subject,
    record: recordFor(cases, 'POTENCIAL', subject),
    score: candidate.ivo_score,
    scoreLabel: 'IVO',
    band: candidate.ivo_band,
    date: candidate.sii_activity_start_date,
    year: candidate.sii_activity_start_date ? Number(candidate.sii_activity_start_date.slice(0, 4)) : null,
    size: candidate.sales_band_size,
    sizeRank: candidate.sales_band_rank,
    workers: candidate.workers,
    years: candidate.activity_years,
    materiality: candidate.materiality_score,
    reviewState: candidate.review_state,
    res: candidate.res_available,
    marks: {
      press: 0,
      sanction: candidate.uaf_sanction_events,
      osfl: false,
      supplier: false,
      alerts: candidate.screening_evidence_count ?? 0,
      evidence: candidate.source_count ?? 0,
    },
    haystack: hay([
      candidate.name, candidate.rut, candidate.rut.replace(/[^0-9kK]/g, ''),
      candidate.implied_sector, candidate.matched_activity, candidate.region, candidate.commune,
      ...(candidate.activity_codes ?? []),
    ]),
    candidate,
    termination: null,
  };
}

export function rowFromTermination(termination: UafSubjectRow, cases: CaseMap): CaseRow {
  const subject = subjectFromTermination(termination);
  return {
    key: caseKey('TERMINO', termination.rut),
    kind: 'TERMINO',
    subject,
    record: recordFor(cases, 'TERMINO', subject),
    score: termination.ipf_score,
    scoreLabel: 'IPF',
    band: termination.ipf_band,
    date: termination.sii_termination_date,
    year: termination.sii_termination_date ? Number(termination.sii_termination_date.slice(0, 4)) : null,
    size: termination.sales_band,
    sizeRank: null,
    workers: termination.workers,
    years: termination.activity_years,
    materiality: null,
    reviewState: null,
    res: false,
    marks: {
      press: termination.press_evidence_count,
      sanction: termination.sanction_evidence_count,
      osfl: termination.is_osfl,
      supplier: termination.is_state_supplier,
      alerts: termination.alert_count,
      evidence: termination.evidence_count,
    },
    haystack: hay([
      termination.name, termination.rut, termination.rut.replace(/[^0-9kK]/g, ''),
      termination.uaf_sector, termination.main_activity, termination.economic_sector,
      termination.region, termination.commune,
    ]),
    candidate: null,
    termination,
  };
}

/** Un caso de la cartera cuya cola no está cargada sigue siendo trabajable: la
 *  identidad y el contacto ya están guardados. Lo que falta es la
 *  caracterización, y la ficha lo dice en vez de dibujar ceros. */
export function rowFromRecord(record: CaseRecord): CaseRow {
  return {
    key: caseKey(record.kind, record.rut),
    kind: record.kind,
    subject: record.subject,
    record,
    score: null,
    scoreLabel: record.kind === 'POTENCIAL' ? 'IVO' : 'IPF',
    band: null,
    date: null,
    year: null,
    size: null,
    sizeRank: null,
    workers: null,
    years: null,
    materiality: null,
    reviewState: null,
    res: false,
    marks: { press: 0, sanction: 0, osfl: false, supplier: false, alerts: 0, evidence: 0 },
    haystack: hay([record.subject.name, record.rut, record.subject.sector, record.subject.region, record.subject.commune]),
    candidate: null,
    termination: null,
  };
}

export const markCount = (marks: CaseMarks) =>
  marks.press + marks.sanction + marks.alerts + (marks.osfl ? 1 : 0) + (marks.supplier ? 1 : 0);
