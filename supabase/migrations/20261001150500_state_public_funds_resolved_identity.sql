-- Huella pública · identidad resuelta en Presupuesto Abierto
--
-- Usa el nombre de obs_entity cuando existe y, para proveedores sin entity_id,
-- reutiliza la nominación ya disponible en obs_state_supplier_directory.
-- Esto evita mostrar el RUT como label cuando Atlas ya conoce la razón social y
-- habilita la búsqueda por nombre sobre ese mismo universo.

create or replace function public.obs_state_public_funds_entity(
  p_action text,
  p_rut text default null,
  p_query text default null,
  p_from_year integer default 2020,
  p_to_year integer default extract(year from current_date)::integer,
  p_limit integer default 100,
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare
  v_uid uuid := (select auth.uid());
  v_rut text := upper(regexp_replace(coalesce(p_rut,''),'[^0-9Kk]','','g'));
  v_q_rut text := upper(regexp_replace(coalesce(p_query,''),'[^0-9Kk]','','g'));
  v_q text := lower(trim(coalesce(p_query,'')));
  v_from integer := greatest(2016, least(coalesce(p_from_year,2020), extract(year from current_date)::integer));
  v_to integer := greatest(v_from, least(coalesce(p_to_year,extract(year from current_date)::integer), extract(year from current_date)::integer));
  v_limit integer := greatest(1,least(coalesce(p_limit,100),500));
  v_offset integer := greatest(0,coalesce(p_offset,0));
  v_rows jsonb;
  v_summary jsonb;
begin
  if v_uid is null or not exists (
    select 1 from public.aml_allowed_users au where au.user_id=v_uid and au.enabled
  ) then
    raise exception 'NOT_AUTHORIZED' using errcode='42501';
  end if;

  if coalesce(p_action,'') not in ('search','summary','payers','timeline','payments') then
    raise exception 'INVALID_ACTION' using errcode='22023';
  end if;

  if p_action='search' then
    select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into v_rows
    from (
      select f.rut,
             coalesce(
               nullif(trim(e.name),''),
               nullif(trim(d.supplier_label),''),
               f.rut
             ) as label,
             f.entity_id,
             f.amount_total as amount_paid,
             f.transaction_count,
             f.payer_count,
             f.first_seen,
             f.last_seen,
             f.top_payer_name,
             f.top_payer_amount
      from public.obs_public_funds_entity f
      left join public.obs_entity e on e.entity_id=f.entity_id
      left join public.obs_state_supplier_directory d on d.rut=f.rut
      where (
        (v_q_rut<>'' and upper(regexp_replace(f.rut,'[^0-9Kk]','','g')) like '%'||v_q_rut||'%')
        or lower(coalesce(e.name_search,e.name,'')) like '%'||v_q||'%'
        or lower(coalesce(d.supplier_label,'')) like '%'||v_q||'%'
        or lower(coalesce(d.supplier_label,'')) % v_q
      )
      order by
        case when v_q_rut<>'' and upper(regexp_replace(f.rut,'[^0-9Kk]','','g'))=v_q_rut then 0 else 1 end,
        case when lower(coalesce(e.name_search,e.name,d.supplier_label,'')) = v_q then 0 else 1 end,
        f.amount_total desc nulls last,
        f.rut
      limit least(v_limit,50) offset v_offset
    ) x;
    return jsonb_build_object('ok',true,'action','search','source','PRESUPUESTO_ABIERTO','amount_basis','POSITIVE_MONTO_PAGO','rows',v_rows);
  end if;

  if v_rut='' then return jsonb_build_object('ok',false,'error','RUT_REQUIRED'); end if;

  if p_action='summary' then
    with y as (
      select * from public.obs_public_funds_year
      where upper(regexp_replace(rut,'[^0-9Kk]','','g'))=v_rut
        and period_year between v_from and v_to
    ), py as (
      select * from public.obs_public_funds_payer_year
      where upper(regexp_replace(rut,'[^0-9Kk]','','g'))=v_rut
        and period_year between v_from and v_to
    ), payer_agg as (
      select payer_key,max(payer_name) payer_name,sum(amount) amount
      from py group by payer_key
    ), top_payer as (
      select * from payer_agg order by amount desc nulls last,payer_key limit 1
    ), identity as (
      select f.rut,
             f.entity_id,
             coalesce(
               nullif(trim(e.name),''),
               nullif(trim(d.supplier_label),''),
               public.obs_state_best_name(f.rut)
             ) as name
      from public.obs_public_funds_entity f
      left join public.obs_entity e on e.entity_id=f.entity_id
      left join public.obs_state_supplier_directory d on d.rut=f.rut
      where upper(regexp_replace(f.rut,'[^0-9Kk]','','g'))=v_rut
      limit 1
    )
    select case when count(y.*)=0 then null else jsonb_build_object(
      'rut',(select rut from identity),'entity_id',(select entity_id from identity),'label',(select name from identity),
      'has_public_payments',true,'first_year',min(y.period_year),'last_year',max(y.period_year),
      'amount_paid',sum(y.amount_total),'amount_as_supplier',sum(y.amount_supplier),'amount_as_recipient',sum(y.amount_transfer),
      'transaction_count',sum(y.transaction_count),'payer_count',(select count(*) from payer_agg),
      'top_payer_key',(select payer_key from top_payer),'top_payer_name',(select payer_name from top_payer),
      'top_payer_amount',(select amount from top_payer),
      'first_seen',(select min(first_seen) from py),'last_seen',(select max(last_seen) from py)
    ) end into v_summary from y;
    return jsonb_build_object('ok',true,'action','summary','source','PRESUPUESTO_ABIERTO','amount_basis','POSITIVE_MONTO_PAGO',
      'requested_period',jsonb_build_object('from_year',v_from,'to_year',v_to),'summary',v_summary);
  elsif p_action='payers' then
    with py as (
      select * from public.obs_public_funds_payer_year
      where upper(regexp_replace(rut,'[^0-9Kk]','','g'))=v_rut
        and period_year between v_from and v_to
    ), agg as (
      select payer_key,max(payer_name) payer_name,sum(amount) amount_paid,sum(transaction_count) transaction_count,
             min(period_year) first_year,max(period_year) last_year,min(first_seen) first_seen,max(last_seen) last_seen,
             bool_or(role='SUPPLIER') as supplier_role,bool_or(role='RECIPIENT') as recipient_role
      from py group by payer_key
    )
    select coalesce(jsonb_agg(to_jsonb(x) order by x.amount_paid desc nulls last),'[]'::jsonb) into v_rows
    from (select * from agg order by amount_paid desc nulls last,payer_key limit v_limit offset v_offset) x;
    return jsonb_build_object('ok',true,'action','payers','source','PRESUPUESTO_ABIERTO','amount_basis','POSITIVE_MONTO_PAGO',
      'requested_period',jsonb_build_object('from_year',v_from,'to_year',v_to),'rows',v_rows);
  elsif p_action='timeline' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.year),'[]'::jsonb) into v_rows
    from (
      select period_year as year,amount_total as amount_paid,amount_supplier as amount_as_supplier,
             amount_transfer as amount_as_recipient,payer_count,transaction_count,top_payer_name,top_payer_amount
      from public.obs_public_funds_year
      where upper(regexp_replace(rut,'[^0-9Kk]','','g'))=v_rut and period_year between v_from and v_to
      order by period_year
    ) x;
    return jsonb_build_object('ok',true,'action','timeline','source','PRESUPUESTO_ABIERTO','amount_basis','POSITIVE_MONTO_PAGO',
      'requested_period',jsonb_build_object('from_year',v_from,'to_year',v_to),'rows',v_rows);
  elsif p_action='payments' then
    return jsonb_build_object('ok',true,'action','payments','source','PRESUPUESTO_ABIERTO','available',false,
      'reason','TRANSACTION_DETAIL_NOT_MATERIALIZED','rows','[]'::jsonb);
  end if;
  return jsonb_build_object('ok',false,'error','UNKNOWN_ACTION');
end
$$;