create or replace view public.aml_v_fintech_ecosystem_semantic_current
with (security_invoker=true)
as
with rel as (
  select distinct on (subject_key)
    subject_key,relation_type,target_label,target_rut,confidence as relationship_confidence
  from public.aml_v_fintech_subject_relationship_current
  where subject_type='CANDIDATE'
    and relation_type in ('PRODUCT_OF','BRAND_OF','OPERATED_BY')
  order by subject_key,confidence desc,relationship_id desc
)
select m.*,
       sc.scope_status,
       sc.include_in_current_universe,
       sc.assessed_vertical,
       sc.confidence as scope_confidence,
       rel.relation_type as semantic_relation_type,
       rel.target_label as semantic_target_label,
       rel.target_rut as semantic_target_rut,
       rel.relationship_confidence,
       case
         when m.matched_fintech_id is not null then 'ENTITY_RESOLVED'
         when rel.subject_key is not null then 'NON_ENTITY_PRODUCT_RESOLVED'
         when sc.include_in_current_universe is false then 'SCOPE_RESOLVED_EXCLUDED'
         when m.coverage_stage='CANDIDATE_ENRICHED' then 'OPEN_ENRICHED'
         when m.coverage_stage='CANDIDATE_FETCH_FAILED' then 'OPEN_FETCH_FAILED'
         else 'OPEN_PENDING'
       end as semantic_stage
from public.aml_v_fintech_ecosystem_master_current m
left join public.aml_v_fintech_scope_current sc
  on (
    (m.matched_fintech_id is not null and sc.subject_type='ENTITY' and sc.subject_key=m.matched_fintech_id)
    or
    (m.matched_fintech_id is null and sc.subject_type='CANDIDATE' and sc.subject_key=m.candidate_id::text)
  )
left join rel on m.matched_fintech_id is null and rel.subject_key=m.candidate_id::text;

revoke all on public.aml_v_fintech_ecosystem_semantic_current from public,anon,authenticated;
grant select on public.aml_v_fintech_ecosystem_semantic_current to service_role;

create or replace function public.aml_fintech_capture_ecosystem_coverage()
returns bigint
language plpgsql
set search_path to 'public','pg_temp'
as $$
declare v_id bigint; v_ref record;
begin
  select * into v_ref from public.aml_fintech_universe_snapshot order by source_date desc,ingested_at desc limit 1;
  insert into public.aml_fintech_ecosystem_coverage_snapshot(
    reference_source_code,reference_source_date,reference_total,
    sector_observed_unique,sector_confirmed_unique,sector_candidates_unique,
    atlas_confirmed,atlas_with_rut,atlas_without_rut,candidates_enriched,candidates_pending,
    function_profiled,business_model_classified,with_market_metrics,
    semantic_resolved_unique,semantic_open_candidates_unique,semantic_product_resolved_unique,
    semantic_out_of_scope_unique,scope_assessed_unique,scope_included_unique,scope_excluded_unique,detail
  )
  select coalesce(v_ref.source_code,'UNKNOWN'),v_ref.source_date,v_ref.reported_total,
    (select count(*) from public.aml_v_fintech_ecosystem_master_current),
    (select count(*) from public.aml_v_fintech_ecosystem_master_current where matched_fintech_id is not null),
    (select count(*) from public.aml_v_fintech_ecosystem_master_current where matched_fintech_id is null),
    (select count(*) from public.aml_fintech_entity),
    (select count(*) from public.aml_fintech_entity where rut is not null),
    (select count(*) from public.aml_fintech_entity where rut is null),
    (select count(*) from public.aml_v_fintech_ecosystem_master_current where coverage_stage='CANDIDATE_ENRICHED'),
    (select count(*) from public.aml_v_fintech_ecosystem_master_current where coverage_stage in ('CANDIDATE_PENDING','CANDIDATE_FETCH_FAILED')),
    (select count(distinct subject_key) from public.aml_fintech_function_observation where subject_type='ENTITY'),
    (select count(*) from public.aml_fintech_entity where business_model is not null),
    (select count(distinct subject_key) from public.aml_fintech_market_metric_observation where subject_type='ENTITY' and evidence_type<>'NO_OBSERVABLE'),
    (select count(*) from public.aml_v_fintech_ecosystem_semantic_current where semantic_stage in ('ENTITY_RESOLVED','NON_ENTITY_PRODUCT_RESOLVED','SCOPE_RESOLVED_EXCLUDED')),
    (select count(*) from public.aml_v_fintech_ecosystem_semantic_current where semantic_stage like 'OPEN_%'),
    (select count(*) from public.aml_v_fintech_ecosystem_semantic_current where semantic_stage='NON_ENTITY_PRODUCT_RESOLVED'),
    (select count(*) from public.aml_v_fintech_ecosystem_semantic_current where semantic_stage='SCOPE_RESOLVED_EXCLUDED'),
    (select count(*) from public.aml_v_fintech_ecosystem_semantic_current where scope_status is not null),
    (select count(*) from public.aml_v_fintech_ecosystem_semantic_current where include_in_current_universe is true),
    (select count(*) from public.aml_v_fintech_ecosystem_semantic_current where include_in_current_universe is false),
    jsonb_build_object(
      'sources',(select coalesce(jsonb_agg(x),'[]'::jsonb) from (
        select source_code,count(*) total,count(*) filter(where matched_fintech_id is not null) matched,count(*) filter(where matched_fintech_id is null) unresolved
        from public.aml_fintech_candidate where source_code in ('FINTECHILE_MEMBERS','LATAMFINTECH_CHILE')
        group by source_code order by source_code
      ) x),
      'semantic_stage_distribution',(select coalesce(jsonb_object_agg(semantic_stage,n),'{}'::jsonb) from (
        select semantic_stage,count(*) n from public.aml_v_fintech_ecosystem_semantic_current group by semantic_stage
      ) s),
      'scope_status_distribution',(select coalesce(jsonb_object_agg(scope_status,n),'{}'::jsonb) from (
        select scope_status,count(*) n from public.aml_v_fintech_ecosystem_semantic_current where scope_status is not null group by scope_status
      ) s)
    )
  returning snapshot_id into v_id;
  return v_id;
end;
$$;
