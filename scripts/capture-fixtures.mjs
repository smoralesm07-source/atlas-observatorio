/* Recaptures tests/fixtures.json from the live read contracts.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/capture-fixtures.mjs
 *
 * Uses the service role because it runs off-line, outside any analyst session.
 * Never ship this key to the browser: the app authenticates as the analyst and
 * reads through RLS.
 */
import { writeFileSync } from 'node:fs';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

async function rpc(fn, args = {}) {
  const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`${fn}: ${res.status} ${await res.text()}`);
  return res.json();
}

const pulse = await rpc('obs_pulse');
pulse.territory = pulse.territory.slice(0, 6);
pulse.alerts.top = pulse.alerts.top.slice(0, 4);

// Las hipótesis del corte de compras se recortan a cuatro, una por estado
// posible: la prueba verifica que «requiere fuente» se declare, no las diez.
const HIPOTESIS = ['H-CONC-BUYER', 'H-ACCEL-SUPPLIER', 'H-PRICE', 'H-FRAGMENT'];

const spendOverview = await rpc('obs_spend_overview');
delete spendOverview.top;
if (spendOverview.corte) {
  spendOverview.corte.readiness = spendOverview.corte.readiness.filter(
    (h) => HIPOTESIS.includes(h.hypothesis_id),
  );
}

const spendActor = await rpc('obs_spend_actor_detail', {
  p_actor_id: '61605000-1', p_role: 'BUYER',
});
if (spendActor) {
  spendActor.contrapartes = spendActor.contrapartes.slice(0, 3);
  spendActor.hallazgos = spendActor.hallazgos.slice(0, 3);
}

const fixtures = {
  pulse,
  alerts: await rpc('obs_alert_feed', { p_limit: 4 }),
  search: await rpc('obs_search_entities', { p_q: 'banco', p_limit: 3 }),
  sources: (await rpc('obs_source_status')).slice(0, 8),
  territoryMap: await rpc('obs_territory_map'),
  territoryDetail: await rpc('obs_territory_detail', { p_territory: 'San Bernardo' }),
  sectorOverview: await rpc('obs_sector_overview'),
  sectorDetail: await rpc('obs_sector_detail', { p_sector: 'CASAS DE CAMBIO' }),
  spendOverview,
  spendFeed: await rpc('obs_spend_finding_feed', { p_limit: 3 }),
  spendActor,
};

writeFileSync(new URL('../tests/fixtures.json', import.meta.url), JSON.stringify(fixtures, null, 1));
console.log('tests/fixtures.json actualizado');
