import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const configError =
  !url || !key
    ? 'Faltan VITE_SUPABASE_URL o VITE_SUPABASE_PUBLISHABLE_KEY en el entorno de build.'
    : null;

/** Where Microsoft Entra sends the browser back after sign-in. It must match a
 *  redirect URL registered in Supabase Auth. Defaults to this deployment's own
 *  origin and base path, so the same build works on Pages, on a subpath and in
 *  local development without a separate setting. */
export const redirectTo =
  import.meta.env.VITE_AUTH_REDIRECT_TO ||
  `${window.location.origin}${import.meta.env.BASE_URL}`;

export const supabase = createClient(url ?? 'http://localhost', key ?? 'missing', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // The Entra redirect carries the session back in the URL; without this the
    // user returns from Microsoft still signed out.
    detectSessionInUrl: true,
    storageKey: 'atlas-observatorio-auth',
  },
  global: { headers: { 'x-atlas-client': 'observatorio/1.0' } },
});
