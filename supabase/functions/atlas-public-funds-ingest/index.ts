import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@6.1.0";

const AUD = 'atlas-public-funds-ingest';
const ALLOWED_REPOS = new Set(['smoralesm07-source/Rada_Presupuesto_Abierto']);
const JWKS = createRemoteJWKSet(new URL('https://token.actions.githubusercontent.com/.well-known/jwks'));
const headers = {'content-type':'application/json; charset=utf-8','cache-control':'no-store'};

type Kind = 'entity'|'year'|'payer_year'|'execution_year';

async function authenticate(req: Request) {
  const h = req.headers.get('authorization') || '';
  if (!h.startsWith('Bearer ')) throw new Error('OIDC_MISSING');
  const { payload } = await jwtVerify(h.slice(7), JWKS, {
    issuer: 'https://token.actions.githubusercontent.com', audience: AUD,
  });
  if (!ALLOWED_REPOS.has(String(payload.repository || ''))) throw new Error('OIDC_REPOSITORY_DENIED');
  if (payload.ref !== 'refs/heads/main') throw new Error('OIDC_REF_DENIED');
  return payload;
}

function cleanSnapshot(v: unknown) {
  const x = String(v || '').trim();
  if (!/^PF-[0-9]{6}-[a-f0-9]{7,40}$/i.test(x)) throw new Error('INVALID_SNAPSHOT_ID');
  return x;
}
function asRows(v: unknown) {
  if (!Array.isArray(v) || v.length === 0 || v.length > 2000) throw new Error('INVALID_BATCH_SIZE');
  return v as Record<string, unknown>[];
}
function tableFor(kind: Kind) {
  if (kind === 'entity') return 'obs_public_funds_entity_stage';
  if (kind === 'year') return 'obs_public_funds_year_stage';
  if (kind === 'payer_year') return 'obs_public_funds_payer_year_stage';
  if (kind === 'execution_year') return 'obs_public_funds_execution_year_stage';
  throw new Error('INVALID_KIND');
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response(JSON.stringify({ok:false,error:'METHOD_NOT_ALLOWED'}),{status:405,headers});
  try { await authenticate(req); }
  catch (e) { return new Response(JSON.stringify({ok:false,error:String((e as Error).message || e)}),{status:401,headers}); }

  try {
    const body = await req.json();
    const operation = String(body?.operation || '');
    const snapshot = cleanSnapshot(body?.snapshot_id);
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {auth:{persistSession:false}});

    if (operation === 'init') {
      const expected_entity = Number(body.expected_entity);
      const expected_year = Number(body.expected_year);
      const expected_payer_year = Number(body.expected_payer_year);
      const expected_execution_year = Number(body.expected_execution_year);
      if (![expected_entity,expected_year,expected_payer_year,expected_execution_year].every(Number.isSafeInteger)
          || expected_entity <= 0 || expected_year <= 0 || expected_payer_year <= 0 || expected_execution_year <= 0) {
        throw new Error('INVALID_EXPECTED_COUNTS');
      }

      const {data,error} = await sb.rpc('obs_public_funds_prepare_snapshot', {
        p_snapshot_id:snapshot,
        p_expected_entity:expected_entity,
        p_expected_year:expected_year,
        p_expected_payer_year:expected_payer_year,
        p_expected_execution_year:expected_execution_year,
      });
      if (error) throw error;
      return new Response(JSON.stringify(data ?? {ok:true,operation,snapshot_id:snapshot}),{headers});
    }

    if (operation === 'batch') {
      const kind = String(body.kind || '') as Kind;
      const rows = asRows(body.rows).map(r => ({...r,snapshot_id:snapshot,refreshed_at:new Date().toISOString()}));
      const table = tableFor(kind);
      const conflicts: Record<Kind,string> = {
        entity:'snapshot_id,rut',
        year:'snapshot_id,rut,period_year',
        payer_year:'snapshot_id,rut,payer_key,period_year,role',
        execution_year:'snapshot_id,payer_key,period_year',
      };
      const {error} = await sb.from(table).upsert(rows,{onConflict:conflicts[kind]});
      if (error) throw error;
      return new Response(JSON.stringify({ok:true,operation,kind,rows:rows.length,snapshot_id:snapshot}),{headers});
    }

    if (operation === 'finalize') {
      const {data,error} = await sb.rpc('obs_public_funds_request_finalize',{p_snapshot_id:snapshot});
      if (error) throw error;
      return new Response(JSON.stringify(data ?? {ok:true,accepted:true,status:'LOADING',snapshot_id:snapshot}),{headers});
    }

    if (operation === 'status') {
      const {data,error} = await sb
        .from('obs_public_funds_ingest_state')
        .select('snapshot_id,status,finalized_at,expected_entity,expected_year,expected_payer_year,expected_execution_year')
        .eq('snapshot_id',snapshot)
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('SNAPSHOT_NOT_FOUND');
      return new Response(JSON.stringify({ok:true,operation,...data}),{headers});
    }

    throw new Error('UNKNOWN_OPERATION');
  } catch (e) {
    return new Response(JSON.stringify({ok:false,error:String((e as Error).message || e)}),{status:400,headers});
  }
});