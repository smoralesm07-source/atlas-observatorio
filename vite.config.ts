import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative base keeps the same static bundle portable: it can be served from
// the legacy GitHub project path (/atlas-observatorio/) and from the canonical
// root domain (https://atlasobservatorio.app/) during the migration.
export default defineConfig({
  base: process.env.VITE_BASE ?? './',
  plugins: [react()],
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          supabase: ['@supabase/supabase-js'],
        },
      },
    },
  },
});
