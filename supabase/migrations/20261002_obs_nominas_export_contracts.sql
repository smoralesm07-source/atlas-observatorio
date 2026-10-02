create or replace function public.obs_nomina_so_export(
  p_region text default null,
  p_sector text default null,
  p_activity text default null,
  p_date_field text default 'ANY',
  p_from date default null,
  p_to date default null,
  p_only_sanctions boolean default false,
  p_only_press boolean default false,
  p_only_state_supplier boolean default false,
  p_limit integer default 1000,
  p_offset integer default 0
) returns jsonb
language plpgsql stable security definer
set search_path to 'public','pg_temp'
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit,1000),1),1000);
  v_offset int := greatest(coalesce(p_offset,0),0);
  v_total bigint;
  v_rows jsonb;
begin
  if not exists (select 1 from public.aml_allowed_users au where au.user_id=auth.uid() and au.enabled) then
    raise exception 'Acceso no habilitado para Atlas Observatorio' using errcode='42501';
  end if;

  with filtered as (
    select s.*
    from public.obs_uaf_subject s
    where (nullif(trim(p_region),'') is null or s.region=trim(p_region))
      and (nullif(trim(p_sector),'') is null or s.uaf_sector=trim(p_sector))
      and (nullif(trim(p_activity),'') is null or coalesce(s.main_activity,'') ilike '%'||trim(p_activity)||'%' or coalesce(s.economic_sector,'') ilike '%'||trim(p_activity)||'%')
      and (not coalesce(p_only_sanctions,false) or coalesce(s.sanction_count,0)>0 or coalesce(s.sanction_evidence_count,0)>0)
      and (not coalesce(p_only_press,false) or coalesce(s.has_press,false) or coalesce(s.press_evidence_count,0)>0)
      and (not coalesce(p_only_state_supplier,false) or coalesce(s.is_state_supplier,false))
      and case upper(coalesce(p_date_field,'ANY'))
        when 'INICIO' then (p_from is null or s.sii_activity_start_date>=p_from) and (p_to is null or s.sii_activity_start_date<=p_to)
        when 'TERMINO' then (p_from is null or s.sii_termination_date>=p_from) and (p_to is null or s.sii_termination_date<=p_to)
        else true end
  ), paged as (
    select * from filtered order by name,rut limit v_limit offset v_offset
  )
  select (select count(*) from filtered), coalesce(jsonb_agg(jsonb_build_object(
    'rut',p.rut,'entity_id',p.entity_id,'name',p.name,'subject_nature',p.subject_nature,
    'uaf_sector',p.uaf_sector,'sii_status',p.sii_status,'activity_start_date',p.sii_activity_start_date,
    'termination_date',p.sii_termination_date,'economic_sector',p.economic_sector,'main_activity',p.main_activity,
    'sales_band',p.sales_band,'workers',p.workers,'region',p.region,'commune',p.commune,
    'is_osfl',p.is_osfl,'is_state_supplier',p.is_state_supplier,'sanction_count',p.sanction_count,
    'has_press',p.has_press,'press_evidence_count',p.press_evidence_count,'alert_count',p.alert_count
  ) order by p.name,p.rut),'[]'::jsonb)
  into v_total,v_rows from paged p;

  return jsonb_build_object('total',coalesce(v_total,0),'limit',v_limit,'offset',v_offset,'rows',v_rows);
end $$;

grant execute on function public.obs_nomina_so_export(text,text,text,text,date,date,boolean,boolean,boolean,integer,integer) to authenticated;

create or replace function public.obs_nomina_sii_export(
  p_region text default null,
  p_sector text default null,
  p_activity text default null,
  p_status text default null,
  p_date_field text default 'ANY',
  p_from date default null,
  p_to date default null,
  p_only_uaf boolean default false,
  p_only_sanctions boolean default false,
  p_limit integer default 1000,
  p_offset integer default 0
) returns jsonb
language plpgsql stable security definer
set search_path to 'public','pg_temp'
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit,1000),1),1000);
  v_offset int := greatest(coalesce(p_offset,0),0);
  v_total bigint;
  v_rows jsonb;
begin
  if not exists (select 1 from public.aml_allowed_users au where au.user_id=auth.uid() and au.enabled) then
    raise exception 'Acceso no habilitado para Atlas Observatorio' using errcode='42501';
  end if;

  with base as (
    select e.entity_id,e.rut,e.name,e.entity_type,e.is_uaf_observed,e.is_sanctioned,e.uaf_sector,
           t.current_status,t.main_activity,t.region,t.commune,t.activity_start_date,t.termination_date,
           t.sales_band_rank,t.workers_numeric,t.economic_sector
    from public.obs_entity e
    join public.aml_entity_tax_profile t on t.entity_id=e.entity_id
  ), filtered as (
    select * from base b
    where (nullif(trim(p_region),'') is null or b.region=trim(p_region))
      and (nullif(trim(p_sector),'') is null or b.economic_sector=trim(p_sector))
      and (nullif(trim(p_activity),'') is null or coalesce(b.main_activity,'') ilike '%'||trim(p_activity)||'%')
      and (nullif(trim(p_status),'') is null or b.current_status=trim(p_status))
      and (not coalesce(p_only_uaf,false) or b.is_uaf_observed)
      and (not coalesce(p_only_sanctions,false) or b.is_sanctioned)
      and case upper(coalesce(p_date_field,'ANY'))
        when 'INICIO' then (p_from is null or b.activity_start_date>=p_from) and (p_to is null or b.activity_start_date<=p_to)
        when 'TERMINO' then (p_from is null or b.termination_date>=p_from) and (p_to is null or b.termination_date<=p_to)
        else true end
  ), paged as (
    select * from filtered order by name,rut limit v_limit offset v_offset
  )
  select (select count(*) from filtered), coalesce(jsonb_agg(to_jsonb(p) order by p.name,p.rut),'[]'::jsonb)
  into v_total,v_rows from paged p;

  return jsonb_build_object('total',coalesce(v_total,0),'limit',v_limit,'offset',v_offset,'rows',v_rows);
end $$;

grant execute on function public.obs_nomina_sii_export(text,text,text,text,text,date,date,boolean,boolean,integer,integer) to authenticated;

create or replace function public.obs_nomina_press_export(
  p_region text default null,
  p_from date default null,
  p_to date default null,
  p_only_uaf boolean default false,
  p_only_sanctions boolean default false,
  p_limit integer default 1000,
  p_offset integer default 0
) returns jsonb
language plpgsql stable security definer
set search_path to 'public','pg_temp'
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit,1000),1),1000);
  v_offset int := greatest(coalesce(p_offset,0),0);
  v_total bigint;
  v_rows jsonb;
begin
  if not exists (select 1 from public.aml_allowed_users au where au.user_id=auth.uid() and au.enabled) then
    raise exception 'Acceso no habilitado para Atlas Observatorio' using errcode='42501';
  end if;

  with links as (
    select l.canonical_entity_id,l.canonical_rut,max(l.first_linked_at)::date first_linked_date,
           max(l.refreshed_at) last_linked_at,max(l.score) score,count(*) link_count
    from public.atlas_press_entity_link l
    where l.canonical_entity_id is not null
      and coalesce(l.requires_review,false)=false and coalesce(l.ambiguous,false)=false
      and upper(coalesce(l.link_status,'')) in ('RESOLVED','LINKED','CONFIRMED')
      and (p_from is null or l.first_linked_at::date>=p_from)
      and (p_to is null or l.first_linked_at::date<=p_to)
    group by l.canonical_entity_id,l.canonical_rut
  ), filtered as (
    select e.entity_id,coalesce(e.rut,l.canonical_rut) rut,e.name,e.entity_type,e.region,e.commune,e.uaf_sector,
           e.is_uaf_observed,e.is_sanctioned,l.first_linked_date,l.last_linked_at,l.score,l.link_count
    from links l join public.obs_entity e on e.entity_id=l.canonical_entity_id
    where (nullif(trim(p_region),'') is null or e.region=trim(p_region))
      and (not coalesce(p_only_uaf,false) or e.is_uaf_observed)
      and (not coalesce(p_only_sanctions,false) or e.is_sanctioned)
  ), paged as (
    select * from filtered order by first_linked_date desc,name limit v_limit offset v_offset
  )
  select (select count(*) from filtered),coalesce(jsonb_agg(to_jsonb(p) order by p.first_linked_date desc,p.name),'[]'::jsonb)
  into v_total,v_rows from paged p;
  return jsonb_build_object('total',coalesce(v_total,0),'limit',v_limit,'offset',v_offset,'rows',v_rows);
end $$;

grant execute on function public.obs_nomina_press_export(text,date,date,boolean,boolean,integer,integer) to authenticated;
