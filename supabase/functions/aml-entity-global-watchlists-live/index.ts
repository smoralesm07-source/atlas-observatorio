import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { screen } from './core.ts';

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'METHOD_NOT_ALLOWED' }), { status: 405, headers: cors });
  }
  try {
    return new Response(JSON.stringify(await screen(await req.json())), { headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500, headers: cors });
  }
});
