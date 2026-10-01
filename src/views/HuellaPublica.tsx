import { useState } from 'react';
import { HuellaEntityExplorer } from './HuellaEntityExplorer';
import { HuellaSampleBuilder } from './HuellaSampleBuilder';
import { AgencyBeneficiaryUniverse } from './AgencyBeneficiaryUniverse';
import '../styles/agency-beneficiaries.css';
import '../styles/huella-publica-premium.css';
import '../styles/huella-publica-refine.css';
import '../styles/huella-publica-layout-fix.css';

type AnalysisMode = 'ENTITY' | 'SAMPLE' | 'PUBLIC_SERVICES';

const FIRST_PUBLIC_FUNDS_YEAR = 2016;
const CURRENT_YEAR = new Date().getFullYear();

export function HuellaPublica({ onNavigate }: { onNavigate: (hash: string) => void }) {
  const [mode, setMode] = useState<AnalysisMode>('ENTITY');
  const [fromYear, setFromYear] = useState(FIRST_PUBLIC_FUNDS_YEAR);
  const [toYear, setToYear] = useState(CURRENT_YEAR);

  const description = mode === 'PUBLIC_SERVICES'
    ? 'Parte desde un servicio público y reconstruye a quiénes compró, pagó o transfirió recursos durante el período consultado.'
    : mode === 'SAMPLE'
      ? 'Construye cohortes de entidades a partir de su relación económica con el Estado y las marcas disponibles en Atlas.'
      : 'Reconstruye la relación económica observada de una entidad con el Estado y concentra compras, pagos, organismos y contexto Atlas en una sola vista.';

  return (
    <div className="huella-workspace fade-in" data-mode={mode}>
      <header className="huella-topbar">
        <div className="huella-title-block">
          <span>ATLAS · vínculo con organismos públicos</span>
          <h1>Huella pública</h1>
          <p>{description}</p>
        </div>

        <div className="huella-top-controls">
          <nav className="huella-analysis-tabs" role="tablist" aria-label="Opciones de análisis de Huella pública">
            <button type="button" role="tab" aria-selected={mode === 'ENTITY'} data-active={mode === 'ENTITY'} onClick={() => setMode('ENTITY')}>
              <i aria-hidden="true">⌕</i><span>Explorar entidad</span>
            </button>
            <button type="button" role="tab" aria-selected={mode === 'SAMPLE'} data-active={mode === 'SAMPLE'} onClick={() => setMode('SAMPLE')}>
              <i aria-hidden="true">▦</i><span>Construir muestra</span>
            </button>
            <button type="button" role="tab" aria-selected={mode === 'PUBLIC_SERVICES'} data-active={mode === 'PUBLIC_SERVICES'} onClick={() => setMode('PUBLIC_SERVICES')}>
              <i aria-hidden="true">⌂</i><span>Servicios públicos</span>
            </button>
          </nav>

          <div className="huella-global-period" aria-label="Período de análisis">
            <span>Período de análisis</span>
            <div>
              <input aria-label="Año inicial" type="number" min={FIRST_PUBLIC_FUNDS_YEAR} max={toYear} value={fromYear} onChange={(event) => setFromYear(Math.min(toYear, Number(event.target.value) || FIRST_PUBLIC_FUNDS_YEAR))} />
              <b>→</b>
              <input aria-label="Año final" type="number" min={fromYear} max={CURRENT_YEAR} value={toYear} onChange={(event) => setToYear(Math.max(fromYear, Number(event.target.value) || CURRENT_YEAR))} />
            </div>
          </div>
        </div>
      </header>

      {mode === 'ENTITY' && <HuellaEntityExplorer onNavigate={onNavigate} fromYear={fromYear} toYear={toYear} />}
      {mode === 'SAMPLE' && <HuellaSampleBuilder onNavigate={onNavigate} fromYear={fromYear} toYear={toYear} />}
      {mode === 'PUBLIC_SERVICES' && <AgencyBeneficiaryUniverse onNavigate={onNavigate} fromYear={fromYear} toYear={toYear} compactShell />}
    </div>
  );
}
