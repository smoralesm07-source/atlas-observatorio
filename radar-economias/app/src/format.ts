import type { SourceStatus } from './types';

const nf = new Intl.NumberFormat('es-CL');
export const n = (v: number | null | undefined) => (v == null ? '—' : nf.format(v));

/** Fechas civiles (AAAA-MM-DD) se muestran tal cual: convertirlas a Date las
 *  corre un día en la zona horaria de Chile. */
export function civil(d: string | null | undefined): string {
  if (!d) return 's/f';
  const m = d.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/);
  if (!m) return d;
  return m[3] ? `${m[3]}-${m[2]}-${m[1]}` : `${m[2]}-${m[1]}`;
}

export function instant(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('es-CL', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Santiago' });
}

export const STATUS_LABEL: Record<SourceStatus, string> = {
  FRESH: 'Respondió',
  ARCHIVE: 'Archivo histórico',
  DEGRADED: 'Respondió con error',
  UNREACHABLE: 'No respondió',
  NOT_CONSULTED: 'No consultada',
};

export const STATUS_ICON: Record<SourceStatus, string> = {
  FRESH: '✓',
  ARCHIVE: '◷',
  DEGRADED: '!',
  UNREACHABLE: '✕',
  NOT_CONSULTED: '–',
};

export const SCOPE_LABEL = { CL: 'Chile', LATAM: 'Latinoamérica', GLOBAL: 'Global' } as const;

export const EVENT_TYPE_LABEL: Record<string, string> = {
  REIVINDICACION_RANSOMWARE: 'Reivindicación de ransomware',
  DOMINIO_SUPLANTACION: 'Dominio que suplanta una marca',
  BRECHA_CATALOGADA: 'Brecha catalogada',
  DIRECCION_DESIGNADA: 'Dirección cripto designada',
  ACTOR_ORIENTADO_REGION: 'Actor orientado a la región',
  ENTIDAD_ALERTADA: 'Entidad alertada por la CMF',
  SITIO_BLOQUEADO: 'Sitio con orden de bloqueo',
};

export const LEGAL_LABEL = ['Metadatos públicos', 'Nombres de organizaciones', 'Requiere informe jurídico'] as const;
