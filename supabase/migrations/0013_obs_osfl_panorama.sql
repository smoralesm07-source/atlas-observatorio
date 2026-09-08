-- ATLAS Observatorio · OSFL panorama y caracterización
-- Read model optimizado para la vista OSFL. El total legal de Registro Civil
-- se conserva como denominador de referencia: no se presenta como padrón
-- individualizado mientras aml_osfl_registry_master no tenga filas cargadas.

create table if not exists public.obs_osfl_entity (
  entity_id text primary key,
  rut text,
  name text not null,
  name_search text,
  rut_search text,
  osfl_type text,
  region text,
  commune text,
  activity_group text,
  main_activity text,
  current_status text,
  activity_start_date date,
  termination_date date,
  sii_year_count integer,
  sales_band text,
  workers_numeric bigint,
  registro19862 boolean not null default false,
  public_funds boolean not null default false,
  transfer_count bigint not null default 0,
  transfer_amount_clp numeric not null default 0,
  uaf_class text,
  uaf_label text,
  uaf_sector text,
  has_uaf_direct boolean not null default false,
  has_uaf_potential boolean not null default false,
  sanction_count integer not null default 0,
  has_sanctions boolean not null default false,
  source_count integer,
  refreshed_at timestamptz not null default now()
);

create index if not exists obs_osfl_entity_name_trgm on public.obs_osfl_entity using gin (name_search gin_trgm_ops);
create index if not exists obs_osfl_entity_rut_search on public.obs_osfl_entity (rut_search);
create index if not exists obs_osfl_entity_region on public.obs_osfl_entity (region);
create index if not exists obs_osfl_entity_type on public.obs_osfl_entity (osfl_type);
create index if not exists obs_osfl_entity_activity on public.obs_osfl_entity (activity_group);
create index if not exists obs_osfl_entity_main_activity on public.obs_osfl_entity (main_activity);
create index if not exists obs_osfl_entity_uaf on public.obs_osfl_entity (uaf_class);
create index if not exists obs_osfl_entity_sanc on public.obs_osfl_entity (has_sanctions) where has_sanctions;
create index if not exists obs_osfl_entity_19862 on public.obs_osfl_entity (registro19862) where registro19862;

alter table public.obs_osfl_entity enable row level security;
drop policy if exists obs_osfl_entity_allowed_read on public.obs_osfl_entity;
create policy obs_osfl_entity_allowed_read on public.obs_osfl_entity
  for select to authenticated
  using (exists (
    select 1 from public.aml_allowed_users au
    where au.user_id=(select auth.uid()) and au.enabled
  ));
grant select on public.obs_osfl_entity to authenticated, service_role;

create or replace function public.obs_refresh_osfl(p_snapshot_id text default null)
returns integer
language plpgsql
security definer
set search_path=public,extensions,pg_temp
as $$
declare v_n integer;
begin
  truncate table public.obs_osfl_entity;
  insert into public.obs_osfl_entity (
    entity_id,rut,name,name_search,rut_search,osfl_type,region,commune,activity_group,main_activity,current_status,
    activity_start_date,termination_date,sii_year_count,sales_band,workers_numeric,registro19862,public_funds,
    transfer_count,transfer_amount_clp,uaf_class,uaf_label,uaf_sector,has_uaf_direct,has_uaf_potential,
    sanction_count,has_sanctions,source_count,refreshed_at
  )
  select e.entity_id,e.rut,e.name,
    public.obs_normalize_text(e.name),regexp_replace(upper(coalesce(e.rut,'')),'[^0-9K]','','g'),
    case
      when upper(coalesce(e.name,'')) like 'FUNDACI%' then 'Fundación'
      when upper(coalesce(e.name,'')) like 'CORPORACI%' then 'Corporación'
      when upper(coalesce(e.name,'')) like 'ASOCIACI%' then 'Asociación'
      when upper(coalesce(e.name,'')) like 'ORGANIZACI%' or upper(coalesce(e.name,'')) like 'ONG %' then 'Organización / ONG'
      when upper(coalesce(e.name,'')) like 'CLUB %' then 'Club'
      when upper(coalesce(e.name,'')) like 'SINDICATO %' then 'Sindicato'
      when upper(coalesce(e.name,'')) like 'COMUNIDAD %' then 'Comunidad'
      else 'Otras'
    end,
    e.region,e.commune,e.activity_group,e.main_activity,e.current_status,e.activity_start_date,e.termination_date,
    e.sii_year_count,e.sales_band,e.workers_numeric,coalesce(e.registro19862,false),coalesce(ep.transfer_received_confirmed,false),
    coalesce(ep.confirmed_transfer_count,0),coalesce(ep.confirmed_transfer_amount_clp,0),b.bridge_class,b.bridge_label,
    coalesce(b.direct_uaf_sector,b.potential_uaf_sector),coalesce(b.bridge_class='DIRECT_OBLIGATED',false),
    coalesce(b.bridge_class='POTENTIAL_SUBJECT',false),coalesce(e.sanction_count,0),coalesce(e.sanction_count,0)>0,
    e.source_count,now()
  from public.aml_osfl_entity_runtime_snapshot e
  left join public.aml_v_osfl_economic_profile_current_v0950 ep on ep.entity_id=e.entity_id
  left join public.aml_v_osfl_law19913_bridge_current b on b.entity_id=e.entity_id;
  get diagnostics v_n=row_count;
  analyze public.obs_osfl_entity;
  return v_n;
end $$;
revoke all on function public.obs_refresh_osfl(text) from public,anon,authenticated;
grant execute on function public.obs_refresh_osfl(text) to service_role;

create or replace function public.obs_osfl_dashboard()
returns jsonb language sql stable security invoker set search_path=public,extensions,pg_temp as $$
with allowed as (select exists(select 1 from public.aml_allowed_users au where au.user_id=(select auth.uid()) and au.enabled) ok),
monitor as (select m.* from public.aml_v_osfl_national_monitor_current m,allowed a where a.ok limit 1),
entity_stats as (select count(*)::bigint observed,count(*) filter(where coalesce(sii_year_count,0)>0)::bigint sii_history,count(*) filter(where registro19862)::bigint registro19862,count(*) filter(where has_sanctions)::bigint sanctioned,count(*) filter(where region is not null)::bigint with_region,count(*) filter(where public_funds)::bigint public_funds from public.obs_osfl_entity),
bridge_stats as (select count(*) filter(where has_uaf_direct)::bigint direct_uaf,count(*) filter(where has_uaf_potential)::bigint potential_uaf from public.obs_osfl_entity),
type_counts as (select osfl_type,count(*)::bigint entity_count from public.obs_osfl_entity group by osfl_type),
activity_counts as (select main_activity label,count(*)::bigint entity_count from public.obs_osfl_entity where main_activity is not null group by main_activity),
region_counts as (select coalesce(region,'Sin región observada') label,count(*)::bigint entity_count from public.obs_osfl_entity group by coalesce(region,'Sin región observada')),
filter_regions as (select distinct region from public.obs_osfl_entity where region is not null order by region),
filter_activities as (select distinct main_activity from public.obs_osfl_entity where main_activity is not null order by main_activity),
evolution as (select g.year,g.stock_year_end,g.starts,g.terminations,g.growth_pct,g.series_eligible_count,g.observed_universe from public.aml_v_osfl_growth_yearly_current g,allowed a where a.ok and g.scope='CHILE' and g.region is null and g.year between 2015 and g.last_complete_year order by g.year)
select case when a.ok then jsonb_build_object(
'national',jsonb_build_object('official_total',coalesce(m.official_active_total,0),'official_snapshot_date',m.legal_snapshot_date,'official_source',m.source_name,'official_loaded_rows',coalesce(m.loaded_rows,0),'observed',coalesce(es.observed,0),'coverage_pct',coalesce(m.atlas_legal_coverage_pct,0),'sii_history',coalesce(es.sii_history,0),'direct_uaf',coalesce(bs.direct_uaf,0),'potential_uaf',coalesce(bs.potential_uaf,0),'law19913_bridge',coalesce(bs.direct_uaf,0)+coalesce(bs.potential_uaf,0),'registro19862',coalesce(es.registro19862,0),'sanctioned',coalesce(es.sanctioned,0),'public_funds',coalesce(es.public_funds,0),'with_region',coalesce(es.with_region,0),'refreshed_at',m.monitor_refreshed_at),
'sources',jsonb_build_array(
jsonb_build_object('code','RC','label','Registro Civil','role','Universo nacional de referencia (RNPJSFL)','volume',coalesce(m.official_active_total,0),'detail','Referencia nacional; el registro individualizado aún no está cargado.'),
jsonb_build_object('code','SII','label','SII','role','Historial económico y actividad tributaria disponible','volume',coalesce(es.sii_history,0),'detail','OSFL observadas con historial económico anual disponible.'),
jsonb_build_object('code','UAF','label','UAF / Ley 19.913','role','Puente regulatorio: SO registrados y potenciales sujetos','volume',coalesce(bs.direct_uaf,0)+coalesce(bs.potential_uaf,0),'detail',coalesce(bs.direct_uaf,0)::text||' SO registrados + '||coalesce(bs.potential_uaf,0)::text||' potenciales.'),
jsonb_build_object('code','19862','label','Registro 19.862','role','Presencia en registro de receptores de fondos públicos','volume',coalesce(es.registro19862,0),'detail','Cruce dentro del universo OSFL observado.'),
jsonb_build_object('code','SANC','label','Sanciones','role','Antecedentes sancionatorios publicados por supervisores','volume',coalesce(es.sanctioned,0),'detail','Cruce con el dossier sancionatorio vigente.')),
'types',(select coalesce(jsonb_agg(jsonb_build_object('label',osfl_type,'count',entity_count) order by entity_count desc),'[]'::jsonb) from type_counts),
'activities',(select coalesce(jsonb_agg(jsonb_build_object('label',label,'count',entity_count) order by entity_count desc),'[]'::jsonb) from (select * from activity_counts order by entity_count desc limit 6) q),
'regions',(select coalesce(jsonb_agg(jsonb_build_object('label',label,'count',entity_count) order by entity_count desc),'[]'::jsonb) from (select * from region_counts order by entity_count desc limit 6) q),
'evolution',(select coalesce(jsonb_agg(jsonb_build_object('year',year,'stock',stock_year_end,'starts',starts,'terminations',terminations,'growth_pct',growth_pct,'eligible',series_eligible_count,'observed',observed_universe) order by year),'[]'::jsonb) from evolution),
'filters',jsonb_build_object('regions',(select coalesce(jsonb_agg(region order by region),'[]'::jsonb) from filter_regions),'activities',(select coalesce(jsonb_agg(main_activity order by main_activity),'[]'::jsonb) from filter_activities),'types',(select coalesce(jsonb_agg(osfl_type order by osfl_type),'[]'::jsonb) from (select distinct osfl_type from public.obs_osfl_entity) q)),
'semantics',jsonb_build_object('official_universe','El total del Registro Civil es un denominador nacional de referencia; el registro individualizado no está cargado en Atlas.','observed_universe','El universo observado corresponde a OSFL individualizadas y conciliadas en Atlas.','type_inference','La tipología se infiere de la denominación cuando no existe tipo jurídico individualizado del Registro Civil.','evolution','La serie representa el stock observado con fecha de inicio válida y las altas anuales; no reconstruye históricamente el total oficial del Registro Civil.')
) else jsonb_build_object('error','NOT_AUTHORIZED') end from allowed a left join monitor m on true left join entity_stats es on true left join bridge_stats bs on true;
$$;
revoke all on function public.obs_osfl_dashboard() from public,anon;
grant execute on function public.obs_osfl_dashboard() to authenticated,service_role;

create or replace function public.obs_osfl_search(
  p_q text default null,p_region text default null,p_type text default null,p_activity text default null,
  p_source text default null,p_uaf text default null,p_public_funds text default null,p_sanctions text default null,
  p_limit integer default 25,p_offset integer default 0
)
returns jsonb language sql stable security invoker set search_path=public,extensions,pg_temp as $$
with filtered as (
  select * from public.obs_osfl_entity x
  where (p_q is null or btrim(p_q)='' or x.name_search like '%'||public.obs_normalize_text(btrim(p_q))||'%' or x.rut_search like '%'||regexp_replace(upper(btrim(p_q)),'[^0-9K]','','g')||'%')
    and (p_region is null or p_region='' or x.region=p_region)
    and (p_type is null or p_type='' or x.osfl_type=p_type)
    and (p_activity is null or p_activity='' or x.main_activity=p_activity)
    and (p_source is null or p_source='' or (p_source='SII' and coalesce(x.sii_year_count,0)>0) or (p_source='UAF' and (x.has_uaf_direct or x.has_uaf_potential)) or (p_source='19862' and x.registro19862) or (p_source='SANCIONES' and x.has_sanctions))
    and (p_uaf is null or p_uaf='' or p_uaf='TODAS' or (p_uaf='DIRECTA' and x.has_uaf_direct) or (p_uaf='POTENCIAL' and x.has_uaf_potential) or (p_uaf='SIN_PUENTE' and not x.has_uaf_direct and not x.has_uaf_potential))
    and (p_public_funds is null or p_public_funds='' or p_public_funds='TODOS' or (p_public_funds='SI' and x.public_funds) or (p_public_funds='NO' and not x.public_funds))
    and (p_sanctions is null or p_sanctions='' or p_sanctions='TODAS' or (p_sanctions='SI' and x.has_sanctions) or (p_sanctions='NO' and not x.has_sanctions))
), page as (
  select * from filtered order by has_sanctions desc,has_uaf_direct desc,public_funds desc,name asc
  limit greatest(1,least(coalesce(p_limit,25),100)) offset greatest(coalesce(p_offset,0),0)
)
select jsonb_build_object('total',(select count(*) from filtered),'limit',greatest(1,least(coalesce(p_limit,25),100)),'offset',greatest(coalesce(p_offset,0),0),
'rows',coalesce((select jsonb_agg(jsonb_build_object(
'entity_id',entity_id,'rut',rut,'name',name,'type',osfl_type,'region',region,'commune',commune,'activity_group',activity_group,'main_activity',main_activity,'status',current_status,
'sources',jsonb_strip_nulls(jsonb_build_object('SII',case when coalesce(sii_year_count,0)>0 then true end,'UAF',case when has_uaf_direct then true end,'POTENTIAL_UAF',case when has_uaf_potential then true end,'19862',case when registro19862 then true end,'SANCIONES',case when has_sanctions then true end)),
'uaf_class',uaf_class,'uaf_label',uaf_label,'uaf_sector',uaf_sector,'public_funds',public_funds,'transfer_count',transfer_count,'transfer_amount_clp',transfer_amount_clp,'sanctions',has_sanctions,'sanction_count',sanction_count,'source_count',source_count,'activity_start_date',activity_start_date,'termination_date',termination_date
) order by has_sanctions desc,has_uaf_direct desc,public_funds desc,name asc) from page),'[]'::jsonb));
$$;
revoke all on function public.obs_osfl_search(text,text,text,text,text,text,text,text,integer,integer) from public,anon;
grant execute on function public.obs_osfl_search(text,text,text,text,text,text,text,text,integer,integer) to authenticated,service_role;

create or replace function public.obs_osfl_entity_detail(p_entity_id text)
returns jsonb language sql stable security invoker set search_path=public,extensions,pg_temp as $$
with entity as (select * from public.obs_osfl_entity where entity_id=p_entity_id),
econ as (select ep.* from public.aml_v_osfl_economic_profile_current_v0950 ep where ep.entity_id=p_entity_id limit 1),
sanc as (select s.* from public.aml_v_sanctions_entity_dossier_current_v0960 s where s.entity_id=p_entity_id and s.is_osfl_observed limit 1),
generic as (select public.obs_entity_detail(p_entity_id) d),
timeline_rows as (
  select nullif(x->>'fecha','')::date event_date,coalesce(x->>'etiqueta',x->>'kind','Hito') label,coalesce(x->>'fuente','Atlas') source,nullif(x->>'detalle','') detail,coalesce(x->>'kind','HITO') kind
  from generic g,lateral jsonb_array_elements(coalesce(g.d->'lifecycle','[]'::jsonb)) x
  union all
  select ec.first_transfer_date,'Primera transferencia pública confirmada','Registro 19.862 / fuente de transferencias',case when ec.confirmed_transfer_count>0 then ec.confirmed_transfer_count::text||' transferencia(s) confirmada(s)' end,'FONDOS_PUBLICOS' from econ ec where ec.first_transfer_date is not null
  union all
  select s.first_event_date,'Primer antecedente sancionatorio',coalesce(array_to_string(s.regulators,', '),'Supervisor'),case when s.event_count>0 then s.event_count::text||' evento(s) sancionatorio(s) observado(s)' end,'SANCION' from sanc s where s.first_event_date is not null
),timeline as (select coalesce(jsonb_agg(jsonb_build_object('date',event_date,'label',label,'source',source,'detail',detail,'kind',kind) order by event_date,label),'[]'::jsonb) data from (select distinct event_date,label,source,detail,kind from timeline_rows where event_date is not null) q)
select case when e.entity_id is null then null else jsonb_build_object(
'entity',jsonb_build_object('entity_id',e.entity_id,'rut',e.rut,'name',e.name,'type',e.osfl_type,'region',e.region,'commune',e.commune,'activity_group',e.activity_group,'main_activity',coalesce(ec.main_activity,e.main_activity),'status',e.current_status,'activity_start_date',coalesce(ec.activity_start_date,e.activity_start_date),'termination_date',coalesce(ec.termination_date,e.termination_date),'sales_band',coalesce(ec.sales_band_label,e.sales_band),'size_class',ec.sii_size_class,'workers',coalesce(ec.workers_numeric,e.workers_numeric),'source_count',e.source_count),
'sources',jsonb_build_object('SII',coalesce(e.sii_year_count,0)>0,'UAF_DIRECT',e.has_uaf_direct,'UAF_POTENTIAL',e.has_uaf_potential,'REGISTRO_19862',e.registro19862,'SANCIONES',coalesce(s.event_count,0)>0,'FONDOS_PUBLICOS',coalesce(ec.transfer_received_confirmed,false)),
'uaf',jsonb_build_object('class',e.uaf_class,'label',e.uaf_label,'sector',e.uaf_sector),
'public_funds',jsonb_build_object('confirmed',coalesce(ec.transfer_received_confirmed,false),'transfer_count',coalesce(ec.confirmed_transfer_count,0),'funder_count',coalesce(ec.public_funder_count,0),'amount_clp',coalesce(ec.confirmed_transfer_amount_clp,0),'first_date',ec.first_transfer_date,'last_date',ec.last_transfer_date),
'sanctions',jsonb_build_object('event_count',coalesce(s.event_count,0),'regulator_count',coalesce(s.regulator_count,0),'first_date',s.first_event_date,'last_date',s.last_event_date,'regulators',coalesce(to_jsonb(s.regulators),'[]'::jsonb),'amount_uf',coalesce(s.amount_uf_total,0),'amount_clp',coalesce(s.amount_clp_total,0)),
'economic',jsonb_build_object('activity_codes',ec.activity_codes,'activity_names',ec.activity_names,'latest_year',ec.sii_latest_year,'operational_scale',ec.operational_scale_band,'workers_band',ec.workers_band,'sales_percentile',ec.sales_band_percentile,'workers_percentile',ec.workers_percentile,'activity_changes',ec.main_activity_change_years),
'timeline',t.data,'timeline_note','La línea de tiempo sólo muestra hechos con fecha disponible. La inscripción UAF y la presencia en Registro 19.862 no se fechan si la fuente no publica una fecha verificable.','generic_detail',g.d
) end from entity e left join econ ec on true left join sanc s on true left join generic g on true left join timeline t on true;
$$;
revoke all on function public.obs_osfl_entity_detail(text) from public,anon;
grant execute on function public.obs_osfl_entity_detail(text) to authenticated,service_role;

-- Incluye el read model OSFL en el refresco gobernado del Observatorio.
create or replace function public.obs_refresh_full(p_snapshot_id text default null)
returns public.obs_snapshot
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.obs_snapshot;
  v_territory integer;
  v_sector integer;
  v_spend jsonb;
  v_uaf integer;
  v_attention integer;
  v_osfl integer;
begin
  v_row := public.obs_refresh_all(p_snapshot_id);
  v_territory := public.obs_refresh_territory(v_row.snapshot_id);
  v_sector := public.obs_refresh_sector(v_row.snapshot_id);
  v_spend := public.obs_refresh_spend(v_row.snapshot_id);
  v_uaf := public.obs_refresh_uaf(v_row.snapshot_id);
  v_attention := public.obs_refresh_uaf_attention();
  v_osfl := public.obs_refresh_osfl(v_row.snapshot_id);

  update public.obs_snapshot
     set row_counts = row_counts || jsonb_build_object(
       'obs_territory',case when v_territory>=0 then v_territory else (select count(*) from public.obs_territory) end,
       'obs_sector',v_sector,'territorio_actualizado',v_territory>=0,
       'obs_spend_finding',v_spend->'findings',
       'obs_spend_actor',(coalesce((v_spend->>'buyers')::int,0)+coalesce((v_spend->>'suppliers')::int,0)),
       'obs_spend_pair',v_spend->'pairs','obs_budget_signal',v_spend->'budget_signals','compras_disponibles',v_spend->'compras_disponibles',
       'obs_uaf_subject',v_uaf,'obs_uaf_evidence',(select count(*) from public.obs_uaf_evidence),'obs_uaf_atencion',v_attention,
       'obs_osfl_entity',v_osfl)
   where snapshot_id=v_row.snapshot_id
   returning * into v_row;
  return v_row;
end $$;

-- Población inicial. Los siguientes cortes entran por obs_refresh_full.
select public.obs_refresh_osfl(null);
