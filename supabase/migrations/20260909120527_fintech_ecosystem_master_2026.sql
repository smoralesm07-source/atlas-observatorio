create or replace function public.aml_fintech_reconcile_sector_directories()
returns jsonb
language plpgsql
set search_path=public,extensions,pg_temp
as $$
declare v_matched integer:=0;
begin
  with unresolved as (
    select c.candidate_id,c.name_raw,c.domain,public.obs_normalize_text(c.name_raw) n
    from public.aml_fintech_candidate c
    where c.matched_fintech_id is null and c.source_code in ('LATAMFINTECH_CHILE','FINTECHILE_MEMBERS')
  ), targets as (
    select u.candidate_id,e.fintech_id,
           case when u.n=public.obs_normalize_text(coalesce(e.brand,'')) then 'EXACT_BRAND'
                when u.n=public.obs_normalize_text(coalesce(e.legal_name,'')) then 'EXACT_LEGAL_NAME'
                when u.domain is not null and u.domain<>'' and lower(u.domain)=lower(coalesce(public.aml_fintech_domain(e.website),'')) then 'EXACT_DOMAIN'
                when exists(select 1 from public.aml_fintech_actor_alias a where a.fintech_id=e.fintech_id and a.active and public.obs_normalize_text(a.alias_text)=u.n) then 'EXACT_ALIAS'
                when u.domain is not null and u.domain<>'' and exists(select 1 from public.aml_fintech_actor_alias a where a.fintech_id=e.fintech_id and a.active and lower(coalesce(a.domain,''))=lower(u.domain)) then 'ALIAS_DOMAIN' end method
    from unresolved u join public.aml_fintech_entity e on
      u.n=public.obs_normalize_text(coalesce(e.brand,''))
      or u.n=public.obs_normalize_text(coalesce(e.legal_name,''))
      or (u.domain is not null and u.domain<>'' and lower(u.domain)=lower(coalesce(public.aml_fintech_domain(e.website),'')))
      or exists(select 1 from public.aml_fintech_actor_alias a where a.fintech_id=e.fintech_id and a.active and (public.obs_normalize_text(a.alias_text)=u.n or (u.domain is not null and u.domain<>'' and lower(coalesce(a.domain,''))=lower(u.domain))))
  ), unique_targets as (
    select candidate_id,min(fintech_id) fintech_id,min(method) method
    from targets group by candidate_id having count(distinct fintech_id)=1
  )
  update public.aml_fintech_candidate c
  set candidate_status='MATCHED_EXISTING',matched_fintech_id=t.fintech_id,match_method='SECTOR_DIRECTORY_'||t.method,match_score=1,last_seen_at=now()
  from unique_targets t where c.candidate_id=t.candidate_id;
  get diagnostics v_matched=row_count;

  insert into public.aml_fintech_entity_source(fintech_id,source_code,source_entity_key,source_label,source_url,status,evidence,first_seen_at,last_seen_at)
  select distinct on (c.matched_fintech_id,c.source_code)
         c.matched_fintech_id,c.source_code,c.source_entity_key,c.name_raw,c.source_url,'OBSERVED',coalesce(c.evidence,'{}'::jsonb),coalesce(c.first_seen_at,now()),now()
  from public.aml_fintech_candidate c
  where c.matched_fintech_id is not null and c.source_code in ('LATAMFINTECH_CHILE','FINTECHILE_MEMBERS')
  order by c.matched_fintech_id,c.source_code,c.last_seen_at desc,c.candidate_id desc
  on conflict(fintech_id,source_code) do update set
    source_entity_key=excluded.source_entity_key,source_label=excluded.source_label,
    source_url=coalesce(excluded.source_url,public.aml_fintech_entity_source.source_url),status='OBSERVED',
    evidence=public.aml_fintech_entity_source.evidence||excluded.evidence,last_seen_at=now();

  return jsonb_build_object('matched',v_matched,'refreshed_at',now(),
    'note','La reconciliación automática sólo promueve coincidencias exactas y unívocas. La evidencia del candidato permanece trazable en staging y puede consolidarse durante la promoción jurídica.');
end$$;

create or replace view public.aml_v_fintech_ecosystem_master_current
with (security_invoker=true)
as
with sector_refs as (
  select c.candidate_id,c.source_code,c.source_entity_key,c.name_raw,c.website,c.domain,c.vertical_hint,c.matched_fintech_id,c.enrichment_status,c.first_seen_at,c.last_seen_at,
         coalesce(c.matched_fintech_id,'CANDIDATE:'||c.candidate_id::text) master_key
  from public.aml_fintech_candidate c where c.source_code in ('FINTECHILE_MEMBERS','LATAMFINTECH_CHILE')
), country_signal as (
  select subject_key,max(value_text) filter(where field_code='COUNTRY_SIGNAL') country_signal
  from public.aml_fintech_enrichment_fact where subject_type='CANDIDATE' group by subject_key
), grouped as (
  select r.master_key,min(r.candidate_id) candidate_id,max(r.matched_fintech_id) matched_fintech_id,
         string_agg(distinct r.source_code,',' order by r.source_code) source_codes,count(distinct r.source_code)::int source_count,
         max(r.name_raw) observed_name,max(r.website) website,max(r.domain) domain,max(r.vertical_hint) vertical_hint,
         max(r.enrichment_status) enrichment_status,min(r.first_seen_at) first_seen_at,max(r.last_seen_at) last_seen_at,max(cs.country_signal) country_signal
  from sector_refs r left join country_signal cs on cs.subject_key=r.candidate_id::text group by r.master_key
)
select g.master_key,g.candidate_id,g.matched_fintech_id,g.source_codes,g.source_count,coalesce(e.brand,g.observed_name) display_name,
       e.legal_name,e.rut,coalesce(e.website,g.website) website,coalesce(public.aml_fintech_domain(e.website),g.domain) domain,
       coalesce(e.origin_country,g.country_signal) origin_country,coalesce(e.primary_vertical,g.vertical_hint) vertical,
       e.business_model,e.target_customer,e.revenue_model,e.psav_status,e.identification_status,e.presence_chile,e.confidence,
       g.enrichment_status,g.first_seen_at,g.last_seen_at,
       case when e.fintech_id is not null and e.rut is not null then 'IDENTIFIED_RUT'
            when e.fintech_id is not null then 'IDENTIFIED_NO_CHILE_RUT'
            when g.enrichment_status='ENRICHED' then 'CANDIDATE_ENRICHED'
            when g.enrichment_status='FETCH_FAILED' then 'CANDIDATE_FETCH_FAILED'
            else 'CANDIDATE_PENDING' end coverage_stage
from grouped g left join public.aml_fintech_entity e on e.fintech_id=g.matched_fintech_id;
revoke all on public.aml_v_fintech_ecosystem_master_current from anon,authenticated;

create table if not exists public.aml_fintech_ecosystem_coverage_snapshot(
  snapshot_id bigint generated always as identity primary key,captured_at timestamptz not null default now(),reference_source_code text not null,
  reference_source_date date,reference_total integer,sector_observed_unique integer not null,sector_confirmed_unique integer not null,
  sector_candidates_unique integer not null,atlas_confirmed integer not null,atlas_with_rut integer not null,atlas_without_rut integer not null,
  candidates_enriched integer not null,candidates_pending integer not null,function_profiled integer not null,business_model_classified integer not null,
  with_market_metrics integer not null,detail jsonb not null default '{}'::jsonb
);
alter table public.aml_fintech_ecosystem_coverage_snapshot enable row level security;
revoke all on public.aml_fintech_ecosystem_coverage_snapshot from anon,authenticated;
create index if not exists aml_fintech_ecosystem_coverage_time_idx on public.aml_fintech_ecosystem_coverage_snapshot(captured_at desc);

create or replace function public.aml_fintech_capture_ecosystem_coverage()
returns bigint language plpgsql set search_path=public,pg_temp as $$
declare v_id bigint; v_ref record;
begin
  select * into v_ref from public.aml_fintech_universe_snapshot order by source_date desc,ingested_at desc limit 1;
  insert into public.aml_fintech_ecosystem_coverage_snapshot(reference_source_code,reference_source_date,reference_total,sector_observed_unique,sector_confirmed_unique,sector_candidates_unique,atlas_confirmed,atlas_with_rut,atlas_without_rut,candidates_enriched,candidates_pending,function_profiled,business_model_classified,with_market_metrics,detail)
  select coalesce(v_ref.source_code,'UNKNOWN'),v_ref.source_date,v_ref.reported_total,
    (select count(*) from public.aml_v_fintech_ecosystem_master_current),(select count(*) from public.aml_v_fintech_ecosystem_master_current where matched_fintech_id is not null),
    (select count(*) from public.aml_v_fintech_ecosystem_master_current where matched_fintech_id is null),(select count(*) from public.aml_fintech_entity),
    (select count(*) from public.aml_fintech_entity where rut is not null),(select count(*) from public.aml_fintech_entity where rut is null),
    (select count(*) from public.aml_v_fintech_ecosystem_master_current where coverage_stage='CANDIDATE_ENRICHED'),
    (select count(*) from public.aml_v_fintech_ecosystem_master_current where coverage_stage in ('CANDIDATE_PENDING','CANDIDATE_FETCH_FAILED')),
    (select count(distinct subject_key) from public.aml_fintech_function_observation where subject_type='ENTITY'),
    (select count(*) from public.aml_fintech_entity where business_model is not null),
    (select count(distinct subject_key) from public.aml_fintech_market_metric_observation where subject_type='ENTITY' and evidence_type<>'NO_OBSERVABLE'),
    jsonb_build_object('sources',(select coalesce(jsonb_agg(x),'[]'::jsonb) from (select source_code,count(*) total,count(*) filter(where matched_fintech_id is not null) matched,count(*) filter(where matched_fintech_id is null) unresolved from public.aml_fintech_candidate where source_code in ('FINTECHILE_MEMBERS','LATAMFINTECH_CHILE') group by source_code order by source_code) x))
  returning snapshot_id into v_id;
  return v_id;
end$$;
revoke all on function public.aml_fintech_capture_ecosystem_coverage() from public,anon,authenticated;
grant execute on function public.aml_fintech_capture_ecosystem_coverage() to service_role;

create or replace function public.obs_fintech_ecosystem_master_status()
returns jsonb language plpgsql stable security definer set search_path=public,extensions,pg_temp as $$
declare ok boolean; r jsonb;
begin
  select exists(select 1 from public.aml_allowed_users au where au.user_id=auth.uid() and au.enabled) into ok;
  if not ok then return jsonb_build_object('error','NOT_AUTHORIZED'); end if;
  select jsonb_build_object(
    'reference',coalesce((select jsonb_build_object('source_code',u.source_code,'source_date',u.source_date,'reported_total',u.reported_total,'local_total',u.local_total,'foreign_total',u.foreign_total,'methodology_note',u.methodology_note,'source_url',u.source_url) from public.aml_fintech_universe_snapshot u order by u.source_date desc,u.ingested_at desc limit 1),'{}'::jsonb),
    'alternate_snapshots',coalesce((select jsonb_agg(jsonb_build_object('source_code',u.source_code,'source_date',u.source_date,'reported_total',u.reported_total,'local_total',u.local_total,'foreign_total',u.foreign_total,'methodology_note',u.methodology_note,'source_url',u.source_url) order by u.source_date desc) from public.aml_fintech_universe_snapshot u),'[]'::jsonb),
    'coverage',jsonb_build_object('sector_observed_unique',(select count(*) from public.aml_v_fintech_ecosystem_master_current),'sector_confirmed_unique',(select count(*) from public.aml_v_fintech_ecosystem_master_current where matched_fintech_id is not null),'sector_candidates_unique',(select count(*) from public.aml_v_fintech_ecosystem_master_current where matched_fintech_id is null),'atlas_confirmed',(select count(*) from public.aml_fintech_entity),'atlas_with_rut',(select count(*) from public.aml_fintech_entity where rut is not null),'atlas_without_rut',(select count(*) from public.aml_fintech_entity where rut is null),'candidates_enriched',(select count(*) from public.aml_v_fintech_ecosystem_master_current where coverage_stage='CANDIDATE_ENRICHED'),'candidates_pending',(select count(*) from public.aml_v_fintech_ecosystem_master_current where coverage_stage in ('CANDIDATE_PENDING','CANDIDATE_FETCH_FAILED')),'function_profiled',(select count(distinct subject_key) from public.aml_fintech_function_observation where subject_type='ENTITY'),'business_model_classified',(select count(*) from public.aml_fintech_entity where business_model is not null),'with_market_metrics',(select count(distinct subject_key) from public.aml_fintech_market_metric_observation where subject_type='ENTITY' and evidence_type<>'NO_OBSERVABLE')),
    'stages',coalesce((select jsonb_agg(jsonb_build_object('stage',coverage_stage,'count',n) order by n desc) from (select coverage_stage,count(*) n from public.aml_v_fintech_ecosystem_master_current group by coverage_stage) s),'[]'::jsonb),
    'source_coverage',coalesce((select jsonb_agg(jsonb_build_object('source_code',source_code,'total',total,'matched',matched,'unresolved',unresolved) order by total desc) from (select source_code,count(*) total,count(*) filter(where matched_fintech_id is not null) matched,count(*) filter(where matched_fintech_id is null) unresolved from public.aml_fintech_candidate where source_code in ('FINTECHILE_MEMBERS','LATAMFINTECH_CHILE') group by source_code) s),'[]'::jsonb),
    'country_distribution',coalesce((select jsonb_agg(jsonb_build_object('country',country,'count',n) order by n desc) from (select coalesce(origin_country,'Por determinar') country,count(*) n from public.aml_v_fintech_ecosystem_master_current group by 1 order by n desc limit 12) s),'[]'::jsonb),
    'vertical_distribution',coalesce((select jsonb_agg(jsonb_build_object('vertical',vertical_name,'count',n) order by n desc) from (select coalesce(vertical,'Por clasificar') vertical_name,count(*) n from public.aml_v_fintech_ecosystem_master_current group by 1 order by n desc limit 15) s),'[]'::jsonb),
    'method_note','El Maestro ATLAS separa universo publicado, actores observados en directorios abiertos, entidades confirmadas y candidatos. Un candidato no se promueve sólo por aparecer en un directorio. La deduplicación automática sólo usa coincidencias exactas y unívocas de marca, razón social, alias o dominio.'
  ) into r; return r;
end$$;
revoke all on function public.obs_fintech_ecosystem_master_status() from public,anon;
grant execute on function public.obs_fintech_ecosystem_master_status() to authenticated,service_role;

create or replace function public.obs_fintech_ecosystem_master_search(p_q text default null,p_stage text default null,p_source text default null,p_limit integer default 50,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path=public,extensions,pg_temp as $$
declare ok boolean; r jsonb; v_limit int:=greatest(1,least(coalesce(p_limit,50),200)); v_offset int:=greatest(0,coalesce(p_offset,0));
begin
  select exists(select 1 from public.aml_allowed_users au where au.user_id=auth.uid() and au.enabled) into ok;
  if not ok then return jsonb_build_object('error','NOT_AUTHORIZED'); end if;
  with f as (select * from public.aml_v_fintech_ecosystem_master_current m where (p_q is null or btrim(p_q)='' or public.obs_normalize_text(coalesce(m.display_name,'')) like '%'||public.obs_normalize_text(p_q)||'%' or public.obs_normalize_text(coalesce(m.legal_name,'')) like '%'||public.obs_normalize_text(p_q)||'%' or coalesce(m.rut,'') ilike '%'||p_q||'%') and (p_stage is null or btrim(p_stage)='' or m.coverage_stage=p_stage) and (p_source is null or btrim(p_source)='' or position(p_source in m.source_codes)>0)), rows as (select * from f order by case coverage_stage when 'CANDIDATE_PENDING' then 1 when 'CANDIDATE_FETCH_FAILED' then 2 when 'CANDIDATE_ENRICHED' then 3 else 4 end,display_name limit v_limit offset v_offset)
  select jsonb_build_object('total',(select count(*) from f),'rows',coalesce((select jsonb_agg(to_jsonb(rows)) from rows),'[]'::jsonb)) into r; return r;
end$$;
revoke all on function public.obs_fintech_ecosystem_master_search(text,text,text,integer,integer) from public,anon;
grant execute on function public.obs_fintech_ecosystem_master_search(text,text,text,integer,integer) to authenticated,service_role;

select public.aml_fintech_reconcile_sector_directories();
select public.aml_fintech_capture_ecosystem_coverage();