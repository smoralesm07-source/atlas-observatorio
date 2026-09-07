/* Render check for the obs_* read contracts.
 *
 * The contracts themselves are verified in the database; this harness proves the
 * views render real contract payloads, in both themes and at phone width,
 * without reaching the network. Fixtures in tests/fixtures.json are captured
 * from the live contracts — refresh them with scripts/capture-fixtures.mjs.
 *
 *   npm run build && npx vite preview --port 4173 &
 *   node tests/render.mjs
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const F = JSON.parse(readFileSync(new URL('./fixtures.json', import.meta.url)));
const BASE = process.env.BASE ?? 'http://localhost:4173';
const OUT = process.env.OUT ?? '/tmp/shots';

const detail = {
  contract: 'ATLAS_OBS_ENTITY_V1',
  entity: { ...F.search[0], snapshot_id: 'OBS-2026-09-07T0126Z', refreshed_at: '2026-09-07T01:26:38Z' },
  identity: { method: 'RUT exacto', confidence: 1, territory: { comuna: 'Las Condes', region: 'Metropolitana de Santiago' } },
  events: [
    { tipo: 'REGULATORY_SANCTION', tipo_es: 'Sanción regulatoria', fecha: '2026-02-09T00:00:00+00:00', titulo: 'REGULATORY_SANCTION', event_id: 'EVT-SANC-67FD', productor: 'RADAR_SANCIONES' },
    { tipo: 'PRESS_CONTEXT_EVENT', tipo_es: 'Press Context Event', fecha: null, titulo: 'document:press:45ca', event_id: 'event:press:719c', productor: 'RADAR_PRENSA' },
  ],
  context: { sujeto_obligado: true, sii_flags_es: ['Amplitud del historial de domicilios'] },
  coverage: [
    { source_code: 'RADAR_SANCIONES', source_name: 'Radar Sanciones · eventos regulatorios', source_class: 'producer', integration_mode: 'scheduled', authoritative_source: 'CMF / UAF / SCJ / CGR', source_data_status: 'fresh', status: 'PRESENT', record_count: 1, last_event_at: '2026-02-09T00:00:00+00:00', detail: { basis: 'EVENTOS_FECHADOS', event_titles: ['Sanción regulatoria'] } },
    { source_code: 'RADAR_UAF', source_name: 'Radar UAF · padron de sujetos obligados', source_class: 'producer', integration_mode: 'scheduled', authoritative_source: 'UAF', source_data_status: 'fresh', status: 'PRESENT', record_count: 0, last_event_at: null, detail: { basis: 'PRESENCIA_DECLARADA' } },
    { source_code: 'RADAR_OSFL', source_name: 'Radar OSFL · organizaciones sin fines de lucro', source_class: 'producer', integration_mode: 'scheduled', authoritative_source: 'Registro Civil / SII', source_data_status: 'fresh', status: 'ABSENT', record_count: null, last_event_at: null, detail: {} },
    { source_code: 'OFAC', source_name: 'OFAC Sanctions', source_class: 'official_list', integration_mode: 'on_demand', authoritative_source: 'U.S. Department of the Treasury / OFAC', source_data_status: 'unknown', status: 'NOT_CONSULTED', record_count: null, last_event_at: null, detail: {} },
    { source_code: 'MAIGRET', source_name: 'Maigret full', source_class: 'osint_on_demand', integration_mode: 'on_demand', authoritative_source: 'https://github.com/soxoj/maigret', source_data_status: 'unknown', status: 'NOT_CONSULTED', record_count: null, last_event_at: null, detail: {} },
  ],
  findings: [
    { finding_key: 'F1', finding_id: 'F1', finding_type: 'ENTITY_CONVERGENCE', title: 'Convergencia de cuatro fuentes sobre la misma entidad', region: 'Metropolitana de Santiago', commune: 'Las Condes', score_explore: 55.1, score_supervise: 61.4, score_investigate: 58.2, source_count: 4, evidence_count: 2, payload: {} },
  ],
  alerts: [F.alerts[1]],
  sanctions: [{ sanction_id: 'SANC-1', event_date: '2026-02-09', regulator: 'CMF', subject: 'Incumplimiento de deberes de información', identity_status: 'RUT_EXACT', laft_direct: false, amount_uf: 165, payload: {} }],
  marks: [
    { mark_id: 'MK-SII-ADDR', mark_name: 'Amplitud del historial de domicilios', semantic_class: 'CONTEXT_MARK', primary_dimension: 'registral', score_group: 'REGISTRY', included_in_score: false, raw_intensity: 32.5, contribution: 0, confidence: 0.72, readiness: 'READY', evidence: {} },
  ],
  priority: { ipa3_score: 0, priority_band_shadow: 'SIN_MARCA_SHADOW', score_confidence_pct: null, coverage_index_pct: 90.4, dominant_mark_id: null, included_mark_count: 0, independent_group_count: 0, registry_group_score: 0, economic_group_score: 0, sanctions_group_score: 0, reconciliation_status: 'SII_ACTIVE', score_as_of: '2026-09-07', score_version: '0.4-shadow', semantics: 'PRIORIDAD_ANALITICA_NO_PROBABILIDAD_LAFT' },
  uaf: { uaf_sector_canonical: 'Bancos', subject_nature: 'LEGAL_ENTITY', sii_status: 'ACTIVO', sii_main_activity: 'Bancos', sii_sales_band: 'Grande 4', sii_workers: 2400, entity_age_years: 46, sanction_event_count: 1, sanction_event_count_5y: 1, sanction_last_event_date: '2026-02-09', ipf_score: 58.2, ipf_band: 'ALTA', ipf_percentile: 91.3, ipf_sector_percentile: 62.5, semantics: 'El IPF ordena esfuerzo de fiscalizacion; no es probabilidad de LA/FT.' },
  osfl: null,
  peers: [{ commercial_year: 2025, peer_level: 'SECTOR', peer_n: 22, sales_peer_percentile: 88.4, sales_band_code: 'G4', sales_band_delta: 0, workforce_ratio: 1.02, economic_sector: 'Intermediación financiera', main_activity_changed: false, region_changed: false }],
  links: [],
  semantics: 'Ficha de observacion. Reune lo que las fuentes abiertas gobernadas registran sobre la entidad. No es un expediente ni una decision institucional.',
};

const RPC = {
  obs_pulse: F.pulse,
  obs_alert_feed: F.alerts,
  obs_search_entities: F.search,
  obs_source_status: F.sources,
  obs_entity_detail: detail,
};

const SESSION = {
  access_token: 'test.jwt.token',
  token_type: 'bearer',
  expires_in: 360000,
  expires_at: Math.floor(Date.now() / 1000) + 360000,
  refresh_token: 'test-refresh',
  user: {
    id: '11a348bf-6a58-4762-a738-dc6ffa470f4e',
    aud: 'authenticated', role: 'authenticated',
    email: 'analista@uaf.gob.cl',
    app_metadata: { provider: 'email' }, user_metadata: {},
    created_at: '2026-01-01T00:00:00Z',
  },
};

const errors = [];
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME ?? undefined });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 2 });

await ctx.route('**/rest/v1/rpc/**', async (route) => {
  const fn = new URL(route.request().url()).pathname.split('/').pop();
  if (!(fn in RPC)) return route.fulfill({ status: 404, body: '{}' });
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(RPC[fn]),
  });
});
await ctx.route('**/auth/v1/**', (route) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: SESSION.user, session: SESSION }) }));

// Authenticating is not authorization: the app reads its own allowlist row to
// tell "enabled" from "authenticated but not enabled". allowlist controls which
// answer the stub gives.
let allowlist = { role: 'viewer', enabled: true };
await ctx.route('**/rest/v1/aml_allowed_users**', (route) =>
  route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(allowlist ? [allowlist] : []),
  }));

await ctx.addInitScript((s) => {
  localStorage.setItem('atlas-observatorio-auth', JSON.stringify(s));
}, SESSION);

const page = await ctx.newPage();
// The webfont stylesheet is unreachable offline and the stack falls back, so
// that one failure must not mask a real error.
const benign = (t) => /fonts\.(googleapis|gstatic)\.com/.test(t) || t.includes('ERR_CONNECTION_RESET');
page.on('console', (m) => {
  if (m.type() === 'error' && !benign(m.text())) errors.push(`console: ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

const checks = [
  ['pulso', '#/pulso', ['Pulso del observatorio', '50.516', 'Anticipación']],
  ['senales', '#/senales', ['Señales', 'MUY ALTA', 'Recurrencia sancionatoria']],
  ['entidades', '#/entidades', ['Entidades', 'Banco Bice', 'Sujeto obligado', '97.080.000-K',
     'Identidad sin resolver', 'sin RUT']],
  ['ficha', '#/entidad/ENT-RUT-97080000-K', ['Banco Bice', 'Prioridad analítica', 'Línea de tiempo', 'Sanción regulatoria']],
  ['fuentes', '#/fuentes', ['Fuentes', 'Radar SII', 'En silencio']],
  ['metodologia', '#/metodologia', ['Metodología', 'Marcas', 'No es']],
];

let failed = 0;
for (const [name, hash, expect] of checks) {
  await page.goto(`${BASE}/${hash}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  const body = await page.textContent('body');
  const missing = expect.filter((t) => !body.includes(t));
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  if (missing.length) { failed++; console.log(`FAIL ${name}: falta ${JSON.stringify(missing)}`); }
  else console.log(`ok   ${name}`);
}

// Ficha tabs must switch without a reload.
await page.goto(`${BASE}/#/entidad/ENT-RUT-97080000-K`, { waitUntil: 'networkidle' });
for (const tab of ['Fuentes', 'Señales y hallazgos', 'Marcas', 'Economía y padrón']) {
  await page.getByRole('button', { name: tab, exact: true }).click();
  await page.waitForTimeout(220);
  await page.screenshot({ path: `${OUT}/ficha-${tab.split(' ')[0].toLowerCase()}.png`, fullPage: true });
}
console.log('ok   pestañas de la ficha');

// Light theme must repaint, not invert.
await page.goto(`${BASE}/#/pulso`, { waitUntil: 'networkidle' });
await page.click('[title*="modo claro"]');
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/pulso-claro.png`, fullPage: true });
console.log('ok   tema claro');

// Mobile must not scroll horizontally.
const m = await ctx.newPage();
await m.setViewportSize({ width: 390, height: 844 });
await m.goto(`${BASE}/#/entidades`, { waitUntil: 'networkidle' });
await m.waitForTimeout(400);
const overflow = await m.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
await m.screenshot({ path: `${OUT}/movil.png`, fullPage: true });
if (overflow > 2) { failed++; console.log(`FAIL móvil: desborde horizontal de ${overflow}px`); }
else console.log('ok   móvil sin desborde');

// ── Access states. Authenticating is not authorization, so each outcome has to
// reach the user as its own screen.

// Authenticated, but not on the allowlist.
allowlist = null;
// The page is already at #/pulso, and goto to an identical URL does not reload,
// so the allowlist would never be re-read. Reload explicitly.
await page.goto(`${BASE}/#/pulso`, { waitUntil: 'networkidle' });
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(600);
{
  const body = await page.textContent('body');
  await page.screenshot({ path: `${OUT}/acceso-pendiente.png`, fullPage: true });
  if (!body.includes('Acceso pendiente de habilitación')) {
    failed++; console.log('FAIL acceso pendiente: no se muestra la pantalla de habilitación');
  } else if (body.includes('Pulso del observatorio')) {
    failed++; console.log('FAIL acceso pendiente: se filtró contenido del observatorio');
  } else console.log('ok   acceso pendiente de habilitación');
}
allowlist = { role: 'viewer', enabled: true };

// Signed out. ATLAS authenticates with Microsoft Entra, so a password field
// here would be a regression: these accounts have no password.
const out = await browser.newContext({ viewport: { width: 1100, height: 900 }, deviceScaleFactor: 2 });
await out.route('**/rest/v1/**', (route) => route.fulfill({ status: 200, body: '[]' }));
const anon = await out.newPage();
await anon.goto(`${BASE}/#/pulso`, { waitUntil: 'networkidle' });
await anon.waitForTimeout(400);
{
  const body = await anon.textContent('body');
  const passwordFields = await anon.locator('input[type="password"]').count();
  await anon.screenshot({ path: `${OUT}/ingreso.png`, fullPage: true });
  if (!body.includes('Ingresar con Microsoft')) {
    failed++; console.log('FAIL ingreso: falta el acceso con Microsoft');
  } else if (passwordFields > 0) {
    failed++; console.log(`FAIL ingreso: hay ${passwordFields} campo(s) de contraseña; ATLAS usa Entra`);
  } else console.log('ok   ingreso con Microsoft, sin campo de contraseña');
}
await out.close();

await browser.close();
if (errors.length) { console.log('\nErrores de consola:'); errors.forEach((e) => console.log('  ' + e)); }
console.log(failed || errors.length ? `\nRESULTADO: ${failed} fallos, ${errors.length} errores` : '\nRESULTADO: todo verde');
process.exit(failed || errors.length ? 1 : 0);
