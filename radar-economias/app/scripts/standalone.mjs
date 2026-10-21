// Arma una versión de un solo archivo de la app, con el corte vigente embebido.
// Sirve para probarla sin servidor: se abre el HTML en el navegador o se publica
// como página. Requiere haber corrido `vite build` antes.
//
//   node scripts/standalone.mjs [ruta/del/corte.json] [salida.html]
//
// La salida no trae <html>/<head>/<body> propios: el visor de páginas los pone.
// Para abrirla localmente, el navegador los infiere igual.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, '../dist');
const snapshotPath = resolve(process.argv[2] ?? join(here, '../../data/latest.json'));
const out = resolve(process.argv[3] ?? join(dist, 'radar-economias.html'));

const index = readFileSync(join(dist, 'index.html'), 'utf8');
const asset = (re) => {
  const m = index.match(re);
  if (!m) throw new Error(`No se encontró ${re} en dist/index.html: corre «npm run build» primero.`);
  return readFileSync(join(dist, m[1].replace(/^\.\//, '')), 'utf8');
};
const js = asset(/<script[^>]+src="([^"]+\.js)"/);
const css = asset(/<link[^>]+href="([^"]+\.css)"/);
const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));

// Ni el JSON ni el JS pueden cerrar la etiqueta que los contiene.
const safeJson = JSON.stringify(snapshot).replace(/<\//g, '<\\/');
const safeJs = js.replace(/<\/script/gi, '<\\/script');

const html = `<title>Radar de economías criminales</title>
<meta name="claude:viewport-fit-sides" content="cover">
<meta name="robots" content="noindex, nofollow">
<style>${css}</style>
<div id="root"></div>
<script id="radar-snapshot" type="application/json">${safeJson}</script>
<script type="module">${safeJs}</script>
`;
writeFileSync(out, html);
console.log(`${out} · corte ${snapshot.snapshot_id} · ${(html.length / 1024).toFixed(0)} KB`);
