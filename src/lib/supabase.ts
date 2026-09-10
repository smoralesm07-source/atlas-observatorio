import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const configError =
  !url || !key
    ? 'Faltan VITE_SUPABASE_URL o VITE_SUPABASE_PUBLISHABLE_KEY en el entorno de build.'
    : null;

/**
 * Canonical authentication destination for the production application.
 *
 * ATLAS previously shared Supabase Auth configuration with the legacy
 * AML-Workbench-Portal. If Supabase ever falls back to a project-level redirect,
 * keeping the production destination explicit prevents a login initiated from
 * atlasobservatorio.app from returning to the legacy GitHub Pages portal.
 */
const CANONICAL_AUTH_REDIRECT = 'https://atlasobservatorio.app/';
const inferredRedirectTo = new URL(import.meta.env.BASE_URL, window.location.href).href;

export const redirectTo =
  import.meta.env.VITE_AUTH_REDIRECT_TO ||
  (import.meta.env.PROD ? CANONICAL_AUTH_REDIRECT : inferredRedirectTo);

export const supabase = createClient(url ?? 'http://localhost', key ?? 'missing', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // OAuth and email callbacks can carry the session back in the URL.
    detectSessionInUrl: true,
    storageKey: 'atlas-observatorio-auth',
  },
  // Keep browser requests to Edge Functions on the standard Supabase header
  // set. The former x-atlas-client header forced a CORS preflight that the
  // legacy on-demand functions did not authorize, so functions.invoke failed
  // before the request reached the function.
});
