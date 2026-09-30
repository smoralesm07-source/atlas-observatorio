alter table public.obs_osfl_entity
  add column if not exists public_funds_payer_count integer not null default 0,
  add column if not exists public_funds_first_seen date,
  add column if not exists public_funds_last_seen date,
  add column if not exists public_funds_snapshot_id text;

update public.obs_osfl_entity e
set public_funds_payer_count = pf.payer_count,
    public_funds_first_seen = pf.first_seen,
    public_funds_last_seen = pf.last_seen,
    public_funds_snapshot_id = pf.source_snapshot_id
from atlas_private.obs_public_funds_recipient_entity pf
where pf.rut = e.rut
  and e.public_funds;

create or replace function public.obs_refresh_osfl(p_snapshot_id text default null::text)
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog','public','extensions','pg_temp'
as $$
declare v_n integer;
begin
  truncate table public.obs_osfl_entity;

  insert into public.obs_osfl_entity (
    entity_id,rut,name,name_search,rut_search,osfl_type,region,commune,activity_group,main_activity,current_status,
    activity_start_date,termination_date,sii_year_count,sales_band,workers_numeric,registro19862,public_funds,
    transfer_count,transfer_amount_clp,public_funds_payer_count,public_funds_first_seen,public_funds_last_seen,public_funds_snapshot_id,
    uaf_class,uaf_label,uaf_sector,has_uaf_direct,has_uaf_potential,
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
    e.sii_year_count,e.sales_band,e.workers_numeric,coalesce(e.registro19862,false),(pf.rut is not null),
    coalesce(pf.transaction_count,0),coalesce(pf.amount_total,0),coalesce(pf.payer_count,0),pf.first_seen,pf.last_seen,pf.source_snapshot_id,
    b.bridge_class,b.bridge_label,
    coalesce(b.direct_uaf_sector,b.potential_uaf_sector),coalesce(b.bridge_class='DIRECT_OBLIGATED',false),
    coalesce(b.bridge_class='POTENTIAL_SUBJECT',false),coalesce(e.sanction_count,0),coalesce(e.sanction_count,0)>0,
    e.source_count,now(),
    exists(select 1 from public.aml_sii_registry_company sc where sc.entity_id=e.entity_id),
    'ATLAS_OSFL_PROFILE',e.confirmation_level
  from public.aml_osfl_entity_runtime_snapshot e
  left join public.aml_v_osfl_law19913_bridge_current b on b.entity_id=e.entity_id
  left join atlas_private.obs_public_funds_recipient_entity pf on pf.rut=e.rut;

  insert into public.obs_osfl_entity (
    entity_id,rut,name,name_search,rut_search,osfl_type,region,commune,activity_group,main_activity,current_status,
    activity_start_date,termination_date,sii_year_count,sales_band,workers_numeric,registro19862,public_funds,
    transfer_count,transfer_amount_clp,public_funds_payer_count,public_funds_first_seen,public_funds_last_seen,public_funds_snapshot_id,
    uaf_class,uaf_label,uaf_sector,has_uaf_direct,has_uaf_potential,
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
    t.sales_band,t.workers_numeric,false,(pf.rut is not null),coalesce(pf.transaction_count,0),coalesce(pf.amount_total,0),
    coalesce(pf.payer_count,0),pf.first_seen,pf.last_seen,pf.source_snapshot_id,
    case when u.rut is not null then 'DIRECT_OBLIGATED' end,
    case when u.rut is not null then 'SO registrado UAF' end,
    u.uaf_sector_canonical,
    (u.rut is not null),false,0,false,
    1 + case when u.rut is not null then 1 else 0 end + case when pf.rut is not null then 1 else 0 end,
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
  left join atlas_private.obs_public_funds_recipient_entity pf on pf.rut=c.rut
  where c.current_status='ACTIVE_AS_PUBLISHED'
    and c.taxpayer_subtype_code in ('811','812','813','814','815','816','818','819')
    and upper(btrim(c.legal_name)) not in ('RUT PRUEBA E RUT','RUT DE PRUEBA','PRUEBA','TEST')
    and not exists(select 1 from public.obs_osfl_entity o where o.entity_id=c.entity_id);

  select count(*)::integer into v_n from public.obs_osfl_entity;
  analyze public.obs_osfl_entity;
  return v_n;
end;
$$;

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
  select nullif(x->>'fecha','')::date event_date,coalesce(x->>'etiqueta',x->>'kind','Hito') label,coalesce(x->>'fuente','Atlas') source,nullif(x->>'detalle','') detail,coalesce(x->>'kind','HITO') kind
  from generic g,lateral jsonb_array_elements(coalesce(g.d->'lifecycle','[]'::jsonb)) x
  union all
  select e.public_funds_first_seen,'Primera transferencia pública observada','Presupuesto Abierto',
    e.transfer_count::text||' registro(s) · $'||to_char(e.transfer_amount_clp,'FM999G999G999G999G990'),'FONDOS_PUBLICOS'
  from entity e where e.public_funds_first_seen is not null
  union all
  select s.first_event_date,'Primer antecedente sancionatorio',coalesce(array_to_string(s.regulators,', '),'Supervisor'),case when s.event_count>0 then s.event_count::text||' evento(s) sancionatorio(s) observado(s)' end,'SANCION' from sanc s where s.first_event_date is not null
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
    'FONDOS_PUBLICOS',coalesce(e.public_funds,false)
  ),
  'uaf',jsonb_build_object('class',coalesce(b.bridge_class,e.uaf_class),'label',coalesce(b.bridge_label,e.uaf_label),'sector',coalesce(b.direct_uaf_sector,b.potential_uaf_sector,e.uaf_sector),'semantics',b.bridge_semantics),
  'public_funds',jsonb_build_object(
    'confirmed',coalesce(e.public_funds,false),
    'transfer_count',coalesce(e.transfer_count,0),
    'funder_count',coalesce(e.public_funds_payer_count,0),
    'amount_clp',coalesce(e.transfer_amount_clp,0),
    'first_date',e.public_funds_first_seen,
    'last_date',e.public_funds_last_seen,
    'source','Presupuesto Abierto'
  ),
  'sanctions',jsonb_build_object('event_count',coalesce(s.event_count,0),'regulator_count',coalesce(s.regulator_count,0),'first_date',s.first_event_date,'last_date',s.last_event_date,'regulators',coalesce(to_jsonb(s.regulators),'[]'::jsonb),'amount_uf',coalesce(s.amount_uf_total,0),'amount_clp',coalesce(s.amount_clp_total,0)),
  'economic',jsonb_build_object('activity_codes',ec.activity_codes,'activity_names',ec.activity_names,'latest_year',ec.sii_latest_year,'operational_scale',ec.operational_scale_band,'workers_band',ec.workers_band,'sales_percentile',ec.sales_band_percentile,'workers_percentile',ec.workers_percentile,'activity_changes',ec.main_activity_change_years,'has_annual_history',coalesce(e.sii_year_count,0)>0,'annual_year_count',coalesce(e.sii_year_count,0)),
  'timeline',t.data,
  'timeline_note','La línea de tiempo sólo muestra hechos con fecha disponible. Las transferencias públicas corresponden a registros de Presupuesto Abierto observados como receptor; no incluyen por sí solas pagos por compras públicas.',
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