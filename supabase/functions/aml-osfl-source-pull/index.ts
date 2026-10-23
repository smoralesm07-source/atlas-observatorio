const EXPECTED_TOKEN_SHA="392b6c2b4b908c8cba08fd35de156a830b60bbc97027d2c2be2b1b6bb60c9416";
const SOURCE_URL="https://raw.githubusercontent.com/smoralesm07-source/Radar_OSFL/main/docs/data/osfl_universe_v03.csv";

function out(status:number,body:any){return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store, max-age=0"}})}
function hex(b:ArrayBuffer){return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("")}
async function sha256(s:string){return hex(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s)))}
async function auth(req:Request){const t=req.headers.get("x-atlas-cron-token")||"";return (await sha256(t))===EXPECTED_TOKEN_SHA}
function truth(v:any){return new Set(["1","TRUE","T","YES","SI","SÍ"]).has(String(v||"").trim().toUpperCase())}
function clean(v:any){const s=String(v??"").trim();return s||null}
// Parsea una línea CSV con indexOf en vez de concatenar carácter a carácter: el CSV de Radar_OSFL (16 MB)
// superaba el límite de CPU/memoria del worker (WORKER_RESOURCE_LIMIT). El CSV no trae saltos de línea dentro de campos.
function parseLine(line:string){
 const fields:string[]=[];const n=line.length;let i=0;
 while(i<=n){
  if(line.charCodeAt(i)===34){let s="";i++;
   for(;;){const q=line.indexOf('"',i);if(q<0){s+=line.slice(i);i=n+1;break}s+=line.slice(i,q);if(line.charCodeAt(q+1)===34){s+='"';i=q+2;continue}i=q+1;break}
   fields.push(s);if(line.charCodeAt(i)===44)i++;else i=n+1;
  }else{const c=line.indexOf(",",i);if(c<0){fields.push(line.slice(i));break}fields.push(line.slice(i,c));i=c+1;if(i===n){fields.push("");break}}
 }
 return fields;
}
function* csvLines(text:string){let start=0;while(start<text.length){let end=text.indexOf("\n",start);if(end<0)end=text.length;let line=text.slice(start,end);start=end+1;if(line.endsWith("\r"))line=line.slice(0,-1);if(line)yield line}}
function activityGroup(codes:any,names:any){const c=String(codes||""),t=`|${c}| ${String(names||"")}`.toUpperCase();const rules:[[string,string],...Array<[string,string]>]=[["941100","Asociaciones empresariales"],["941200","Asociaciones profesionales"],["942000","Sindicatos"],["949100","Organizaciones religiosas"],["949901","Centros de madres"],["949902","Clubes sociales"],["949903","Fundaciones y corporaciones"],["949909","Otras asociaciones"]];for(const [code,label] of rules){if(new RegExp(`(^|\\|)${code}(\\||$)`).test(c))return label}if(t.includes("FUNDACION")||t.includes("CORPORACION"))return "Fundaciones y corporaciones";return null}
function yearsMask(r:Record<string,string>){let m=0;for(let y=2020;y<=2024;y++)if(truth(r[`company_presence_${y}`]))m|=1<<(y-2020);return m||null}
function salesRank(r:Record<string,string>){const m=String(r.latest_sales_band||"").match(/\b(1[0-3]|[1-9])\b/);return m?Number(m[1]):null}

Deno.serve(async(req:Request)=>{
 if(req.method!=="POST")return out(405,{ok:false,error:"METHOD_NOT_ALLOWED"});
 if(!(await auth(req)))return out(401,{ok:false,error:"INVALID_INTERNAL_TOKEN"});
 try{
  const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");if(!url||!key)return out(503,{ok:false,error:"SERVER_CREDENTIALS_UNAVAILABLE"});
  const headers={apikey:key,authorization:`Bearer ${key}`,"content-type":"application/json"};
  const call=async(path:string,payload?:any,method="POST")=>{const r=await fetch(`${url}/rest/v1/${path}`,{method,headers,body:payload===undefined?undefined:JSON.stringify(payload)});const t=await r.text();if(!r.ok)throw new Error(`${path} HTTP ${r.status}: ${t.slice(0,1000)}`);return t?JSON.parse(t):null};
  const src=await fetch(SOURCE_URL,{headers:{"user-agent":"Atlas-OSFL-Direct/2.1"}});if(!src.ok)throw new Error(`OSFL source HTTP ${src.status}`);
  // Hash sobre los bytes descargados: equivale al hash previo del texto (sin BOM) y evita re-codificar 16 MB.
  const bytes=new Uint8Array(await src.arrayBuffer()),sourceBytes=bytes.byteLength;
  const digest=hex(await crypto.subtle.digest("SHA-256",bytes)),snapshot=`RADAR_OSFL_V03_${digest.slice(0,12)}`;
  const states=await call("aml_sync_state?pipeline=eq.OSFL_PROFILE&select=detail&limit=1",undefined,"GET");const prior=Array.isArray(states)?states[0]?.detail?.source_sha256:null;
  if(prior===digest)return out(200,{ok:true,skipped:true,reason:"UNCHANGED_SOURCE",source_sha256:digest,source_snapshot:snapshot,source_bytes:sourceBytes});
  const raw=new TextDecoder().decode(bytes);
  let lineCount=0;for(let p=raw.indexOf("\n");p>=0;p=raw.indexOf("\n",p+1))lineCount++;if(lineCount<30000)throw new Error(`OSFL CSV unexpectedly small: ${lineCount}`);
  const ids=await call("rpc/aml_osfl_entity_ids_v0711",{});const entityIds=new Set((ids||[]).map(String));
  await call("rpc/prepare_aml_osfl_stage_v0712",{p_snapshot_id:snapshot});
  const now=new Date().toISOString();let batch:any[]=[];let staged=0,sourceRows=0,head:string[]|null=null;
  const flush=async()=>{if(!batch.length)return;const r=await call("rpc/upsert_aml_osfl_profiles_v0711",{p_rows:batch});staged+=Number(r?.staged||0);batch=[]};
  for(const line of csvLines(raw)){
   const vals=parseLine(line);if(!head){head=vals.map(x=>x.replace(/^﻿/,""));continue}
   const r:Record<string,string>={};for(let j=0;j<head.length;j++)r[head[j]]=vals[j]??"";
   const rut=clean(r.rut);if(!rut)continue;const eid=clean(r.entity_id);const linked=eid&&entityIds.has(eid)?eid:null;const r8=String(r.fatf_r8_screening||"").trim().toUpperCase();
   batch.push({rut,entity_id:linked,source_name:clean(r.legal_name),activity_group:activityGroup(r.activity_codes,r.activity_names),source_region:clean(r.latest_region),sales_band_rank:salesRank(r),years_mask:yearsMask(r),confirmation_level:clean(r.confirmation_status_v03)||"CORE_SII_ONLY",law21440_active:truth(r.law21440_active),registro19862:truth(r.registro19862),fatf_r8_candidate:r8==="FATF_R8_CANDIDATE"?true:new Set(["NOT_DETERMINED","BROAD_OSFL","OUT_OF_SCOPE"]).has(r8)?false:null,direct_confirmed:truth(r.direct_confirmed),source_sanction_match:null,source_uaf_so:null,source_uaf_public_body:null,detail_profile:true,source_snapshot:snapshot,source_version:"RADAR_OSFL_V03",source_detail:{origin_v03:clean(r.origin_v03),universe_status:clean(r.universe_status),universe_confidence:clean(r.universe_confidence),max_activity_signal:clean(r.max_activity_signal),activity_codes:clean(r.activity_codes),evidence_sources:clean(r.evidence_sources),company_year_count:clean(r.company_year_count)},updated_at:now});sourceRows++;
   if(batch.length>=1000)await flush();
  }
  await flush();if(sourceRows<30000)throw new Error(`OSFL transformed coverage too low: ${sourceRows}`);
  const final=await call("rpc/finalize_aml_osfl_profile_v0711",{p_snapshot_id:snapshot,p_source_sha:digest,p_checked_at:now});
  return out(200,{ok:true,source_rows:sourceRows,staged,source_sha256:digest,source_snapshot:snapshot,source_bytes:sourceBytes,finalize:final,transport:"SUPABASE_PG_CRON_EDGE_DIRECT"});
 }catch(e){return out(502,{ok:false,error:"OSFL_DIRECT_PULL_FAILED",detail:String((e as Error)?.message||e)})}
});
