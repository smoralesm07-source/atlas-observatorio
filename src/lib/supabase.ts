import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const configError =
  !url || !key
    ? 'Faltan VITE_SUPABASE_URL o VITE_SUPABASE_PUBLISHABLE_KEY en el entorno de build.'
    : null;

export const supabase = createClient(url ?? 'http://localhost', key ?? 'missing', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storageKey: 'atlas-observatorio-auth',
  },
  global: { headers: { 'x-atlas-client': 'observatorio/1.0' } },
});
