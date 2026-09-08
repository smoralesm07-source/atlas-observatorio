import type { PressAlias, SubjectRow } from '../lib/contracts';
import { n, n1, rutFormat, titleCase } from '../lib/format';
import { Badge } from './primitives';

/* Los seis padrones que el sujeto puede o no tocar, en un orden fijo para que
   la tira se lea igual en todas las filas. Cada uno responde una pregunta
   distinta, así que ninguno se agrega con otro. */
type PadronKey = 'uaf' | 'sii' | 'osfl' | 'sanciones' | 'prensa' | 'compras';

interface PadronCell {
  key: PadronKey;
  label: string;
  /** Lo que la fuente dice. null = sin registro, que no es lo mismo que cero. */
  value: string | null;
  tone: 'present' | 'critical' | 'warn' | 'neutral';
}

function clp(value: number | null | undefined): string {
  if (value == null) return '—';
  if (value >= 1e9) return `$${n1(value / 1e9)} mil M`;
  if (value >= 1e6) return `$${n1(value / 1e6)} M`;
  return `$${n(Math.round(value))}`;
}

function padrones(s: SubjectRow, pressNotes: number): PadronCell[] {
  return [
    {
      key: 'uaf',
      label: 'Padrón UAF',
      value: s.in_uaf ? (s.uaf_sector ? titleCase(s.uaf_sector) : 'Inscrita') : null,
      tone: 'present',
    },
    {
      key: 'sii',
      label: 'Actividad SII',
      value: s.in_sii
        ? (s.tax_termination ? `Término de giro ${s.tax_termination.slice(0, 4)}` : 'Con actividad')
        : null,
      tone: s.tax_termination ? 'warn' : 'present',
    },
    {
      key: 'osfl',
      label: 'Registro OSFL',
      value: s.in_osfl
        ? (s.osfl_registro19862 ? 'Sin fines de lucro · Registro 19.862' : 'Sin fines de lucro')
        : null,
      tone: 'present',
    },
    {
      key: 'sanciones',
      label: 'Sanciones',
      value: s.sanction_count > 0
        ? `${n(s.sanction_count)} ${s.sanction_count === 1 ? 'evento' : 'eventos'}`
        : null,
      tone: 'critical',
    },
    {
      key: 'prensa',
      label: 'Prensa',
      value: pressNotes > 0
        ? `${n(pressNotes)} ${pressNotes === 1 ? 'nota' : 'notas'}`
        : s.in_press ? 'Con mención' : null,
      tone: 'warn',
    },
    {
      key: 'compras',
      label: 'Proveedor del Estado',
      value: s.spend_role === 'SUPPLIER'
        ? `${clp(s.spend_amount_12m)} · 12 meses`
        : s.spend_role === 'BUYER' ? 'Comprador público' : null,
      tone: 'present',
    },
  ];
}

export function SubjectRowItem({
  subject: s,
  pressNotes = 0,
  pressRoles = [],
  onOpen,
}: {
  subject: SubjectRow;
  /** Notas de prensa que Radar Prensa asocia a este sujeto, ya resueltas. */
  pressNotes?: number;
  pressRoles?: string[];
  onOpen: () => void;
}) {
  const cells = padrones(s, pressNotes);
  const aliases: PressAlias[] = s.press_aliases ?? [];

  /* Una entidad que sólo existe en prensa no se rotula con una etiqueta de
     estado interno. Se dice lo que pasó: aparece en prensa y no tiene RUT en
     las fuentes oficiales de este corte. */
  if (s.is_press_only) {
    return (
      <button className="row-subject row-subject-press" onClick={onOpen}>
        <div className="subject-main">
          <div className="subject-name">
            {titleCase(s.name)}
            <Badge tone="unknown">Sólo en prensa</Badge>
          </div>
          <div className="subject-meta">
            <span>Sin RUT en fuentes oficiales del corte</span>
            {pressNotes > 0 && (
              <span className="subject-press-count">
                {n(pressNotes)} {pressNotes === 1 ? 'nota' : 'notas'}
              </span>
            )}
            {pressRoles.slice(0, 3).map((r) => (
              <span key={r} className="subject-role">{r}</span>
            ))}
          </div>
        </div>
        <span className="subject-chevron" aria-hidden>→</span>
      </button>
    );
  }

  return (
    <button className="row-subject" onClick={onOpen}>
      <div className="subject-main">
        <div className="subject-name">
          {titleCase(s.name)}
          {s.sanction_count > 0 && (
            <Badge tone="critical" dot>
              {s.sanction_count === 1 ? '1 sanción' : `${n(s.sanction_count)} sanciones`}
            </Badge>
          )}
          {s.tax_status === 'TERMINATED' && <Badge tone="watch">Giro terminado</Badge>}
        </div>

        <div className="subject-meta">
          <span className="rut">{rutFormat(s.rut)}</span>
          {s.tax_activity && <span className="subject-activity">{titleCase(s.tax_activity)}</span>}
          {(s.tax_region ?? s.region) && (
            <span>{s.tax_region ?? s.region}{s.commune ? ` · ${s.commune}` : ''}</span>
          )}
        </div>

        {/* Segunda línea tributaria: desde cuándo existe, de qué tamaño es y
            con cuánta gente. El tramo 1 del SII es ausencia de dato, y por eso
            el contrato lo entrega ya rotulado como tal. */}
        {(s.tax_activity_start || s.tax_sales_band_uf || s.tax_workers != null) && (
          <div className="subject-tax">
            {s.tax_activity_start && <span>desde {s.tax_activity_start.slice(0, 4)}</span>}
            {s.tax_sales_band_uf && s.tax_sales_band_rank !== 1 && (
              <span>{s.tax_sales_band_uf}</span>
            )}
            {s.tax_size && <span>{s.tax_size}</span>}
            {s.tax_workers != null && s.tax_workers > 0 && (
              <span>{n(s.tax_workers)} trabajadores</span>
            )}
          </div>
        )}

        {aliases.length > 0 && (
          <div className="subject-aliases">
            <span className="subject-aliases-label">También aparece en prensa como</span>
            {aliases.slice(0, 4).map((a) => (
              <span key={a.entity_id} className="alias-chip">{a.name}</span>
            ))}
            {aliases.length > 4 && (
              <span className="alias-chip alias-chip-more">
                + {aliases.length - 4} {aliases.length - 4 === 1 ? 'variante' : 'variantes'}
              </span>
            )}
          </div>
        )}

        {pressRoles.length > 0 && (
          <div className="subject-roles">
            <span className="subject-roles-label">Roles en prensa</span>
            {pressRoles.slice(0, 4).map((r) => (
              <span key={r} className="subject-role">{r}</span>
            ))}
          </div>
        )}
      </div>

      {/* Padrón por padrón. "Sin registro" y "no consultada" nunca se dibujan
          igual: aquí todas las fuentes son de consulta programada, de modo que
          la ausencia sí es ausencia y se rotula como tal. */}
      <div className="subject-padrones">
        {cells.map((c) => (
          <div key={c.key} className="padron" data-on={c.value != null} data-tone={c.tone}>
            <span className="padron-label">{c.label}</span>
            <span className="padron-value">{c.value ?? 'sin registro'}</span>
          </div>
        ))}
        {s.budget_signal_count > 0 && (
          <div className="padron" data-on data-tone="warn">
            <span className="padron-label">Presupuesto y CGR</span>
            <span className="padron-value">
              {n(s.budget_signal_count)} {s.budget_signal_count === 1 ? 'señal' : 'señales'}
            </span>
          </div>
        )}
      </div>
    </button>
  );
}
