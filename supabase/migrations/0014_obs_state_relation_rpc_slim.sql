-- Slim RPC for Entidad 360: the base payload never carries payer-history rows.
-- Payer/year detail is exposed separately and paginated, so it is only read on
-- demand by UI surfaces that actually need it.

create or replace function public.obs_state_relation_detail(p_entity_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public','pg_temp'
as $$
declare
  v_rut text;
  v_supplier jsonb;
  v_funds jsonb;
  v_years jsonb;
  v_mp_status jsonb;
  v_pa_status jsonb;
begin
  if not (
    auth.role() = 'service_role' or (
      auth.uid() is not null and exists (
        select 1 from public.aml_allowed_users u where u.user_id=auth.uid() and u.enabled
      )
    )
  ) then
    raise exception 'ATLAS_CORE_FORBIDDEN' using errcode='42501';
  end if;

  select rut into v_rut from public.obs_entity where entity_id=p_entity_id;
  if v_rut is null then
    return jsonb_build_object('entity_id',p_entity_id,'rut',null,'marks','[]'::jsonb);
  end if;

  select to_jsonb(s) into v_supplier from public.obs_state_supplier_directory s where s.rut=v_rut;
  select to_jsonb(f) into v_funds from public.obs_public_funds_entity f where f.rut=v_rut;
  select coalesce(jsonb_agg(to_jsonb(y) order by y.period_year desc),'[]'::jsonb)
    into v_years from public.obs_public_funds_year y where y.rut=v_rut;
  select to_jsonb(r) into v_mp_status from public.obs_state_relation_refresh r where source_code='MERCADO_PUBLICO';
  select to_jsonb(r) into v_pa_status from public.obs_state_relation_refresh r where source_code='PRESUPUESTO_ABIERTO';

  return jsonb_build_object(
    'entity_id',p_entity_id,'rut',v_rut,
    'marks', jsonb_build_array(
      jsonb_build_object(
        'code','STATE_SUPPLIER','label','Proveedor del Estado','active',v_supplier is not null,
        'status',case when v_supplier is not null then 'PRESENT' when v_mp_status->>'status'='READY' then 'ABSENT' else 'UNKNOWN' end,
        'source','MERCADO_PUBLICO','included_in_score',false),
      jsonb_build_object(
        'code','PUBLIC_FUNDS_RECIPIENT','label','Fondos públicos','active',v_funds is not null,
        'status',case when v_funds is not null then 'PRESENT' when v_pa_status->>'status'='READY' then 'ABSENT' else 'UNKNOWN' end,
        'source','PRESUPUESTO_ABIERTO','included_in_score',false)
    ),
    'supplier',v_supplier,'public_funds',v_funds,
    'public_funds_years',v_years,
    'source_status',jsonb_build_object('mercado_publico',v_mp_status,'presupuesto_abierto',v_pa_status)
  );
end
$$;

create or replace function public.obs_public_funds_payer_detail(
  p_entity_id text,
  p_year integer default null,
  p_limit integer default 100,
  p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public','pg_temp'
as $$
declare
  v_rut text;
  v_rows jsonb;
  v_limit integer := greatest(1, least(coalesce(p_limit,100),500));
  v_offset integer := greatest(0,coalesce(p_offset,0));
begin
  if not (
    auth.role() = 'service_role' or (
      auth.uid() is not null and exists (
        select 1 from public.aml_allowed_users u where u.user_id=auth.uid() and u.enabled
      )
    )
  ) then
    raise exception 'ATLAS_CORE_FORBIDDEN' using errcode='42501';
  end if;

  select rut into v_rut from public.obs_entity where entity_id=p_entity_id;
  if v_rut is null then
    return jsonb_build_object('rows','[]'::jsonb,'count',0,'limit',v_limit,'offset',v_offset);
  end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.period_year desc,x.amount desc nulls last),'[]'::jsonb)
    into v_rows
  from (
    select payer_key,payer_name,period_year,role,amount,transaction_count,first_seen,last_seen
    from public.obs_public_funds_payer_year
    where rut=v_rut and (p_year is null or period_year=p_year)
    order by period_year desc,amount desc nulls last,payer_key
    limit v_limit offset v_offset
  ) x;

  return jsonb_build_object('rows',v_rows,'count',jsonb_array_length(v_rows),'limit',v_limit,'offset',v_offset,'year',p_year);
end
$$;

revoke all on function public.obs_public_funds_payer_detail(text,integer,integer,integer) from public, anon;
grant execute on function public.obs_public_funds_payer_detail(text,integer,integer,integer) to authenticated, service_role;
