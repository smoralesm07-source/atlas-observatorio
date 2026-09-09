create or replace function public.aml_fintech_enrichment_batch(p_limit integer default 20)
returns jsonb
language sql
stable
security definer
set search_path=public,pg_temp
as $$
with cand as (
  select 'CANDIDATE'::text subject_type,c.candidate_id::text subject_key,c.name_raw display_name,c.rut_raw rut,c.website,c.domain,c.source_code,c.source_url,c.enrichment_refreshed_at refreshed_at,
         case when c.source_code in ('FINTECHILE_MEMBERS','LATAMFINTECH_CHILE') then 1 when c.source_code='CMF_PAYMENTS' then 2 else 4 end priority
  from public.aml_fintech_candidate c
  where c.matched_fintech_id is null and c.website is not null and btrim(c.website)<>''
  order by priority,c.enrichment_refreshed_at asc nulls first,c.name_raw
  limit greatest(1,ceil(greatest(1,least(coalesce(p_limit,20),40))*0.75)::int)
), ent as (
  select 'ENTITY'::text subject_type,e.fintech_id subject_key,coalesce(e.brand,e.legal_name) display_name,e.rut,e.website,null::text domain,'COMPANY_WEB'::text source_code,e.website source_url,e.profile_refreshed_at refreshed_at,3 priority
  from public.aml_fintech_entity e
  where e.website is not null and btrim(e.website)<>''
  order by e.profile_refreshed_at asc nulls first,display_name
  limit greatest(1,floor(greatest(1,least(coalesce(p_limit,20),40))*0.25)::int)
), q as (select * from cand union all select * from ent)
select coalesce(jsonb_agg(jsonb_build_object('subject_type',subject_type,'subject_key',subject_key,'display_name',display_name,'rut',rut,'website',website,'domain',domain,'source_code',source_code,'source_url',source_url,'refreshed_at',refreshed_at) order by priority,refreshed_at asc nulls first,display_name),'[]'::jsonb) from q;
$$;