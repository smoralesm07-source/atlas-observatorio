import { useState } from 'react';
import { RelacionEstado } from './RelacionEstado';
import { AgencyBeneficiaryUniverse } from './AgencyBeneficiaryUniverse';
import '../styles/agency-beneficiaries.css';
import '../styles/huella-publica-premium.css';

type Orientation = 'ENTITY_TO_STATE' | 'STATE_TO_ENTITY';

export function HuellaPublica({ onNavigate }: { onNavigate: (hash: string) => void }) {
  const [orientation, setOrientation] = useState<Orientation>('ENTITY_TO_STATE');

  return (
    <>
      <div className="huella-mode-shell fade-in">
        <div className="huella-mode-card">
          <div className="huella-mode-copy">
            <span>Modo de análisis</span>
            <strong>Define desde dónde quieres reconstruir la relación con el Estado</strong>
            <small>La vista principal prioriza los flujos económicos. La prensa y otras marcas quedan como contexto bajo demanda.</small>
          </div>
          <div className="huella-mode-options" role="tablist" aria-label="Modo de análisis de Huella pública">
            <button
              type="button"
              role="tab"
              aria-selected={orientation === 'ENTITY_TO_STATE'}
              data-active={orientation === 'ENTITY_TO_STATE'}
              onClick={() => setOrientation('ENTITY_TO_STATE')}
            >
              <i aria-hidden="true">↗</i>
              <span><strong>Explorar entidad</strong><small>Entidad → Estado</small></span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={orientation === 'STATE_TO_ENTITY'}
              data-active={orientation === 'STATE_TO_ENTITY'}
              onClick={() => setOrientation('STATE_TO_ENTITY')}
            >
              <i aria-hidden="true">⌂</i>
              <span><strong>Beneficiarios de organismos públicos</strong><small>Estado → entidades · pagos, compras y transferencias</small></span>
            </button>
          </div>
        </div>
      </div>
      {orientation === 'ENTITY_TO_STATE'
        ? <RelacionEstado onNavigate={onNavigate} />
        : <AgencyBeneficiaryUniverse onNavigate={onNavigate} />}
    </>
  );
}
