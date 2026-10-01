import { useState } from 'react';
import { RelacionEstado } from './RelacionEstado';
import { AgencyBeneficiaryUniverse } from './AgencyBeneficiaryUniverse';
import '../styles/agency-beneficiaries.css';

type Orientation = 'ENTITY_TO_STATE' | 'STATE_TO_ENTITY';

export function HuellaPublica({ onNavigate }: { onNavigate: (hash: string) => void }) {
  const [orientation, setOrientation] = useState<Orientation>('ENTITY_TO_STATE');

  return (
    <>
      <div className="huella-orientation-shell fade-in">
        <div className="huella-orientation-bar">
          <div className="huella-orientation-copy">
            <span>Sentido de consulta</span>
            <small>Consulta una entidad frente al Estado o invierte la lectura para reconstruir los beneficiarios de un organismo público.</small>
          </div>
          <div className="huella-orientation-tabs" role="tablist" aria-label="Sentido de consulta de Huella pública">
            <button role="tab" aria-selected={orientation === 'ENTITY_TO_STATE'} data-active={orientation === 'ENTITY_TO_STATE'} onClick={() => setOrientation('ENTITY_TO_STATE')}>Entidad → Estado</button>
            <button role="tab" aria-selected={orientation === 'STATE_TO_ENTITY'} data-active={orientation === 'STATE_TO_ENTITY'} onClick={() => setOrientation('STATE_TO_ENTITY')}>Estado → Entidades</button>
          </div>
        </div>
      </div>
      {orientation === 'ENTITY_TO_STATE'
        ? <RelacionEstado onNavigate={onNavigate} />
        : <AgencyBeneficiaryUniverse onNavigate={onNavigate} />}
    </>
  );
}
