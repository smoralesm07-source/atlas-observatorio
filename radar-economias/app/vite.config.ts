import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// El corte que publican los recolectores (../data) se sirve tal cual como
// carpeta pública: la app no reconstruye nada, sólo lee latest.json.
export default defineConfig({
  base: process.env.VITE_BASE ?? './',
  publicDir: fileURLToPath(new URL('../data', import.meta.url)),
  plugins: [react()],
  build: { target: 'es2022', outDir: 'dist' },
});
