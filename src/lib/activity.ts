import { useEffect, useMemo } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { Route } from './router';

export const ATLAS_HEARTBEAT_MS = 60_000;
export const ATLAS_ONLINE_WINDOW_MS = 180_000;

const recentPageViews = new Map<string, number>();

export type ActivityLocation = {
  route: string;
  section: string;
};

function lensLabel(value: string | undefined) {
  switch (value) {
    case 'reportabilidad': return 'Reportabilidad';
    case 'revision': return 'Revisión';
    case 'territorio': return 'Territorio';
    case 'ciclo': return 'Ciclo';
    default: return null;
  }
}

export function activityLocation(route: Route): ActivityLocation {
  switch (route.view) {
    case 'pulso': {
      const lens = lensLabel(route.lente);
      return {
        route: route.lente ? `pulso/${route.lente}` : 'pulso',
        section: lens ? `Pulso · ${lens}` : 'Pulso',
      };
    }
    case 'universo': {
      const mode = route.mode ?? 'padron';
      if (mode === 'casos') {
        const queue = route.cola === 'termino'
          ? 'Término de giro'
          : route.cola === 'cartera'
            ? 'Cartera'
            : 'Potenciales SO';
        return { route: 'universo/casos', section: `Universo SO · Gestión · ${queue}` };
      }
      return { route: 'universo/padron', section: 'Universo SO · Padrón' };
    }
    case 'cobertura':
      return { route: 'universo/casos', section: 'Universo SO · Gestión · Potenciales SO' };
    case 'sectores':
      return { route: 'universo/padron', section: 'Universo SO · Padrón' };
    case 'osfl':
      return { route: 'monitores/osfl', section: 'Monitores · OSFL' };
    case 'fintech':
      return { route: 'monitores/fintech', section: 'Monitores · Fintech' };
    case 'sanciones':
      return { route: 'monitores/sanciones', section: 'Monitores · Sanciones' };
    case 'senales':
      return { route: 'senales', section: 'Señales' };
    case 'entidades':
      return { route: 'entidades', section: 'Entidades' };
    case 'ficha':
      return { route: 'ficha', section: 'Ficha de entidad' };
    case 'territorio':
      return { route: 'territorio', section: 'Territorio' };
    case 'fuentes':
      return { route: 'fuentes', section: 'Fuentes' };
    case 'metodologia':
      return { route: 'metodologia', section: 'Metodología' };
    case 'administracion':
      return { route: 'administracion', section: 'Administración' };
    default:
      return { route: 'atlas', section: 'ATLAS Observatorio' };
  }
}

async function touchPresence(session: Session, location: ActivityLocation) {
  const email = session.user.email ?? '';
  if (!email) return;

  await supabase.from('atlas_user_presence').upsert({
    user_id: session.user.id,
    email,
    current_route: location.route,
    current_section: location.section,
    last_seen_at: new Date().toISOString(),
    is_online: true,
    signed_out_at: null,
  }, { onConflict: 'user_id' });
}

async function recordActivity(session: Session, location: ActivityLocation, operation: 'session_start' | 'page_view') {
  const email = session.user.email ?? '';
  if (!email) return;

  await supabase.from('atlas_user_activity').insert({
    user_id: session.user.id,
    email,
    route: location.route,
    section: location.section,
    operation,
    metadata: {},
  });
}

function sessionStartKey(userId: string) {
  return `atlas-activity-session-start:${userId}`;
}

function shouldRecordSessionStart(userId: string) {
  try {
    const key = sessionStartKey(userId);
    if (sessionStorage.getItem(key)) return false;
    sessionStorage.setItem(key, new Date().toISOString());
    return true;
  } catch {
    return true;
  }
}

function shouldRecordPageView(userId: string, location: ActivityLocation) {
  const key = `${userId}:${location.route}:${location.section}`;
  const now = Date.now();
  const previous = recentPageViews.get(key) ?? 0;
  recentPageViews.set(key, now);
  return now - previous > 1_500;
}

export function useAtlasActivity(session: Session, route: Route) {
  const location = useMemo(() => activityLocation(route), [route]);

  useEffect(() => {
    void touchPresence(session, location);

    if (shouldRecordSessionStart(session.user.id)) {
      void recordActivity(session, location, 'session_start');
    }

    if (shouldRecordPageView(session.user.id, location)) {
      void recordActivity(session, location, 'page_view');
    }
  }, [session, location]);

  useEffect(() => {
    const heartbeat = () => {
      void touchPresence(session, location);
    };

    const timer = window.setInterval(heartbeat, ATLAS_HEARTBEAT_MS);
    const onFocus = () => heartbeat();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') heartbeat();
    };
    const onOnline = () => heartbeat();

    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [session, location]);
}

export async function markAtlasOffline(session: Session) {
  const email = session.user.email ?? '';
  if (!email) return;

  const now = new Date().toISOString();
  await supabase.from('atlas_user_presence').upsert({
    user_id: session.user.id,
    email,
    current_route: 'offline',
    current_section: 'Sesión cerrada',
    last_seen_at: now,
    is_online: false,
    signed_out_at: now,
  }, { onConflict: 'user_id' });
}
