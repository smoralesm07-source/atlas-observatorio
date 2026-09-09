create or replace function public.aml_fintech_promote_candidate_identity(
  p_candidate_id bigint,
  p_rut text,
  p_basis text,
  p_score numeric default 0.99,
  p_brand text default null,
  p_evidence_url text default null,
  p_evidence_source text default 'SII_PUBLIC',
  p_role_code text default 'PRIMARY_OPERATING_ENTITY'
) returns jsonb
language plpgsql
set search_path to public, extensions, pg_temp
as $function$
declare
  c record;
  s record;
  v_res boolean:=false;
  v_fintech_id text;
  v_rows integer:=0;
  v_facts integer:=0;
  v_funcs integer:=0;
  v_metrics integer:=0;
  x record;
begin
  select * into c from public.aml_fintech_candidate where candidate_id=p_candidate_id and matched_fintech_id is null;
  if c.candidate_id is null then return jsonb_build_object('ok',false,'reason','CANDIDATE_NOT_FOUND_OR_ALREADY_MATCHED','candidate_id',p_candidate_id); end if;

  select * into s from public.aml_sii_registry_company where rut=p_rut order by refreshed_at desc nulls last,last_seen_at desc nulls last limit 1;
  if s.entity_id is null then return jsonb_build_object('ok',false,'reason','RUT_NOT_FOUND_IN_SII','rut',p_rut); end if;
  select exists(select 1 from public.aml_res_company r where r.rut=s.rut) into v_res;
  v_fintech_id:=s.entity_id;

  insert into public.aml_fintech_entity(
    fintech_id,atlas_entity_id,rut,brand,legal_name,website,presence_chile,entity_status,
    identification_status,identification_basis,primary_vertical,psav_status,confidence,
    first_seen_at,last_seen_at,refreshed_at
  ) values(
    v_fintech_id,s.entity_id,s.rut,coalesce(p_brand,c.name_raw),s.legal_name,c.website,
    'CONFIRMED','ACTIVE_OBSERVED','CONFIRMED',p_basis,c.vertical_hint,'NO_EVIDENCE',least(1,greatest(0,p_score)),
    coalesce(c.first_seen_at,now()),now(),now()
  ) on conflict(fintech_id) do update set
    atlas_entity_id=excluded.atlas_entity_id,
    rut=excluded.rut,
    brand=coalesce(public.aml_fintech_entity.brand,excluded.brand),
    legal_name=excluded.legal_name,
    website=coalesce(public.aml_fintech_entity.website,excluded.website),
    primary_vertical=coalesce(public.aml_fintech_entity.primary_vertical,excluded.primary_vertical),
    identification_status='CONFIRMED',
    identification_basis=excluded.identification_basis,
    confidence=greatest(public.aml_fintech_entity.confidence,excluded.confidence),
    last_seen_at=now(),refreshed_at=now();

  update public.aml_fintech_candidate set
    candidate_status='MATCHED_EXISTING',matched_fintech_id=v_fintech_id,match_method=p_basis,match_score=p_score,
    identity_candidate_rut=s.rut,identity_candidate_legal_name=s.legal_name,identity_candidate_confidence=p_score,
    identity_candidate_source_url=coalesce(p_evidence_url,'https://www.sii.cl/'),last_seen_at=now()
  where candidate_id=c.candidate_id;

  insert into public.aml_fintech_entity_source(fintech_id,source_code,source_entity_key,source_label,source_url,status,evidence,first_seen_at,last_seen_at)
  values(v_fintech_id,c.source_code,c.source_entity_key,coalesce(p_brand,c.name_raw),c.source_url,'OBSERVED',
         coalesce(c.evidence,'{}'::jsonb)||jsonb_build_object('identity_basis',p_basis,'identity_score',p_score),coalesce(c.first_seen_at,now()),now())
  on conflict(fintech_id,source_code) do update set
    source_entity_key=excluded.source_entity_key,source_label=excluded.source_label,
    source_url=coalesce(excluded.source_url,public.aml_fintech_entity_source.source_url),status='OBSERVED',
    evidence=public.aml_fintech_entity_source.evidence||excluded.evidence,last_seen_at=now();

  insert into public.aml_fintech_entity_source(fintech_id,source_code,source_entity_key,source_label,source_url,status,evidence,first_seen_at,last_seen_at)
  values(v_fintech_id,'SII_PUBLIC',s.rut,s.legal_name,'https://www.sii.cl/','OBSERVED',jsonb_build_object('identity_basis',p_basis),now(),now())
  on conflict(fintech_id,source_code) do update set source_entity_key=excluded.source_entity_key,source_label=excluded.source_label,status='OBSERVED',evidence=public.aml_fintech_entity_source.evidence||excluded.evidence,last_seen_at=now();

  if v_res then
    insert into public.aml_fintech_entity_source(fintech_id,source_code,source_entity_key,source_label,source_url,status,evidence,first_seen_at,last_seen_at)
    values(v_fintech_id,'RES_PUBLIC',s.rut,s.legal_name,'https://www.registrodeempresasysociedades.cl/','OBSERVED',jsonb_build_object('identity_basis',p_basis),now(),now())
    on conflict(fintech_id,source_code) do update set source_entity_key=excluded.source_entity_key,source_label=excluded.source_label,status='OBSERVED',evidence=public.aml_fintech_entity_source.evidence||excluded.evidence,last_seen_at=now();
  end if;

  if p_evidence_source is not null and p_evidence_source not in (c.source_code,'SII_PUBLIC','RES_PUBLIC') then
    insert into public.aml_fintech_entity_source(fintech_id,source_code,source_entity_key,source_label,source_url,status,evidence,first_seen_at,last_seen_at)
    values(v_fintech_id,p_evidence_source,coalesce(c.source_entity_key,s.rut),coalesce(p_brand,c.name_raw),p_evidence_url,'OBSERVED',jsonb_build_object('identity_basis',p_basis,'identity_score',p_score),now(),now())
    on conflict(fintech_id,source_code) do update set source_url=coalesce(excluded.source_url,public.aml_fintech_entity_source.source_url),status='OBSERVED',evidence=public.aml_fintech_entity_source.evidence||excluded.evidence,last_seen_at=now();
  end if;

  perform public.aml_fintech_link_legal_vehicle(v_fintech_id,s.rut,p_role_code,true,coalesce(p_evidence_source,'SII_PUBLIC'),p_evidence_url,p_basis,p_score,s.legal_name,jsonb_build_object('candidate_id',p_candidate_id,'source_code',c.source_code));

  for x in select * from public.aml_fintech_candidate q where q.candidate_id<>c.candidate_id and q.matched_fintech_id is null and q.rut_raw=s.rut
  loop
    update public.aml_fintech_candidate set candidate_status='MATCHED_EXISTING',matched_fintech_id=v_fintech_id,match_method='EXACT_RUT_AFTER_GENERIC_PROMOTION',match_score=1,last_seen_at=now() where candidate_id=x.candidate_id;
    insert into public.aml_fintech_entity_source(fintech_id,source_code,source_entity_key,source_label,source_url,status,evidence,first_seen_at,last_seen_at)
    values(v_fintech_id,x.source_code,x.source_entity_key,x.name_raw,x.source_url,'OBSERVED',coalesce(x.evidence,'{}'::jsonb),coalesce(x.first_seen_at,now()),now())
    on conflict(fintech_id,source_code) do update set source_entity_key=excluded.source_entity_key,source_label=excluded.source_label,source_url=excluded.source_url,status='OBSERVED',evidence=public.aml_fintech_entity_source.evidence||excluded.evidence,last_seen_at=now();
  end loop;

  update public.aml_fintech_enrichment_fact set subject_type='ENTITY',subject_key=v_fintech_id where subject_type='CANDIDATE' and subject_key=c.candidate_id::text;
  get diagnostics v_rows=row_count; v_facts:=v_facts+v_rows;
  update public.aml_fintech_function_observation set subject_type='ENTITY',subject_key=v_fintech_id where subject_type='CANDIDATE' and subject_key=c.candidate_id::text;
  get diagnostics v_rows=row_count; v_funcs:=v_funcs+v_rows;
  update public.aml_fintech_market_metric_observation set subject_type='ENTITY',subject_key=v_fintech_id where subject_type='CANDIDATE' and subject_key=c.candidate_id::text;
  get diagnostics v_rows=row_count; v_metrics:=v_metrics+v_rows;

  return jsonb_build_object('ok',true,'fintech_id',v_fintech_id,'rut',s.rut,'legal_name',s.legal_name,'res',v_res,'facts_migrated',v_facts,'functions_migrated',v_funcs,'metrics_migrated',v_metrics,'source_code',c.source_code);
end;$function$;

revoke all on function public.aml_fintech_promote_candidate_identity(bigint,text,text,numeric,text,text,text,text) from public,anon,authenticated;
grant execute on function public.aml_fintech_promote_candidate_identity(bigint,text,text,numeric,text,text,text,text) to service_role;