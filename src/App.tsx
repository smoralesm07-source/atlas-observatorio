import { useCallback } from 'react';
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
import { GastoPublico } from './views/GastoPublico';
import { Metodologia } from './views/Metodologia';
import { Administracion } from './views/Administracion';

export default function App() {
  return <AuthGate>{(session, role) => <Routed session={session} role={role} />}</AuthGate>;
}

function Routed({ session, role }: { session: Session; role: AtlasRole }) {
  const [route] = useRoute();
  const go = useCallback((hash: string) => {
    window.location.hash = hash.startsWith('#') ? hash : `#${hash}`;
  }, []);

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
          <Entity360StatusMarks entityId={route.entityId} />
        </>
      )}
      {route.view === 'territorio' && <Territorio onNavigate={go} />}
      {route.view === 'gasto' && <GastoPublico familiaInicial={route.familia} onNavigate={go} />}
      {route.view === 'gastoActor' && (
        <GastoPublico
          key={`${route.role}|${route.actorId}`}
          actor={{ id: route.actorId, role: route.role }}
          onNavigate={go}
        />
      )}
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
