-- ATLAS Observatorio · OSFL · ampliación de identidad SII
--
-- Objetivo:
-- - conservar el universo OSFL ya corroborado por Atlas;
-- - incorporar entidades activas que SII clasifica en subtipos tributarios OSFL;
-- - exponer RUT + razón social con procedencia explícita;
-- - mantener separado el total agregado del Registro Civil de la identidad SII;
-- - habilitar ficha rápida y fallback a Entidad 360 federada para las nuevas entidades.

alter table public.obs_osfl_entity
  add column if not exists has_sii_identity boolean not null default false,
  add column if not exists identity_basis text not null default 'ATLAS_OSFL_PROFILE',
  add column if not exists confirmation_level text;

create index if not exists obs_osfl_entity_identity_basis_idx
  on public.obs_osfl_entity(identity_basis);
create index if not exists obs_osfl_entity_sii_identity_idx
  on public.obs_osfl_entity(has_sii_identity) where has_sii_identity;
create index if not exists obs_osfl_entity_priority_name_idx
  on public.obs_osfl_entity(has_sanctions desc,has_uaf_direct desc,public_funds desc,name);

create or replace function public.obs_refresh_osfl(p_snapshot_id text default null)
returns integer
language plpgsql
security definer
set search_path=pg_catalog,public,extensions,pg_temp
as $$
declare v_n integer;
begin
  truncate table public.obs_osfl_entity;

  insert into public.obs_osfl_entity (
    entity_id,rut,name,name_search,rut_search,osfl_type,region,commune,activity_group,main_activity,current_status,
    activity_start_date,termination_date,sii_year_count,sales_band,workers_numeric,registro19862,public_funds,
    transfer_count,transfer_amount_clp,uaf_class,uaf_label,uaf_sector,has_uaf_direct,has_uaf_potential,
    sanction_count,has_sanctions,source_count,refreshed_at,has_sii_identity,identity_basis,confirmation_level
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
    e.source_count,now(),
    exists(select 1 from public.aml_sii_registry_company sc where sc.entity_id=e.entity_id),
    'ATLAS_OSFL_PROFILE',e.confirmation_level
  from public.aml_osfl_entity_runtime_snapshot e
  left join public.aml_v_osfl_economic_profile_current_v0950 ep on ep.entity_id=e.entity_id
  left join public.aml_v_osfl_law19913_bridge_current b on b.entity_id=e.entity_id;

  insert into public.obs_osfl_entity (
    entity_id,rut,name,name_search,rut_search,osfl_type,region,commune,activity_group,main_activity,current_status,
    activity_start_date,termination_date,sii_year_count,sales_band,workers_numeric,registro19862,public_funds,
    transfer_count,transfer_amount_clp,uaf_class,uaf_label,uaf_sector,has_uaf_direct,has_uaf_potential,
    sanction_count,has_sanctions,source_count,refreshed_at,has_sii_identity,identity_basis,confirmation_level
  )
  select
    c.entity_id,c.rut,c.legal_name,
    public.obs_normalize_text(c.legal_name),regexp_replace(upper(c.rut),'[^0-9K]','','g'),
    case
      when upper(c.legal_name) like 'FUNDACI%' then 'Fundación'
      when upper(c.legal_name) like 'CORPORACI%' then 'Corporación'
      when upper(c.legal_name) like 'ASOCIACI%' then 'Asociación'
      when upper(c.legal_name) like 'ORGANIZACI%' or upper(c.legal_name) like 'ONG %' then 'Organización / ONG'
      when upper(c.legal_name) like 'CLUB %' then 'Club'
      when upper(c.legal_name) like 'SINDICATO %' then 'Sindicato'
      when upper(c.legal_name) like 'COMUNIDAD %' then 'Comunidad'
      when c.taxpayer_subtype_code='813' then 'Fundación'
      when c.taxpayer_subtype_code in ('814','819') then 'Corporación'
      when c.taxpayer_subtype_code='815' then 'Asociación'
      when c.taxpayer_subtype_code='816' then 'Sindicato'
      when c.taxpayer_subtype_code='812' then 'Club'
      else 'Otras'
    end,
    coalesce(t.region,a.region),coalesce(t.commune,a.commune),
    case c.taxpayer_subtype_code
      when '811' then 'Organizaciones comunitarias'
      when '812' then 'Clubes deportivos'
      when '813' then 'Fundaciones'
      when '814' then 'Corporaciones'
      when '815' then 'Asociaciones gremiales'
      when '816' then 'Sindicatos'
      when '818' then 'Otras OSFL'
      when '819' then 'Corporaciones educacionales'
      else 'OSFL'
    end,
    t.main_activity,c.current_status,c.activity_start_date,c.termination_date,
    case when exists(select 1 from public.aml_sii_entity_year y where y.entity_id=c.entity_id) then 1 else 0 end,
    t.sales_band,t.workers_numeric,false,false,0,0,
    case when u.rut is not null then 'DIRECT_OBLIGATED' end,
    case when u.rut is not null then 'SO registrado UAF' end,
    u.uaf_sector_canonical,
    (u.rut is not null),false,0,false,
    1 + case when u.rut is not null then 1 else 0 end,
    coalesce(c.refreshed_at,now()),true,'SII_OSFL_ACTIVE','SII_CLASSIFIED_ACTIVE'
  from public.aml_sii_registry_company c
  left join public.aml_entity_tax_profile t on t.entity_id=c.entity_id
  left join public.aml_entities a on a.entity_id=c.entity_id
  left join lateral (
    select x.rut,x.uaf_sector_canonical
    from public.aml_uaf_obligated_subject_snapshot x
    where x.rut=c.rut
    limit 1
  ) u on true
  where c.current_status='ACTIVE_AS_PUBLISHED'
    and c.taxpayer_subtype_code in ('811','812','813','814','815','816','818','819')
    and upper(btrim(c.legal_name)) not in ('RUT PRUEBA E RUT','RUT DE PRUEBA','PRUEBA','TEST')
    and not exists(select 1 from public.obs_osfl_entity o where o.entity_id=c.entity_id);

  get diagnostics v_n=row_count;
  select count(*)::integer into v_n from public.obs_osfl_entity;
  analyze public.obs_osfl_entity;
  return v_n;
end $$;
revoke all on function public.obs_refresh_osfl(text) from public,anon,authenticated;
grant execute on function public.obs_refresh_osfl(text) to service_role;

create or replace function public.obs_osfl_dashboard()
returns jsonb language sql stable security invoker set search_path=public,extensions,pg_temp as $$
with allowed as (
  select exists(select 1 from public.aml_allowed_users au where au.user_id=(select auth.uid()) and au.enabled) ok
),
monitor as (select m.* from public.aml_v_osfl_national_monitor_current m,allowed a where a.ok limit 1),
entity_stats as (
  select count(*)::bigint observed,
         count(*) filter(where rut is not null and btrim(rut)<>'')::bigint rutified,
         count(*) filter(where has_sii_identity)::bigint sii_identified,
         count(*) filter(where identity_basis='ATLAS_OSFL_PROFILE')::bigint corroborated,
         count(*) filter(where identity_basis='SII_OSFL_ACTIVE')::bigint sii_only,
         count(*) filter(where coalesce(sii_year_count,0)>0)::bigint sii_history,
         count(*) filter(where registro19862)::bigint registro19862,
         count(*) filter(where has_sanctions)::bigint sanctioned,
         count(*) filter(where region is not null)::bigint with_region,
         count(*) filter(where public_funds)::bigint public_funds
  from public.obs_osfl_entity
),
bridge_stats as (
  select count(*) filter(where has_uaf_direct)::bigint direct_uaf,
         count(*) filter(where has_uaf_potential)::bigint potential_uaf
  from public.obs_osfl_entity
),
type_counts as (select osfl_type,count(*)::bigint entity_count from public.obs_osfl_entity group by osfl_type),
activity_counts as (select main_activity label,count(*)::bigint entity_count from public.obs_osfl_entity where main_activity is not null group by main_activity),
region_counts as (select coalesce(region,'Sin región observada') label,count(*)::bigint entity_count from public.obs_osfl_entity group by coalesce(region,'Sin región observada')),
filter_regions as (select distinct region from public.obs_osfl_entity where region is not null order by region),
filter_activities as (select distinct main_activity from public.obs_osfl_entity where main_activity is not null order by main_activity),
evolution as (
  select g.year,g.stock_year_end,g.starts,g.terminations,g.growth_pct,g.series_eligible_count,g.observed_universe
  from public.aml_v_osfl_growth_yearly_current g,allowed a
  where a.ok and g.scope='CHILE' and g.region is null and g.year between 2015 and g.last_complete_year
  order by g.year
)
select case when a.ok then jsonb_build_object(
'national',jsonb_build_object(
  'official_total',coalesce(m.official_active_total,0),
  'official_snapshot_date',m.legal_snapshot_date,
  'official_source',m.source_name,
  'official_loaded_rows',coalesce(m.loaded_rows,0),
  'observed',coalesce(es.observed,0),
  'rutified',coalesce(es.rutified,0),
  'rutified_pct',case when coalesce(es.observed,0)=0 then 0 else round(100.0*es.rutified/es.observed,2) end,
  'coverage_pct',case when coalesce(es.observed,0)=0 then 0 else round(100.0*es.rutified/es.observed,2) end,
  'sii_identified',coalesce(es.sii_identified,0),
  'corroborated',coalesce(es.corroborated,0),
  'sii_only',coalesce(es.sii_only,0),
  'sii_history',coalesce(es.sii_history,0),
  'direct_uaf',coalesce(bs.direct_uaf,0),
  'potential_uaf',coalesce(bs.potential_uaf,0),
  'law19913_bridge',coalesce(bs.direct_uaf,0)+coalesce(bs.potential_uaf,0),
  'registro19862',coalesce(es.registro19862,0),
  'sanctioned',coalesce(es.sanctioned,0),
  'public_funds',coalesce(es.public_funds,0),
  'with_region',coalesce(es.with_region,0),
  'refreshed_at',now()
),
'sources',jsonb_build_array(
  jsonb_build_object('code','RC','label','Registro Civil','role','Universo nacional legal de referencia','volume',coalesce(m.official_active_total,0),'detail','Total agregado de referencia al corte publicado. La nómina individual del Registro Civil aún no está cargada fila a fila, por lo que no se usa para afirmar coincidencia registral individual.'),
  jsonb_build_object('code','SII','label','SII','role','Identidad tributaria: RUT, razón social y clasificación OSFL','volume',coalesce(es.sii_identified,0),'detail','Entidades individualizadas por RUT en padrones SII. Incluye OSFL activas clasificadas en subtipos tributarios 811, 812, 813, 814, 815, 816, 818 y 819.'),
  jsonb_build_object('code','UAF','label','UAF / Ley 19.913','role','Puente regulatorio: SO registrados y potenciales sujetos','volume',coalesce(bs.direct_uaf,0)+coalesce(bs.potential_uaf,0),'detail',coalesce(bs.direct_uaf,0)::text||' SO registrados + '||coalesce(bs.potential_uaf,0)::text||' potenciales.'),
  jsonb_build_object('code','19862','label','Registro 19.862','role','Presencia en registro de receptores de fondos públicos','volume',coalesce(es.registro19862,0),'detail','Cruce disponible para el universo corroborado por las fuentes actuales.'),
  jsonb_build_object('code','SANC','label','Sanciones','role','Antecedentes sancionatorios publicados por supervisores','volume',coalesce(es.sanctioned,0),'detail','Cruce con el dossier sancionatorio vigente.')
),
'types',(select coalesce(jsonb_agg(jsonb_build_object('label',osfl_type,'count',entity_count) order by entity_count desc),'[]'::jsonb) from type_counts),
'activities',(select coalesce(jsonb_agg(jsonb_build_object('label',label,'count',entity_count) order by entity_count desc),'[]'::jsonb) from (select * from activity_counts order by entity_count desc limit 6) q),
'regions',(select coalesce(jsonb_agg(jsonb_build_object('label',label,'count',entity_count) order by entity_count desc),'[]'::jsonb) from (select * from region_counts order by entity_count desc limit 6) q),
'evolution',(select coalesce(jsonb_agg(jsonb_build_object('year',year,'stock',stock_year_end,'starts',starts,'terminations',terminations,'growth_pct',growth_pct,'eligible',series_eligible_count,'observed',observed_universe) order by year),'[]'::jsonb) from evolution),
'filters',jsonb_build_object(
  'regions',(select coalesce(jsonb_agg(region order by region),'[]'::jsonb) from filter_regions),
  'activities',(select coalesce(jsonb_agg(main_activity order by main_activity),'[]'::jsonb) from filter_activities),
  'types',(select coalesce(jsonb_agg(osfl_type order by osfl_type),'[]'::jsonb) from (select distinct osfl_type from public.obs_osfl_entity) q)
),
'semantics',jsonb_build_object(
  'official_universe','El total del Registro Civil es una referencia nacional agregada con fecha de corte propia. No se calcula una tasa de coincidencia RC↔SII hasta disponer de la nómina individual del Registro Civil.',
  'observed_universe','Universo individualizado por ATLAS: une OSFL corroboradas previamente con entidades activas que SII clasifica en subtipos tributarios de OSFL. Todas se presentan con RUT y procedencia explícita.',
  'type_inference','La tipología visible se infiere por denominación y, cuando corresponde, por subtipo tributario SII. No equivale a una certificación jurídica de tipo del Registro Civil.',
  'evolution','La serie histórica conserva el subuniverso con fechas e historial suficientes; no reconstruye históricamente el total legal del Registro Civil ni la totalidad del nuevo universo SII.'
)
) else jsonb_build_object('error','NOT_AUTHORIZED') end
from allowed a
left join monitor m on true
left join entity_stats es on true
left join bridge_stats bs on true;
$$;
revoke all on function public.obs_osfl_dashboard() from public,anon;
grant execute on function public.obs_osfl_dashboard() to authenticated,service_role;

create or replace function public.obs_osfl_search(
  p_q text default null,p_region text default null,p_type text default null,p_activity text default null,
  p_source text default null,p_uaf text default null,p_public_funds text default null,p_sanctions text default null,
  p_limit integer default 25,p_offset integer default 0
)
returns jsonb language sql stable security invoker set search_path=public,extensions,pg_temp as $$
with search_params as (
  select nullif(public.obs_normalize_text(btrim(p_q)), '') as q_name,
         nullif(regexp_replace(upper(btrim(p_q)), '[^0-9K]', '', 'g'), '') as q_rut
), filtered as (
  select x.*
  from public.obs_osfl_entity x cross join search_params q
  where (
      p_q is null or btrim(p_q)=''
      or (q.q_name is not null and x.name_search like '%'||q.q_name||'%')
      or (q.q_rut is not null and x.rut_search like '%'||q.q_rut||'%')
    )
    and (p_region is null or p_region='' or x.region=p_region)
    and (p_type is null or p_type='' or x.osfl_type=p_type)
    and (p_activity is null or p_activity='' or x.main_activity=p_activity)
    and (p_source is null or p_source=''
      or (p_source='SII' and x.has_sii_identity)
      or (p_source='UAF' and (x.has_uaf_direct or x.has_uaf_potential))
      or (p_source='19862' and x.registro19862)
      or (p_source='SANCIONES' and x.has_sanctions))
    and (p_uaf is null or p_uaf='' or p_uaf='TODAS'
      or (p_uaf='DIRECTA' and x.has_uaf_direct)
      or (p_uaf='POTENCIAL' and x.has_uaf_potential)
      or (p_uaf='SIN_PUENTE' and not x.has_uaf_direct and not x.has_uaf_potential))
    and (p_public_funds is null or p_public_funds='' or p_public_funds='TODOS'
      or (p_public_funds='SI' and x.public_funds)
      or (p_public_funds='NO' and not x.public_funds))
    and (p_sanctions is null or p_sanctions='' or p_sanctions='TODAS'
      or (p_sanctions='SI' and x.has_sanctions)
      or (p_sanctions='NO' and not x.has_sanctions))
), page as (
  select * from filtered
  order by has_sanctions desc,has_uaf_direct desc,public_funds desc,name asc
  limit greatest(1,least(coalesce(p_limit,25),100)) offset greatest(coalesce(p_offset,0),0)
)
select jsonb_build_object(
  'total',(select count(*) from filtered),
  'limit',greatest(1,least(coalesce(p_limit,25),100)),
  'offset',greatest(coalesce(p_offset,0),0),
  'rows',coalesce((select jsonb_agg(jsonb_build_object(
    'entity_id',entity_id,'rut',rut,'name',name,'type',osfl_type,'region',region,'commune',commune,
    'activity_group',activity_group,'main_activity',main_activity,'status',current_status,
    'identity_basis',identity_basis,'confirmation_level',confirmation_level,
    'sources',jsonb_strip_nulls(jsonb_build_object(
      'SII',case when has_sii_identity then true end,
      'UAF',case when has_uaf_direct then true end,
      'POTENTIAL_UAF',case when has_uaf_potential then true end,
      '19862',case when registro19862 then true end,
      'SANCIONES',case when has_sanctions then true end
    )),
    'uaf_class',uaf_class,'uaf_label',uaf_label,'uaf_sector',uaf_sector,
    'public_funds',public_funds,'transfer_count',transfer_count,'transfer_amount_clp',transfer_amount_clp,
    'sanctions',has_sanctions,'sanction_count',sanction_count,'source_count',source_count,
    'activity_start_date',activity_start_date,'termination_date',termination_date
  ) order by has_sanctions desc,has_uaf_direct desc,public_funds desc,name asc) from page),'[]'::jsonb)
);
$$;
revoke all on function public.obs_osfl_search(text,text,text,text,text,text,text,text,integer,integer) from public,anon;
grant execute on function public.obs_osfl_search(text,text,text,text,text,text,text,text,integer,integer) to authenticated,service_role;

create or replace function public.obs_osfl_entity_detail(p_entity_id text)
returns jsonb
language sql
stable
set search_path to 'public','extensions','pg_temp'
as $$
with entity as (
  select e.* from public.obs_osfl_entity e where e.entity_id=p_entity_id
),
econ as (select ep.* from public.aml_v_osfl_economic_profile_current_v0950 ep where ep.entity_id=p_entity_id limit 1),
bridge as (select b.* from public.aml_v_osfl_law19913_bridge_current b where b.entity_id=p_entity_id limit 1),
sanc as (select s.* from public.aml_v_sanctions_entity_dossier_current_v0960 s where s.entity_id=p_entity_id and s.is_osfl_observed limit 1),
sii as (select exists(select 1 from public.aml_sii_registry_company c where c.entity_id=p_entity_id) reconciled),
generic as (select public.obs_entity_detail(p_entity_id) d),
timeline_rows as (
  select nullif(x->>'fecha','')::date event_date,
         coalesce(x->>'etiqueta',x->>'kind','Hito') label,
         coalesce(x->>'fuente','Atlas') source,
         nullif(x->>'detalle','') detail,
         coalesce(x->>'kind','HITO') kind
  from generic g,lateral jsonb_array_elements(coalesce(g.d->'lifecycle','[]'::jsonb)) x
  union all
  select ec.first_transfer_date,'Primera transferencia pública confirmada','Registro 19.862 / fuente de transferencias',case when ec.confirmed_transfer_count>0 then ec.confirmed_transfer_count::text||' transferencia(s) confirmada(s)' end,'FONDOS_PUBLICOS'
  from econ ec where ec.first_transfer_date is not null
  union all
  select s.first_event_date,'Primer antecedente sancionatorio',coalesce(array_to_string(s.regulators,', '),'Supervisor'),case when s.event_count>0 then s.event_count::text||' evento(s) sancionatorio(s) observado(s)' end,'SANCION'
  from sanc s where s.first_event_date is not null
),
timeline as (
  select coalesce(jsonb_agg(jsonb_build_object('date',event_date,'label',label,'source',source,'detail',detail,'kind',kind) order by event_date,label),'[]'::jsonb) data
  from (select distinct event_date,label,source,detail,kind from timeline_rows where event_date is not null) q
)
select case when e.entity_id is null then null else jsonb_build_object(
  'entity',jsonb_build_object(
    'entity_id',e.entity_id,'rut',e.rut,'name',e.name,'type',e.osfl_type,'region',e.region,'commune',e.commune,
    'activity_group',e.activity_group,'main_activity',coalesce(ec.main_activity,e.main_activity),'status',e.current_status,
    'activity_start_date',coalesce(ec.activity_start_date,e.activity_start_date),'termination_date',coalesce(ec.termination_date,e.termination_date),
    'sales_band',coalesce(ec.sales_band_label,e.sales_band),'size_class',ec.sii_size_class,'workers',coalesce(ec.workers_numeric,e.workers_numeric),'source_count',e.source_count
  ),
  'identity',jsonb_build_object('basis',e.identity_basis,'confirmation_level',e.confirmation_level,'rutified',e.rut is not null),
  'sources',jsonb_build_object(
    'SII',coalesce(si.reconciled,false),
    'SII_HISTORY',coalesce(e.sii_year_count,0)>0,
    'UAF_DIRECT',coalesce(b.bridge_class='DIRECT_OBLIGATED',e.has_uaf_direct,false),
    'UAF_POTENTIAL',coalesce(b.bridge_class='POTENTIAL_SUBJECT',e.has_uaf_potential,false),
    'REGISTRO_19862',coalesce(e.registro19862,false),
    'SANCIONES',coalesce(s.event_count,0)>0,
    'FONDOS_PUBLICOS',coalesce(ec.transfer_received_confirmed,false)
  ),
  'uaf',jsonb_build_object(
    'class',coalesce(b.bridge_class,e.uaf_class),
    'label',coalesce(b.bridge_label,e.uaf_label),
    'sector',coalesce(b.direct_uaf_sector,b.potential_uaf_sector,e.uaf_sector),
    'semantics',b.bridge_semantics
  ),
  'public_funds',jsonb_build_object(
    'confirmed',coalesce(ec.transfer_received_confirmed,false),
    'transfer_count',coalesce(ec.confirmed_transfer_count,0),
    'funder_count',coalesce(ec.public_funder_count,0),
    'amount_clp',coalesce(ec.confirmed_transfer_amount_clp,0),
    'first_date',ec.first_transfer_date,'last_date',ec.last_transfer_date
  ),
  'sanctions',jsonb_build_object(
    'event_count',coalesce(s.event_count,0),
    'regulator_count',coalesce(s.regulator_count,0),
    'first_date',s.first_event_date,'last_date',s.last_event_date,
    'regulators',coalesce(to_jsonb(s.regulators),'[]'::jsonb),
    'amount_uf',coalesce(s.amount_uf_total,0),'amount_clp',coalesce(s.amount_clp_total,0)
  ),
  'economic',jsonb_build_object(
    'activity_codes',ec.activity_codes,'activity_names',ec.activity_names,'latest_year',ec.sii_latest_year,
    'operational_scale',ec.operational_scale_band,'workers_band',ec.workers_band,
    'sales_percentile',ec.sales_band_percentile,'workers_percentile',ec.workers_percentile,
    'activity_changes',ec.main_activity_change_years,
    'has_annual_history',coalesce(e.sii_year_count,0)>0,'annual_year_count',coalesce(e.sii_year_count,0)
  ),
  'timeline',t.data,
  'timeline_note','La línea de tiempo sólo muestra hechos con fecha disponible. Para entidades incorporadas desde SII, la identificación tributaria no equivale por sí sola a una coincidencia individual con el Registro Civil.',
  'generic_detail',g.d
) end
from entity e
left join econ ec on true
left join bridge b on true
left join sanc s on true
left join sii si on true
left join generic g on true
left join timeline t on true;
$$;
revoke all on function public.obs_osfl_entity_detail(text) from public,anon;
grant execute on function public.obs_osfl_entity_detail(text) to authenticated,service_role;
