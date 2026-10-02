-- Huella pública: cobertura explícita por fuente y período.
-- Evita presentar $0 cuando un año aún no está cargado en Presupuesto Abierto
-- y conserva separadas las semánticas de órdenes, pagos y ejecución devengada.

create or replace function public.obs_state_agency_beneficiaries(p_request jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public','extensions','pg_temp'
set statement_timeout to '60s'
as $$
declare
  v_result jsonb;
  v_cov jsonb;
  v_action text := lower(coalesce(nullif(trim(p_request->>'action'),''),'search'));
  v_source text := upper(coalesce(nullif(trim(p_request->>'source'),''),'ALL'));
  v_from integer := greatest(2000,least(coalesce(nullif(p_request->>'from_year','')::integer,2016),extract(year from current_date)::integer));
  v_to integer;
  v_agency_name text := upper(trim(coalesce(p_request->>'agency_name','')));
  v_is_municipality boolean;
  v_flow_years integer := 0;
  v_exec_years integer := 0;
  v_requested_years integer;
  v_flow_min integer;
  v_flow_max integer;
  v_exec_min integer;
  v_exec_max integer;
  v_flow_status text;
  v_exec_status text;
  v_pa_status text;
  v_pa_message text;
begin
  if v_action='search' then
    return public.obs_state_agency_search(p_request);
  end if;

  v_to := greatest(v_from,least(coalesce(nullif(p_request->>'to_year','')::integer,extract(year from current_date)::integer),extract(year from current_date)::integer));
  v_requested_years := v_to-v_from+1;
  v_is_municipality := v_agency_name like '%MUNICIPALIDAD%';
  v_result := public.obs_state_agency_beneficiaries_raw(p_request);

  if v_action='rows' and v_is_municipality then
    v_result := jsonb_set(v_result,'{public_funds_incomplete}','true'::jsonb,true);
    v_result := jsonb_set(v_result,'{public_funds_coverage_status}',to_jsonb('MUNICIPAL_MONITOR_NOT_INGESTED'::text),true);
    v_result := jsonb_set(v_result,'{summary,public_funds_amount}','null'::jsonb,true);
    v_result := jsonb_set(v_result,'{summary,public_funds_transactions}','null'::jsonb,true);
    v_result := jsonb_set(v_result,'{summary,public_funds_execution_amount}','null'::jsonb,true);
    v_result := jsonb_set(v_result,'{summary,public_funds_personnel_amount}','null'::jsonb,true);
    v_result := jsonb_set(v_result,'{summary,public_funds_execution_transactions}','null'::jsonb,true);
    v_result := jsonb_set(v_result,'{summary,public_funds_personnel_share}','null'::jsonb,true);
    v_result := jsonb_set(v_result,'{summary,public_funds_flow_execution_share}','null'::jsonb,true);
    v_result := jsonb_set(v_result,'{summary,top10_public_funds_share}','null'::jsonb,true);
    v_result := jsonb_set(v_result,'{public_funds_coverage}',jsonb_build_object(
      'status','MUNICIPAL_MONITOR_NOT_INGESTED','scope','MUNICIPAL','zero_is_valid',false,
      'message','La fuente municipal de Presupuesto Abierto aún no está integrada en ATLAS.'
    ),true);
    v_result := jsonb_set(v_result,'{semantics,public_funds_coverage}',to_jsonb('Municipalidad detectada: la fuente municipal de Presupuesto Abierto (Monitor de gastos municipales/DTE) aún no está integrada en ATLAS. Los guiones no significan cero gasto ni cero flujos.'::text),true);
    v_result := jsonb_set(v_result,'{semantics,public_funds_zero_valid}','false'::jsonb,true);
  elsif v_action='rows' then
    select min(period_year),max(period_year),count(distinct period_year) filter (where period_year between v_from and v_to)
      into v_flow_min,v_flow_max,v_flow_years
    from public.obs_public_funds_payer_year;

    select min(period_year),max(period_year),count(distinct period_year) filter (where period_year between v_from and v_to)
      into v_exec_min,v_exec_max,v_exec_years
    from public.obs_public_funds_execution_year;

    v_flow_status := case
      when coalesce(v_flow_years,0)=0 then 'NONE'
      when v_flow_years=v_requested_years then 'COMPLETE'
      else 'PARTIAL'
    end;
    v_exec_status := case
      when coalesce(v_exec_years,0)=0 then 'NONE'
      when v_exec_years=v_requested_years then 'COMPLETE'
      else 'PARTIAL'
    end;
    v_pa_status := case
      when v_flow_status='COMPLETE' and v_exec_status='COMPLETE' then 'COMPLETE'
      when v_flow_status='NONE' and v_exec_status='NONE' then 'NONE'
      else 'PARTIAL'
    end;

    if v_pa_status='COMPLETE' then
      v_pa_message := format('Presupuesto Abierto tiene cobertura cargada para todos los años consultados (%s–%s).',v_from,v_to);
    elsif v_pa_status='NONE' then
      v_pa_message := format('Presupuesto Abierto no tiene años cargados para %s–%s. La cobertura disponible actualmente comienza en %s para flujos y %s para ejecución; un cero no debe interpretarse como ausencia de pagos o gasto.',v_from,v_to,coalesce(v_flow_min::text,'—'),coalesce(v_exec_min::text,'—'));
    else
      v_pa_message := format('Presupuesto Abierto tiene cobertura parcial para %s–%s. Los montos visibles corresponden sólo a los años cargados; un cero fuera de esa cobertura no es válido.',v_from,v_to);
    end if;

    v_result := jsonb_set(v_result,'{public_funds_incomplete}',to_jsonb(v_pa_status<>'COMPLETE'),true);
    v_result := jsonb_set(v_result,'{public_funds_coverage_status}',to_jsonb(v_pa_status),true);
    v_result := jsonb_set(v_result,'{public_funds_coverage}',jsonb_build_object(
      'status',v_pa_status,
      'scope','GOVERNMENT_CENTRAL',
      'requested_from_year',v_from,
      'requested_to_year',v_to,
      'flow_status',v_flow_status,
      'flow_first_year',v_flow_min,
      'flow_last_year',v_flow_max,
      'flow_years_loaded',v_flow_years,
      'execution_status',v_exec_status,
      'execution_first_year',v_exec_min,
      'execution_last_year',v_exec_max,
      'execution_years_loaded',v_exec_years,
      'zero_is_valid',v_pa_status='COMPLETE',
      'message',v_pa_message
    ),true);
    v_result := jsonb_set(v_result,'{semantics,public_funds_coverage}',to_jsonb(v_pa_message),true);
    v_result := jsonb_set(v_result,'{semantics,public_funds_zero_valid}',to_jsonb(v_pa_status='COMPLETE'),true);

    if v_flow_status='NONE' then
      v_result := jsonb_set(v_result,'{summary,public_funds_amount}','null'::jsonb,true);
      v_result := jsonb_set(v_result,'{summary,public_funds_transactions}','null'::jsonb,true);
      v_result := jsonb_set(v_result,'{summary,top10_public_funds_share}','null'::jsonb,true);
      v_result := jsonb_set(v_result,'{summary,public_funds_flow_execution_share}','null'::jsonb,true);
    end if;

    if v_exec_status='NONE' then
      v_result := jsonb_set(v_result,'{summary,public_funds_execution_amount}','null'::jsonb,true);
      v_result := jsonb_set(v_result,'{summary,public_funds_personnel_amount}','null'::jsonb,true);
      v_result := jsonb_set(v_result,'{summary,public_funds_execution_transactions}','null'::jsonb,true);
      v_result := jsonb_set(v_result,'{summary,public_funds_personnel_share}','null'::jsonb,true);
      v_result := jsonb_set(v_result,'{summary,public_funds_flow_execution_share}','null'::jsonb,true);
    end if;

    if v_flow_status='PARTIAL' then
      v_result := jsonb_set(v_result,'{semantics,public_funds_amount_scope}',to_jsonb('Monto y pagos observados sólo en los años de Presupuesto Abierto actualmente cargados dentro del período solicitado.'::text),true);
    elsif v_flow_status='NONE' then
      v_result := jsonb_set(v_result,'{semantics,public_funds_amount_scope}',to_jsonb('Sin cobertura cargada de flujos de Presupuesto Abierto para el período solicitado.'::text),true);
    else
      v_result := jsonb_set(v_result,'{semantics,public_funds_amount_scope}',to_jsonb('Cobertura cargada de flujos para todos los años solicitados.'::text),true);
    end if;

    v_result := jsonb_set(v_result,'{semantics,source_reconciliation}',to_jsonb('Mercado Público registra órdenes de compra; Presupuesto Abierto registra ejecución devengada y pagos. Las fuentes se concilian por organismo, RUT de contraparte y período, pero sus montos no son equivalentes ni deben forzarse a coincidir.'::text),true);
  end if;

  if v_action <> 'rows' or v_source = 'PUBLIC_FUNDS' then
    return v_result;
  end if;

  v_cov := public.obs_market_public_coverage(v_from,v_to);
  v_result := jsonb_set(v_result,'{market_coverage}',v_cov,true);
  v_result := jsonb_set(v_result,'{semantics,market_coverage}',to_jsonb(coalesce(v_cov->>'message','Cobertura no informada')),true);
  v_result := jsonb_set(v_result,'{semantics,market_zero_valid}',to_jsonb(coalesce(v_cov->>'zero_is_valid','false')),true);

  if coalesce(v_cov->>'status','NONE') <> 'COMPLETE' then
    v_result := jsonb_set(v_result,'{market_incomplete}','true'::jsonb,true);
    v_result := jsonb_set(v_result,'{semantics,market_amount_scope}',to_jsonb('Monto y órdenes observadas en la cobertura actualmente cargada; cobertura histórica en reconstrucción.'::text),true);
  else
    v_result := jsonb_set(v_result,'{market_incomplete}','false'::jsonb,true);
    v_result := jsonb_set(v_result,'{semantics,market_amount_scope}',to_jsonb('Cobertura completa para el período consultado.'::text),true);
  end if;
  return v_result;
end
$$;

revoke all on function public.obs_state_agency_beneficiaries(jsonb) from public,anon;
grant execute on function public.obs_state_agency_beneficiaries(jsonb) to authenticated;

comment on function public.obs_state_agency_beneficiaries(jsonb) is
  'Huella pública: consulta organismos y contrapartes con cobertura explícita por fuente/año. Evita interpretar como cero los períodos de Presupuesto Abierto aún no cargados y mantiene Mercado Público separado.';
