create or replace function public.aml_fintech_profile_normalize_v222(p_row jsonb)
returns jsonb
language plpgsql
immutable
set search_path to 'public','pg_temp'
as $function$
declare
  r jsonb:=coalesce(p_row,'{}'::jsonb);
  ev jsonb:=coalesce(r->'classification_evidence','{}'::jsonb);
  b2b jsonb:=coalesce(ev->'b2b','{}'::jsonb);
  b2c jsonb:=coalesce(ev->'b2c','{}'::jsonb);
  rev jsonb:=coalesce(ev->'revenue','[]'::jsonb);
  bm text:=r->>'business_model_hint';
  bc numeric:=coalesce(nullif(r->>'business_model_confidence','')::numeric,0);
  rm text:=r->>'revenue_model_hint';
  rc numeric:=coalesce(nullif(r->>'revenue_model_confidence','')::numeric,0);
  b2b_score numeric:=coalesce(nullif(b2b->>'score','')::numeric,0);
  b2b_strong numeric:=coalesce(nullif(b2b->>'strong','')::numeric,0);
  b2c_score numeric:=coalesce(nullif(b2c->>'score','')::numeric,0);
  b2b_strong_matches text[]:=array(select jsonb_array_elements_text(coalesce(b2b->'strongMatches','[]'::jsonb)));
  b2c_strong_matches text[]:=array(select jsonb_array_elements_text(coalesce(b2c->'strongMatches','[]'::jsonb)));
  rev_strong_matches text[]:=array(select jsonb_array_elements_text(coalesce(rev->0->'strongMatches','[]'::jsonb)));
  has_explicit_b2b boolean:=false;
  ambiguous_b2c_only boolean:=false;
begin
  has_explicit_b2b := b2b_strong_matches && array[
    'para empresas','para negocios','para comercios','para pymes','for businesses','for enterprises',
    'financial institutions','for financial institutions','large enterprises','enterprise software','enterprise platform'
  ]::text[];

  ambiguous_b2c_only := cardinality(b2c_strong_matches)>0
    and not exists (
      select 1 from unnest(b2c_strong_matches) x
      where x <> all(array['para ti','persona natural','personas naturales','solicita tu credito','tarjeta prepago']::text[])
    );

  if ambiguous_b2c_only and has_explicit_b2b and b2b_strong>=3 and b2b_score>=5 then
    bm:='B2B'; bc:=greatest(bc,0.94);
    r:=jsonb_set(r,'{target_customer_hint}','"EMPRESAS"'::jsonb,true);
    r:=jsonb_set(r,'{target_customer_confidence}',to_jsonb(bc),true);
    ev:=jsonb_set(ev,'{normalization_note}',to_jsonb('V222_DB_MERCHANT_TARGET_OVERRIDE'::text),true);
  elsif (bm is null or bc<0.93) and has_explicit_b2b and b2b_score>=8 and b2c_score<=2 then
    bm:='B2B'; bc:=0.94;
    r:=jsonb_set(r,'{target_customer_hint}','"EMPRESAS"'::jsonb,true);
    r:=jsonb_set(r,'{target_customer_confidence}',to_jsonb(bc),true);
    ev:=jsonb_set(ev,'{normalization_note}',to_jsonb('V222_DB_EXPLICIT_B2B_UPGRADE'::text),true);
  end if;

  if rm='INTERES_ORIGINACION'
     and cardinality(rev_strong_matches)>0
     and not exists(select 1 from unnest(rev_strong_matches) x where x<>'cae') then
    rm:=null; rc:=0;
    ev:=jsonb_set(ev,'{revenue_normalization_note}',to_jsonb('V222_DB_REJECT_CAE_AS_REVENUE_SIGNAL'::text),true);
  end if;

  r:=jsonb_set(r,'{business_model_hint}',case when bm is null then 'null'::jsonb else to_jsonb(bm) end,true);
  r:=jsonb_set(r,'{business_model_confidence}',to_jsonb(bc),true);
  if bm is null then
    r:=jsonb_set(r,'{target_customer_hint}','null'::jsonb,true);
    r:=jsonb_set(r,'{target_customer_confidence}','0'::jsonb,true);
  end if;
  r:=jsonb_set(r,'{revenue_model_hint}',case when rm is null then 'null'::jsonb else to_jsonb(rm) end,true);
  r:=jsonb_set(r,'{revenue_model_confidence}',to_jsonb(rc),true);
  r:=jsonb_set(r,'{classifier_version}',to_jsonb('2.2.2-db'::text),true);
  r:=jsonb_set(r,'{classification_evidence}',ev,true);
  return r;
end;
$function$;

revoke all on function public.aml_fintech_profile_normalize_v222(jsonb) from public,anon,authenticated;
grant execute on function public.aml_fintech_profile_normalize_v222(jsonb) to service_role;

do $$
declare ddl text;
begin
  select pg_get_functiondef(p.oid) into ddl
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='aml_fintech_ingest_enrichment';
  if position('aml_fintech_profile_normalize_v222' in ddl)=0 then
    ddl:=replace(ddl,'v_processed:=v_processed+1;','v_processed:=v_processed+1; r:=public.aml_fintech_profile_normalize_v222(r);');
    execute ddl;
  end if;

  select pg_get_functiondef(p.oid) into ddl
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='aml_fintech_enrichment_batch';
  ddl:=replace(ddl,'''2.2.2''','''2.2.2-db''');
  execute ddl;
end $$;