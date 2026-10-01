-- Huella pública · disponibilidad temprana y segura durante cargas de Presupuesto Abierto.
--
-- Problema observado: una entidad puede estar completamente cargada a nivel entidad/año
-- en el nuevo snapshot, pero seguir invisible en Huella pública hasta que termine el detalle
-- payer-year de todo el universo. Esto deja fuera temporalmente entidades válidas como
-- FUNDACION DEMOCRACIA VIVA aunque su agregado ya esté disponible.
--
-- Solución: el contrato de lectura conserva el snapshot LIVE como prioridad. Sólo cuando
-- un RUT no existe en el corte LIVE permite una PREVIEW_LOADING desde el último snapshot
-- en carga, usando entity_stage y year_stage. El detalle de pagadores NO se expone desde
-- staging mientras el snapshot no esté finalizado, evitando presentar datos parciales.

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
  v_rut text := upper(regexp_replace(coalesce(p_rut,''),'[^0-9Kk]','','g'));
  v_q_rut text := upper(regexp_replace(coalesce(p_query,''),'[^0-9Kk]','','g'));
  v_q text := lower(trim(coalesce(p_query,'')));
  v_from integer := greatest(2016, least(coalesce(p_from_year,2020), extract(year from current_date)::integer));
  v_to integer := greatest(v_from, least(coalesce(p_to_year,extract(year from current_date)::integer), extract(year from current_date)::integer));
  v_limit integer := greatest(1,least(coalesce(p_limit,100),500));
  v_offset integer := greatest(0,coalesce(p_offset,0));
  v_rows jsonb;
  v_summary jsonb;
  v_stage_snapshot text;
  v_has_live_period boolean := false;
begin
  if v_uid is null or not exists (
    select 1 from public.aml_allowed_users au where au.user_id=v_uid and au.enabled
  ) then
    raise exception 'NOT_AUTHORIZED' using errcode='42501';
  end if;

  if coalesce(p_action,'') not in ('search','summary','payers','timeline','payments') then
    raise exception 'INVALID_ACTION' using errcode='22023';
  end if;

  select s.snapshot_id into v_stage_snapshot
  from public.obs_public_funds_ingest_state s
  where s.status='LOADING'
    and exists (
      select 1
      from public.obs_public_funds_entity_stage es
      where es.snapshot_id=s.snapshot_id
        and coalesce(es.source_status,'READY')='READY'
    )
  order by s.created_at desc
  limit 1;

  if p_action='search' then
    with live as (
      select f.rut,
             coalesce(nullif(trim(e.name),''),nullif(trim(d.supplier_label),''),f.rut) as label,
             f.entity_id,
             f.amount_total as amount_paid,
             f.transaction_count,
             f.payer_count,
             f.first_seen,
             f.last_seen,
             f.top_payer_name,
             f.top_payer_amount,
             'LIVE'::text as data_status,
             f.source_snapshot_id
      from public.obs_public_funds_entity f
      left join public.obs_entity e on e.entity_id=f.entity_id
      left join public.obs_state_supplier_directory d on d.rut=f.rut
      where (
        (v_q_rut<>'' and upper(regexp_replace(f.rut,'[^0-9Kk]','','g')) like '%'||v_q_rut||'%')
        or lower(coalesce(e.name_search,e.name,'')) like '%'||v_q||'%'
        or lower(coalesce(d.supplier_label,'')) like '%'||v_q||'%'
        or lower(coalesce(d.supplier_label,'')) % v_q
      )
    ), preview as (
      select f.rut,
             coalesce(nullif(trim(e.name),''),nullif(trim(d.supplier_label),''),f.rut) as label,
             f.entity_id,
             f.amount_total as amount_paid,
             f.transaction_count,
             f.payer_count,
             f.first_seen,
             f.last_seen,
             f.top_payer_name,
             f.top_payer_amount,
             'PREVIEW_LOADING'::text as data_status,
             f.snapshot_id as source_snapshot_id
      from public.obs_public_funds_entity_stage f
      left join public.obs_entity e on e.entity_id=f.entity_id
      left join public.obs_state_supplier_directory d on d.rut=f.rut
      where v_stage_snapshot is not null
        and f.snapshot_id=v_stage_snapshot
        and coalesce(f.source_status,'READY')='READY'
        and not exists (
          select 1 from public.obs_public_funds_entity c
          where upper(regexp_replace(c.rut,'[^0-9Kk]','','g'))=upper(regexp_replace(f.rut,'[^0-9Kk]','','g'))
        )
        and (
          (v_q_rut<>'' and upper(regexp_replace(f.rut,'[^0-9Kk]','','g')) like '%'||v_q_rut||'%')
          or lower(coalesce(e.name_search,e.name,'')) like '%'||v_q||'%'
          or lower(coalesce(d.supplier_label,'')) like '%'||v_q||'%'
          or lower(coalesce(d.supplier_label,'')) % v_q
        )
    ), combined as (
      select * from live
      union all
      select * from preview
    )
    select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into v_rows
    from (
      select * from combined
      order by
        case when v_q_rut<>'' and upper(regexp_replace(rut,'[^0-9Kk]','','g'))=v_q_rut then 0 else 1 end,
        case when lower(coalesce(label,''))=v_q then 0 else 1 end,
        amount_paid desc nulls last,
        rut
      limit least(v_limit,50) offset v_offset
    ) x;

    return jsonb_build_object(
      'ok',true,'action','search','source','PRESUPUESTO_ABIERTO','amount_basis','POSITIVE_MONTO_PAGO',
      'preview_snapshot',v_stage_snapshot,'rows',v_rows
    );
  end if;

  if v_rut='' then
    return jsonb_build_object('ok',false,'error','RUT_REQUIRED');
  end if;

  select exists (
    select 1
    from public.obs_public_funds_year y
    where upper(regexp_replace(y.rut,'[^0-9Kk]','','g'))=v_rut
      and y.period_year between v_from and v_to
  ) into v_has_live_period;

  if p_action='summary' then
    if v_has_live_period then
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
        select f.rut,f.entity_id,
               coalesce(nullif(trim(e.name),''),nullif(trim(d.supplier_label),''),public.obs_state_best_name(f.rut)) as name
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
        'first_seen',(select min(first_seen) from py),'last_seen',(select max(last_seen) from py),
        'data_status','LIVE'
      ) end into v_summary from y;

      return jsonb_build_object('ok',true,'action','summary','source','PRESUPUESTO_ABIERTO','amount_basis','POSITIVE_MONTO_PAGO',
        'requested_period',jsonb_build_object('from_year',v_from,'to_year',v_to),'data_status','LIVE','summary',v_summary);
    end if;

    with s as (
      select f.*,
             coalesce(nullif(trim(e.name),''),nullif(trim(d.supplier_label),''),public.obs_state_best_name(f.rut)) as resolved_name
      from public.obs_public_funds_entity_stage f
      left join public.obs_entity e on e.entity_id=f.entity_id
      left join public.obs_state_supplier_directory d on d.rut=f.rut
      where v_stage_snapshot is not null
        and f.snapshot_id=v_stage_snapshot
        and coalesce(f.source_status,'READY')='READY'
        and upper(regexp_replace(f.rut,'[^0-9Kk]','','g'))=v_rut
      limit 1
    ), y as (
      select * from public.obs_public_funds_year_stage
      where v_stage_snapshot is not null
        and snapshot_id=v_stage_snapshot
        and upper(regexp_replace(rut,'[^0-9Kk]','','g'))=v_rut
        and period_year between v_from and v_to
    ), year_top as (
      select top_payer_key,top_payer_name,top_payer_amount
      from y
      where top_payer_name is not null
      order by top_payer_amount desc nulls last,period_year desc
      limit 1
    )
    select case when count(y.*)=0 or not exists(select 1 from s) then null else jsonb_build_object(
      'rut',(select rut from s),'entity_id',(select entity_id from s),'label',(select resolved_name from s),
      'has_public_payments',true,'first_year',min(y.period_year),'last_year',max(y.period_year),
      'amount_paid',sum(y.amount_total),'amount_as_supplier',sum(y.amount_supplier),'amount_as_recipient',sum(y.amount_transfer),
      'transaction_count',sum(y.transaction_count),'payer_count',(select payer_count from s),
      'top_payer_key',coalesce((select top_payer_key from year_top),(select top_payer_key from s)),
      'top_payer_name',coalesce((select top_payer_name from year_top),(select top_payer_name from s)),
      'top_payer_amount',coalesce((select top_payer_amount from year_top),(select top_payer_amount from s)),
      'first_seen',(select first_seen from s),'last_seen',(select last_seen from s),
      'data_status','PREVIEW_LOADING','source_snapshot_id',v_stage_snapshot
    ) end into v_summary from y;

    return jsonb_build_object('ok',true,'action','summary','source','PRESUPUESTO_ABIERTO','amount_basis','POSITIVE_MONTO_PAGO',
      'requested_period',jsonb_build_object('from_year',v_from,'to_year',v_to),
      'data_status',case when v_summary is null then 'LIVE' else 'PREVIEW_LOADING' end,
      'preview_snapshot',v_stage_snapshot,'summary',v_summary);

  elsif p_action='payers' then
    if v_has_live_period then
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
        'requested_period',jsonb_build_object('from_year',v_from,'to_year',v_to),'data_status','LIVE','detail_complete',true,'rows',v_rows);
    end if;

    return jsonb_build_object('ok',true,'action','payers','source','PRESUPUESTO_ABIERTO','amount_basis','POSITIVE_MONTO_PAGO',
      'requested_period',jsonb_build_object('from_year',v_from,'to_year',v_to),'data_status','PREVIEW_LOADING',
      'preview_snapshot',v_stage_snapshot,'detail_complete',false,'rows','[]'::jsonb);

  elsif p_action='timeline' then
    if v_has_live_period then
      select coalesce(jsonb_agg(to_jsonb(x) order by x.year),'[]'::jsonb) into v_rows
      from (
        select period_year as year,amount_total as amount_paid,amount_supplier as amount_as_supplier,
               amount_transfer as amount_as_recipient,payer_count,transaction_count,top_payer_name,top_payer_amount
        from public.obs_public_funds_year
        where upper(regexp_replace(rut,'[^0-9Kk]','','g'))=v_rut
          and period_year between v_from and v_to
        order by period_year
      ) x;
      return jsonb_build_object('ok',true,'action','timeline','source','PRESUPUESTO_ABIERTO','amount_basis','POSITIVE_MONTO_PAGO',
        'requested_period',jsonb_build_object('from_year',v_from,'to_year',v_to),'data_status','LIVE','rows',v_rows);
    end if;

    select coalesce(jsonb_agg(to_jsonb(x) order by x.year),'[]'::jsonb) into v_rows
    from (
      select period_year as year,amount_total as amount_paid,amount_supplier as amount_as_supplier,
             amount_transfer as amount_as_recipient,payer_count,transaction_count,top_payer_name,top_payer_amount
      from public.obs_public_funds_year_stage
      where v_stage_snapshot is not null
        and snapshot_id=v_stage_snapshot
        and upper(regexp_replace(rut,'[^0-9Kk]','','g'))=v_rut
        and period_year between v_from and v_to
      order by period_year
    ) x;
    return jsonb_build_object('ok',true,'action','timeline','source','PRESUPUESTO_ABIERTO','amount_basis','POSITIVE_MONTO_PAGO',
      'requested_period',jsonb_build_object('from_year',v_from,'to_year',v_to),'data_status','PREVIEW_LOADING',
      'preview_snapshot',v_stage_snapshot,'rows',v_rows);

  elsif p_action='payments' then
    return jsonb_build_object('ok',true,'action','payments','source','PRESUPUESTO_ABIERTO','available',false,
      'reason','TRANSACTION_DETAIL_NOT_MATERIALIZED','rows','[]'::jsonb);
  end if;

  return jsonb_build_object('ok',false,'error','UNKNOWN_ACTION');
end
$$;

comment on function public.obs_state_public_funds_entity(text,text,text,integer,integer,integer,integer) is
  'Huella publica: consulta pagos del Estado. Mientras un nuevo corte se carga, permite previsualizar entidades y agregados anuales ya disponibles en staging sin promover el snapshot ni exponer detalle de pagadores parcial.';
