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
    // Compras publicas: el recuento son ordenes, no eventos, y el corte declara
    // su alcance parcial dentro de la propia fila.
    { source_code: 'MERCADO_PUBLICO', source_name: 'Mercado Publico · compras del Estado', source_class: 'producer', integration_mode: 'scheduled', authoritative_source: 'ChileCompra', source_data_status: 'fresh', status: 'PRESENT', record_count: 1283, last_event_at: null, detail: { basis: 'PRESENCIA_DECLARADA', unidad: 'órdenes en 12 meses', roles: ['Comprador'], alcance: 'Corte acotado a los 3.000 actores de mayor prioridad', monto_12m_clp: 18130049673.48, prioridad_revision: 51.4 } },
    { source_code: 'PRESUPUESTO_ABIERTO', source_name: 'Presupuesto Abierto · ejecucion fiscal', source_class: 'producer', integration_mode: 'scheduled', authoritative_source: 'DIPRES', source_data_status: 'fresh', status: 'ABSENT', record_count: null, last_event_at: null, detail: {} },
    { source_code: 'OFAC', source_name: 'OFAC Sanctions', source_class: 'official_list', integration_mode: 'on_demand', authoritative_source: 'U.S. Department of the Treasury / OFAC', source_data_status: 'unknown', status: 'NOT_CONSULTED', record_count: null, last_event_at: null, detail: {} },
    { source_code: 'MAIGRET', source_name: 'Maigret full', source_class: 'osint_on_demand', integration_mode: 'on_demand', authoritative_source: 'https://github.com/soxoj/maigret', source_data_status: 'unknown', status: 'NOT_CONSULTED', record_count: null, last_event_at: null, detail: {} },
  ],
  findings: [
    { finding_key: 'F1', finding_id: 'F1', finding_type: 'ENTITY_CONVERGENCE', title: 'Convergencia de cuatro fuentes sobre la misma entidad', region: 'Metropolitana de Santiago', commune: 'Las Condes', score_explore: 55.1, score_supervise: 61.4, score_investigate: 58.2, source_count: 4, evidence_count: 2, payload: {} },
  ],
  alerts: [F.alerts[1]],
  // Dos sanciones para cubrir los dos caminos del enlace: un documento que
  // apunta al acto y otro que el productor marca como parcial.
  sanctions: [
    { sanction_id: 'SANC-1', event_date: '2026-02-09', regulator: 'CMF', subject: 'Incumplimiento de deberes de información', identity_status: 'RUT_EXACT', laft_direct: false, amount_uf: 165, payload: {},
      document_url: 'https://www.cmfchile.cl/sitio/aplic/serdoc/ver_sgd.php?s567=5e69cbb724a4124c95', document_quality: 'VALID',
      document_excerpt: 'La resolución CMF N°5624 individualiza a BANCO BICE.', resolution_ref: '5624' },
    { sanction_id: 'SANC-2', event_date: '2023-07-10', regulator: 'CMF', subject: 'Deberes de información al mercado', identity_status: 'RESOLVED_CONSERVATIVE', laft_direct: false, amount_uf: 40, payload: {},
      document_url: 'https://www.cmfchile.cl/sitio/aplic/serdoc/ver_sgd.php?s567=9dc7541fb85176b049', document_quality: 'PARTIAL',
      document_excerpt: null, resolution_ref: '4082' },
  ],
  marks: [
    { mark_id: 'MK-SII-ADDR', mark_name: 'Amplitud del historial de domicilios', semantic_class: 'CONTEXT_MARK', primary_dimension: 'registral', score_group: 'REGISTRY', included_in_score: false, raw_intensity: 32.5, contribution: 0, confidence: 0.72, readiness: 'READY', evidence: {} },
  ],
  priority: { ipa3_score: 0, priority_band_shadow: 'SIN_MARCA_SHADOW', score_confidence_pct: null, coverage_index_pct: 90.4, dominant_mark_id: null, included_mark_count: 0, independent_group_count: 0, registry_group_score: 0, economic_group_score: 0, sanctions_group_score: 0, reconciliation_status: 'SII_ACTIVE', score_as_of: '2026-09-07', score_version: '0.4-shadow', semantics: 'PRIORIDAD_ANALITICA_NO_PROBABILIDAD_LAFT' },
  // Perfil tributario y ciclo de vida: lo primero que mira un analista.
  tax: {
    commercial_year: 2024, current_status: 'ACTIVE_AS_PUBLISHED',
    activity_start_date: '1979-03-16', termination_date: null,
    first_activity_registration_date: '1979-03-16',
    region: 'XIII REGION METROPOLITANA', province: 'SANTIAGO', commune: 'LAS CONDES',
    main_activity: 'ACTIVIDADES BANCARIAS',
    economic_sector: 'ACTIVIDADES FINANCIERAS Y DE SEGUROS',
    economic_subsector: 'INTERMEDIACION MONETARIA', activity_count: 3,
    activity_codes: '641901', activity_names: 'ACTIVIDADES BANCARIAS',
    sales_band: '13', sales_band_rank: 13,
    sales_band_uf: 'Más de 1.000.000 UF', size_label: 'Grande',
    workers_numeric: 1793, taxpayer_type: 'PERSONA JURIDICA',
    society_type: 'SOCIEDAD ANONIMA', ownership_edge_count: 12,
    legal_entity_partner_count: 4, societies_as_partner_count: 2,
    address_count: 9, current_address_count: 6,
    signal_count: 1, signal_types: 'ADDRESS_HISTORY_BREADTH',
    updated_at: '2026-09-01T00:00:00Z',
  },
  res: {
    constitution_date: '1979-01-22', company_age_days: 17400,
    observed_lifecycle_state: 'CONSTITUCION_Y_MODIFICACIONES', actuation_count: 6,
    modification_count: 5, transformation_count: 0, merger_count: 0,
    division_count: 0, dissolution_count: 0, last_change_date: '2021-04-19',
    relationship_count: 11, coverage_note: null,
    capital: 12000000000, registry_date: '1979-01-22',
  },
  lifecycle: [
    { kind: 'CONSTITUCION_RES', fecha: '1979-01-22', etiqueta: 'Constitución de la sociedad',
      fuente: 'Registro de Empresas y Sociedades',
      detalle: 'CONSTITUCION_Y_MODIFICACIONES · 6 actuaciones registradas' },
    { kind: 'INICIO_ACTIVIDADES', fecha: '1979-03-16', etiqueta: 'Inicio de actividades',
      fuente: 'Servicio de Impuestos Internos', detalle: 'ACTIVIDADES BANCARIAS' },
  ],
  lifecycle_notes: {
    uaf_registration_date: false,
    uaf_registration_note: 'El registro de sujetos obligados no publica fecha de inscripción. Lo único fechado es cuándo el Observatorio observó a la entidad en el padrón.',
    uaf_observed_at: '2026-08-25T22:51:15.680612+00:00',
    res_coverage_note: 'El Registro de Empresas y Sociedades sólo cubre sociedades acogidas al régimen simplificado. Su ausencia no significa que la entidad no exista.',
    sales_band_note: 'El tramo de ventas es el ordinal que publica el SII, expresado en UF anuales. El tramo más bajo significa ausencia de información, no ventas cero.',
    sanction_document_note: 'El enlace lleva al documento tal como lo publica el regulador. Cuando la calidad es parcial, el documento puede cubrir más de un acto sancionatorio.',
  },
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
  obs_territory_map: F.territoryMap,
  obs_territory_detail: F.territoryDetail,
  obs_sector_overview: F.sectorOverview,
  obs_sector_detail: F.sectorDetail,
  obs_spend_overview: F.spendOverview,
  obs_spend_finding_feed: F.spendFeed,
  obs_spend_actor_detail: F.spendActor,
  obs_uaf_pulse: F.uafPulse,
  obs_uaf_cohort: F.uafCohort,
  obs_uaf_subject_dossier: F.uafDossier,
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
    const q = String(body.p_q || '').toLowerCase();
    if (q.includes('fodich') || q.includes('zarahemla')) payload = [];
  }
  // El listado de hallazgos filtra en el servidor: si el doble no respeta el
  // filtro, la prueba del filtro no probaría nada.
  if (fn === 'obs_spend_finding_feed') {
    let body = {};
    try { body = JSON.parse(route.request().postData() || '{}'); } catch { /* sin cuerpo */ }
    if (body.p_family || body.p_severity) {
      if (body.p_family) payload = payload.filter((r) => r.family === body.p_family);
      if (body.p_severity) payload = payload.filter((r) => r.severity_band === body.p_severity);
      // total_count viaja en cada fila: si no se recalcula, el paginador
      // anunciaría 6.058 resultados sobre un filtro que devuelve uno.
      payload = payload.map((r) => ({ ...r, total_count: payload.length }));
    }
    // Sin filtro se conserva el total real del corte, para que el paginador se
    // dibuje de verdad en la prueba.
  }
  // La cohorte se resuelve en el servidor. El doble respeta el corte pedido
  // para que la prueba verifique que cada cifra abre SU lista, no una fija.
  if (fn === 'obs_uaf_cohort') {
    let body = {};
    try { body = JSON.parse(route.request().postData() || '{}'); } catch { /* sin cuerpo */ }
    const cohorte = String(body.p_cohort || '');
    if (cohorte === 'OSFL') payload = [];
    else if (cohorte === 'REGION') {
      payload = payload.filter((r) => r.region === body.p_value);
      payload = payload.map((r) => ({ ...r, total_count: payload.length }));
    }
  }
  // La ficha del actor solo conoce al comprador capturado en la fixture.
  if (fn === 'obs_spend_actor_detail') {
    let body = {};
    try { body = JSON.parse(route.request().postData() || '{}'); } catch { /* sin cuerpo */ }
    payload = body.p_actor_id === F.spendActor.actor.actor_id ? F.spendActor : null;
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

// Radar Prensa se publica como JSON en un repo externo. Sin este doble la
// prueba saldria a la red y su resultado cambiaria con el indice del dia.
await ctx.route('**/raw.githubusercontent.com/**/atlas_prensa.json', (route) =>
  route.fulfill({ status: 200, contentType: 'application/json',
                  body: JSON.stringify(F.pressBridge) }));

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
  // Pulso: la composicion del padron, lo que el universo obligado reporta,
  // la cola de revision con su motivo, el territorio y la industria. Las
  // senales de patron NO deben estar desplegadas de entrada.
  ['pulso', '#/pulso', ['Pulso del universo obligado', '10.294',
    // Composicion y estado registral.
    'Con término de giro', '445', 'Sin perfil SII', '2.110',
    'Estado registral ante el SII', 'Activos con SII', '7.739',
    // Reportabilidad publicada: la pregunta que el Pulso no respondia.
    'Lo que el universo obligado reporta', '21.828', 'sin publicar',
    'Quién sostiene la reportabilidad', 'Tres sectores explican',
    'sectores no registran ningún ROS', 'sin ROS 5 años',
    'Informe Estadístico UAF',
    // Cola de revision, con el motivo de mayor precedencia por sujeto.
    'Piden revisión', '2.728', 'Sujetos que piden revisión',
    'Sanción últimos 5 años', 'Casino Luckia Arica S.A.', 'Motivo de revisión',
    // Prioridad fiscalizadora, territorio e industria.
    'Prioridad fiscalizadora (IPF)', 'Muy alta',
    'Sujetos obligados por región', 'Tarapacá',
    'Sector UAF que obliga', 'Usuarios de Zonas Francas',
    'Industria según el SII', 'Actividades Financieras y de Seguros',
    'Término de giro por año', 'Caracterización cruzada',
    'Con antecedente sancionatorio', '372', 'Proveedores del Estado',
    // Los limites se declaran en la propia pantalla, no en la documentacion.
    'no publica fecha de inscripción', 'Describe el entorno, nunca al sujeto',
    'no existe ROS por sujeto', 'no prueba incumplimiento',
    'Entorno territorial donde operan', 'Muy alto']],
  ['senales', '#/senales', ['Señales', 'MUY ALTA', 'Recurrencia sancionatoria']],
  // El listado ya no dice sólo quién es la entidad: dice desde cuándo existe,
  // a qué se dedica y de qué tamaño es.
  ['entidades', '#/entidades', ['Entidades', 'Banco Bice', 'Sujeto obligado', '97.080.000-K',
     'Identidad sin resolver', 'sin RUT',
     'desde 1979', 'Actividades Bancarias', 'Grande', 'Más de 1.000.000 UF', '1.793 trab.']],
  // La ficha enmarca los hechos dentro del ciclo de vida, y declara que el
  // padrón UAF no publica fecha de inscripción en vez de inventar un hito.
  ['ficha', '#/entidad/ENT-RUT-97080000-K', ['Banco Bice', 'Prioridad analítica',
    'Línea de tiempo',
    // La sanción entra a la línea de tiempo con su materia, su regulador y su
    // monto, no como el rótulo genérico del productor. El "165 UF" sólo lo
    // imprime la línea de tiempo: la tabla de abajo usa un decimal.
    'Incumplimiento de deberes de información', '165 UF',
    'Constitución de la sociedad', 'Inicio de actividades',
    'Registro de Empresas y Sociedades', 'Servicio de Impuestos Internos',
    'Perfil tributario', 'Actividades Bancarias', 'Más de 1.000.000 UF', '1.793',
    'no publica fecha de inscripción',
    'Documento', 'N° 5624', 'N° 4082', 'parcial',
    // El estado de identidad de la radiografía llega en inglés desde el
    // productor; la ficha lo dice en español y sin sonar a certeza.
    'RUT, criterio conservador',
    'puede cubrir más de un acto sancionatorio']],
  // Fuentes: una al dia, una de alcance parcial que dice por que su cobertura
  // es baja, una en silencio y una bajo demanda.
  ['fuentes', '#/fuentes', ['Fuentes', 'Radar SII', 'En silencio',
    'Mercado Publico', 'Alcance parcial', 'nunca «sin registro»',
    'Presupuesto Abierto', 'Bajo demanda',
    // 15 de 50.516 redondea a "0%", que se leería como ninguna.
    '<0,1%']],
  // Territorio: el indicador vigente, su cobertura real y lo que queda fuera.
  ['territorio', '#/territorio', ['Territorio', 'IGR-2A-1.0.0', 'San Bernardo',
    'tráfico de sustancias', 'corrupción', 'ponderada por confianza',
    'densidad de sujetos obligados', 'Muy alto']],
  ['sectores', '#/sectores', ['Sectores obligados', 'Casas de Cambio', 'Notarios',
    'Vulnerabilidad', 'IPF medio', 'no contiene entidades más culpables',
    'sus insumos aún no están materializados']],
  // Gasto público: los dos universos separados, los topes declarados y las
  // hipótesis que hoy no tienen fuente.
  ['gasto', '#/gasto', ['Gasto público y compras', 'Compras públicas',
    'Ejecución presupuestaria', 'no se suman', 'PS-2026-07-V1', '494.867',
    'Requiere fuente', 'CHILECOMPRA_OC_EVENTOS', 'Presupuesto Abierto',
    'audiencias de lobby', 'no el libro mayor completo',
    '6.058 en el filtro actual', '89 de 3.000']],
  ['gasto-actor', '#/gasto/comprador/61605000-1',
    ['Instituto de Salud Publica de Chile', '61.605.000-1', 'Contrapartes',
     'de 392 en el universo', 'no es dependencia sobre sus ventas totales',
     'Percentil de materialidad', 'a quién mirar primero',
     // El HHI es pequeño: con un decimal se imprimiría «0» y parecería faltante.
     'HHI 0,042',
     // Las marcas del par llegan sin tildes desde el productor.
     'Concentración', 'Aceleración',
     // La trayectoria no existe para compradores: se dice, no se deja en guiones.
     'sólo para proveedores']],
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
  // El recuento de una fuente lleva su propia unidad: llamar "eventos" a 1.283
  // ordenes de compra afirmaria algo que la fuente no dice.
  await page.getByRole('button', { name: 'Fuentes', exact: true }).click();
  await page.waitForTimeout(260);
  const body = await page.textContent('body');
  const faltan = ['1.283 órdenes en 12 meses', 'Comprador',
                  'Corte acotado a los 3.000 actores de mayor prioridad']
    .filter((t) => !body.includes(t));
  if (body.includes('1.283 eventos')) {
    failed++; console.log('FAIL unidad de la fuente: rotula ordenes de compra como eventos');
  } else if (faltan.length) {
    failed++; console.log(`FAIL unidad de la fuente: falta ${JSON.stringify(faltan)}`);
  } else console.log('ok   cada fuente rotula su recuento con su propia unidad');
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
{
  // Un enlace que se ve pero no lleva a ninguna parte sería peor que no
  // ofrecerlo: la prueba comprueba el href, no el rótulo.
  await page.getByRole('button', { name: 'Panorama', exact: true }).click();
  await page.waitForTimeout(280);
  const doc = page.getByRole('link', { name: /N° 5624/ });
  const href = await doc.getAttribute('href');
  const nueva = await doc.getAttribute('target');
  if (!href || !href.startsWith('https://www.cmfchile.cl/')) {
    failed++; console.log(`FAIL documento: el enlace no apunta al regulador (${href})`);
  } else if (nueva !== '_blank') {
    failed++; console.log('FAIL documento: el enlace se abre encima de la ficha');
  } else console.log('ok   la sanción enlaza al documento del regulador');
}
console.log('ok   pestañas de la ficha');

// ── Pulso · las señales van replegadas ────────────────────────────────────
// El analista pidió que la caracterización del universo no compita con la
// persecución de casos. Las señales existen, pero sólo cuando se piden.
{
  await page.goto(`${BASE}/#/pulso`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  const cerrado = await page.textContent('body');
  if (cerrado.includes('Señales que piden mirada')) {
    failed++; console.log('FAIL señales: llegan desplegadas sin que nadie las pida');
  } else {
    await page.getByRole('button', { name: /Señales de patrón sobre el padrón/ }).click();
    await page.waitForTimeout(420);
    const abierto = await page.textContent('body');
    const faltan = ['Señales que piden mirada', 'Ver todas las señales']
      .filter((t) => !abierto.includes(t));
    if (faltan.length) {
      failed++; console.log(`FAIL señales: al desplegar falta ${JSON.stringify(faltan)}`);
    } else console.log('ok   las señales se recogen y sólo se despliegan al pedirlas');
  }
}

// ── Pulso · de la cifra a los nombres y al antecedente ────────────────────
{
  await page.goto(`${BASE}/#/pulso`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: /Con término de giro/ }).first().click();
  await page.waitForTimeout(450);
  let body = await page.textContent('body');
  const faltanLista = ['Sujetos con término de giro', 'PEHUEN SPA',
                       'IMPORTADORA Y EXPORTADORA DENVER LIMITADA',
                       'siguen inscritos en el registro UAF']
    .filter((t) => !body.includes(t));
  if (faltanLista.length) {
    failed++; console.log(`FAIL cohorte: falta ${JSON.stringify(faltanLista)}`);
  } else {
    // Y de un nombre al antecedente que lo sostiene, con su enlace.
    await page.getByRole('button', { name: /PEHUEN SPA/ }).click();
    await page.waitForTimeout(420);
    body = await page.textContent('body');
    const link = await page.getByRole('link', { name: /Abrir documento original/ }).count();
    const faltanEv = ['La UAF publicó fiscalización',
                      'puede estar emitido bajo otra razón social del mismo contribuyente']
      .filter((t) => !body.includes(t));
    if (faltanEv.length || link === 0) {
      failed++;
      console.log(`FAIL antecedente: falta ${JSON.stringify(faltanEv)}${link === 0 ? ' y el enlace al documento' : ''}`);
    } else console.log('ok   la cifra abre nombres y cada nombre abre su antecedente con enlace');
    await page.screenshot({ path: `${OUT}/pulso-cohorte.png`, fullPage: true });
  }
  // Escape cierra la capa. Tambien deja el tablero listo para el bloque siguiente.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(260);
  if ((await page.textContent('body')).includes('Sujetos con término de giro')) {
    failed++; console.log('FAIL cohorte: Escape no cierra la capa');
  } else console.log('ok   Escape cierra la lista y devuelve el tablero');
}

// ── Pulso · una cohorte vacía lo dice, no finge ───────────────────────────
{
  await page.goto(`${BASE}/#/pulso`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  const osfl = page.getByRole('button', { name: /Organizaciones sin fines de lucro/ });
  await osfl.scrollIntoViewIfNeeded();
  await osfl.click();
  await page.waitForTimeout(420);
  const body = await page.textContent('body');
  if (!body.includes('Sin sujetos en este corte')) {
    failed++; console.log('FAIL cohorte vacía: no declara que el corte no tiene sujetos');
  } else console.log('ok   una cohorte sin sujetos lo declara');
}

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

// ── Detalle territorial y sectorial: el análisis vive en el detalle, no en la
// portada, así que se verifica que abra y muestre la descomposición.

await page.goto(`${BASE}/#/territorio`, { waitUntil: 'networkidle' });
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(500);
await page.locator('table').getByText('San Bernardo', { exact: true }).first().click();
await page.waitForTimeout(600);
{
  const body = await page.textContent('body');
  await page.screenshot({ path: `${OUT}/territorio-comuna.png`, fullPage: true });
  const faltan = ['San Bernardo', 'Delito base directo', 'Economía criminal',
                  'Persistencia', 'Anomalía', 'en el país', 'no imputan nada',
                  'confianza']
    .filter((t) => !body.includes(t));
  if (faltan.length) { failed++; console.log(`FAIL detalle comunal: falta ${JSON.stringify(faltan)}`); }
  else console.log('ok   el detalle comunal descompone capas y componentes');
}

await page.goto(`${BASE}/#/sectores`, { waitUntil: 'networkidle' });
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(500);
// El nombre también aparece como etiqueta dentro del gráfico de dispersión,
// así que el clic se acota a la tabla.
await page.locator('table').getByText('Casas de Cambio', { exact: true }).first().click();
await page.waitForTimeout(600);
{
  const body = await page.textContent('body');
  await page.screenshot({ path: `${OUT}/sector-detalle.png`, fullPage: true });
  const faltan = ['Casas de Cambio', 'Giros característicos', 'Distribución del IPF',
                  'Observabilidad del sector', 'no constituye incumplimiento',
                  'Dónde está el sector']
    .filter((t) => !body.includes(t));
  if (faltan.length) { failed++; console.log(`FAIL detalle sectorial: falta ${JSON.stringify(faltan)}`); }
  else console.log('ok   el detalle sectorial abre giros, bandas y territorio');
}

// ── Gasto público: el filtro por familia viaja en la URL y el listado enlaza
// al actor por RUT, que es el único identificador que la fuente publica.

await page.goto(`${BASE}/#/gasto`, { waitUntil: 'networkidle' });
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(600);
await page.locator('table').getByText('Convergencia', { exact: true }).first().click();
await page.waitForTimeout(700);
{
  const body = await page.textContent('body');
  await page.screenshot({ path: `${OUT}/gasto-familia.png`, fullPage: true });
  const faltan = ['Convergencia de señales independientes', '1 en el filtro actual']
    .filter((t) => !body.includes(t));
  const sobra = body.includes('Concentración inusual de gasto en proveedores');
  if (faltan.length || sobra) {
    failed++;
    console.log(`FAIL filtro de familia: falta ${JSON.stringify(faltan)}${sobra ? ' y no filtró' : ''}`);
  } else console.log('ok   el filtro por familia acota el listado y viaja en la URL');
  if (!page.url().includes('familia=CONVERGENCIA')) {
    failed++; console.log('FAIL filtro de familia: no quedó en la URL');
  }
}

// Un proveedor sin razón social debe seguir siendo navegable por su RUT, y un
// actor fuera del corte debe decirlo en vez de mostrar una ficha vacía.
await page.goto(`${BASE}/#/gasto/proveedor/77536802-0`, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
{
  const body = await page.textContent('body');
  await page.screenshot({ path: `${OUT}/gasto-fuera-de-corte.png`, fullPage: true });
  const faltan = ['77.536.802-0', 'no está en el corte publicado',
                  'no significa que no tenga compras públicas']
    .filter((t) => !body.includes(t));
  if (faltan.length) { failed++; console.log(`FAIL actor fuera de corte: falta ${JSON.stringify(faltan)}`); }
  else console.log('ok   un actor fuera del corte lo declara, no finge vacío');
}

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

// 2. Una mención en prensa detiene el salto automático: el Observatorio ya
//    tiene algo que mostrar, así que no gasta una consulta externa sin que
//    nadie se lo pida. La capa sigue ofrecida, pero no se dispara sola.
await page.fill('#obs-search', 'Vinko Fodich');
await page.waitForTimeout(1800);
{
  const body = await page.textContent('body');
  await page.screenshot({ path: `${OUT}/cascada-prensa.png`, fullPage: true });
  const faltan = ['Radar Prensa', 'Investigación por presunto fraude en zona franca']
    .filter((t) => !body.includes(t));
  if (faltan.length) {
    failed++; console.log(`FAIL prensa: falta ${JSON.stringify(faltan)}`);
  } else if (body.includes('Coincidencia exacta de nombre')) {
    failed++; console.log('FAIL prensa: la cascada externa se disparó pese a haber coincidencia en prensa');
  } else console.log('ok   una coincidencia en prensa detiene el salto automático');
}

// 3. Consulta que nadie registra, ni el universo ni la prensa: ahí sí debe
//    saltar sola a listas internacionales y mostrar el candidato con encuadre.
await page.fill('#obs-search', 'Zarahemla Quispe');
await page.waitForTimeout(2200);
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
