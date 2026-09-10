import { useCallback, useEffect } from 'react';
import type { Session } from '@supabase/supabase-js';
import { AuthGate, type AtlasRole } from './components/OpenAuthGate';
import { Shell } from './components/Shell';
import { Entity360StatusMarks } from './components/Entity360StatusMarks';
import { useRoute } from './lib/router';
import { PulsoV6 } from './views/PulsoV6';
import { UniversoSOV2 } from './views/UniversoSOV2';
import { Osfl } from './views/Osfl';
import { FintechEnhanced } from './views/FintechEnhanced';
import { Sanciones } from './views/Sanciones';
import { Senales } from './views/Senales';
import { Entidades } from './views/Entidades';
import { EntityExpediente } from './views/EntityExpediente';
import { Fuentes } from './views/Fuentes';
import { Territorio } from './views/Territorio';
import { Metodologia } from './views/Metodologia';
import { Administracion } from './views/Administracion';
import './styles/territory-commune-typography.css';

export default function App() {
  return <AuthGate>{(session, role) => <Routed session={session} role={role} />}</AuthGate>;
}

function Routed({ session, role }: { session: Session; role: AtlasRole }) {
  const [route] = useRoute();
  const go = useCallback((hash: string) => {
    window.location.hash = hash.startsWith('#') ? hash : `#${hash}`;
  }, []);

  const caseManagementRestricted = role === 'viewer'
    && route.view === 'universo'
    && route.mode === 'casos';

  useEffect(() => {
    if (!caseManagementRestricted) return;
    if (window.location.hash !== '#/universo-so') window.location.hash = '#/universo-so';
  }, [caseManagementRestricted]);

  if (caseManagementRestricted) {
    return (
      <Shell route={{ view: 'universo', mode: 'padron' }} session={session} role={role}>
        <UniversoSOV2 onNavigate={go} initialMode="padron" />
      </Shell>
    );
  }

  return (
    <Shell route={route} session={session} role={role}>
      {route.view === 'pulso' && <PulsoV6 onNavigate={go} />}
      {route.view === 'universo' && (
        <UniversoSOV2 onNavigate={go} initialMode={route.mode ?? 'padron'} initialQueue={route.cola} />
      )}
      {route.view === 'osfl' && <Osfl onNavigate={go} />}
      {route.view === 'fintech' && <FintechEnhanced onNavigate={go} />}
      {route.view === 'sanciones' && <Sanciones onNavigate={go} />}
      {route.view === 'senales' && <Senales family={route.family} onNavigate={go} />}
      {route.view === 'entidades' && (
        <Entidades
          key={`${route.q ?? ''}|${route.region ?? ''}`}
          initialQuery={route.q}
          initialRegion={route.region}
          onNavigate={go}
        />
      )}
      {route.view === 'ficha' && (
        <>
          <EntityExpediente entityId={route.entityId} onNavigate={go} />
          <Entity360StatusMarks entityId={route.entityId} role={role} />
        </>
      )}
      {route.view === 'territorio' && <Territorio onNavigate={go} />}
      {route.view === 'fuentes' && <Fuentes />}
      {route.view === 'metodologia' && <Metodologia />}
      {route.view === 'administracion' && (
        role === 'admin'
          ? <Administracion session={session} />
          : <AdminDenied />
      )}
    </Shell>
  );
}

function AdminDenied() {
  return (
    <div className="panel panel-pad fade-in" style={{ maxWidth: 560, margin: '38px auto' }}>
      <div className="section-title">Acceso restringido</div>
      <h1 className="view-title" style={{ fontSize: 21 }}>Administración</h1>
      <p className="view-lede">
        Esta sección sólo está disponible para administradores habilitados de ATLAS Observatorio.
      </p>
    </div>
  );
}
