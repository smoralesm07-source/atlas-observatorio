import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './lib/caseDrawerEnhancer';
import './lib/territoryDirectoryEnhancer';
import './styles/app.css';
import './styles/explore.css';
import './styles/osfl.css';
import './styles/osfl-detail-readable.css';
import './styles/fintech.css';
import './styles/fintech-market-cohorts.css';
import './styles/fintech-entity-market-position.css';
import './styles/fintech-accessibility.css';
import './styles/fintech-ui-cleanup.css';
import './styles/territorio-map.css';
import './styles/territory-map-priority.css';
import './styles/territory-commune-compact.css';
import './styles/territory-commune-typography.css';
import './styles/entity-expediente.css';
import './styles/entity-expediente-typography.css';
import './styles/entity-sanctions-table-fit.css';
import './styles/entities-search.css';
import './styles/entities-search-mobile-fixes.css';
import './styles/ui-fixes.css';
import './styles/entities-search-compact-toolbar.css';
import './styles/cohort-dense.css';
import './styles/cohort-overlay-v2.css';
import './styles/pulso-updates-priority.css';

const root = document.getElementById('root');
if (!root) throw new Error('Falta el nodo #root.');

// The Entra redirect can come back with the session in the URL hash. Setting a
// default route before supabase-js has read it would throw the session away.
const carriesSession = /access_token|error_description|provider_token/.test(window.location.hash);
if (!window.location.hash && !carriesSession) window.location.hash = '#/pulso';

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
