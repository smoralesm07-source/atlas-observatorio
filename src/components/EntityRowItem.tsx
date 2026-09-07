import type { EntityRow } from '../lib/contracts';
import { n, n1, rutFormat, titleCase } from '../lib/format';
import { Badge } from './primitives';

/** The five governed producers, in a fixed order, so the dot strip reads the
 *  same on every row and a missing source is visible by position. */
const STRIP: { code: string; label: string }[] = [
  { code: 'RADAR_UAF', label: 'Padrón UAF' },
  { code: 'RADAR_SII', label: 'Actividad SII' },
  { code: 'RADAR_OSFL', label: 'Registro OSFL' },
  { code: 'RADAR_SANCIONES', label: 'Sanciones' },
  { code: 'RADAR_PRENSA', label: 'Prensa' },
];

/* Only the matches that qualify the result are labelled. Telling an analyst
   that a name search matched by name is noise. */
const MATCH_LABEL: Record<string, string> = {
  RUT_PARCIAL: 'RUT parcial',
  NOMBRE_APROXIMADO: 'Coincidencia aproximada',
};

export function EntityRowItem({
  entity: e,
  onOpen,
}: {
  entity: EntityRow;
  onOpen: () => void;
}) {
  const held = new Set(e.sources);

  return (
    <button className="row-entity" onClick={onOpen}>
      <div style={{ minWidth: 0 }}>
        <div className="row-name">
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {titleCase(e.name)}
          </span>
          {e.is_sanctioned && <Badge tone="critical" dot>Sancionada</Badge>}
          {e.is_uaf_observed && <Badge tone="present">Sujeto obligado</Badge>}
          {e.match_kind === 'RUT_EXACTO' && <Badge tone="neutral">RUT exacto</Badge>}
        </div>

        <div className="row-meta">
          <span className="rut">{rutFormat(e.rut)}</span>
          {e.entity_type && <span>{e.entity_type}</span>}
          {e.region && <span>{e.region}{e.commune ? ` · ${e.commune}` : ''}</span>}
          {e.uaf_sector && <span>{titleCase(e.uaf_sector)}</span>}
          {e.alert_count > 0 && (
            <span style={{ color: 'var(--sig-high)', fontWeight: 600 }}>
              {n(e.alert_count)} {e.alert_count === 1 ? 'señal' : 'señales'}
            </span>
          )}
          {e.finding_count > 0 && <span>{n(e.finding_count)} hallazgos</span>}
          {MATCH_LABEL[e.match_kind] && (
            <span style={{ color: 'var(--ink-4)' }}>{MATCH_LABEL[e.match_kind]}</span>
          )}
        </div>
      </div>

      <div className="row-right">
        <div
          className="srcdots"
          title={STRIP.map((s) => `${s.label}: ${held.has(s.code) ? 'con registro' : 'sin registro'}`).join('\n')}
        >
          {STRIP.map((s) => (
            <i key={s.code} className="srcdot" data-on={held.has(s.code)} />
          ))}
        </div>

        <div style={{ textAlign: 'right', minWidth: 58 }}>
          <div className="num" style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.03em' }}>
            {e.ipa3_score == null ? '—' : n1(e.ipa3_score)}
          </div>
          <div style={{ fontSize: 9.5, color: 'var(--ink-4)', letterSpacing: '.08em', textTransform: 'uppercase', fontWeight: 650 }}>
            prioridad
          </div>
        </div>

        <span style={{ color: 'var(--ink-4)' }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="m9 5 7 7-7 7" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </div>
    </button>
  );
}
