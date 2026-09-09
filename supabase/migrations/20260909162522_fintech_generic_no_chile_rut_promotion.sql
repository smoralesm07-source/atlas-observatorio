create or replace function public.aml_fintech_promote_candidate_actor_no_chile_rut(
  p_candidate_id bigint,
  p_brand text,
  p_origin_country text,
  p_legal_name text,
  p_presence_basis text,
  p_score numeric default 0.96,
  p_evidence_url text default null,
  p_evidence_source text default 'COMPANY_OFFICIAL'
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  c record;
  v_id text;
  v_rows int:=0;
  v_facts int:=0;
  v_funcs int:=0;
  v_metrics int:=0;
begin
  select * into c
  from public.aml_fintech_candidate
  where candidate_id=p_candidate_id and matched_fintech_id is null
  for update;

  if c.candidate_id is null then
    return jsonb_build_object('ok',false,'reason','CANDIDATE_NOT_FOUND_OR_ALREADY_MATCHED','candidate_id',p_candidate_id);
  end if;

  v_id := 'ACTOR-'||upper(substr(md5(coalesce(public.aml_fintech_domain_root(coalesce(c.domain,c.website)),c.source_code||':'||c.source_entity_key,c.candidate_id::text)),1,16));

  insert into public.aml_fintech_entity(
    fintech_id,atlas_entity_id,rut,brand,legal_name,website,origin_country,presence_chile,entity_status,
    identification_status,identification_basis,primary_vertical,psav_status,confidence,
    first_seen_at,last_seen_at,refreshed_at
  ) values(
    v_id,null,null,coalesce(nullif(trim(p_brand),''),c.name_raw),coalesce(nullif(trim(p_legal_name),''),nullif(trim(p_brand),''),c.name_raw),
    c.website,p_origin_country,'CONFIRMED_NO_CHILE_VEHICLE','ACTIVE_OBSERVED','ACTOR_CONFIRMED_NO_CHILE_RUT',
    p_presence_basis,c.vertical_hint,'NO_EVIDENCE',least(1,greatest(0,p_score)),coalesce(c.first_seen_at,now()),now(),now()
  )
  on conflict(fintech_id) do update set
    brand=excluded.brand,
    legal_name=excluded.legal_name,
    website=coalesce(public.aml_fintech_entity.website,excluded.website),
    origin_country=coalesce(excluded.origin_country,public.aml_fintech_entity.origin_country),
    presence_chile='CONFIRMED_NO_CHILE_VEHICLE',
    entity_status='ACTIVE_OBSERVED',
    identification_status='ACTOR_CONFIRMED_NO_CHILE_RUT',
    identification_basis=excluded.identification_basis,
    primary_vertical=coalesce(public.aml_fintech_entity.primary_vertical,excluded.primary_vertical),
    confidence=greatest(public.aml_fintech_entity.confidence,excluded.confidence),
    last_seen_at=now(),refreshed_at=now();

  update public.aml_fintech_candidate
  set candidate_status='PROMOTED',matched_fintech_id=v_id,
      match_method='ACTOR_NO_CHILE_RUT:'||p_evidence_source,
      match_score=least(1,greatest(0,p_score)),last_seen_at=now()
  where candidate_id=c.candidate_id;

  insert into public.aml_fintech_entity_source(
    fintech_id,source_code,source_entity_key,source_label,source_url,status,evidence,first_seen_at,last_seen_at
  ) values(
    v_id,c.source_code,c.source_entity_key,coalesce(nullif(trim(p_brand),''),c.name_raw),c.source_url,'OBSERVED',
    coalesce(c.evidence,'{}'::jsonb)||jsonb_build_object('presence_basis',p_presence_basis,'origin_country',p_origin_country,'no_chile_rut_identified',true),
    coalesce(c.first_seen_at,now()),now()
  )
  on conflict(fintech_id,source_code) do update set
    source_entity_key=excluded.source_entity_key,source_label=excluded.source_label,source_url=excluded.source_url,
    status='OBSERVED',evidence=public.aml_fintech_entity_source.evidence||excluded.evidence,last_seen_at=now();

  if p_evidence_source is not null and exists(select 1 from public.aml_fintech_source_catalog where source_code=p_evidence_source) then
    insert into public.aml_fintech_entity_source(
      fintech_id,source_code,source_entity_key,source_label,source_url,status,evidence,first_seen_at,last_seen_at
    ) values(
      v_id,p_evidence_source,coalesce(c.source_entity_key,c.candidate_id::text),coalesce(nullif(trim(p_brand),''),c.name_raw),p_evidence_url,'OBSERVED',
      jsonb_build_object('presence_basis',p_presence_basis,'origin_country',p_origin_country,'no_chile_rut_identified',true),now(),now()
    )
    on conflict(fintech_id,source_code) do update set
      source_url=coalesce(excluded.source_url,public.aml_fintech_entity_source.source_url),
      status='OBSERVED',evidence=public.aml_fintech_entity_source.evidence||excluded.evidence,last_seen_at=now();
  end if;

  insert into public.aml_fintech_actor_alias(
    fintech_id,alias_text,alias_type,domain,source_code,source_url,evidence_basis,confidence,active,first_seen_at,last_seen_at,metadata
  ) values(
    v_id,coalesce(nullif(trim(p_brand),''),c.name_raw),'BRAND',c.domain,c.source_code,coalesce(p_evidence_url,c.source_url),p_presence_basis,
    least(1,greatest(0,p_score)),true,coalesce(c.first_seen_at,now()),now(),jsonb_build_object('candidate_id',c.candidate_id)
  )
  on conflict(fintech_id,lower(alias_text),coalesce(lower(domain),'')) do update set
    source_url=coalesce(excluded.source_url,public.aml_fintech_actor_alias.source_url),
    evidence_basis=excluded.evidence_basis,
    confidence=greatest(public.aml_fintech_actor_alias.confidence,excluded.confidence),active=true,last_seen_at=now(),
    metadata=public.aml_fintech_actor_alias.metadata||excluded.metadata;

  update public.aml_fintech_enrichment_fact set subject_type='ENTITY',subject_key=v_id where subject_type='CANDIDATE' and subject_key=c.candidate_id::text;
  get diagnostics v_rows=row_count; v_facts:=v_facts+v_rows;
  update public.aml_fintech_function_observation set subject_type='ENTITY',subject_key=v_id where subject_type='CANDIDATE' and subject_key=c.candidate_id::text;
  get diagnostics v_rows=row_count; v_funcs:=v_funcs+v_rows;
  update public.aml_fintech_market_metric_observation set subject_type='ENTITY',subject_key=v_id where subject_type='CANDIDATE' and subject_key=c.candidate_id::text;
  get diagnostics v_rows=row_count; v_metrics:=v_metrics+v_rows;

  return jsonb_build_object('ok',true,'fintech_id',v_id,'candidate_id',c.candidate_id,'source_code',c.source_code,
    'brand',coalesce(nullif(trim(p_brand),''),c.name_raw),'origin_country',p_origin_country,
    'facts_migrated',v_facts,'functions_migrated',v_funcs,'metrics_migrated',v_metrics);
end;
$$;

revoke all on function public.aml_fintech_promote_candidate_actor_no_chile_rut(bigint,text,text,text,text,numeric,text,text) from public,anon,authenticated;
grant execute on function public.aml_fintech_promote_candidate_actor_no_chile_rut(bigint,text,text,text,text,numeric,text,text) to service_role;
