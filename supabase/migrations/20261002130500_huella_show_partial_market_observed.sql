-- Mantiene visibles los montos/OC efectivamente cargados de Mercado Público durante el backfill.
-- La versión anterior convertía estos valores a NULL mientras la cobertura no fuese COMPLETE,
-- haciendo que Huella pública mostrara “—” aun cuando existían órdenes observadas.

create or replace function public.obs_state_agency_beneficiaries(p_request jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  v_result jsonb;
  v_cov jsonb;
  v_action text := lower(coalesce(nullif(trim(p_request->>'action'),''),'search'));
  v_source text := upper(coalesce(nullif(trim(p_request->>'source'),''),'ALL'));
  v_from integer := greatest(2000,least(coalesce(nullif(p_request->>'from_year','')::integer,2016),extract(year from current_date)::integer));
  v_to integer;
begin
  if v_action='search' then
    return public.obs_state_agency_search(p_request);
  end if;

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
    v_result := jsonb_set(v_result,'{market_incomplete}', 'true'::jsonb, true);
    v_result := jsonb_set(v_result,'{semantics,market_amount_scope}',to_jsonb('Monto y órdenes observadas en la cobertura actualmente cargada; cobertura histórica en reconstrucción.'::text),true);
  else
    v_result := jsonb_set(v_result,'{market_incomplete}', 'false'::jsonb, true);
    v_result := jsonb_set(v_result,'{semantics,market_amount_scope}',to_jsonb('Cobertura completa para el período consultado.'::text),true);
  end if;

  return v_result;
end
$$;
