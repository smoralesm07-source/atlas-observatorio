import { useCallback } from 'react';
import type { Session } from '@supabase/supabase-js';
import { AuthGate } from './components/Auth';
import { Shell } from './components/Shell';
import { useRoute } from './lib/router';
import { Pulso } from './views/Pulso';
import { Senales } from './views/Senales';
import { Entidades } from './views/Entidades';
import { Ficha } from './views/Ficha';
import { Fuentes } from './views/Fuentes';
import { Territorio } from './views/Territorio';
import { Sectores } from './views/Sectores';
import { Metodologia } from './views/Metodologia';

export default function App() {
  return <AuthGate>{(session) => <Routed session={session} />}</AuthGate>;
}

function Routed({ session }: { session: Session }) {
  const [route] = useRoute();
  const go = useCallback((hash: string) => {
    window.location.hash = hash.startsWith('#') ? hash : `#${hash}`;
  }, []);

  return (
    <Shell route={route} session={session}>
      {route.view === 'pulso' && <Pulso onNavigate={go} />}
      {route.view === 'senales' && <Senales family={route.family} onNavigate={go} />}
      {route.view === 'entidades' && (
        <Entidades
          key={`${route.q ?? ''}|${route.region ?? ''}`}
          initialQuery={route.q}
          initialRegion={route.region}
          onNavigate={go}
        />
      )}
      {route.view === 'ficha' && <Ficha entityId={route.entityId} onNavigate={go} />}
      {route.view === 'territorio' && <Territorio onNavigate={go} />}
      {route.view === 'sectores' && <Sectores onNavigate={go} />}
      {route.view === 'fuentes' && <Fuentes />}
      {route.view === 'metodologia' && <Metodologia />}
    </Shell>
  );
}
