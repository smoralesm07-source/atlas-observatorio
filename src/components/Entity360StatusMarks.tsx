import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRpc } from '../lib/rpc';
import { Badge } from './primitives';
import type { AtlasRole } from './Auth';
import '../styles/entity360-status-marks.css';

type EntityUafStatus = {
  entity_id?: string;
  rut?: string;
  universe_status?: string;
  is_uaf_registered: boolean;
  is_potential_screening: boolean;
  management_bucket?: string;
  uaf_sector?: string;
  status_basis?: string;
  refreshed_at?: string;
};

/**
 * Añade al renglón principal de Entidad 360 dos estados regulatorios compactos
 * sin duplicar el contrato pesado del expediente. El portal permite mantener
 * este indicador desacoplado de la ficha analítica y consultar un RPC liviano
 * por entity_id/RUT.
 */
export function Entity360StatusMarks({ entityId, role }: { entityId: string; role: AtlasRole }) {
  const { data, loading, error } = useRpc<EntityUafStatus>(
    'obs_entity_uaf_status',
    { p_entity_id: entityId },
  );
  const [target, setTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setTarget(null);

    const locate = () => {
      const node = document.querySelector<HTMLElement>('.entity360-titleline');
      if (node) setTarget(node);
      return Boolean(node);
    };

    if (locate()) return;

    const observer = new MutationObserver(() => {
      if (locate()) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [entityId]);

  // Si esta lectura secundaria falla, no mostramos una ausencia falsa. El
  // expediente principal sigue operativo y el analista puede continuar.
  if (!target || loading || error || !data) return null;

  const registered = data.is_uaf_registered === true;
  const potential = !registered && data.is_potential_screening === true;
  const basis = data.status_basis ?? undefined;
  const potentialTitle = data.uaf_sector
    ? `Screening de potencial SO · ${data.uaf_sector}. ${basis ?? ''}`.trim()
    : basis;
  const terminated = /término de giro/i.test(target.textContent ?? '');
  const manageableQueue = role !== 'viewer'
    ? (potential ? 'potenciales' : registered && terminated ? 'termino' : null)
    : null;

  return createPortal(
    <>
      <Badge tone={registered ? 'present' : 'absent'} title={basis}>
        {registered ? 'SO inscrito' : 'No inscrito'}
      </Badge>
      {potential && (
        <Badge tone="medium" title={potentialTitle}>
          Potencial SO
        </Badge>
      )}
      {manageableQueue && (
        <button
          className="entity360-manage-case"
          aria-label="Gestionar entidad en la mesa de casos"
          onClick={() => { window.location.hash = `#/universo-so?vista=casos&cola=${manageableQueue}&q=${encodeURIComponent(data.rut ?? entityId)}`; }}
          title={manageableQueue === 'termino' ? 'Abrir este universo en la mesa de casos' : 'Abrir potenciales SO en la mesa de casos'}
        >
          Gestionar
        </button>
      )}
    </>,
    target,
  );
}