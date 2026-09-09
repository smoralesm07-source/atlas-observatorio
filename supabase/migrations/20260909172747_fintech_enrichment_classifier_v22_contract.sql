alter table public.aml_fintech_entity
  add column if not exists profile_classifier_version text;

create or replace function public.aml_fintech_ingest_enrichment(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  r jsonb;
  f jsonb;
  v_processed int:=0;
  v_facts int:=0;
  v_identity_hints int:=0;
  v_rut_norm text;
  v_sii_name text;
begin
  if p_rows is null or jsonb_typeof(p_rows)<>'array' then raise exception 'p_rows must be an array'; end if;
  for r in select value from jsonb_array_elements(p_rows)
  loop
    v_processed:=v_processed+1;
    for f in select value from jsonb_array_elements(coalesce(r->'facts','[]'::jsonb))
    loop
      insert into public.aml_fintech_enrichment_fact(
        evidence_key,subject_type,subject_key,field_code,value_text,value_json,evidence_class,
        confidence,source_code,source_url,evidence_excerpt,first_seen_at,last_seen_at,observed_at
      ) values (
        f->>'evidence_key',r->>'subject_type',r->>'subject_key',f->>'field_code',f->>'value_text',
        coalesce(f->'value_json','{}'::jsonb),coalesce(f->>'evidence_class','INFERRED'),
        nullif(f->>'confidence','')::numeric,coalesce(f->>'source_code','COMPANY_WEB'),
        coalesce(f->>'source_url',r->>'website'),left(f->>'evidence_excerpt',1000),
        coalesce(nullif(f->>'observed_at','')::timestamptz,now()),now(),coalesce(nullif(f->>'observed_at','')::timestamptz,now())
      )
      on conflict (evidence_key) do update set
        value_text=excluded.value_text,value_json=excluded.value_json,evidence_class=excluded.evidence_class,
        confidence=excluded.confidence,source_code=excluded.source_code,source_url=excluded.source_url,
        evidence_excerpt=excluded.evidence_excerpt,last_seen_at=now(),observed_at=excluded.observed_at;
      v_facts:=v_facts+1;
    end loop;

    if r->>'subject_type'='CANDIDATE' then
      v_rut_norm:=public.aml_fintech_norm_rut(r->>'legal_rut');
      v_sii_name:=null;
      if coalesce(v_rut_norm,'')<>'' and coalesce(nullif(r->>'legal_rut_confidence','')::numeric,0)>=0.96 then
        select sc.legal_name into v_sii_name from public.aml_sii_registry_company sc
        where public.aml_fintech_norm_rut(sc.rut)=v_rut_norm limit 1;
      end if;
      update public.aml_fintech_candidate c set
        enrichment_status=case when coalesce(r->>'fetch_status','')='OK' then 'ENRICHED' else 'FETCH_FAILED' end,
        enrichment_refreshed_at=now(),
        identity_candidate_rut=case when v_sii_name is not null then r->>'legal_rut' else c.identity_candidate_rut end,
        identity_candidate_legal_name=coalesce(v_sii_name,c.identity_candidate_legal_name),
        identity_candidate_confidence=case when v_sii_name is not null then nullif(r->>'legal_rut_confidence','')::numeric else c.identity_candidate_confidence end,
        identity_candidate_source_url=case when v_sii_name is not null then r->>'legal_rut_source_url' else c.identity_candidate_source_url end,
        classification_hint=jsonb_strip_nulls(jsonb_build_object(
          'business_model',r->>'business_model_hint','business_model_confidence',nullif(r->>'business_model_confidence','')::numeric,
          'target_customer',r->>'target_customer_hint','target_customer_confidence',nullif(r->>'target_customer_confidence','')::numeric,
          'revenue_model',r->>'revenue_model_hint','revenue_model_confidence',nullif(r->>'revenue_model_confidence','')::numeric,
          'products',coalesce(r->'product_hints','[]'::jsonb),'countries',coalesce(r->'country_hints','[]'::jsonb),
          'virtual_asset_signals',coalesce(r->'virtual_asset_signals','[]'::jsonb),
          'classifier_version',r->>'classifier_version',
          'classification_evidence',coalesce(r->'classification_evidence','{}'::jsonb)
        ))
      where c.candidate_id::text=r->>'subject_key';
      if v_sii_name is not null then v_identity_hints:=v_identity_hints+1; end if;
    elsif r->>'subject_type'='ENTITY' then
      update public.aml_fintech_entity e set
        business_model=case when e.business_model is null and nullif(r->>'business_model_confidence','')::numeric>=0.93 then r->>'business_model_hint' else e.business_model end,
        business_model_basis=case when e.business_model is null and nullif(r->>'business_model_confidence','')::numeric>=0.93 then 'INFERRED_COMPANY_WEB_V22' else e.business_model_basis end,
        business_model_confidence=case when e.business_model is null and nullif(r->>'business_model_confidence','')::numeric>=0.93 then nullif(r->>'business_model_confidence','')::numeric else e.business_model_confidence end,
        target_customer=case when e.target_customer is null and nullif(r->>'target_customer_confidence','')::numeric>=0.93 then r->>'target_customer_hint' else e.target_customer end,
        target_customer_basis=case when e.target_customer is null and nullif(r->>'target_customer_confidence','')::numeric>=0.93 then 'INFERRED_COMPANY_WEB_V22' else e.target_customer_basis end,
        target_customer_confidence=case when e.target_customer is null and nullif(r->>'target_customer_confidence','')::numeric>=0.93 then nullif(r->>'target_customer_confidence','')::numeric else e.target_customer_confidence end,
        revenue_model=case when e.revenue_model is null and nullif(r->>'revenue_model_confidence','')::numeric>=0.93 then r->>'revenue_model_hint' else e.revenue_model end,
        revenue_model_basis=case when e.revenue_model is null and nullif(r->>'revenue_model_confidence','')::numeric>=0.93 then 'INFERRED_COMPANY_WEB_V22' else e.revenue_model_basis end,
        revenue_model_confidence=case when e.revenue_model is null and nullif(r->>'revenue_model_confidence','')::numeric>=0.93 then nullif(r->>'revenue_model_confidence','')::numeric else e.revenue_model_confidence end,
        profile_classifier_version=coalesce(r->>'classifier_version',e.profile_classifier_version),
        profile_refreshed_at=now(),refreshed_at=now()
      where e.fintech_id=r->>'subject_key';
    end if;
  end loop;
  return jsonb_build_object('processed',v_processed,'facts_upserted',v_facts,'identity_hints_resolved_sii',v_identity_hints);
end;
$function$;

revoke all on function public.aml_fintech_ingest_enrichment(jsonb) from public,anon,authenticated;
grant execute on function public.aml_fintech_ingest_enrichment(jsonb) to service_role;