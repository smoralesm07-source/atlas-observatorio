import type { ReactNode } from 'react';
import { priorityTone, statusLabel, type Tone } from '../lib/format';
import { UafSectorWatch } from './UafSectorWatch';

export function Badge({
  tone = 'neutral',
  children,
  dot = false,
  title,
}: {
  tone?: Tone | 'neutral' | 'present' | 'absent' | 'unknown';
  children: ReactNode;
  dot?: boolean;
  title?: string;
}) {
  return (
    <span className={`badge badge-${tone}`} title={title}>
      {dot && <i className="dot" />}
      {children}
    </span>
  );
}

export function PriorityBadge({ priority }: { priority: string | null | undefined }) {
  if (!priority) return <Badge tone="none">Sin prioridad</Badge>;
  return (
    <Badge tone={priorityTone(priority)} dot>
      {priority}
    </Badge>
  );
}

export function SourceStatusBadge({ status }: { status: string }) {
  const tone =
    status === 'PRESENT' ? 'present' : status === 'NOT_CONSULTED' ? 'unknown' : 'absent';
  return <Badge tone={tone as 'present'}>{statusLabel(status)}</Badge>;
}

export function Panel({
  title,
  meta,
  children,
  actions,
  pad = true,
}: {
  title?: string;
  meta?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  pad?: boolean;
}) {
  const sectorWatch =
    typeof title === 'string'
    && (title === 'Estado registral ante el SII' || title.toLocaleLowerCase('es').includes('conciliación uaf'));

  return (
    <section className="panel">
      {(title || actions) && (
        <header className="panel-head">
          <h3>{title}</h3>
          <div className="meta">{actions ?? meta}</div>
        </header>
      )}
      <div className={pad ? 'panel-pad' : undefined}>{children}</div>
      {sectorWatch && <UafSectorWatch />}
    </section>
  );
}

export function Loading({ label = 'Consultando fuentes…' }: { label?: string }) {
  return (
    <div className="loading">
      <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden>
        <circle cx="14" cy="14" r="10" fill="none" stroke="var(--line)" strokeWidth="2" />
        <circle
          cx="14" cy="14" r="10" fill="none" stroke="var(--accent)" strokeWidth="2"
          strokeLinecap="round" strokeDasharray="20 44"
        >
          <animateTransform
            attributeName="transform" type="rotate" from="0 14 14" to="360 14 14"
            dur="0.9s" repeatCount="indefinite"
          />
        </circle>
      </svg>
      <span>{label}</span>
    </div>
  );
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="empty">
      <svg width="34" height="34" viewBox="0 0 24 24" fill="none" aria-hidden>
        <circle cx="11" cy="11" r="7" stroke="var(--ink-4)" strokeWidth="1.6" />
        <path d="m16.5 16.5 4 4" stroke="var(--ink-4)" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      <strong style={{ color: 'var(--ink-2)', fontWeight: 600 }}>{title}</strong>
      {hint && <span style={{ maxWidth: '46ch' }}>{hint}</span>}
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div className="errbox">
      <strong>No se pudo leer el contrato</strong>
      <span style={{ color: 'var(--ink-2)', maxWidth: '52ch' }}>{error}</span>
      {onRetry && (
        <button className="btn" style={{ marginTop: 6 }} onClick={onRetry}>
          Reintentar
        </button>
      )}
    </div>
  );
}

/** Every derived number in this app carries what it is not. */
export function Semantics({ children }: { children: ReactNode }) {
  return (
    <div className="semantics">
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, marginTop: 1 }} aria-hidden>
        <circle cx="8" cy="8" r="6.6" stroke="currentColor" strokeWidth="1.3" opacity=".55" />
        <path d="M8 7.2v4M8 4.9v.9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <div>{children}</div>
    </div>
  );
}