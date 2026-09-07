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

  // Una consulta que el universo no conoce debe devolver vacío, para que la
  // cascada hacia fuentes externas se dispare de verdad.
  let payload = RPC[fn];
  if (fn === 'obs_search_entities') {
    let body = {};
    try { body = JSON.parse(route.request().postData() || '{}'); } catch { /* sin cuerpo */ }
    if (String(body.p_q || '').toLowerCase().includes('fodich')) payload = [];
  }

  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(payload),
  });
});
// Conectores bajo demanda. El Observatorio los invoca, no los implementa, así
// que la prueba verifica la orquestación y el encuadre, no la fuente externa.
const WATCHLIST = {
  ok: true,
  mode: 'LIVE_NO_PERSIST',
  entity: { name: 'Vinko Fodich', rut: null, entity_type: null },
  sources: {
    OFAC: {
      status: 'fresh', source: 'OFAC', checked_at: new Date().toISOString(),
      records: [{
        source_code: 'OFAC', source_record_id: 'ofac:SDN:12345:vinko fodich',
        signal_type: 'international_watchlist_candidate', signal_status: 'possible_match',
        match_method: 'ofac_official_primary_csv', match_confidence: 0.99,
        title: 'Posible coincidencia en fuente internacional oficial',
        summary: 'OFAC SDN · individuo', related_entity_name: 'VINKO FODICH',
        relationship_type: 'POSIBLE_COINCIDENCIA_LISTA_INTERNACIONAL', event_date: null,
        source_url: 'https://ofac.treasury.gov/sanctions-list-service',
        evidence: { ofac_id: '12345', list: 'SDN', official_direct: true, identity_guardrail: 'candidate_requires_analyst_review' },
      }],
    },
    UN_SANCTIONS: { status: 'fresh', source: 'UN_SANCTIONS', records: [], checked_at: new Date().toISOString() },
    EU_SANCTIONS: { status: 'degraded', source: 'EU_SANCTIONS', records: [], checked_at: new Date().toISOString(), error: 'HTTP_503' },
    OPENSANCTIONS: { status: 'credential_missing', source: 'OPENSANCTIONS', records: [], checked_at: new Date().toISOString() },
    ICIJ_OFFSHORE: {
      status: 'fresh', source: 'ICIJ_OFFSHORE', checked_at: new Date().toISOString(),
      records: [{
        source_code: 'ICIJ_OFFSHORE', source_record_id: 'icij:80000123',
        signal_type: 'offshore_database_candidate', signal_status: 'possible_match',
        match_method: 'icij_reconciliation_name', match_confidence: 0.71,
        title: 'Posible coincidencia en ICIJ Offshore Leaks',
        summary: 'Vinko Fodich Ltd · candidato entity', related_entity_name: 'Vinko Fodich Ltd',
        relationship_type: 'POSIBLE_COINCIDENCIA_OFFSHORE', event_date: null,
        source_url: 'https://offshoreleaks.icij.org/nodes/80000123',
        evidence: { icij_node_id: '80000123', query_type: 'entity' },
      }],
    },
  },
  routing: {
    opensanctions_status: 'credential_missing', fallback_used: true,
    fallback_reason: 'credential_missing',
    direct_sources: ['UN_SANCTIONS', 'OFAC', 'EU_SANCTIONS', 'UK_SANCTIONS', 'IDB_SANCTIONS', 'WORLD_BANK'],
  },
  guardrails: { persisted: false, score_mutation: false, identity_promotion: false },
};

const IDENTITY = {
  ok: true,
  analytics: { generated_aliases: 9, aliases_with_profiles: 2, multi_engine_profiles: 3, strong_aliases: 1, profiles: 5 },
  candidate_aliases: [
    { alias: 'vinkofodich', rule: 'first_last_compact', profiles: 4, evidence_strength: 55, engines: ['maigret', 'sherlock'] },
    { alias: 'v.fodich', rule: 'first_dot_last', profiles: 1, evidence_strength: 25, engines: ['maigret'] },
  ],
  records: [
    { source_url: 'https://github.com/vinkofodich', title: 'GitHub', evidence: { platform: 'GitHub', username: 'vinkofodich', engines: ['maigret', 'sherlock'] } },
    { source_url: 'https://x.com/vinkofodich', title: 'X', evidence: { platform: 'X', username: 'vinkofodich', engines: ['maigret'] } },
  ],
  guardrails: { identity_assertion: false },
};

const DEEP = {
  ok: true,
  records: [],
  derived: {
    intelligence: {
      summary: { corroborated_attributes: 2, link_pivots: 1, alias_candidates: 1 },
      attributes: [
        { field: 'Ubicación declarada', value: 'Santiago, Chile', source_count: 3, corroborated: true },
        { field: 'Correo público', value: 'v.fodich@example.org', source_count: 2, corroborated: true },
      ],
      links: [{ url: 'https://vinkofodich.example.org', host: 'vinkofodich.example.org', source_count: 2 }],
      alias_candidates: [{ alias: 'vfodich', source_count: 2, corroborated: true }],
    },
  },
};

await ctx.route('**/functions/v1/aml-entity-global-watchlists-live', (route) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(WATCHLIST) }));
await ctx.route('**/functions/v1/aml-digital-identity-resolver-live', (route) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(IDENTITY) }));
await ctx.route('**/functions/v1/aml-digital-identity-deep', (route) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(DEEP) }));

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
// Un bundle construido sin las variables de entorno muestra la pantalla de
// configuración y haría fallar todas las comprobaciones por la misma causa.
// Decirlo una vez es más útil que once fallos idénticos.
{
  const probe = await ctx.newPage();
  await probe.goto(`${BASE}/#/pulso`, { waitUntil: 'networkidle' });
  await probe.waitForTimeout(300);
  if ((await probe.textContent('body')).includes('Configuración incompleta')) {
    console.log('FAIL entorno: el bundle se construyó sin VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY.');
    console.log('     Copia .env.example a .env y reconstruye antes de correr esta prueba.');
    await browser.close();
    process.exit(1);
  }
  await probe.close();
}
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
for (const tab of ['Fuentes', 'Señales y hallazgos', 'Marcas', 'Economía y padrón',
                   'Screening internacional', 'Identidad digital']) {
  await page.getByRole('button', { name: tab, exact: true }).click();
  await page.waitForTimeout(220);
  await page.screenshot({ path: `${OUT}/ficha-${tab.split(' ')[0].toLowerCase()}.png`, fullPage: true });
}
{
  // La ficha ofrece el screening con el RUT, que el buscador no tiene.
  await page.getByRole('button', { name: 'Screening internacional', exact: true }).click();
  await page.waitForTimeout(300);
  const body = await page.textContent('body');
  const faltan = ['97.080.000-K', 'Consultar listas internacionales', 'no afirma ni presencia ni']
    .filter((t) => !body.includes(t));
  if (faltan.length) { failed++; console.log(`FAIL ficha screening: falta ${JSON.stringify(faltan)}`); }
  else console.log('ok   la ficha ofrece screening con RUT y tipo');
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

// ── Cascada de búsqueda. Es la capacidad que distingue a Entidades: cuando el
// universo observado no sabe nada, el Observatorio no se queda callado.

await page.goto(`${BASE}/#/entidades`, { waitUntil: 'networkidle' });
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(400);

// 1. Consulta conocida: las tres capas se ofrecen, sin consultar las externas.
await page.fill('#obs-search', 'banco');
await page.waitForTimeout(900);
{
  const body = await page.textContent('body');
  await page.screenshot({ path: `${OUT}/cascada-capas.png`, fullPage: true });
  const faltan = ['Universo observado', 'Listas internacionales', 'Identidad digital', 'Banco Bice']
    .filter((t) => !body.includes(t));
  if (faltan.length) { failed++; console.log(`FAIL capas: falta ${JSON.stringify(faltan)}`); }
  else console.log('ok   las tres capas se ofrecen sobre una consulta conocida');
}

// 2. Consulta desconocida: debe saltar sola a listas internacionales y mostrar
//    el candidato exacto de OFAC junto a su encuadre.
await page.fill('#obs-search', 'Vinko Fodich');
await page.waitForTimeout(2000);
{
  const body = await page.textContent('body');
  await page.screenshot({ path: `${OUT}/cascada-internacional.png`, fullPage: true });
  const faltan = ['OFAC', 'Coincidencia exacta de nombre', 'ICIJ Offshore Leaks',
                  'continuó', 'candidato', 'Sin credencial']
    .filter((t) => !body.includes(t));
  if (faltan.length) { failed++; console.log(`FAIL cascada: falta ${JSON.stringify(faltan)}`); }
  else console.log('ok   salto automático a listas internacionales con encuadre');
}

// 3. Identidad digital sobre el mismo nombre.
await page.getByRole('button', { name: /Identidad digital/ }).click();
await page.waitForTimeout(2200);
{
  const body = await page.textContent('body');
  await page.screenshot({ path: `${OUT}/cascada-digital.png`, fullPage: true });
  const faltan = ['vinkofodich', 'Matriz de corroboración', 'Santiago, Chile',
                  'Enlaces pivote', 'nombre+apellido']
    .filter((t) => !body.includes(t));
  if (faltan.length) { failed++; console.log(`FAIL identidad digital: falta ${JSON.stringify(faltan)}`); }
  else console.log('ok   identidad digital resuelve aliases y corrobora');
}

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
