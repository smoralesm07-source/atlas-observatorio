import { useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useRpc } from '../lib/rpc';
import { downloadExcel, exportDate, filtersAsMetadata } from '../lib/excelExport';
import type { SourceStatusRow } from '../lib/contracts';
import '../styles/nominas.css';

type NominaCode = 'osfl' | 'fintech' | 'sanciones' | 'so' | 'sii' | 'e1d' | 'prensa' | 'estado';
type Filters = {
  region: string;
  activity: string;
  type: string;
  status: string;
  dateField: string;
  from: string;
  to: string;
  sanctions: boolean;
  publicFunds: boolean;
  uaf: boolean;
  press: boolean;
};

type OsflDashboard = {
  national: { official_total: number; official_snapshot_date: string | null; observed: number; coverage_pct: number; refreshed_at: string | null };
  filters: { regions: string[]; activities: string[]; types: string[] };
};

type FintechDashboard = {
  national: { reference_total: number; reference_date: string | null; sector_observed: number; refreshed_at: string | null };
  filters: { regions: string[]; verticals: string[] };
};

const EMPTY: Filters = {
  region: '', activity: '', type: '', status: '', dateField: 'ANY', from: '', to: '',
  sanctions: false, publicFunds: false, uaf: false, press: false,
};

const REGIONS = [
  'Arica y Parinacota','Tarapacá','Antofagasta','Atacama','Coquimbo','Valparaíso',
  'Metropolitana de Santiago','O’Higgins','Maule','Ñuble','Biobío','La Araucanía',
  'Los Ríos','Los Lagos','Aysén','Magallanes y de la Antártica Chilena',
];

const NOMINAS: Array<{ code: NominaCode; label: string; detail: string; source: string }> = [
  { code: 'osfl', label: 'OSFL', detail: 'Organizaciones sin fines de lucro', source: 'Registro Civil + cruces Atlas' },
  { code: 'fintech', label: 'Fintech', detail: 'Ecosistema Fintech y PSAV', source: 'Atlas Fintech' },
  { code: 'sanciones', label: 'Sanciones', detail: 'Entidades con antecedentes sancionatorios', source: 'Radar sancionatorio Atlas' },
  { code: 'so', label: 'Sujetos Obligados', detail: 'Padrón UAF y gestión registral', source: 'Universo SO' },
  { code: 'sii', label: 'SII', detail: 'Inicio, actividad y término de giro', source: 'Perfiles tributarios' },
  { code: 'e1d', label: 'Empresas en un día', detail: 'Constituciones y vigencia', source: 'Registro de Empresas y Sociedades' },
  { code: 'prensa', label: 'Prensa', detail: 'Entidades con coincidencias de prensa', source: 'Monitor de prensa' },
  { code: 'estado', label: 'Huella pública', detail: 'Proveedores y receptores de fondos públicos', source: 'Mercado Público + Presupuesto Abierto' },
];

function nf(v: number | null | undefined) { return Number(v ?? 0).toLocaleString('es-CL'); }
function pct(v: number | null | undefined) { return `${Number(v ?? 0).toLocaleString('es-CL', { maximumFractionDigits: 1 })}%`; }
function dateLabel(v: string | null | undefined) {
  if (!v) return 'Sin fecha';
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T12:00:00` : v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString('es-CL');
}
function glyph(code: NominaCode) {
  return ({ osfl: '◇', fintech: '◫', sanciones: '⚖', so: '◎', sii: '▦', e1d: '▤', prensa: '◌', estado: '⌁' } as Record<NominaCode,string>)[code];
}

export function NominasV2() {
  const [selected, setSelected] = useState<NominaCode>('osfl');
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [exporting, setExporting] = useState(false);
  const osfl = useRpc<OsflDashboard>('obs_osfl_dashboard', {});
  const fintech = useRpc<FintechDashboard>('obs_fintech_dashboard_v2', {});
  const sources = useRpc<SourceStatusRow[]>('obs_source_status', {});

  const config = NOMINAS.find((x) => x.code === selected)!;
  const sourceHealth = useMemo(() => {
    const rows = sources.data ?? [];
    const needles: Record<NominaCode,string[]> = {
      osfl:['osfl','registro civil'], fintech:['fintech'], sanciones:['sanc'], so:['uaf'], sii:['sii'],
      e1d:['res','empresa'], prensa:['press','prensa'], estado:['market','public','presupuesto'],
    };
    return rows.find((r) => needles[selected].some((n) => `${r.source_code} ${r.source_name}`.toLowerCase().includes(n)));
  }, [sources.data, selected]);

  const stats = useMemo(() => {
    if (selected === 'osfl' && osfl.data) return {
      measurable:true, official:osfl.data.national.official_total, atlas:osfl.data.national.observed,
      coverage:osfl.data.national.coverage_pct, cut:osfl.data.national.official_snapshot_date,
      refreshed:osfl.data.national.refreshed_at, authority:'Registro Civil',
    };
    if (selected === 'fintech' && fintech.data) {
      const official = fintech.data.national.reference_total;
      const atlas = fintech.data.national.sector_observed;
      return { measurable:true, official, atlas, coverage:official ? atlas / official * 100 : 0,
        cut:fintech.data.national.reference_date, refreshed:fintech.data.national.refreshed_at,
        authority:'Referencia sectorial Fintech' };
    }
    return { measurable:false, official:null, atlas:null, coverage:null, cut:null,
      refreshed:sourceHealth?.last_successful_ingest_at ?? sourceHealth?.last_source_record_at ?? null,
      authority:sourceHealth?.authoritative_source || config.source };
  }, [selected, osfl.data, fintech.data, sourceHealth, config.source]);

  const activityOptions = selected === 'osfl' ? (osfl.data?.filters.activities ?? []) : selected === 'fintech' ? (fintech.data?.filters.verticals ?? []) : [];
  const typeOptions = selected === 'osfl' ? (osfl.data?.filters.types ?? []) : [];
  const showPeriod = ['so','sii','e1d','prensa','estado'].includes(selected);
  const showActivity = !['sanciones','prensa','estado'].includes(selected);
  const showType = ['osfl','so','sii','estado'].includes(selected);
  const showStatus = selected === 'sii';

  function reset() { setFilters(EMPTY); }

  async function exportSelected() {
    setExporting(true);
    try {
      if (selected === 'osfl') await exportOsfl(filters);
      else if (selected === 'fintech') await exportFintech(filters);
      else if (selected === 'sanciones') await exportSanciones(filters);
      else if (selected === 'so') await exportSo(filters);
      else if (selected === 'sii') await exportSii(filters);
      else if (selected === 'e1d') await exportE1d(filters);
      else if (selected === 'prensa') await exportPrensa(filters);
      else if (selected === 'estado') await exportEstado(filters);
    } catch (error) {
      window.alert(`No fue posible generar la nómina: ${(error as Error).message}`);
    } finally { setExporting(false); }
  }

  return <div className="nominas-page fade-in">
    <header className="nominas-head"><div><span className="nominas-kicker">UNIVERSOS EXPORTABLES</span><h1>Nóminas</h1><p>Construye universos de trabajo sin exponer registros en pantalla. Filtra, revisa cobertura y descarga el resultado con trazabilidad.</p></div></header>

    <section className="nominas-catalog">{NOMINAS.map((item) => <button key={item.code} className={`nominas-card ${selected===item.code?'active':''}`} onClick={() => { setSelected(item.code); reset(); }}>
      <span className="nominas-card-icon">{glyph(item.code)}</span><strong>{item.label}</strong><small>{item.detail}</small><em>Disponible</em>
    </button>)}</section>

    <div className="nominas-workspace">
      <section className="nominas-panel nominas-filters">
        <div className="nominas-panel-head"><div><span>CONFIGURACIÓN</span><h2>Filtros de la nómina</h2></div><button onClick={reset}>Limpiar filtros</button></div>

        {showPeriod && <div className="nominas-field-grid">
          {['so','sii'].includes(selected) && <label><span>Fecha que filtra</span><select value={filters.dateField} onChange={(e)=>setFilters(f=>({...f,dateField:e.target.value}))}><option value="ANY">Sin filtro temporal</option><option value="INICIO">Inicio de actividades</option><option value="TERMINO">Término de giro</option></select></label>}
          {selected==='estado' && <label><span>Tipo de relación</span><select value={filters.type} onChange={(e)=>setFilters(f=>({...f,type:e.target.value}))}><option value="ANY">Cualquier relación</option><option value="TRANSFERS">Transferencias</option><option value="BUDGET_SUPPLIER">Proveedor Presupuesto Abierto</option><option value="MARKET_SUPPLIER">Proveedor Mercado Público</option></select></label>}
          <label><span>Desde</span><input type="date" value={filters.from} onChange={(e)=>setFilters(f=>({...f,from:e.target.value}))} /></label>
          <label><span>Hasta</span><input type="date" value={filters.to} onChange={(e)=>setFilters(f=>({...f,to:e.target.value}))} /></label>
        </div>}

        <div className="nominas-field-grid">
          <label><span>Región</span><select value={filters.region} onChange={(e)=>setFilters(f=>({...f,region:e.target.value}))}><option value="">Todas las regiones</option>{REGIONS.map(r=><option key={r}>{r}</option>)}</select></label>
          {showActivity && <label><span>Actividad / sector</span>{activityOptions.length ? <select value={filters.activity} onChange={(e)=>setFilters(f=>({...f,activity:e.target.value}))}><option value="">Todas</option>{activityOptions.map(x=><option key={x}>{x}</option>)}</select> : <input value={filters.activity} onChange={(e)=>setFilters(f=>({...f,activity:e.target.value}))} placeholder="Buscar actividad o sector" />}</label>}
          {showType && selected!=='estado' && <label><span>{selected==='so'?'Sector UAF':selected==='sii'?'Sector económico':'Categoría'}</span>{typeOptions.length ? <select value={filters.type} onChange={(e)=>setFilters(f=>({...f,type:e.target.value}))}><option value="">Todas</option>{typeOptions.map(x=><option key={x}>{x}</option>)}</select> : <input value={filters.type} onChange={(e)=>setFilters(f=>({...f,type:e.target.value}))} placeholder="Todos" />}</label>}
          {showStatus && <label><span>Estado tributario</span><select value={filters.status} onChange={(e)=>setFilters(f=>({...f,status:e.target.value}))}><option value="">Todos</option><option value="ACTIVE_AS_PUBLISHED">Activo</option><option value="TERMINATED_AS_PUBLISHED">Término de giro</option></select></label>}
        </div>

        <div className="nominas-marks"><span>Marcas Atlas</span>
          {['osfl','so','sii','prensa'].includes(selected) && <label><input type="checkbox" checked={filters.sanctions} onChange={(e)=>setFilters(f=>({...f,sanctions:e.target.checked}))}/> Sanciones</label>}
          {['osfl','so'].includes(selected) && <label><input type="checkbox" checked={filters.publicFunds} onChange={(e)=>setFilters(f=>({...f,publicFunds:e.target.checked}))}/> Relación con el Estado</label>}
          {['osfl','fintech','sii','prensa','estado'].includes(selected) && <label><input type="checkbox" checked={filters.uaf} onChange={(e)=>setFilters(f=>({...f,uaf:e.target.checked}))}/> Vínculo UAF</label>}
          {['so','estado'].includes(selected) && <label><input type="checkbox" checked={filters.press} onChange={(e)=>setFilters(f=>({...f,press:e.target.checked}))}/> Prensa coincidente</label>}
        </div>
      </section>

      <aside className="nominas-panel nominas-health">
        <div className="nominas-panel-head"><div><span>CONTROL DE COBERTURA</span><h2>Completitud y actualización</h2></div><i className={sourceHealth?.data_status==='silent'?'bad':'ok'}>{sourceHealth?.data_status==='silent'?'Fuente en silencio':'Fuente activa'}</i></div>
        <div className="nominas-source"><strong>{config.label}</strong><span>{config.source}</span><small>Autoridad / referencia: {stats.authority}</small></div>
        {stats.measurable ? <div className="nominas-coverage"><div className="nominas-ring" style={{['--coverage' as string]:`${Math.min(100,Number(stats.coverage??0))*3.6}deg`}}><strong>{pct(stats.coverage)}</strong></div><div><span>Universo de referencia <b>{nf(stats.official)}</b></span><span>Disponible en Atlas <b>{nf(stats.atlas)}</b></span><span>Fecha de corte <b>{dateLabel(stats.cut)}</b></span><span>Última actualización <b>{dateLabel(stats.refreshed)}</b></span></div></div> : <div className="nominas-notice"><strong>Cobertura no estimable.</strong><span>Atlas no mostrará un porcentaje si no existe un denominador oficial comparable. La ausencia de porcentaje no equivale a baja calidad.</span></div>}
        <div className="nominas-health-foot"><span>Último registro</span><strong>{dateLabel(sourceHealth?.last_source_record_at)}</strong><span>Última ingesta exitosa</span><strong>{dateLabel(sourceHealth?.last_successful_ingest_at)}</strong></div>
      </aside>
    </div>

    <section className="nominas-exportbar"><div><span>DESCARGA</span><strong>{config.label}</strong><small>El Excel incluye una hoja de metadatos con filtros, fuente y fecha de extracción.</small></div><button disabled={exporting} onClick={()=>void exportSelected()}>{exporting?'Generando…':'⇩ Descargar nómina en Excel'}</button></section>
  </div>;
}

async function collectRpc<T>(name:string,args:(offset:number)=>Record<string,unknown>,pageSize=1000):Promise<T[]> {
  const rows:T[]=[]; let offset=0; let total=0;
  do {
    const {data,error}=await supabase.rpc(name,args(offset)); if(error) throw error;
    const payload=data as {rows?:T[];total?:number}|null; const batch=payload?.rows??[]; total=Number(payload?.total??0);
    rows.push(...batch); offset+=batch.length; if(!batch.length) break;
  } while(offset<total);
  return rows;
}

async function exportOsfl(filters:Filters){
  type Row={rut:string|null;name:string;type:string;region:string|null;commune:string|null;main_activity:string|null;status:string|null;sources:Record<string,boolean>};
  const rows:Row[]=[]; let cursor:string|null=null; let more=true;
  while(more){const {data,error}=await supabase.rpc('obs_osfl_export_page',{p_q:null,p_region:filters.region||null,p_type:filters.type||null,p_activity:filters.activity||null,p_source:null,p_uaf:filters.uaf?'SI':'TODAS',p_public_funds:filters.publicFunds?'SI':'TODOS',p_sanctions:filters.sanctions?'SI':'TODAS',p_after_entity_id:cursor,p_limit:10000}); if(error)throw error; const p=data as {rows?:Row[];next_cursor?:string|null;has_more?:boolean}|null; rows.push(...(p?.rows??[])); cursor=p?.next_cursor??null; more=Boolean(p?.has_more&&cursor); if(!(p?.rows?.length))break;}
  downloadExcel({filename:`ATLAS_Nomina_OSFL_${exportDate()}.xls`,sheetName:'Nomina',rows,columns:[{header:'Nombre / Razón social',value:r=>r.name},{header:'RUT',value:r=>r.rut??'Sin RUT'},{header:'Categoría',value:r=>r.type},{header:'Región',value:r=>r.region??''},{header:'Comuna',value:r=>r.commune??''},{header:'Actividad',value:r=>r.main_activity??''},{header:'Estado',value:r=>r.status??''},{header:'Cruces Atlas',value:r=>Object.entries(r.sources??{}).filter(([,v])=>v).map(([k])=>k).join(' · ')}],metadata:meta('OSFL',rows.length,filters)});
}

async function exportFintech(filters:Filters){
  type Row={brand:string|null;legal_name:string;rut:string|null;vertical:string|null;business_model:string|null;operating_status:string;psav_status:string;region:string|null;commune:string|null;sii_main_activity:string|null;has_cmf_public:boolean;has_uaf_public:boolean;source_codes:string[]};
  const rows:Row[]=[]; let offset=0,total=0; do{const {data,error}=await supabase.rpc('obs_fintech_search_v2',{p_q:null,p_region:filters.region||null,p_vertical:filters.activity||null,p_model:null,p_source:null,p_regulator:filters.uaf?'UAF':'TODOS',p_psav:'TODOS',p_operating:'TODOS',p_limit:500,p_offset:offset});if(error)throw error;const p=data as {total?:number;rows?:Row[]}|null;const b=p?.rows??[];total=Number(p?.total??0);rows.push(...b);offset+=b.length;if(!b.length)break;}while(offset<total);
  downloadExcel({filename:`ATLAS_Nomina_Fintech_${exportDate()}.xls`,sheetName:'Nomina',rows,columns:[{header:'Nombre',value:r=>r.brand||r.legal_name},{header:'Razón social',value:r=>r.legal_name},{header:'RUT',value:r=>r.rut??'Sin RUT chileno'},{header:'Categoría',value:r=>r.vertical??''},{header:'Modelo',value:r=>r.business_model??''},{header:'Estado operativo',value:r=>r.operating_status},{header:'PSAV',value:r=>r.psav_status},{header:'Región',value:r=>r.region??''},{header:'Comuna',value:r=>r.commune??''},{header:'Actividad SII',value:r=>r.sii_main_activity??''},{header:'Huella CMF',value:r=>r.has_cmf_public},{header:'Huella UAF',value:r=>r.has_uaf_public},{header:'Fuentes',value:r=>(r.source_codes??[]).join(' · ')}],metadata:meta('Fintech',rows.length,filters)});
}

async function exportSanciones(filters:Filters){
  type Row={canonical_name?:string|null;source_entity_name?:string|null;rut?:string|null;regulator?:string|null;region?:string|null;event_date?:string|null;amount_clp?:number|string|null;amount_uf?:number|string|null;reason?:string|null;resolution_ref?:string|null;event_kind?:string|null};
  const rows:Row[]=[];let offset=0,total=0;do{const {data,error}=await supabase.rpc('atlas_v2_sanctions_query',{p_request:{kind:'events',q:'',universe:'',regulator:'',region:filters.region,event_kind:'',year:'',amount_band:'',limit:500,offset}});if(error)throw error;const p=data as {page?:{total?:number|string};items?:Row[]}|null;const b=p?.items??[];total=Number(p?.page?.total??0);rows.push(...b);offset+=b.length;if(!b.length)break;}while(offset<total);
  downloadExcel({filename:`ATLAS_Nomina_Sanciones_${exportDate()}.xls`,sheetName:'Nomina',rows,columns:[{header:'Nombre / Razón social',value:r=>r.canonical_name||r.source_entity_name||'Entidad no resuelta'},{header:'RUT',value:r=>r.rut??'Sin RUT'},{header:'Organismo sancionador',value:r=>r.regulator??''},{header:'Región',value:r=>r.region??''},{header:'Fecha',value:r=>r.event_date??''},{header:'Monto CLP',value:r=>Number(r.amount_clp??0)||''},{header:'Monto UF',value:r=>Number(r.amount_uf??0)||''},{header:'Tipo',value:r=>r.event_kind??''},{header:'Materia / infracción',value:r=>r.reason??''},{header:'Resolución',value:r=>r.resolution_ref??''}],metadata:meta('Sanciones',rows.length,filters)});
}

async function exportSo(filters:Filters){
  type Row={rut:string;name:string;subject_nature:string|null;uaf_sector:string|null;sii_status:string|null;activity_start_date:string|null;termination_date:string|null;economic_sector:string|null;main_activity:string|null;sales_band:string|null;workers:number|null;region:string|null;commune:string|null;is_osfl:boolean;is_state_supplier:boolean;sanction_count:number;has_press:boolean;press_evidence_count:number;alert_count:number};
  const rows=await collectRpc<Row>('obs_nomina_so_export',offset=>({p_region:filters.region||null,p_sector:filters.type||null,p_activity:filters.activity||null,p_date_field:filters.dateField,p_from:filters.from||null,p_to:filters.to||null,p_only_sanctions:filters.sanctions,p_only_press:filters.press,p_only_state_supplier:filters.publicFunds,p_limit:1000,p_offset:offset}));
  downloadExcel({filename:`ATLAS_Nomina_SO_${exportDate()}.xls`,sheetName:'Nomina',rows,columns:[{header:'RUT',value:r=>r.rut},{header:'Nombre / Razón social',value:r=>r.name},{header:'Naturaleza',value:r=>r.subject_nature??''},{header:'Sector UAF',value:r=>r.uaf_sector??''},{header:'Estado SII',value:r=>r.sii_status??''},{header:'Inicio actividades',value:r=>r.activity_start_date??''},{header:'Término de giro',value:r=>r.termination_date??''},{header:'Sector económico',value:r=>r.economic_sector??''},{header:'Actividad principal',value:r=>r.main_activity??''},{header:'Tramo ventas',value:r=>r.sales_band??''},{header:'Trabajadores',value:r=>r.workers??''},{header:'Región',value:r=>r.region??''},{header:'Comuna',value:r=>r.commune??''},{header:'OSFL',value:r=>r.is_osfl},{header:'Proveedor Estado',value:r=>r.is_state_supplier},{header:'Sanciones',value:r=>r.sanction_count},{header:'Prensa',value:r=>r.has_press},{header:'Coincidencias prensa',value:r=>r.press_evidence_count},{header:'Señales Atlas',value:r=>r.alert_count}],metadata:meta('Sujetos Obligados',rows.length,filters)});
}

async function exportSii(filters:Filters){
  type Row={rut:string|null;name:string;entity_type:string|null;is_uaf_observed:boolean;is_sanctioned:boolean;uaf_sector:string|null;current_status:string|null;main_activity:string|null;region:string|null;commune:string|null;activity_start_date:string|null;termination_date:string|null;sales_band_rank:number|null;workers_numeric:number|null;economic_sector:string|null};
  const rows=await collectRpc<Row>('obs_nomina_sii_export',offset=>({p_region:filters.region||null,p_sector:filters.type||null,p_activity:filters.activity||null,p_status:filters.status||null,p_date_field:filters.dateField,p_from:filters.from||null,p_to:filters.to||null,p_only_uaf:filters.uaf,p_only_sanctions:filters.sanctions,p_limit:1000,p_offset:offset}));
  downloadExcel({filename:`ATLAS_Nomina_SII_${exportDate()}.xls`,sheetName:'Nomina',rows,columns:[{header:'RUT',value:r=>r.rut??'Sin RUT'},{header:'Nombre / Razón social',value:r=>r.name},{header:'Tipo entidad',value:r=>r.entity_type??''},{header:'Estado tributario',value:r=>r.current_status??''},{header:'Inicio actividades',value:r=>r.activity_start_date??''},{header:'Término de giro',value:r=>r.termination_date??''},{header:'Actividad principal',value:r=>r.main_activity??''},{header:'Sector económico',value:r=>r.economic_sector??''},{header:'Región',value:r=>r.region??''},{header:'Comuna',value:r=>r.commune??''},{header:'Trabajadores',value:r=>r.workers_numeric??''},{header:'Tramo ventas',value:r=>r.sales_band_rank??''},{header:'Vínculo UAF',value:r=>r.is_uaf_observed},{header:'Sancionado',value:r=>r.is_sanctioned},{header:'Sector UAF',value:r=>r.uaf_sector??''}],metadata:meta('SII',rows.length,filters)});
}

async function exportE1d(filters:Filters){
  type Row={rut:string;name:string;event_date:string;constitution_date:string|null;activity_start_date:string|null;region:string|null;commune:string|null;activity:string|null;sii_status:string|null;entity_id:string|null;visible_in_atlas:boolean;is_uaf_observed:boolean;uaf_sector:string|null;is_potential_so:boolean;potential_sector:string|null;ivo_score:number|null;ivo_band:string|null;sources:string[]};
  const rows:Row[]=[];let offset=0,total=0;do{const {data,error}=await supabase.rpc('obs_new_entities_directory',{p_q:null,p_source:'RES',p_visibility:'TODAS',p_region:filters.region||null,p_activity:filters.activity||null,p_potential_only:false,p_from:filters.from||null,p_to:filters.to||null,p_limit:200,p_offset:offset});if(error)throw error;const p=data as {total?:number;rows?:Row[]}|null;const b=p?.rows??[];total=Number(p?.total??0);rows.push(...b);offset+=b.length;if(!b.length)break;}while(offset<total);
  downloadExcel({filename:`ATLAS_Nomina_Empresas_1_Dia_${exportDate()}.xls`,sheetName:'Nomina',rows,columns:[{header:'RUT',value:r=>r.rut},{header:'Razón social',value:r=>r.name},{header:'Fecha constitución',value:r=>r.constitution_date??r.event_date},{header:'Inicio actividades',value:r=>r.activity_start_date??''},{header:'Actividad',value:r=>r.activity??''},{header:'Estado SII',value:r=>r.sii_status??''},{header:'Región',value:r=>r.region??''},{header:'Comuna',value:r=>r.commune??''},{header:'Visible Atlas',value:r=>r.visible_in_atlas},{header:'Vínculo UAF',value:r=>r.is_uaf_observed},{header:'Sector UAF',value:r=>r.uaf_sector??''},{header:'Potencial SO',value:r=>r.is_potential_so},{header:'Sector potencial',value:r=>r.potential_sector??''},{header:'IVO',value:r=>r.ivo_score??''},{header:'Banda IVO',value:r=>r.ivo_band??''},{header:'Fuentes',value:r=>(r.sources??[]).join(' · ')}],metadata:meta('Empresas en un día',rows.length,filters)});
}

async function exportPrensa(filters:Filters){
  type Row={rut:string|null;name:string;entity_type:string|null;region:string|null;commune:string|null;uaf_sector:string|null;is_uaf_observed:boolean;is_sanctioned:boolean;first_linked_date:string|null;last_linked_at:string|null;score:number|null;link_count:number};
  const rows=await collectRpc<Row>('obs_nomina_press_export',offset=>({p_region:filters.region||null,p_from:filters.from||null,p_to:filters.to||null,p_only_uaf:filters.uaf,p_only_sanctions:filters.sanctions,p_limit:1000,p_offset:offset}));
  downloadExcel({filename:`ATLAS_Nomina_Prensa_${exportDate()}.xls`,sheetName:'Nomina',rows,columns:[{header:'RUT',value:r=>r.rut??'Sin RUT'},{header:'Nombre / Razón social',value:r=>r.name},{header:'Tipo entidad',value:r=>r.entity_type??''},{header:'Región',value:r=>r.region??''},{header:'Comuna',value:r=>r.commune??''},{header:'Sector UAF',value:r=>r.uaf_sector??''},{header:'Vínculo UAF',value:r=>r.is_uaf_observed},{header:'Sancionado',value:r=>r.is_sanctioned},{header:'Primera vinculación',value:r=>r.first_linked_date??''},{header:'Última actualización vínculo',value:r=>r.last_linked_at??''},{header:'Confianza',value:r=>r.score??''},{header:'Coincidencias',value:r=>r.link_count}],metadata:meta('Prensa coincidente',rows.length,filters)});
}

async function exportEstado(filters:Filters){
  type Row={rut:string;name:string;region:string|null;commune:string|null;is_osfl:boolean;is_so:boolean;is_potential_so:boolean;is_res_new:boolean;has_press:boolean;is_market_supplier:boolean;sii_status:string|null;termination_date:string|null;workers:number|null;uaf_sector:string|null;amount_total:number;amount_transfer:number;amount_supplier:number;transaction_count:number;first_year:number|null;last_year:number|null;market_amount_12m:number;market_order_count_12m:number;top_buyer_label:string|null;top_payer_name:string|null;top_payer_amount:number|null};
  const rows:Row[]=[];let offset=0,total=0;const marks:string[]=[];if(filters.uaf)marks.push('SO');if(filters.press)marks.push('PRESS');const fy=filters.from?Number(filters.from.slice(0,4)):2020;const ty=filters.to?Number(filters.to.slice(0,4)):new Date().getFullYear();do{const {data,error}=await supabase.rpc('obs_state_sample_query_v1',{p_filters:{from_year:fy,to_year:ty,relation_mode:filters.type||'ANY',marks,mark_mode:'ALL',sii_condition:'ANY',min_amount_clp:0,q:''},p_limit:1000,p_offset:offset});if(error)throw error;const p=data as {ok?:boolean;total?:number;rows?:Row[]}|null;if(p?.ok===false)throw new Error('Filtros de Huella pública no válidos');const b=p?.rows??[];total=Number(p?.total??0);rows.push(...b);offset+=b.length;if(!b.length)break;}while(offset<total);
  downloadExcel({filename:`ATLAS_Nomina_Huella_Publica_${exportDate()}.xls`,sheetName:'Nomina',rows,columns:[{header:'RUT',value:r=>r.rut},{header:'Nombre / Razón social',value:r=>r.name},{header:'Región',value:r=>r.region??''},{header:'Comuna',value:r=>r.commune??''},{header:'OSFL',value:r=>r.is_osfl},{header:'SO',value:r=>r.is_so},{header:'Potencial SO',value:r=>r.is_potential_so},{header:'Empresa 1 día',value:r=>r.is_res_new},{header:'Prensa',value:r=>r.has_press},{header:'Proveedor Mercado Público',value:r=>r.is_market_supplier},{header:'Monto total',value:r=>r.amount_total},{header:'Transferencias',value:r=>r.amount_transfer},{header:'Compras / pagos',value:r=>r.amount_supplier},{header:'Transacciones',value:r=>r.transaction_count},{header:'Primer año',value:r=>r.first_year??''},{header:'Último año',value:r=>r.last_year??''},{header:'Monto Mercado Público 12m',value:r=>r.market_amount_12m},{header:'Órdenes Mercado Público 12m',value:r=>r.market_order_count_12m},{header:'Principal comprador',value:r=>r.top_buyer_label??''},{header:'Principal pagador',value:r=>r.top_payer_name??''},{header:'Monto principal pagador',value:r=>r.top_payer_amount??''}],metadata:meta('Huella pública',rows.length,filters)});
}

function meta(name:string,count:number,filters:Filters){return [{label:'Nómina',value:name},{label:'Fecha de extracción',value:exportDate()},{label:'Registros exportados',value:count},...filtersAsMetadata(filters)];}
