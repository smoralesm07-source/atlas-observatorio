import { STATUS_ICON, STATUS_LABEL } from '../format';
import type { SourceStatus } from '../types';

/** Estado de una fuente: siempre ícono + texto, nunca color solo. */
export function StatusBadge({ status }: { status: SourceStatus }) {
  return (
    <span className={`status status-${status.toLowerCase()}`}>
      <span aria-hidden="true" className="status-icon">{STATUS_ICON[status]}</span>
      {STATUS_LABEL[status]}
    </span>
  );
}
