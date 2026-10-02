from pathlib import Path

path = Path('src/views/NominasV3.tsx')
text = path.read_text(encoding='utf-8')

replacements = [
    (
        'Construye universos personalizados, controla su completitud y descarga archivos trazables sin exponer registros en pantalla.',
        'Selecciona una fuente, aplica filtros y perfila una nómina de entidades de interés para descargarla en Excel, con trazabilidad de cobertura, fecha de corte y criterios utilizados.'
    ),
    (
        "{exporting&&<div className=\"nominas3-progress\"><i style={{width:`${progress}%`}}/><b>{progress}%</b></div>}",
        "{exporting&&<div className=\"nominas3-progress\"><i style={{width:`${progress}%`}}/></div>}"
    ),
    (
        "if(selected==='sanciones'){const {data,error}=await supabase.rpc('atlas_v2_sanctions_query',{p_request:{kind:'events',q:'',universe:'',regulator:'',region:f.region,event_kind:'',year:'',amount_band:'',limit:1,offset:0}});if(error)throw error;return Number((data as {page?:{total?:number|string}}|null)?.page?.total??0)}",
        "if(selected==='sanciones'){const {data,error}=await supabase.rpc('obs_nomina_sanctions_export',{p_region:f.region||null,p_limit:1,p_offset:0});if(error)throw error;return Number((data as {total?:number}|null)?.total??0)}"
    ),
    (
        "async function exportSanciones(f:Filters,p:(d:number,t:number)=>void){type R=Record<string,unknown>;const rows:R[]=[];let offset=0,total=0;do{const {data,error}=await supabase.rpc('atlas_v2_sanctions_query',{p_request:{kind:'events',q:'',universe:'',regulator:'',region:f.region,event_kind:'',year:'',amount_band:'',limit:500,offset}});if(error)throw error;const x=data as {page?:{total?:number|string};items?:R[]}|null,b=x?.items??[];total=Number(x?.page?.total??0);rows.push(...b);offset+=b.length;p(offset,total);if(!b.length)break}while(offset<total);downloadExcel({filename:`ATLAS_Nomina_Sanciones_${exportDate()}.xls`,sheetName:'Nomina',rows,columns:[{header:'Nombre / Razón social',value:r=>String(r.canonical_name??r.source_entity_name??'Entidad no resuelta')},{header:'RUT',value:r=>String(r.rut??'Sin RUT')},{header:'Organismo sancionador',value:r=>String(r.regulator??'')},{header:'Región',value:r=>String(r.region??'')},{header:'Fecha',value:r=>String(r.event_date??'')},{header:'Monto CLP',value:r=>Number(r.amount_clp??0)||''},{header:'Monto UF',value:r=>Number(r.amount_uf??0)||''},{header:'Tipo',value:r=>String(r.event_kind??'')},{header:'Materia / infracción',value:r=>String(r.reason??'')},{header:'Resolución',value:r=>String(r.resolution_ref??'')}],metadata:meta('Sanciones',rows.length,f)})}",
        "async function exportSanciones(f:Filters,p:(d:number,t:number)=>void){type R=Record<string,unknown>;const rows=await collectRpc<R>('obs_nomina_sanctions_export',o=>({p_region:f.region||null,p_limit:1000,p_offset:o}),p);downloadExcel({filename:`ATLAS_Nomina_Sanciones_${exportDate()}.xls`,sheetName:'Nomina',rows,columns:[{header:'Nombre / Razón social',value:r=>String(r.canonical_name??r.source_entity_name??'Entidad no resuelta')},{header:'RUT',value:r=>String(r.rut??'Sin RUT')},{header:'Región',value:r=>String(r.region??'')},{header:'Antecedentes',value:r=>Number(r.event_count??0)},{header:'Organismos',value:r=>String(r.regulators??'')},{header:'Primera fecha',value:r=>String(r.first_event_date??'')},{header:'Última fecha',value:r=>String(r.last_event_date??'')},{header:'Monto CLP',value:r=>Number(r.amount_clp??0)||''},{header:'Monto UF',value:r=>Number(r.amount_uf??0)||''},{header:'Padrón UAF',value:r=>Boolean(r.in_uaf_registry)},{header:'Registro SII',value:r=>Boolean(r.in_sii_registry)},{header:'Universo OSFL',value:r=>Boolean(r.in_osfl_registry)}],metadata:meta('Sanciones · entidades únicas',rows.length,f)})}"
    ),
]

for old, new in replacements:
    if old not in text:
        raise SystemExit(f'No se encontró el bloque esperado para reemplazar: {old[:100]}')
    text = text.replace(old, new, 1)

path.write_text(text, encoding='utf-8')
print('Nóminas conciliada: sanciones por entidad, bajada mejorada y progreso visual limpio.')
