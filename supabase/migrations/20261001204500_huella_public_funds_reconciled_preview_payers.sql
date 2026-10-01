-- Huella pública: exponer detalle de organismo pagador desde staging sólo cuando
-- el detalle payer-year reconcilia completamente con los agregados entity/year.
-- Mantiene el comportamiento LIVE existente y evita mostrar parciales durante carga.

alter function public.obs_state_public_funds_entity(text,text,text,integer,integer,integer,integer)
  rename to obs_state_public_funds_entity_base_20261001;

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
set search_path to 'public','extensions','pg_temp'
as $$
declare
  v_base jsonb;
  v_stage_snapshot text;
  v_rut text := upper(regexp_replace(coalesce(p_rut,''),'[^0-9Kk]','','g'));
  v_from integer := greatest(2016, least(coalesce(p_from_year,2020), extract(year from current_date)::integer));
  v_to integer := greatest(v_from, least(coalesce(p_to_year,extract(year from current_date)::integer), extract(year from current_date)::integer));
  v_limit integer := greatest(1,least(coalesce(p_limit,100),500));
  v_offset integer := greatest(0,coalesce(p_offset,0));
  v_reconciled boolean := false;
  v_rows jsonb;
  v_summary jsonb;
  v_payer_count integer;
  v_top_payer_key text;
  v_top_payer_name text;
  v_top_payer_amount numeric;
  v_first_seen date;
  v_last_seen date;
begin
  v_base := public.obs_state_public_funds_entity_base_20261001(
    p_action,p_rut,p_query,p_from_year,p_to_year,p_limit,p_offset
  );

  if coalesce(p_action,'') not in ('summary','payers') then
    return v_base;
  end if;

  if coalesce(v_base->>'data_status','') <> 'PREVIEW_LOADING' then
    return v_base;
  end if;

  v_stage_snapshot := nullif(v_base->>'preview_snapshot','');
  if v_stage_snapshot is null or v_rut='' then
    return v_base;
  end if;

  with y as materialized (
    select y.period_year,y.amount_total,y.transaction_count,y.payer_count
    from public.obs_public_funds_year_stage y
    where y.snapshot_id=v_stage_snapshot
      and upper(regexp_replace(y.rut,'[^0-9Kk]','','g'))=v_rut
      and y.period_year between v_from and v_to
  ), py as materialized (
    select p.*
    from public.obs_public_funds_payer_year_stage p
    where p.snapshot_id=v_stage_snapshot
      and upper(regexp_replace(p.rut,'[^0-9Kk]','','g'))=v_rut
      and p.period_year between v_from and v_to
  ), checks as (
    select y.period_year,
           y.amount_total = coalesce((select sum(p.amount) from py p where p.period_year=y.period_year),0) as amount_ok,
           y.transaction_count = coalesce((select sum(p.transaction_count) from py p where p.period_year=y.period_year),0) as tx_ok,
           y.payer_count = coalesce((select count(distinct p.payer_key) from py p where p.period_year=y.period_year),0) as payer_ok
    from y
  )
  select coalesce(count(*)>0 and bool_and(amount_ok and tx_ok and payer_ok),false)
    into v_reconciled
  from checks;

  if not v_reconciled then
    return v_base;
  end if;

  if p_action='payers' then
    with py as materialized (
      select p.*
      from public.obs_public_funds_payer_year_stage p
      where p.snapshot_id=v_stage_snapshot
        and upper(regexp_replace(p.rut,'[^0-9Kk]','','g'))=v_rut
        and p.period_year between v_from and v_to
    ), agg as (
      select payer_key,
             max(payer_name) as payer_name,
             sum(amount) as amount_paid,
             sum(transaction_count) as transaction_count,
             min(period_year) as first_year,
             max(period_year) as last_year,
             min(first_seen) as first_seen,
             max(last_seen) as last_seen,
             bool_or(role='SUPPLIER') as supplier_role,
             bool_or(role='RECIPIENT') as recipient_role
      from py
      group by payer_key
    )
    select coalesce(jsonb_agg(to_jsonb(x) order by x.amount_paid desc nulls last),'[]'::jsonb)
      into v_rows
    from (
      select * from agg
      order by amount_paid desc nulls last,payer_key
      limit v_limit offset v_offset
    ) x;

    return jsonb_build_object(
      'ok',true,
      'action','payers',
      'source','PRESUPUESTO_ABIERTO',
      'amount_basis','POSITIVE_MONTO_PAGO',
      'requested_period',jsonb_build_object('from_year',v_from,'to_year',v_to),
      'data_status','PREVIEW_LOADING_RECONCILED',
      'preview_snapshot',v_stage_snapshot,
      'detail_complete',true,
      'rows',v_rows
    );
  end if;

  with py as materialized (
    select p.*
    from public.obs_public_funds_payer_year_stage p
    where p.snapshot_id=v_stage_snapshot
      and upper(regexp_replace(p.rut,'[^0-9Kk]','','g'))=v_rut
      and p.period_year between v_from and v_to
  ), agg as (
    select payer_key,max(payer_name) payer_name,sum(amount) amount
    from py group by payer_key
  ), top_one as (
    select * from agg order by amount desc nulls last,payer_key limit 1
  )
  select (select count(*)::integer from agg),
         (select payer_key from top_one),
         (select payer_name from top_one),
         (select amount from top_one),
         (select min(first_seen) from py),
         (select max(last_seen) from py)
    into v_payer_count,v_top_payer_key,v_top_payer_name,v_top_payer_amount,v_first_seen,v_last_seen;

  v_summary := coalesce(v_base->'summary','{}'::jsonb) || jsonb_build_object(
    'payer_count',v_payer_count,
    'top_payer_key',v_top_payer_key,
    'top_payer_name',v_top_payer_name,
    'top_payer_amount',v_top_payer_amount,
    'first_seen',v_first_seen,
    'last_seen',v_last_seen,
    'data_status','PREVIEW_LOADING_RECONCILED'
  );

  return jsonb_set(
    v_base || jsonb_build_object('data_status','PREVIEW_LOADING_RECONCILED','detail_complete',true),
    '{summary}',v_summary,true
  );
end
$$;

revoke all on function public.obs_state_public_funds_entity_base_20261001(text,text,text,integer,integer,integer,integer)
  from public,anon,authenticated;
revoke all on function public.obs_state_public_funds_entity(text,text,text,integer,integer,integer,integer)
  from public,anon;
grant execute on function public.obs_state_public_funds_entity(text,text,text,integer,integer,integer,integer)
  to authenticated;

comment on function public.obs_state_public_funds_entity(text,text,text,integer,integer,integer,integer) is
  'Huella publica: consulta pagos del Estado. En PREVIEW_LOADING expone payer-year sólo si reconcilia por año monto, transacciones y payer_count contra year_stage.';

alter function public.obs_state_public_funds_counterparty_history(text,text,integer,integer)
  rename to obs_state_public_funds_counterparty_history_base_20261001;

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
  v_base jsonb;
  v_stage_snapshot text;
  v_rut text := upper(regexp_replace(coalesce(p_rut,''),'[^0-9Kk]','','g'));
  v_payer text := trim(coalesce(p_payer_key,''));
  v_from integer := greatest(2016, least(coalesce(p_from_year,2020), extract(year from current_date)::integer));
  v_to integer := greatest(v_from, least(coalesce(p_to_year,extract(year from current_date)::integer), extract(year from current_date)::integer));
  v_reconciled boolean := false;
  v_result jsonb;
begin
  v_base := public.obs_state_public_funds_counterparty_history_base_20261001(
    p_rut,p_payer_key,p_from_year,p_to_year
  );

  if v_base->'summary' is not null and v_base->'summary' <> 'null'::jsonb then
    return v_base;
  end if;
  if v_rut='' or v_payer='' then return v_base; end if;

  select s.snapshot_id into v_stage_snapshot
  from public.obs_public_funds_ingest_state s
  where s.status='LOADING'
    and exists (
      select 1 from public.obs_public_funds_entity_stage es
      where es.snapshot_id=s.snapshot_id
        and upper(regexp_replace(es.rut,'[^0-9Kk]','','g'))=v_rut
        and coalesce(es.source_status,'READY')='READY'
    )
  order by s.created_at desc
  limit 1;

  if v_stage_snapshot is null then return v_base; end if;

  with y as materialized (
    select y.period_year,y.amount_total,y.transaction_count,y.payer_count
    from public.obs_public_funds_year_stage y
    where y.snapshot_id=v_stage_snapshot
      and upper(regexp_replace(y.rut,'[^0-9Kk]','','g'))=v_rut
      and y.period_year between v_from and v_to
  ), py as materialized (
    select p.* from public.obs_public_funds_payer_year_stage p
    where p.snapshot_id=v_stage_snapshot
      and upper(regexp_replace(p.rut,'[^0-9Kk]','','g'))=v_rut
      and p.period_year between v_from and v_to
  ), checks as (
    select y.period_year,
           y.amount_total = coalesce((select sum(p.amount) from py p where p.period_year=y.period_year),0) as amount_ok,
           y.transaction_count = coalesce((select sum(p.transaction_count) from py p where p.period_year=y.period_year),0) as tx_ok,
           y.payer_count = coalesce((select count(distinct p.payer_key) from py p where p.period_year=y.period_year),0) as payer_ok
    from y
  )
  select coalesce(count(*)>0 and bool_and(amount_ok and tx_ok and payer_ok),false)
    into v_reconciled
  from checks;

  if not v_reconciled then return v_base; end if;

  with all_py as materialized (
    select *
    from public.obs_public_funds_payer_year_stage
    where snapshot_id=v_stage_snapshot
      and upper(regexp_replace(rut,'[^0-9Kk]','','g'))=v_rut
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
    'data_status','PREVIEW_LOADING_RECONCILED',
    'preview_snapshot',v_stage_snapshot,
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
      'detail','Agregado anual; detalle staged expuesto sólo tras reconciliación completa por año.'
    )
  ) into v_result
  from summary;

  return v_result;
end
$$;

revoke all on function public.obs_state_public_funds_counterparty_history_base_20261001(text,text,integer,integer)
  from public,anon,authenticated;
revoke all on function public.obs_state_public_funds_counterparty_history(text,text,integer,integer)
  from public,anon;
grant execute on function public.obs_state_public_funds_counterparty_history(text,text,integer,integer)
  to authenticated;

comment on function public.obs_state_public_funds_counterparty_history(text,text,integer,integer) is
  'Huella publica: histórico entity × payer. Usa LIVE y, si no existe, staging sólo cuando el payer-year reconcilia completamente contra year_stage.';