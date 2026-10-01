-- Huella Pública: preservar la implementación existente y envolverla con estado de cobertura.
do $$
begin
  if to_regprocedure('public.obs_state_agency_beneficiaries_raw(jsonb)') is null
     and to_regprocedure('public.obs_state_agency_beneficiaries(jsonb)') is not null then
    alter function public.obs_state_agency_beneficiaries(jsonb) rename to obs_state_agency_beneficiaries_raw;
  end if;
end
$$;

create or replace function public.obs_state_agency_beneficiaries(p_request jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security invoker
set search_path to 'public','extensions','pg_temp'
as $$
declare
  v_result jsonb;
  v_cov jsonb;
  v_action text := lower(coalesce(nullif(trim(p_request->>'action'),''),'search'));
  v_source text := upper(coalesce(nullif(trim(p_request->>'source'),''),'ALL'));
  v_from integer := greatest(2000,least(coalesce(nullif(p_request->>'from_year','')::integer,2016),extract(year from current_date)::integer));
  v_to integer;
begin
  v_to := greatest(v_from,least(coalesce(nullif(p_request->>'to_year','')::integer,extract(year from current_date)::integer),extract(year from current_date)::integer));
  v_result := public.obs_state_agency_beneficiaries_raw(p_request);

  if v_action <> 'rows' or v_source = 'PUBLIC_FUNDS' then
    return v_result;
  end if;

  v_cov := public.obs_market_public_coverage(v_from,v_to);
  v_result := jsonb_set(v_result,'{market_coverage}',v_cov,true);
  v_result := jsonb_set(v_result,'{semantics,market_coverage}',to_jsonb(coalesce(v_cov->>'message','Cobertura no informada')),true);
  v_result := jsonb_set(v_result,'{semantics,market_zero_valid}',to_jsonb(coalesce(v_cov->>'zero_is_valid','false')),true);

  if coalesce(v_cov->>'status','NONE') <> 'COMPLETE' then
    v_result := jsonb_set(v_result,'{summary,market_amount}','null'::jsonb,true);
    v_result := jsonb_set(v_result,'{summary,market_orders}','null'::jsonb,true);
    v_result := jsonb_set(v_result,'{summary,top10_market_share}','null'::jsonb,true);
    v_result := jsonb_set(v_result,'{market_incomplete}','true'::jsonb,true);
  else
    v_result := jsonb_set(v_result,'{market_incomplete}','false'::jsonb,true);
  end if;
  return v_result;
end
$$;

grant execute on function public.obs_state_agency_beneficiaries(jsonb) to authenticated;
revoke all on function public.obs_state_agency_beneficiaries_raw(jsonb) from public,anon;
grant execute on function public.obs_state_agency_beneficiaries_raw(jsonb) to authenticated;
