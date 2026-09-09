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
  v_model_conf numeric;
  v_customer_conf numeric;
  v_revenue_conf numeric;
  v_classifier text;
begin
  if p_rows is null or jsonb_typeof(p_rows)<>'array' then raise exception 'p_rows must be an array'; end if;
  for r in select value from jsonb_array_elements(p_rows)
  loop
    v_processed:=v_processed+1;
    v_model_conf:=coalesce(nullif(r->>'business_model_confidence','')::numeric,0);
    v_customer_conf:=coalesce(nullif(r->>'target_customer_confidence','')::numeric,0);
    v_revenue_conf:=coalesce(nullif(r->>'revenue_model_confidence','')::numeric,0);
    v_classifier:=coalesce(nullif(r->>'classifier_version',''),'unknown');

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
          'business_model',r->>'business_model_hint','business_model_confidence',v_model_conf,
          'target_customer',r->>'target_customer_hint','target_customer_confidence',v_customer_conf,
          'revenue_model',r->>'revenue_model_hint','revenue_model_confidence',v_revenue_conf,
          'products',coalesce(r->'product_hints','[]'::jsonb),'countries',coalesce(r->'country_hints','[]'::jsonb),
          'virtual_asset_signals',coalesce(r->'virtual_asset_signals','[]'::jsonb),
          'classifier_version',v_classifier,
          'classification_evidence',coalesce(r->'classification_evidence','{}'::jsonb)
        ))
      where c.candidate_id::text=r->>'subject_key';
      if v_sii_name is not null then v_identity_hints:=v_identity_hints+1; end if;

    elsif r->>'subject_type'='ENTITY' then
      insert into public.aml_fintech_profile_audit(
        fintech_id,classifier_version,business_model,business_model_confidence,target_customer,target_customer_confidence,
        revenue_model,revenue_model_confidence,pages_scanned,observed_at,evidence
      ) values (
        r->>'subject_key',v_classifier,r->>'business_model_hint',v_model_conf,
        r->>'target_customer_hint',v_customer_conf,r->>'revenue_model_hint',v_revenue_conf,
        nullif(r->>'pages_scanned','')::integer,now(),coalesce(r->'classification_evidence','{}'::jsonb)
      );

      update public.aml_fintech_entity e set
        business_model=case
          when coalesce(e.business_model_basis,'') like 'INFERRED_COMPANY_WEB_V%' then case when v_model_conf>=0.93 then r->>'business_model_hint' else null end
          when e.business_model is null and v_model_conf>=0.93 then r->>'business_model_hint'
          else e.business_model end,
        business_model_basis=case
          when coalesce(e.business_model_basis,'') like 'INFERRED_COMPANY_WEB_V%' then case when v_model_conf>=0.93 then 'INFERRED_COMPANY_WEB_V221' else null end
          when e.business_model is null and v_model_conf>=0.93 then 'INFERRED_COMPANY_WEB_V221'
          else e.business_model_basis end,
        business_model_confidence=case
          when coalesce(e.business_model_basis,'') like 'INFERRED_COMPANY_WEB_V%' then case when v_model_conf>=0.93 then v_model_conf else null end
          when e.business_model is null and v_model_conf>=0.93 then v_model_conf
          else e.business_model_confidence end,

        target_customer=case
          when coalesce(e.target_customer_basis,'') like 'INFERRED_COMPANY_WEB_V%' then case when v_customer_conf>=0.93 then r->>'target_customer_hint' else null end
          when e.target_customer is null and v_customer_conf>=0.93 then r->>'target_customer_hint'
          else e.target_customer end,
        target_customer_basis=case
          when coalesce(e.target_customer_basis,'') like 'INFERRED_COMPANY_WEB_V%' then case when v_customer_conf>=0.93 then 'INFERRED_COMPANY_WEB_V221' else null end
          when e.target_customer is null and v_customer_conf>=0.93 then 'INFERRED_COMPANY_WEB_V221'
          else e.target_customer_basis end,
        target_customer_confidence=case
          when coalesce(e.target_customer_basis,'') like 'INFERRED_COMPANY_WEB_V%' then case when v_customer_conf>=0.93 then v_customer_conf else null end
          when e.target_customer is null and v_customer_conf>=0.93 then v_customer_conf
          else e.target_customer_confidence end,

        revenue_model=case
          when coalesce(e.revenue_model_basis,'') like 'INFERRED_COMPANY_WEB_V%' then case when v_revenue_conf>=0.93 then r->>'revenue_model_hint' else null end
          when e.revenue_model is null and v_revenue_conf>=0.93 then r->>'revenue_model_hint'
          else e.revenue_model end,
        revenue_model_basis=case
          when coalesce(e.revenue_model_basis,'') like 'INFERRED_COMPANY_WEB_V%' then case when v_revenue_conf>=0.93 then 'INFERRED_COMPANY_WEB_V221' else null end
          when e.revenue_model is null and v_revenue_conf>=0.93 then 'INFERRED_COMPANY_WEB_V221'
          else e.revenue_model_basis end,
        revenue_model_confidence=case
          when coalesce(e.revenue_model_basis,'') like 'INFERRED_COMPANY_WEB_V%' then case when v_revenue_conf>=0.93 then v_revenue_conf else null end
          when e.revenue_model is null and v_revenue_conf>=0.93 then v_revenue_conf
          else e.revenue_model_confidence end,

        profile_classifier_version=v_classifier,
        profile_refreshed_at=now(),
        refreshed_at=now()
      where e.fintech_id=r->>'subject_key';
    end if;
  end loop;
  return jsonb_build_object('processed',v_processed,'facts_upserted',v_facts,'identity_hints_resolved_sii',v_identity_hints);
end;
$function$;

revoke all on function public.aml_fintech_ingest_enrichment(jsonb) from public,anon,authenticated;
grant execute on function public.aml_fintech_ingest_enrichment(jsonb) to service_role;

create or replace function public.aml_fintech_enrichment_batch(p_limit integer default 20)
returns jsonb
language sql
stable security definer
set search_path to 'public','pg_temp'
as $function$
with lim as (select greatest(1,least(coalesce(p_limit,20),40))::int n),
cand as (
  select 'CANDIDATE'::text subject_type,c.candidate_id::text subject_key,c.name_raw display_name,c.rut_raw rut,c.website,c.domain,c.source_code,c.source_url,c.enrichment_refreshed_at refreshed_at,2 priority
  from public.aml_fintech_candidate c
  where c.matched_fintech_id is null and c.website is not null and btrim(c.website)<>''
    and (c.source_code not in ('FINTECHILE_MEMBERS','LATAMFINTECH_CHILE') or exists (
      select 1 from public.aml_v_fintech_ecosystem_semantic_current s where s.candidate_id=c.candidate_id and s.semantic_stage like 'OPEN_%'))
  order by c.enrichment_refreshed_at asc nulls first,c.name_raw
  limit greatest(1,ceil((select n from lim)*0.20)::int)
), ent as (
  select 'ENTITY'::text subject_type,e.fintech_id subject_key,coalesce(e.brand,e.legal_name) display_name,e.rut,e.website,null::text domain,'COMPANY_WEB'::text source_code,e.website source_url,e.profile_refreshed_at refreshed_at,1 priority
  from public.aml_fintech_entity e
  where e.website is not null and btrim(e.website)<>''
  order by case when e.profile_classifier_version is distinct from '2.2.1' then 0 else 1 end,
           case when e.business_model is null or e.target_customer is null or e.revenue_model is null then 0 else 1 end,
           e.profile_refreshed_at asc nulls first,display_name
  limit greatest(1,floor((select n from lim)*0.80)::int)
), q as (select * from ent union all select * from cand)
select coalesce(jsonb_agg(jsonb_build_object('subject_type',subject_type,'subject_key',subject_key,'display_name',display_name,'rut',rut,'website',website,'domain',domain,'source_code',source_code,'source_url',source_url,'refreshed_at',refreshed_at) order by priority,refreshed_at asc nulls first,display_name),'[]'::jsonb) from q;
$function$;

revoke all on function public.aml_fintech_enrichment_batch(integer) from public,anon,authenticated;
grant execute on function public.aml_fintech_enrichment_batch(integer) to service_role;