-- ATLAS Observatorio · detalle anual entity × organismo pagador.
-- Se consulta sólo al abrir la ficha de contraparte en Huella pública.

create or replace function public.obs_state_public_funds_counterparty_history(
  p_rut text,
  p_payer_key text,
  p_from_year integer default 2020,
  p_to_year integer default extract(year from current_date)::integer
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare
  v_uid uuid := (select auth.uid());
  v_rut text := upper(regexp_replace(coalesce(p_rut,''),'[^0-9Kk]','','g'));
  v_payer text := trim(coalesce(p_payer_key,''));
  v_from integer := greatest(2016, least(coalesce(p_from_year,2020), extract(year from current_date)::integer));
  v_to integer := greatest(v_from, least(coalesce(p_to_year,extract(year from current_date)::integer), extract(year from current_date)::integer));
  v_result jsonb;
begin
  if v_uid is null or not exists (
    select 1 from public.aml_allowed_users au where au.user_id=v_uid and au.enabled
  ) then
    raise exception 'NOT_AUTHORIZED' using errcode='42501';
  end if;

  if v_rut='' then return jsonb_build_object('ok',false,'error','RUT_REQUIRED'); end if;
  if v_payer='' then return jsonb_build_object('ok',false,'error','PAYER_REQUIRED'); end if;

  with all_py as materialized (
    select *
    from public.obs_public_funds_payer_year
    where upper(regexp_replace(rut,'[^0-9Kk]','','g'))=v_rut
      and period_year between v_from and v_to
  ), py as materialized (
    select * from all_py where payer_key=v_payer
  ), annual as materialized (
    select period_year as year,
           max(payer_name) as payer_name,
           sum(amount) as amount_paid,
           coalesce(sum(amount) filter (where role='SUPPLIER'),0) as amount_as_supplier,
           coalesce(sum(amount) filter (where role='RECIPIENT'),0) as amount_as_recipient,
           sum(transaction_count)::bigint as transaction_count,
           min(first_seen) as first_seen,
           max(last_seen) as last_seen,
           bool_or(role='SUPPLIER') as supplier_role,
           bool_or(role='RECIPIENT') as recipient_role
    from py
    group by period_year
  ), payer_agg as materialized (
    select payer_key,max(payer_name) payer_name,sum(amount) amount_paid,sum(transaction_count)::bigint transaction_count
    from all_py group by payer_key
  ), ranked as materialized (
    select payer_key,payer_name,amount_paid,transaction_count,
           row_number() over(order by amount_paid desc nulls last,payer_key) as rank
    from payer_agg
  ), entity_total as (
    select coalesce(sum(amount),0) amount_paid from all_py
  ), summary as (
    select max(payer_name) as payer_name,
           min(year)::integer as first_year,
           max(year)::integer as last_year,
           count(*)::integer as active_years,
           sum(amount_paid) as amount_paid,
           sum(amount_as_supplier) as amount_as_supplier,
           sum(amount_as_recipient) as amount_as_recipient,
           sum(transaction_count)::bigint as transaction_count,
           min(first_seen) as first_seen,
           max(last_seen) as last_seen,
           bool_or(supplier_role) as supplier_role,
           bool_or(recipient_role) as recipient_role
    from annual
  )
  select jsonb_build_object(
    'ok',true,
    'schema','PUBLIC_FUNDS_COUNTERPARTY_HISTORY_V1',
    'source','PRESUPUESTO_ABIERTO',
    'rut',p_rut,
    'payer_key',p_payer_key,
    'period',jsonb_build_object('from_year',v_from,'to_year',v_to),
    'summary',case when exists(select 1 from annual) then (to_jsonb(summary) || jsonb_build_object(
      'entity_amount_paid',(select amount_paid from entity_total),
      'share_pct',case when (select amount_paid from entity_total)>0 then round((summary.amount_paid/(select amount_paid from entity_total)*100)::numeric,2) else null end,
      'rank',(select rank from ranked where payer_key=v_payer),
      'payer_count',(select count(*)::integer from payer_agg)
    )) else null end,
    'years',coalesce((select jsonb_agg(to_jsonb(a) order by a.year desc) from annual a),'[]'::jsonb),
    'semantics',jsonb_build_object(
      'grain','entity × payer × role × year',
      'amount_basis','POSITIVE_MONTO_PAGO',
      'detail','Agregado anual; no corresponde al detalle de cada pago individual.'
    )
  ) into v_result
  from summary;

  return v_result;
end
$$;

revoke all on function public.obs_state_public_funds_counterparty_history(text,text,integer,integer) from public,anon;
grant execute on function public.obs_state_public_funds_counterparty_history(text,text,integer,integer) to authenticated;
