import {A,N,DIRECT} from './util.ts';
import {icij,opensanctions} from './source_agg.ts';
import {un,ofac,uk} from './source_official_a.ts';
import {eu,idb} from './source_official_b.ts';

async function direct(name:string){const [a,b,c,d,e]=await Promise.all([un(name),ofac(name),uk(name),eu(name),idb(name)]);return {UN_SANCTIONS:a,OFAC:b,UK_SANCTIONS:c,EU_SANCTIONS:d,IDB_SANCTIONS:e[0],WORLD_BANK:e[1]};}

export async function screen(body:any){
  const name=String(body?.name||'').trim(),rut=String(body?.rut||'').trim(),type=String(body?.entity_type||body?.entityType||'').trim();
  if(!name&&!rut)throw new Error('ENTITY_REQUIRED');
  const [i,o,d]=await Promise.all([icij(name),opensanctions(name,rut,type),name?direct(name):Promise.resolve({})]);
  const keys=new Set<string>();
  for(const [code,s] of Object.entries(d as any)){for(const r of A((s as any)?.records))keys.add(`${code}|${N(r.related_entity_name)}`);}
  const osrecs=A(o.records).filter((r:any)=>!keys.has(`${String(r.source_code||'OPENSANCTIONS')}|${N(r.related_entity_name)}`));
  const sources={...(d as any),ICIJ_OFFSHORE:i,OPENSANCTIONS:{...o,records:osrecs}},fresh=o.status==='fresh';
  return {ok:true,mode:'LIVE_NO_PERSIST',entity:{name:name||null,rut:rut||null,entity_type:type||null},sources,routing:{strategy:name?'official_direct_plus_aggregator':'aggregator_by_identifier',official_direct_always:Boolean(name),opensanctions_status:o.status||'unknown',fallback_used:!fresh,fallback_reason:fresh?null:o.status,direct_sources:name?DIRECT:[]},guardrails:{persisted:false,score_mutation:false,risk_transfer:false,identity_promotion:false,possible_match_requires_review:true,official_direct_always_for_name:true}};
}
