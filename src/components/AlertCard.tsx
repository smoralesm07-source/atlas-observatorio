import { useState } from 'react';
import type { AlertRow } from '../lib/contracts';
import { hrefFor } from '../lib/router';
import { n1, priorityTone, rutFormat, titleCase, toneVar } from '../lib/format';
import { Badge, PriorityBadge } from './primitives';

const SCOPE_LABEL: Record<string, string> = {
  ENTITY: 'Entidad',
  SECTOR: 'Sector',
  REGION: 'Región',
  FINDING: 'Hallazgo',
  SYSTEM: 'Sistema',
};

/** A signal card answers three questions before any click: what pattern fired,
 *  how strongly, and over what. The evidence stays one interaction away. */
export function AlertCard({
  alert,
  onNavigate,
  compact = false,
}: {
  alert: AlertRow;
  onNavigate: (hash: string) => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const tone = priorityTone(alert.priority);
  const color = toneVar(tone);
  const payload = alert.payload ?? {};
  const facts = Object.entries(payload).filter(
    ([, v]) => v != null && typeof v !== 'object',
  );

  return (
    <article className="alert-card">
      <div className="alert-rail" style={{ background: color }} />
      <div className="alert-body">
        <div className="alert-top">
          <PriorityBadge priority={alert.priority} />
          <Badge tone="neutral">{titleCase(alert.family)}</Badge>
          <Badge tone="neutral">{SCOPE_LABEL[alert.scope_type] ?? alert.scope_type}</Badge>
          <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="strength-bar" title={`Intensidad ${n1(alert.strength)}`}>
              <span style={{ width: `${Math.min(100, alert.strength ?? 0)}%`, background: color }} />
            </span>
            <span className="num" style={{ fontSize: 11.5, fontWeight: 650, color }}>
              {n1(alert.strength)}
            </span>
          </span>
        </div>

        <h4 className="alert-title">{alert.title ?? alert.pattern_type.replace(/_/g, ' ')}</h4>
        {alert.summary && !compact && <p className="alert-summary">{alert.summary}</p>}
        {alert.summary && compact && (
          <p className="alert-summary" style={{
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
          }}>
            {alert.summary}
          </p>
        )}

        <div className="alert-foot">
          <span className="mono" style={{ fontSize: 11, color: 'var(--ink-4)' }}>
            {alert.pattern_type}
          </span>
          {alert.scope_label && <span>· {alert.scope_label}</span>}

          {alert.entity_ref && (
            <a
              href={hrefFor({ view: 'ficha', entityId: alert.entity_ref.entity_id })}
              onClick={(e) => {
                e.preventDefault();
                onNavigate(hrefFor({ view: 'ficha', entityId: alert.entity_ref!.entity_id }));
              }}
              style={{ color: 'var(--accent)', fontWeight: 550 }}
            >
              {alert.entity_ref.name}
              {alert.entity_ref.rut && (
                <span className="mono" style={{ color: 'var(--ink-3)', marginLeft: 6 }}>
                  {rutFormat(alert.entity_ref.rut)}
                </span>
              )}
              {' →'}
            </a>
          )}

          {facts.length > 0 && (
            <button
              className="chip"
              style={{ marginLeft: 'auto', padding: '3px 9px', fontSize: 11 }}
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
            >
              {open ? 'Ocultar evidencia' : `Evidencia (${facts.length})`}
            </button>
          )}
        </div>

        {open && facts.length > 0 && (
          <dl className="kv fade-in" style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--line-soft)' }}>
            {facts.map(([k, v]) => (
              <div key={k} style={{ display: 'contents' }}>
                <dt>{titleCase(k.replace(/_/g, ' '))}</dt>
                <dd className={typeof v === 'number' ? 'num' : undefined}>{String(v)}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </article>
  );
}
