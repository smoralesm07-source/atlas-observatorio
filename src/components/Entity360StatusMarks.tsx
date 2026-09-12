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

const rutKey = (value: string | null | undefined) =>
  String(value ?? '').toUpperCase().replace(/[^0-9K]/g, '');

/**
 * Añade al renglón principal de Entidad 360 dos estados regulatorios compactos
 * sin duplicar el contrato pesado del expediente. El portal permite mantener
 * este indicador desacoplado de la ficha analítica y consultar un RPC liviano
 * por entity_id/RUT.
 *
 * La clave de consulta se toma del RUT que está efectivamente visible en la
 * ficha. Así el botón Gestionar nunca hereda un RUT de otra resolución de
 * identidad o de una navegación anterior.
 */
export function Entity360StatusMarks({ entityId, role }: { entityId: string; role: AtlasRole }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [lookupKey, setLookupKey] = useState('');
  const { data, loading, error } = useRpc<EntityUafStatus>(
    'obs_entity_uaf_status',
    { p_entity_id: lookupKey },
    { skip: !lookupKey },
  );

  useEffect(() => {
    setTarget(null);
    setLookupKey('');

    const locate = () => {
      const root = document.querySelector<HTMLElement>('.entity360');
      const node = root?.querySelector<HTMLElement>('.entity360-titleline') ?? null;
      if (!root || !node) return false;

      const visibleRut = root.querySelector<HTMLElement>('.entity360-meta .mono')?.textContent?.trim() ?? '';
      const nextLookup = visibleRut && !/^sin rut$/i.test(visibleRut) ? visibleRut : entityId;
      setLookupKey(nextLookup);
      setTarget(node);
      return true;
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
  if (!target || !lookupKey || loading || error || !data) return null;

  // Defensa adicional: si el RPC devolviera por cualquier razón un RUT distinto
  // del que la ficha principal está mostrando, no renderizamos marcas ni una
  // acción de gestión sobre una identidad cruzada.
  const visibleRutKey = rutKey(lookupKey);
  const returnedRutKey = rutKey(data.rut);
  if (visibleRutKey && returnedRutKey && visibleRutKey !== returnedRutKey) return null;

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
  const navigationRut = data.rut ?? lookupKey;

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
          onClick={() => {
            window.location.hash = `#/universo-so?vista=casos&cola=${manageableQueue}&q=${encodeURIComponent(navigationRut)}`;
          }}
          title={manageableQueue === 'termino' ? 'Abrir este universo en la mesa de casos' : 'Abrir potenciales SO en la mesa de casos'}
        >
          Gestionar
        </button>
      )}
    </>,
    target,
  );
}
