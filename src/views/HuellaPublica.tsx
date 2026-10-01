import { useEffect, useState } from 'react';
import { RelacionEstado } from './RelacionEstado';
import { AgencyBeneficiaryUniverse } from './AgencyBeneficiaryUniverse';
import '../styles/agency-beneficiaries.css';
import '../styles/huella-publica-premium.css';

type AnalysisMode = 'ENTITY' | 'SAMPLE' | 'PUBLIC_SERVICES';

export function HuellaPublica({ onNavigate }: { onNavigate: (hash: string) => void }) {
  const [mode, setMode] = useState<AnalysisMode>('ENTITY');

  useEffect(() => {
    if (mode === 'PUBLIC_SERVICES') return undefined;

    const syncInnerMode = () => {
      const page = document.querySelector<HTMLElement>('.huella-workspace > .state-page');
      const buttons = page?.querySelectorAll<HTMLButtonElement>('.state-toolbar .state-tabs button');
      if (!buttons || buttons.length < 2) return false;
      const target = mode === 'ENTITY' ? buttons[0] : buttons[1];
      if (target?.dataset.active !== 'true') target?.click();
      return true;
    };

    if (syncInnerMode()) return undefined;
    const timer = window.setTimeout(syncInnerMode, 0);
    return () => window.clearTimeout(timer);
  }, [mode]);

  const description = mode === 'PUBLIC_SERVICES'
    ? 'Parte desde un servicio público y reconstruye a quiénes compró, pagó o transfirió recursos durante el período consultado.'
    : mode === 'SAMPLE'
      ? 'Construye cohortes de entidades a partir de su relación económica con el Estado y las marcas disponibles en Atlas.'
      : 'Reconstruye la relación económica observada de una entidad con el Estado: compras, pagos, traspasos, organismos y contrapartes.';

  return (
    <div className="huella-workspace fade-in" data-mode={mode}>
      <header className="huella-topbar">
        <div className="huella-title-block">
          <span>ATLAS · vínculo con organismos públicos</span>
          <h1>Huella pública</h1>
          <p>{description}</p>
        </div>

        <nav className="huella-analysis-tabs" role="tablist" aria-label="Opciones de análisis de Huella pública">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'ENTITY'}
            data-active={mode === 'ENTITY'}
            onClick={() => setMode('ENTITY')}
          >Explorar entidad</button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'SAMPLE'}
            data-active={mode === 'SAMPLE'}
            onClick={() => setMode('SAMPLE')}
          >Construir muestra</button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'PUBLIC_SERVICES'}
            data-active={mode === 'PUBLIC_SERVICES'}
            onClick={() => setMode('PUBLIC_SERVICES')}
          >Servicios públicos</button>
        </nav>
      </header>

      {mode === 'PUBLIC_SERVICES'
        ? <AgencyBeneficiaryUniverse onNavigate={onNavigate} />
        : <RelacionEstado onNavigate={onNavigate} />}
    </div>
  );
}
