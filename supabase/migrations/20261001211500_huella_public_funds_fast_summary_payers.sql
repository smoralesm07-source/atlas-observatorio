-- Huella pública: fast path para summary/payers.
-- Evita regexp_replace sobre millones de filas y usa los PK (rut, ...).
-- Esto corrige timeouts intermitentes donde el gráfico cargaba pero KPI/pagadores quedaban vacíos.

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
  v_uid uuid := (select auth.uid());
  v_norm text := upper(regexp_replace(coalesce(p_rut,''),'[^0-9Kk]','','g'));
  v_rut_key text;
  v_from integer := greatest(2016, least(coalesce(p_from_year,2020), extract(year from current_date)::integer));
  v_to integer := greatest(v_from, least(coalesce(p_to_year,extract(year from current_date)::integer), extract(year from current_date)::integer));
  v_limit integer := greatest(1,least(coalesce(p_limit,100),500));
  v_offset integer := greatest(0,coalesce(p_offset,0));
  v_stage_snapshot text;
  v_has_live boolean := false;
  v_reconciled boolean := false;
  v_rows jsonb;
  v_summary jsonb;
begin
  if coalesce(p_action,'') not in ('summary','payers') then
    return public.obs_state_public_funds_entity_base_20261001(
      p_action,p_rut,p_query,p_from_year,p_to_year,p_limit,p_offset
    );
  end if;

  if v_uid is null or not exists (
    select 1 from public.aml_allowed_users au where au.user_id=v_uid and au.enabled
  ) then
    raise exception 'NOT_AUTHORIZED' using errcode='42501';
  end if;

  if v_norm='' or length(v_norm)<2 then
    return jsonb_build_object('ok',false,'error','RUT_REQUIRED');
  end if;

  v_rut_key := left(v_norm,length(v_norm)-1)||'-'||right(v_norm,1);

  select exists (
    select 1 from public.obs_public_funds_year y
    where y.rut=v_rut_key and y.period_year between v_from and v_to
  ) into v_has_live;

  if v_has_live then
    if p_action='payers' then
      with py as materialized (
        select * from public.obs_public_funds_payer_year
        where rut=v_rut_key and period_year between v_from and v_to
      ), agg as (
        select payer_key,max(payer_name) payer_name,sum(amount) amount_paid,
               sum(transaction_count) transaction_count,
               min(period_year) first_year,max(period_year) last_year,
               min(first_seen) first_seen,max(last_seen) last_seen,
               bool_or(role='SUPPLIER') supplier_role,
               bool_or(role='RECIPIENT') recipient_role
        from py group by payer_key
      )
      select coalesce(jsonb_agg(to_jsonb(x) order by x.amount_paid desc nulls last),'[]'::jsonb)
        into v_rows
      from (
        select * from agg order by amount_paid desc nulls last,payer_key
        limit v_limit offset v_offset
      ) x;

      return jsonb_build_object(
        'ok',true,'action','payers','source','PRESUPUESTO_ABIERTO',
        'amount_basis','POSITIVE_MONTO_PAGO',
        'requested_period',jsonb_build_object('from_year',v_from,'to_year',v_to),
        'data_status','LIVE','detail_complete',true,'rows',v_rows
      );
    end if;

    with y as materialized (
      select * from public.obs_public_funds_year
      where rut=v_rut_key and period_year between v_from and v_to
    ), py as materialized (
      select * from public.obs_public_funds_payer_year
      where rut=v_rut_key and period_year between v_from and v_to
    ), payer_agg as (
      select payer_key,max(payer_name) payer_name,sum(amount) amount
      from py group by payer_key
    ), top_payer as (
      select * from payer_agg order by amount desc nulls last,payer_key limit 1
    ), identity as (
      select f.rut,f.entity_id,
             coalesce(nullif(trim(e.name),''),nullif(trim(d.supplier_label),''),public.obs_state_best_name(f.rut),f.rut) as name
      from public.obs_public_funds_entity f
      left join public.obs_entity e on e.entity_id=f.entity_id
      left join public.obs_state_supplier_directory d on d.rut=f.rut
      where f.rut=v_rut_key limit 1
    )
    select jsonb_build_object(
      'rut',coalesce((select rut from identity),v_rut_key),
      'entity_id',(select entity_id from identity),
      'label',coalesce((select name from identity),public.obs_state_best_name(v_rut_key),v_rut_key),
      'has_public_payments',true,
      'first_year',min(y.period_year),'last_year',max(y.period_year),
      'amount_paid',sum(y.amount_total),
      'amount_as_supplier',sum(y.amount_supplier),
      'amount_as_recipient',sum(y.amount_transfer),
      'transaction_count',sum(y.transaction_count),
      'payer_count',(select count(*) from payer_agg),
      'top_payer_key',(select payer_key from top_payer),
      'top_payer_name',(select payer_name from top_payer),
      'top_payer_amount',(select amount from top_payer),
      'first_seen',(select min(first_seen) from py),
      'last_seen',(select max(last_seen) from py),
      'data_status','LIVE'
    ) into v_summary from y;

    return jsonb_build_object(
      'ok',true,'action','summary','source','PRESUPUESTO_ABIERTO',
      'amount_basis','POSITIVE_MONTO_PAGO',
      'requested_period',jsonb_build_object('from_year',v_from,'to_year',v_to),
      'data_status','LIVE','detail_complete',true,'summary',v_summary
    );
  end if;

  select s.snapshot_id into v_stage_snapshot
  from public.obs_public_funds_ingest_state s
  where s.status='LOADING'
    and exists (
      select 1 from public.obs_public_funds_entity_stage es
      where es.snapshot_id=s.snapshot_id and es.rut=v_rut_key
        and coalesce(es.source_status,'READY')='READY'
    )
  order by s.created_at desc
  limit 1;

  if v_stage_snapshot is null then
    if p_action='payers' then
      return jsonb_build_object(
        'ok',true,'action','payers','source','PRESUPUESTO_ABIERTO','amount_basis','POSITIVE_MONTO_PAGO',
        'requested_period',jsonb_build_object('from_year',v_from,'to_year',v_to),
        'data_status','LIVE','detail_complete',true,'rows','[]'::jsonb
      );
    end if;
    return jsonb_build_object(
      'ok',true,'action','summary','source','PRESUPUESTO_ABIERTO','amount_basis','POSITIVE_MONTO_PAGO',
      'requested_period',jsonb_build_object('from_year',v_from,'to_year',v_to),
      'data_status','LIVE','detail_complete',true,'summary',null
    );
  end if;

  with y as materialized (
    select y.period_year,y.amount_total,y.transaction_count,y.payer_count
    from public.obs_public_funds_year_stage y
    where y.snapshot_id=v_stage_snapshot and y.rut=v_rut_key
      and y.period_year between v_from and v_to
  ), py as materialized (
    select p.* from public.obs_public_funds_payer_year_stage p
    where p.snapshot_id=v_stage_snapshot and p.rut=v_rut_key
      and p.period_year between v_from and v_to
  ), checks as (
    select y.period_year,
           y.amount_total = coalesce((select sum(p.amount) from py p where p.period_year=y.period_year),0) amount_ok,
           y.transaction_count = coalesce((select sum(p.transaction_count) from py p where p.period_year=y.period_year),0) tx_ok,
           y.payer_count = coalesce((select count(distinct p.payer_key) from py p where p.period_year=y.period_year),0) payer_ok
    from y
  )
  select coalesce(count(*)>0 and bool_and(amount_ok and tx_ok and payer_ok),false)
    into v_reconciled
  from checks;

  if p_action='payers' then
    if not v_reconciled then
      return jsonb_build_object(
        'ok',true,'action','payers','source','PRESUPUESTO_ABIERTO','amount_basis','POSITIVE_MONTO_PAGO',
        'requested_period',jsonb_build_object('from_year',v_from,'to_year',v_to),
        'data_status','PREVIEW_LOADING','preview_snapshot',v_stage_snapshot,
        'detail_complete',false,'rows','[]'::jsonb
      );
    end if;

    with py as materialized (
      select * from public.obs_public_funds_payer_year_stage
      where snapshot_id=v_stage_snapshot and rut=v_rut_key
        and period_year between v_from and v_to
    ), agg as (
      select payer_key,max(payer_name) payer_name,sum(amount) amount_paid,
             sum(transaction_count) transaction_count,
             min(period_year) first_year,max(period_year) last_year,
             min(first_seen) first_seen,max(last_seen) last_seen,
             bool_or(role='SUPPLIER') supplier_role,
             bool_or(role='RECIPIENT') recipient_role
      from py group by payer_key
    )
    select coalesce(jsonb_agg(to_jsonb(x) order by x.amount_paid desc nulls last),'[]'::jsonb)
      into v_rows
    from (
      select * from agg order by amount_paid desc nulls last,payer_key
      limit v_limit offset v_offset
    ) x;

    return jsonb_build_object(
      'ok',true,'action','payers','source','PRESUPUESTO_ABIERTO','amount_basis','POSITIVE_MONTO_PAGO',
      'requested_period',jsonb_build_object('from_year',v_from,'to_year',v_to),
      'data_status','PREVIEW_LOADING_RECONCILED','preview_snapshot',v_stage_snapshot,
      'detail_complete',true,'rows',v_rows
    );
  end if;

  with s as (
    select f.*,
           coalesce(nullif(trim(e.name),''),nullif(trim(d.supplier_label),''),public.obs_state_best_name(f.rut),f.rut) resolved_name
    from public.obs_public_funds_entity_stage f
    left join public.obs_entity e on e.entity_id=f.entity_id
    left join public.obs_state_supplier_directory d on d.rut=f.rut
    where f.snapshot_id=v_stage_snapshot and f.rut=v_rut_key
    limit 1
  ), y as materialized (
    select * from public.obs_public_funds_year_stage
    where snapshot_id=v_stage_snapshot and rut=v_rut_key
      and period_year between v_from and v_to
  ), py as materialized (
    select * from public.obs_public_funds_payer_year_stage
    where v_reconciled and snapshot_id=v_stage_snapshot and rut=v_rut_key
      and period_year between v_from and v_to
  ), payer_agg as (
    select payer_key,max(payer_name) payer_name,sum(amount) amount from py group by payer_key
  ), top_payer as (
    select * from payer_agg order by amount desc nulls last,payer_key limit 1
  ), year_top as (
    select top_payer_key,top_payer_name,top_payer_amount
    from y where top_payer_name is not null
    order by top_payer_amount desc nulls last,period_year desc limit 1
  )
  select case when count(y.*)=0 or not exists(select 1 from s) then null else jsonb_build_object(
    'rut',(select rut from s),'entity_id',(select entity_id from s),'label',(select resolved_name from s),
    'has_public_payments',true,'first_year',min(y.period_year),'last_year',max(y.period_year),
    'amount_paid',sum(y.amount_total),'amount_as_supplier',sum(y.amount_supplier),
    'amount_as_recipient',sum(y.amount_transfer),'transaction_count',sum(y.transaction_count),
    'payer_count',case when v_reconciled then (select count(*) from payer_agg) else (select payer_count from s) end,
    'top_payer_key',case when v_reconciled then (select payer_key from top_payer) else coalesce((select top_payer_key from year_top),(select top_payer_key from s)) end,
    'top_payer_name',case when v_reconciled then (select payer_name from top_payer) else coalesce((select top_payer_name from year_top),(select top_payer_name from s)) end,
    'top_payer_amount',case when v_reconciled then (select amount from top_payer) else coalesce((select top_payer_amount from year_top),(select top_payer_amount from s)) end,
    'first_seen',case when v_reconciled then (select min(first_seen) from py) else (select first_seen from s) end,
    'last_seen',case when v_reconciled then (select max(last_seen) from py) else (select last_seen from s) end,
    'data_status',case when v_reconciled then 'PREVIEW_LOADING_RECONCILED' else 'PREVIEW_LOADING' end,
    'source_snapshot_id',v_stage_snapshot
  ) end into v_summary from y;

  return jsonb_build_object(
    'ok',true,'action','summary','source','PRESUPUESTO_ABIERTO','amount_basis','POSITIVE_MONTO_PAGO',
    'requested_period',jsonb_build_object('from_year',v_from,'to_year',v_to),
    'data_status',case when v_reconciled then 'PREVIEW_LOADING_RECONCILED' else 'PREVIEW_LOADING' end,
    'preview_snapshot',v_stage_snapshot,'detail_complete',v_reconciled,'summary',v_summary
  );
end
$$;

revoke all on function public.obs_state_public_funds_entity(text,text,text,integer,integer,integer,integer) from public,anon;
grant execute on function public.obs_state_public_funds_entity(text,text,text,integer,integer,integer,integer) to authenticated;

comment on function public.obs_state_public_funds_entity(text,text,text,integer,integer,integer,integer) is
  'Huella publica: fast path indexado para summary/payers y contrato previo para search/timeline. Evita timeouts por normalización fila-a-fila en tablas masivas.';