import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const configError =
  !url || !key
    ? 'Faltan VITE_SUPABASE_URL o VITE_SUPABASE_PUBLISHABLE_KEY en el entorno de build.'
    : null;

/** Where Microsoft Entra sends the browser back after sign-in. It must match a
 * redirect URL registered in Supabase Auth. Resolve Vite's base against the
 * current page instead of concatenating strings, so a relative base works both
 * on the legacy GitHub project path and on atlasobservatorio.app. */
const inferredRedirectTo = new URL(import.meta.env.BASE_URL, window.location.href).href;

export const redirectTo =
  import.meta.env.VITE_AUTH_REDIRECT_TO ||
  inferredRedirectTo;

export const supabase = createClient(url ?? 'http://localhost', key ?? 'missing', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // The Entra redirect carries the session back in the URL; without this the
    // user returns from Microsoft still signed out.
    detectSessionInUrl: true,
    storageKey: 'atlas-observatorio-auth',
  },
  // Keep browser requests to Edge Functions on the standard Supabase header
  // set. The former x-atlas-client header forced a CORS preflight that the
  // legacy on-demand functions did not authorize, so functions.invoke failed
  // before the request reached the function.
});
