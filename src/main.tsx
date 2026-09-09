import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/app.css';
import './styles/explore.css';
import './styles/osfl.css';
import './styles/fintech.css';
import './styles/territorio-map.css';
import './styles/entity-expediente.css';
import './styles/ui-fixes.css';

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
