create table if not exists atlas_private.obs_public_funds_recipient_entity (
  rut text primary key,
  amount_total numeric not null default 0,
  transaction_count bigint not null default 0,
  payer_count integer not null default 0,
  first_seen date,
  last_seen date,
  source_snapshot_id text not null,
  refreshed_at timestamptz not null default now()
);

create index if not exists obs_public_funds_recipient_last_seen_idx
  on atlas_private.obs_public_funds_recipient_entity (last_seen desc);

create or replace function atlas_private.obs_refresh_public_funds_recipient_entity(p_snapshot_id text)
returns bigint
language plpgsql
security definer
set search_path = 'pg_catalog','public','atlas_private','pg_temp'
as $$
declare
  v_rows bigint;
begin
  if p_snapshot_id is null or btrim(p_snapshot_id) = '' then
    raise exception 'snapshot id required';
  end if;

  delete from atlas_private.obs_public_funds_recipient_entity;

  insert into atlas_private.obs_public_funds_recipient_entity
    (rut,amount_total,transaction_count,payer_count,first_seen,last_seen,source_snapshot_id,refreshed_at)
  select
    p.rut,
    sum(p.amount) as amount_total,
    sum(p.transaction_count)::bigint as transaction_count,
    count(distinct p.payer_key)::integer as payer_count,
    min(p.first_seen) as first_seen,
    max(p.last_seen) as last_seen,
    p_snapshot_id,
    now()
  from public.obs_public_funds_payer_year p
  where p.source_snapshot_id = p_snapshot_id
    and p.role = 'RECIPIENT'
    and p.rut is not null
    and btrim(p.rut) <> ''
  group by p.rut;

  get diagnostics v_rows = row_count;
  analyze atlas_private.obs_public_funds_recipient_entity;
  return v_rows;
end;
$$;

revoke all on function atlas_private.obs_refresh_public_funds_recipient_entity(text) from public;

create or replace function public.obs_public_funds_finalize(p_snapshot_id text)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare
  v_state public.obs_public_funds_ingest_state%rowtype;
  v_entity bigint;
  v_year bigint;
  v_payer bigint;
  v_recipient bigint;
begin
  if p_snapshot_id is null or btrim(p_snapshot_id) = '' then
    raise exception 'snapshot id required';
  end if;
  perform pg_advisory_xact_lock(hashtext('obs_public_funds_finalize'));

  select * into v_state
  from public.obs_public_funds_ingest_state
  where snapshot_id = p_snapshot_id
  for update;
  if not found then raise exception 'unknown snapshot %', p_snapshot_id; end if;

  select count(*) into v_entity from public.obs_public_funds_entity_stage where snapshot_id=p_snapshot_id;
  select count(*) into v_year from public.obs_public_funds_year_stage where snapshot_id=p_snapshot_id;
  select count(*) into v_payer from public.obs_public_funds_payer_year_stage where snapshot_id=p_snapshot_id;

  if v_entity <> v_state.expected_entity or v_year <> v_state.expected_year or v_payer <> v_state.expected_payer_year then
    raise exception 'incomplete snapshot %: entity %/%, year %/%, payer %/%', p_snapshot_id,
      v_entity,v_state.expected_entity,v_year,v_state.expected_year,v_payer,v_state.expected_payer_year;
  end if;
  if v_entity = 0 then raise exception 'empty public funds snapshot rejected'; end if;

  delete from public.obs_public_funds_payer_year where true;
  delete from public.obs_public_funds_year where true;
  delete from public.obs_public_funds_entity where true;

  insert into public.obs_public_funds_entity
    (rut,entity_id,amount_total,amount_12m,amount_36m,transaction_count,payer_count,first_seen,last_seen,top_payer_key,top_payer_name,top_payer_amount,source_snapshot_id,source_status,refreshed_at)
  select rut,entity_id,amount_total,amount_12m,amount_36m,transaction_count,payer_count,first_seen,last_seen,top_payer_key,top_payer_name,top_payer_amount,p_snapshot_id,'READY',now()
  from public.obs_public_funds_entity_stage where snapshot_id=p_snapshot_id;

  insert into public.obs_public_funds_year
    (rut,entity_id,period_year,amount_total,amount_transfer,amount_supplier,payer_count,transaction_count,top_payer_key,top_payer_name,top_payer_amount,source_snapshot_id,refreshed_at)
  select rut,entity_id,period_year,amount_total,amount_transfer,amount_supplier,payer_count,transaction_count,top_payer_key,top_payer_name,top_payer_amount,p_snapshot_id,now()
  from public.obs_public_funds_year_stage where snapshot_id=p_snapshot_id;

  insert into public.obs_public_funds_payer_year
    (rut,entity_id,payer_key,payer_name,period_year,role,amount,transaction_count,first_seen,last_seen,source_snapshot_id,refreshed_at)
  select rut,entity_id,payer_key,payer_name,period_year,role,amount,transaction_count,first_seen,last_seen,p_snapshot_id,now()
  from public.obs_public_funds_payer_year_stage where snapshot_id=p_snapshot_id;

  v_recipient := atlas_private.obs_refresh_public_funds_recipient_entity(p_snapshot_id);

  insert into public.obs_state_relation_refresh(source_code,source_snapshot_id,status,row_count,refreshed_at,error_detail)
  values ('PRESUPUESTO_ABIERTO',p_snapshot_id,'READY',v_entity,now(),null)
  on conflict (source_code) do update set
    source_snapshot_id=excluded.source_snapshot_id,status='READY',row_count=excluded.row_count,refreshed_at=excluded.refreshed_at,error_detail=null;

  update public.obs_public_funds_ingest_state set status='READY',finalized_at=now() where snapshot_id=p_snapshot_id;

  delete from public.obs_public_funds_entity_stage where snapshot_id<>p_snapshot_id and refreshed_at < now()-interval '2 days';
  delete from public.obs_public_funds_year_stage where snapshot_id<>p_snapshot_id and refreshed_at < now()-interval '2 days';
  delete from public.obs_public_funds_payer_year_stage where snapshot_id<>p_snapshot_id and refreshed_at < now()-interval '2 days';

  return jsonb_build_object('ok',true,'snapshot_id',p_snapshot_id,'entities',v_entity,'years',v_year,'payer_years',v_payer,'recipients',v_recipient);
end;
$$;

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
    e.sii_year_count,e.sales_band,e.workers_numeric,coalesce(e.registro19862,false),(pf.rut is not null),
    coalesce(pf.transaction_count,0),coalesce(pf.amount_total,0),b.bridge_class,b.bridge_label,
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
    t.sales_band,t.workers_numeric,false,(pf.rut is not null),coalesce(pf.transaction_count,0),coalesce(pf.amount_total,0),
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

  get diagnostics v_n=row_count;
  select count(*)::integer into v_n from public.obs_osfl_entity;
  analyze public.obs_osfl_entity;
  return v_n;
end;
$$;

create index if not exists obs_osfl_entity_public_funds_idx
  on public.obs_osfl_entity (transfer_amount_clp desc, name)
  where public_funds;

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
pf as (
  select r.*
  from entity e
  join atlas_private.obs_public_funds_recipient_entity r on r.rut=e.rut
  limit 1
),
generic as (select public.obs_entity_detail(p_entity_id) d),
timeline_rows as (
  select nullif(x->>'fecha','')::date event_date,coalesce(x->>'etiqueta',x->>'kind','Hito') label,coalesce(x->>'fuente','Atlas') source,nullif(x->>'detalle','') detail,coalesce(x->>'kind','HITO') kind
  from generic g,lateral jsonb_array_elements(coalesce(g.d->'lifecycle','[]'::jsonb)) x
  union all
  select pf.first_seen,'Primera transferencia pública observada','Presupuesto Abierto',
    pf.transaction_count::text||' registro(s) · $'||to_char(pf.amount_total,'FM999G999G999G999G990'),'FONDOS_PUBLICOS'
  from pf where pf.first_seen is not null
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
    'funder_count',coalesce(pf.payer_count,0),
    'amount_clp',coalesce(e.transfer_amount_clp,0),
    'first_date',pf.first_seen,
    'last_date',pf.last_seen,
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
left join pf on true
left join generic g on true
left join timeline t on true;
$$;
