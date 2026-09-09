const UA='ATLAS-Observatorio-Fintech/market-weight-1.1';
const BUDA='https://www.buda.com/api/v2';
function out(status:number,body:unknown){return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}})}
async function getJson(url:string,ms=12000){const r=await fetch(url,{headers:{'user-agent':UA,accept:'application/json'},signal:AbortSignal.timeout(ms)});if(!r.ok)throw new Error(`GET ${url} HTTP_${r.status}`);return await r.json()}
function isoDate(d:Date){return d.toISOString().slice(0,10)}
function n(v:any){const x=Number(Array.isArray(v)?v[0]:v);return Number.isFinite(x)?x:0}

Deno.serve(async(req:Request)=>{
  if(req.method!=='POST')return out(405,{ok:false,error:'METHOD_NOT_ALLOWED'});
  const sb=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if(!sb||!key)return out(503,{ok:false,error:'SERVER_CREDENTIALS_UNAVAILABLE'});
  const token=req.headers.get('x-atlas-cron-token')||'';
  const headers={apikey:key,authorization:`Bearer ${key}`,'content-type':'application/json'};
  const rpc=async(name:string,payload:unknown)=>{const r=await fetch(`${sb}/rest/v1/rpc/${name}`,{method:'POST',headers,body:JSON.stringify(payload)});const t=await r.text();if(!r.ok)throw new Error(`${name} HTTP ${r.status}: ${t.slice(0,600)}`);return t?JSON.parse(t):null};
  if(!token||await rpc('aml_fintech_validate_internal_token',{p_token:token})!==true)return out(401,{ok:false,error:'INVALID_INTERNAL_TOKEN'});
  let runId:number|null=null;
  try{
    const rr=await fetch(`${sb}/rest/v1/aml_fintech_market_weight_run`,{method:'POST',headers:{...headers,Prefer:'return=representation'},body:JSON.stringify({status:'STARTED',adapter:'BUDA_PUBLIC_API'})});
    const rt=await rr.text();if(!rr.ok)throw new Error(`RUN_START HTTP ${rr.status}: ${rt}`);runId=JSON.parse(rt)[0]?.run_id??null;

    const [marketsJ,tickersJ]=await Promise.all([getJson(`${BUDA}/markets`),getJson(`${BUDA}/tickers`)]);
    const markets=(marketsJ?.markets||[]).filter((m:any)=>!m.disabled&&String(m.quote_currency).toUpperCase()==='CLP');
    const tickers=new Map<string,any>((tickersJ?.tickers||[]).map((t:any)=>[String(t.market_id).toUpperCase(),t]));
    const usdcClp=n(tickers.get('USDC-CLP')?.last_price);
    if(!usdcClp)throw new Error('USDC_CLP_REFERENCE_UNAVAILABLE');

    const rows:any[]=[];let totalUsd=0;const breakdown:any[]=[];
    for(let i=0;i<markets.length;i+=4){
      const batch=markets.slice(i,i+4);
      const vols=await Promise.all(batch.map((m:any)=>getJson(`${BUDA}/markets/${String(m.name).toLowerCase()}/volume`)));
      for(let j=0;j<batch.length;j++){
        const m=batch[j],v=vols[j]?.volume||{};
        const base=String(m.base_currency).toUpperCase();
        const base7=n(v.ask_volume_7d)+n(v.bid_volume_7d);
        const px=n(tickers.get(String(m.id).toUpperCase())?.last_price);
        if(!base7||!px)continue;
        const usd=(base7*px)/usdcClp; totalUsd+=usd;
        breakdown.push({market:m.id,base,base_volume_7d:base7,last_price_clp:px,usd_est:Math.round(usd*100)/100});
      }
    }

    const today=new Date(),start=new Date(today.getTime()-6*86400000),day=isoDate(today);
    const candR=await fetch(`${sb}/rest/v1/aml_fintech_candidate?name_raw=ilike.buda&select=candidate_id,matched_fintech_id&limit=1`,{headers});
    const candT=await candR.text();if(!candR.ok)throw new Error(`BUDA_SUBJECT HTTP ${candR.status}: ${candT}`);const cand=JSON.parse(candT)[0];
    if(!cand)throw new Error('BUDA_CANDIDATE_NOT_FOUND');
    const subjectType=cand.matched_fintech_id?'ENTITY':'CANDIDATE',subjectKey=String(cand.matched_fintech_id||cand.candidate_id);
    const annualized=totalUsd*365/7;
    const common={subject_type:subjectType,subject_key:subjectKey,unit:'USD',currency:'USD',geography:'CHILE',evidence_type:'ESTIMADO',source_code:'BUDA_PUBLIC_API',source_url:'https://api.buda.com/',observed_at:new Date().toISOString(),last_seen_at:new Date().toISOString(),confidence:0.88};

    rows.push({...common,observation_key:`BUDA_API|${day}|VOLUME_7D_CLP`,metric_code:'TRANSACTION_VOLUME_7D_USD_EST',value_numeric:Math.round(totalUsd*100)/100,value_text:'Ventana móvil 7 días, pares CLP',qualifier:'APPROX',period_start:isoDate(start),period_end:day,basis:'Suma de ask_volume_7d + bid_volume_7d de mercados activos cotizados en CLP, valorizada al último precio de cada mercado y convertida a USD con USDC-CLP. No representa todo el volumen regional de Buda.com.',metadata:{method:'clp_pairs_last_price_conversion',usdc_clp_reference:usdcClp,markets:breakdown}});
    rows.push({...common,observation_key:`BUDA_API|${day}|ANNUALIZED`,metric_code:'ANNUALIZED_TRANSACTION_VOLUME_USD_EST',value_numeric:Math.round(annualized*100)/100,value_text:'Anualización de ventana móvil 7 días',qualifier:'APPROX',period_start:isoDate(start),period_end:day,basis:'Anualización simple (volumen estimado 7d × 365/7). Se mantiene como ESTIMADO y no se interpreta como volumen anual realizado.',metadata:{derived_from:`BUDA_API|${day}|VOLUME_7D_CLP`,formula:'7d_usd_est*365/7'}});
    rows.push({subject_type:subjectType,subject_key:subjectKey,observation_key:`BUDA_API|${day}|ACTIVE_CLP_MARKETS`,metric_code:'ACTIVE_MARKETS',value_numeric:markets.length,value_text:`${markets.length} pares activos cotizados en CLP`,unit:'markets',currency:null,qualifier:'EXACT',period_start:null,period_end:day,geography:'CHILE',evidence_type:'DECLARADO',confidence:0.99,source_code:'BUDA_PUBLIC_API',source_url:'https://www.buda.com/api/v2/markets',observed_at:new Date().toISOString(),last_seen_at:new Date().toISOString(),basis:'Conteo de mercados activos con moneda de cotización CLP publicados por la API corporativa abierta de Buda.com.',metadata:{market_ids:markets.map((m:any)=>m.id)}});

    const up=await fetch(`${sb}/rest/v1/aml_fintech_market_metric_observation?on_conflict=observation_key`,{method:'POST',headers:{...headers,Prefer:'resolution=merge-duplicates,return=representation'},body:JSON.stringify(rows)});
    const ut=await up.text();if(!up.ok)throw new Error(`OBS_UPSERT HTTP ${up.status}: ${ut.slice(0,700)}`);
    const refresh=await rpc('aml_fintech_refresh_market_weight_internal',{p_token:token});

    if(runId)await fetch(`${sb}/rest/v1/aml_fintech_market_weight_run?run_id=eq.${runId}`,{method:'PATCH',headers,body:JSON.stringify({status:'COMPLETED',observations_upserted:rows.length,completed_at:new Date().toISOString(),detail:{subject_type:subjectType,subject_key:subjectKey,clp_markets:markets.length,volume_7d_usd_est:Math.round(totalUsd*100)/100,annualized_usd_est:Math.round(annualized*100)/100,refresh}})});
    return out(200,{ok:true,run_id:runId,adapter:'BUDA_PUBLIC_API',subject_type:subjectType,subject_key:subjectKey,clp_markets:markets.length,volume_7d_usd_est:Math.round(totalUsd*100)/100,annualized_usd_est:Math.round(annualized*100)/100,refresh});
  }catch(e){
    if(runId)try{await fetch(`${sb}/rest/v1/aml_fintech_market_weight_run?run_id=eq.${runId}`,{method:'PATCH',headers,body:JSON.stringify({status:'FAILED',completed_at:new Date().toISOString(),detail:{error:String((e as Error)?.message||e).slice(0,900)}})})}catch{}
    return out(502,{ok:false,error:'MARKET_WEIGHT_FAILED',detail:String((e as Error)?.message||e)});
  }
});