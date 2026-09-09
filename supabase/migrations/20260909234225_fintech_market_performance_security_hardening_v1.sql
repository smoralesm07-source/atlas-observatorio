create index if not exists aml_fintech_scope_assessment_source_code_idx
  on public.aml_fintech_scope_assessment(source_code);

create index if not exists aml_fintech_subject_relationship_source_code_idx
  on public.aml_fintech_subject_relationship(source_code);

create index if not exists aml_fintech_subject_relationship_target_fintech_idx
  on public.aml_fintech_subject_relationship(target_fintech_id)
  where target_fintech_id is not null;

alter function public.aml_fintech_function_alignment_tier_v1(text,text)
  set search_path = public, pg_temp;
