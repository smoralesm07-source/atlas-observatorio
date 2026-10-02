import { useState } from 'react';
import { HuellaEntityExplorer } from './HuellaEntityExplorer';
import { HuellaSampleBuilder } from './HuellaSampleBuilder';
import { AgencyBeneficiaryUniverse } from './AgencyBeneficiaryUniverse';
import '../styles/agency-beneficiaries.css';
import '../styles/huella-publica-premium.css';
import '../styles/huella-publica-refine.css';
import '../styles/huella-publica-layout-fix.css';
import '../styles/huella-publica-controls-refresh.css';

type AnalysisMode = 'ENTITY' | 'SAMPLE' | 'PUBLIC_SERVICES';

const FIRST_PUBLIC_FUNDS_YEAR = 2016;
const DEFAULT_FROM_YEAR = 2020;
const DEFAULT_TO_YEAR = 2026;
const CURRENT_YEAR = new Date().getFullYear();

export function HuellaPublica({ onNavigate }: { onNavigate: (hash: string) => void }) {
  const [mode, setMode] = useState<AnalysisMode>('ENTITY');
  const [fromYear, setFromYear] = useState(DEFAULT_FROM_YEAR);
  const [toYear, setToYear] = useState(DEFAULT_TO_YEAR);

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
              <i aria-hidden="true">
                <svg viewBox="0 0 24 24" focusable="false">
                  <circle cx="10.5" cy="10.5" r="5.5" />
                  <path d="m15 15 4.5 4.5" />
                </svg>
              </i>
              <span>Explorar entidad</span>
            </button>
            <button type="button" role="tab" aria-selected={mode === 'SAMPLE'} data-active={mode === 'SAMPLE'} onClick={() => setMode('SAMPLE')}>
              <i aria-hidden="true">
                <svg viewBox="0 0 24 24" focusable="false">
                  <rect x="4" y="4" width="6" height="6" rx="1.25" />
                  <rect x="14" y="4" width="6" height="6" rx="1.25" />
                  <rect x="4" y="14" width="6" height="6" rx="1.25" />
                  <rect x="14" y="14" width="6" height="6" rx="1.25" />
                </svg>
              </i>
              <span>Construir muestra</span>
            </button>
            <button type="button" role="tab" aria-selected={mode === 'PUBLIC_SERVICES'} data-active={mode === 'PUBLIC_SERVICES'} onClick={() => setMode('PUBLIC_SERVICES')}>
              <i aria-hidden="true">
                <svg viewBox="0 0 24 24" focusable="false">
                  <path d="M3.5 9 12 4l8.5 5" />
                  <path d="M5 9h14M6.5 19.5h11M8 9v7.5M12 9v7.5M16 9v7.5" />
                </svg>
              </i>
              <span>Servicios públicos</span>
            </button>
          </nav>

          <div className="huella-global-period" aria-label="Período de análisis">
            <span>Período de análisis</span>
            <div>
              <input aria-label="Año inicial" type="number" min={FIRST_PUBLIC_FUNDS_YEAR} max={toYear} value={fromYear} onChange={(event) => setFromYear(Math.min(toYear, Number(event.target.value) || DEFAULT_FROM_YEAR))} />
              <b aria-hidden="true">→</b>
              <input aria-label="Año final" type="number" min={fromYear} max={CURRENT_YEAR} value={toYear} onChange={(event) => setToYear(Math.max(fromYear, Number(event.target.value) || DEFAULT_TO_YEAR))} />
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
