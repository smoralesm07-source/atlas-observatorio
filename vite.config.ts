import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base is overridable so the same build can be served from a project page
// (/atlas-observatorio/) or from a domain root.
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
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
