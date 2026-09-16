-- IPA3 M17: toda sanción UAF confirmada se considera señal AML/CFT.
-- Se trabaja sobre procedimientos sancionatorios estrictos/deduplicados, no sobre hitos repetidos.
-- Intensidad por recencia: <=1 año 100; <=2 años 80; <=3 años 60; <=5 años 40; >5 años 20.

create or replace view public.aml_v_ipa3_mark_scores_v0_4 as
with m17_uaf as (
  select
    s.entity_id,
    count(distinct s.procedure_id)::integer as procedure_count,
    max(s.event_date) as latest_procedure_date,
    min(coalesce(s.identity_confidence,0.95::numeric)) as identity_confidence,
    array_agg(distinct s.procedure_id order by s.procedure_id) as procedure_ids,
    array_agg(distinct coalesce(s.procedure_category,'Sin categoría') order by coalesce(s.procedure_category,'Sin categoría')) as procedure_categories,
    array_agg(distinct coalesce(s.procedure_status,'Sin estado') order by coalesce(s.procedure_status,'Sin estado')) as procedure_statuses
  from public.aml_v_ipa3_sanction_procedures_strict s
  where upper(coalesce(s.regulator,''))='UAF'
  group by s.entity_id
),
source_marks as (
  select
    b.entity_id,b.mark_id,b.mark_name,b.semantic_class,b.primary_dimension,b.score_group,b.correlation_group,
    b.included_in_score,b.raw_intensity,b.standalone_cap,b.contribution,b.confidence,b.readiness,b.source_ids,b.evidence,b.score_version
  from public.aml_v_ipa3_mark_scores_v0_3 b
  where b.mark_id <> 'M17'

  union all

  select
    u.entity_id,
    'M17'::text as mark_id,
    'Sanción UAF directamente relacionada con AML/CFT'::text as mark_name,
    'ANALYTIC_MARK'::text as semantic_class,
    'INCONSISTENCIA_VULNERABILIDAD'::text as primary_dimension,
    'SANCTIONS'::text as score_group,
    'SANCTIONS'::text as correlation_group,
    true as included_in_score,
    (case
      when current_date-u.latest_procedure_date <= 365 then 100
      when current_date-u.latest_procedure_date <= 730 then 80
      when current_date-u.latest_procedure_date <= 1095 then 60
      when current_date-u.latest_procedure_date <= 1825 then 40
      else 20
    end)::numeric as raw_intensity,
    100::numeric as standalone_cap,
    (case
      when current_date-u.latest_procedure_date <= 365 then 100
      when current_date-u.latest_procedure_date <= 730 then 80
      when current_date-u.latest_procedure_date <= 1095 then 60
      when current_date-u.latest_procedure_date <= 1825 then 40
      else 20
    end)::numeric as contribution,
    least(1::numeric,greatest(0.95::numeric,u.identity_confidence)) as confidence,
    'READY_SHADOW_UAF_POLICY'::text as readiness,
    array['RADAR_SANCIONES'::text,'RADAR_UAF'::text] as source_ids,
    jsonb_build_object(
      'policy_rule','Toda sanción UAF confirmada se considera señal directamente relacionada con AML/CFT para IPA3.',
      'procedure_count',u.procedure_count,
      'procedure_ids',u.procedure_ids,
      'procedure_categories',u.procedure_categories,
      'procedure_statuses',u.procedure_statuses,
      'latest_date',u.latest_procedure_date,
      'identity_confidence',u.identity_confidence,
      'recency_rule','<=1 año:100; <=2 años:80; <=3 años:60; <=5 años:40; >5 años:20'
    ) as evidence,
    '0.4-m17-uaf'::text as score_version
  from m17_uaf u
),
absorbed as (
  select
    s.*,
    case
      when s.mark_id='M04' and exists (
        select 1 from source_marks x
        where x.entity_id=s.entity_id and x.mark_id in ('M05','M19')
          and x.included_in_score and x.contribution>0
      ) then 'M05_OR_M19'
      when s.mark_id='M05' and exists (
        select 1 from source_marks x
        where x.entity_id=s.entity_id and x.mark_id='M19'
          and x.included_in_score and x.contribution>0
      ) then 'M19'
      when s.mark_id='M16' and exists (
        select 1 from source_marks x
        where x.entity_id=s.entity_id and x.mark_id='M18'
          and x.included_in_score and x.contribution>0
      ) then 'M18'
      else null::text
    end as absorbed_by
  from source_marks s
),
post_absorption as (
  select
    a.*,
    case when a.absorbed_by is null then a.included_in_score else false end as included_after_absorption,
    case when a.absorbed_by is null then a.contribution else 0::numeric end as contribution_after_absorption
  from absorbed a
),
driver_rank as (
  select entity_id,score_group,mark_id as effective_group_driver
  from (
    select
      p.entity_id,p.score_group,p.mark_id,p.contribution_after_absorption,
      row_number() over (
        partition by p.entity_id,p.score_group
        order by p.contribution_after_absorption desc,
          case
            when p.score_group='SANCTIONS' then case p.mark_id when 'M17' then 1 when 'M18' then 2 when 'M16' then 3 else 9 end
            when p.score_group='ECONOMIC_TRAJECTORY' then case p.mark_id when 'M05' then 1 when 'M19' then 2 when 'M03' then 3 when 'M04' then 4 else 9 end
            else 9
          end,
          p.mark_id
      ) as rn
    from post_absorption p
    where p.included_after_absorption
      and p.contribution_after_absorption>0
      and p.score_group in ('REGISTRY','ECONOMIC_TRAJECTORY','SANCTIONS')
  ) q
  where rn=1
),
classified as (
  select
    p.*,
    d.effective_group_driver,
    case
      when p.absorbed_by is not null then 'ABSORBED_BY_COMPOSITE'::text
      when p.included_after_absorption and p.contribution_after_absorption>0
        and d.effective_group_driver is not null and p.mark_id<>d.effective_group_driver
        then 'CORRELATED_GROUP_NOT_ADDITIVE'::text
      else p.readiness
    end as readiness_v04,
    case
      when p.absorbed_by is not null then false
      when p.included_after_absorption and p.contribution_after_absorption>0
        and d.effective_group_driver is not null and p.mark_id<>d.effective_group_driver
        then false
      else p.included_after_absorption
    end as included_v04
  from post_absorption p
  left join driver_rank d
    on d.entity_id=p.entity_id and d.score_group=p.score_group
)
select
  entity_id,
  mark_id,
  mark_name,
  semantic_class,
  primary_dimension,
  score_group,
  correlation_group,
  included_v04 as included_in_score,
  raw_intensity,
  standalone_cap,
  case when included_v04 then contribution_after_absorption else 0::numeric end as contribution,
  confidence,
  readiness_v04 as readiness,
  source_ids,
  (evidence ||
    case when absorbed_by is not null
      then jsonb_build_object('absorbed_by',absorbed_by,'absorption_rule','IPA3_RULE_B_REUSED_EVIDENCE')
      else '{}'::jsonb end ||
    case when readiness_v04='CORRELATED_GROUP_NOT_ADDITIVE'
      then jsonb_build_object('effective_group_driver',effective_group_driver,'aggregation_rule','ONE_EFFECTIVE_DRIVER_PER_SCORE_GROUP')
      else '{}'::jsonb end
  ) as evidence,
  case when mark_id='M17' then '0.4-m17-uaf'::text else '0.4-shadow'::text end as score_version
from classified;

create or replace view public.aml_v_ipa3_entity_score_v0_4 as
with scoring_marks as (
  select *
  from public.aml_v_ipa3_mark_scores_v0_4
  where included_in_score is true and contribution>0
),
registry_driver as (
  select distinct on (entity_id) entity_id,mark_id,contribution,confidence
  from scoring_marks
  where score_group='REGISTRY'
  order by entity_id,contribution desc,mark_id
),
economic_driver as (
  select distinct on (entity_id) entity_id,mark_id,contribution,confidence
  from scoring_marks
  where score_group='ECONOMIC_TRAJECTORY'
  order by entity_id,contribution desc,
    case mark_id when 'M05' then 1 when 'M19' then 2 when 'M03' then 3 when 'M04' then 4 else 9 end,
    mark_id
),
sanctions_driver as (
  select distinct on (entity_id) entity_id,mark_id,contribution,confidence
  from scoring_marks
  where score_group='SANCTIONS'
  order by entity_id,contribution desc,
    case mark_id when 'M17' then 1 when 'M18' then 2 when 'M16' then 3 else 9 end,
    mark_id
),
stats as (
  select
    entity_id,
    count(*) filter(where included_in_score)::integer as included_mark_count,
    count(*) filter(where readiness in ('ABSORBED_BY_COMPOSITE','CORRELATED_GROUP_NOT_ADDITIVE'))::integer as non_additive_mark_count,
    count(*) filter(where not included_in_score and semantic_class<>'ROLE_CONTEXT' and readiness not in ('ABSORBED_BY_COMPOSITE','CORRELATED_GROUP_NOT_ADDITIVE'))::integer as diagnostic_mark_count,
    count(*) filter(where semantic_class in ('ROLE_CONTEXT','CONTEXT_ONLY'))::integer as context_mark_count,
    array_agg(mark_id order by mark_id) filter(where included_in_score) as included_mark_ids,
    array_agg(mark_id order by mark_id) filter(where not included_in_score and semantic_class<>'ROLE_CONTEXT' and readiness not in ('ABSORBED_BY_COMPOSITE','CORRELATED_GROUP_NOT_ADDITIVE')) as diagnostic_mark_ids
  from public.aml_v_ipa3_mark_scores_v0_4
  group by entity_id
),
base as (
  select
    e.entity_id,e.rut,e.name,e.entity_type,e.region,e.commune,e.is_uaf_observed,
    coalesce(r.contribution,0::numeric) as registry_score,
    r.mark_id as registry_driver_mark,
    coalesce(r.confidence,0::numeric) as registry_confidence,
    coalesce(ec.contribution,0::numeric) as economic_score,
    ec.mark_id as economic_driver_mark,
    coalesce(ec.confidence,0::numeric) as economic_confidence,
    coalesce(sa.contribution,0::numeric) as sanctions_score,
    sa.mark_id as sanctions_driver_mark,
    coalesce(sa.confidence,0::numeric) as sanctions_confidence,
    coalesce(s.included_mark_count,0) as included_mark_count,
    coalesce(s.non_additive_mark_count,0) as non_additive_mark_count,
    coalesce(s.diagnostic_mark_count,0) as diagnostic_mark_count,
    coalesce(s.context_mark_count,0) as context_mark_count,
    s.included_mark_ids,s.diagnostic_mark_ids,
    e.sii_year_count,e.sii_years_with_sales_delta,e.sii_years_with_workforce_ratio,
    coalesce(e.economic_coverage_pct,0::numeric)/100.0 as economic_coverage,
    case when sa.entity_id is not null then 1.00::numeric else coalesce(e.sanctions_identity_coverage_pct,0::numeric)/100.0 end as sanctions_identity_coverage,
    case when e.registry_coverage_pct is null then null::numeric else e.registry_coverage_pct/100.0 end as registry_coverage,
    e.reconciliation_status
  from public.aml_v_ipa3_entity_score_v0_3 e
  left join registry_driver r using(entity_id)
  left join economic_driver ec using(entity_id)
  left join sanctions_driver sa using(entity_id)
  left join stats s using(entity_id)
),
ordered as (
  select
    b.*,
    greatest(b.registry_score,b.economic_score,b.sanctions_score) as group_1,
    least(b.registry_score,b.economic_score,b.sanctions_score) as group_3,
    b.registry_score+b.economic_score+b.sanctions_score
      -greatest(b.registry_score,b.economic_score,b.sanctions_score)
      -least(b.registry_score,b.economic_score,b.sanctions_score) as group_2
  from base b
),
scored as (
  select
    o.*,
    least(100::numeric,o.group_1+0.25*o.group_2+0.10*o.group_3) as ipa3_score,
    (o.registry_score>0)::integer+(o.economic_score>0)::integer+(o.sanctions_score>0)::integer as independent_group_count,
    case
      when o.registry_score>=o.economic_score and o.registry_score>=o.sanctions_score and o.registry_score>0 then o.registry_driver_mark
      when o.economic_score>=o.sanctions_score and o.economic_score>0 then o.economic_driver_mark
      when o.sanctions_score>0 then o.sanctions_driver_mark
      else null::text
    end as dominant_mark_id,
    case when (o.registry_score+o.economic_score+o.sanctions_score)=0 then null::numeric
      else (o.registry_score*o.registry_confidence+o.economic_score*o.economic_confidence+o.sanctions_score*o.sanctions_confidence)
        /(o.registry_score+o.economic_score+o.sanctions_score)
    end as score_confidence,
    100::numeric*(o.economic_coverage+o.sanctions_identity_coverage+coalesce(o.registry_coverage,0::numeric))
      /(2+(o.is_uaf_observed is true)::integer)::numeric as coverage_index
  from ordered o
)
select
  entity_id,
  rut,
  name,
  entity_type,
  region,
  commune,
  is_uaf_observed,
  round(ipa3_score,2) as ipa3_score,
  case
    when ipa3_score>=70 then 'MUY_ALTA'
    when ipa3_score>=55 then 'ALTA'
    when ipa3_score>=35 then 'MEDIA'
    when ipa3_score>0 then 'BAJA'
    else 'SIN_MARCA_SHADOW'
  end::text as priority_band_shadow,
  round(registry_score,2) as registry_group_score,
  registry_driver_mark,
  round(economic_score,2) as economic_group_score,
  economic_driver_mark,
  round(sanctions_score,2) as sanctions_group_score,
  sanctions_driver_mark,
  dominant_mark_id,
  included_mark_count,
  independent_group_count,
  non_additive_mark_count as absorbed_or_correlated_mark_count,
  diagnostic_mark_count,
  context_mark_count,
  included_mark_ids,
  diagnostic_mark_ids,
  round(score_confidence*100,1) as score_confidence_pct,
  round(coverage_index,1) as coverage_index_pct,
  sii_year_count,
  sii_years_with_sales_delta,
  sii_years_with_workforce_ratio,
  round(economic_coverage*100,1) as economic_coverage_pct,
  round(sanctions_identity_coverage*100,1) as sanctions_identity_coverage_pct,
  case when registry_coverage is null then null::numeric else round(registry_coverage*100,1) end as registry_coverage_pct,
  reconciliation_status,
  current_date as score_as_of,
  '0.4-m17-uaf'::text as score_version,
  false as production_enabled,
  'PRIORIDAD_ANALITICA_NO_PROBABILIDAD_LAFT'::text as semantics
from scored;

select public.refresh_aml_ipa3_entity_score_snapshot_v0_4();
