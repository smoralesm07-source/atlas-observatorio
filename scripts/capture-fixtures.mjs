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

const fixtures = {
  pulse,
  alerts: await rpc('obs_alert_feed', { p_limit: 4 }),
  search: await rpc('obs_search_entities', { p_q: 'banco', p_limit: 3 }),
  sources: (await rpc('obs_source_status')).slice(0, 8),
};

writeFileSync(new URL('../tests/fixtures.json', import.meta.url), JSON.stringify(fixtures, null, 1));
console.log('tests/fixtures.json actualizado');
