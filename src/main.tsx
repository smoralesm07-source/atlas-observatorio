import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/app.css';

const root = document.getElementById('root');
if (!root) throw new Error('Falta el nodo #root.');

if (!window.location.hash) window.location.hash = '#/pulso';

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
