create or replace function public.aml_fintech_enrichment_batch(p_limit integer default 20)
returns jsonb
language sql
stable security definer
set search_path to 'public','pg_temp'
as $function$
with lim as (
  select greatest(1,least(coalesce(p_limit,20),40))::int n
), cand as (
  select 'CANDIDATE'::text subject_type,c.candidate_id::text subject_key,c.name_raw display_name,c.rut_raw rut,c.website,c.domain,c.source_code,c.source_url,c.enrichment_refreshed_at refreshed_at,2 priority
  from public.aml_fintech_candidate c
  where c.matched_fintech_id is null
    and c.website is not null and btrim(c.website)<>''
    and (
      c.source_code not in ('FINTECHILE_MEMBERS','LATAMFINTECH_CHILE')
      or exists (
        select 1 from public.aml_v_fintech_ecosystem_semantic_current s
        where s.candidate_id=c.candidate_id and s.semantic_stage like 'OPEN_%'
      )
    )
  order by c.enrichment_refreshed_at asc nulls first,c.name_raw
  limit greatest(1,ceil((select n from lim)*0.25)::int)
), ent as (
  select 'ENTITY'::text subject_type,e.fintech_id subject_key,coalesce(e.brand,e.legal_name) display_name,e.rut,e.website,null::text domain,'COMPANY_WEB'::text source_code,e.website source_url,e.profile_refreshed_at refreshed_at,1 priority
  from public.aml_fintech_entity e
  where e.website is not null and btrim(e.website)<>''
  order by
    case when e.business_model is null or e.target_customer is null or e.revenue_model is null then 0 else 1 end,
    e.profile_refreshed_at asc nulls first,
    display_name
  limit greatest(1,floor((select n from lim)*0.75)::int)
), q as (select * from ent union all select * from cand)
select coalesce(jsonb_agg(jsonb_build_object(
  'subject_type',subject_type,'subject_key',subject_key,'display_name',display_name,'rut',rut,
  'website',website,'domain',domain,'source_code',source_code,'source_url',source_url,'refreshed_at',refreshed_at
) order by priority,refreshed_at asc nulls first,display_name),'[]'::jsonb)
from q;
$function$;

create or replace function public.aml_fintech_function_batch(p_limit integer default 12)
returns jsonb
language sql
stable security definer
set search_path to 'public','pg_temp'
as $function$
with lim as (
  select greatest(1,least(coalesce(p_limit,12),30))::int n
), cand as (
  select 'CANDIDATE'::text subject_type,c.candidate_id::text subject_key,c.name_raw display_name,c.website,c.functional_profile_refreshed_at refreshed_at,2 priority
  from public.aml_fintech_candidate c
  where c.matched_fintech_id is null
    and c.website is not null and btrim(c.website)<>''
    and (
      c.source_code not in ('FINTECHILE_MEMBERS','LATAMFINTECH_CHILE')
      or exists (
        select 1 from public.aml_v_fintech_ecosystem_semantic_current s
        where s.candidate_id=c.candidate_id and s.semantic_stage like 'OPEN_%'
      )
    )
  order by c.functional_profile_refreshed_at asc nulls first,c.name_raw
  limit greatest(1,ceil((select n from lim)*0.20)::int)
), ent as (
  select 'ENTITY'::text subject_type,e.fintech_id subject_key,coalesce(e.brand,e.legal_name) display_name,e.website,e.functional_profile_refreshed_at refreshed_at,1 priority
  from public.aml_fintech_entity e
  where e.website is not null and btrim(e.website)<>''
  order by
    case when not exists (
      select 1 from public.aml_fintech_function_observation o
      where o.subject_type='ENTITY' and o.subject_key=e.fintech_id
    ) then 0 else 1 end,
    e.functional_profile_refreshed_at asc nulls first,
    coalesce(e.brand,e.legal_name)
  limit greatest(1,floor((select n from lim)*0.80)::int)
), q as (select * from ent union all select * from cand)
select coalesce(jsonb_agg(jsonb_build_object(
  'subject_type',subject_type,'subject_key',subject_key,'display_name',display_name,'website',website,'refreshed_at',refreshed_at
) order by priority,refreshed_at asc nulls first,display_name),'[]'::jsonb)
from q;
$function$;

revoke all on function public.aml_fintech_enrichment_batch(integer) from public,anon,authenticated;
revoke all on function public.aml_fintech_function_batch(integer) from public,anon,authenticated;
grant execute on function public.aml_fintech_enrichment_batch(integer) to service_role;
grant execute on function public.aml_fintech_function_batch(integer) to service_role;