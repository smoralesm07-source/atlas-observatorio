-- Huella pública · Estado -> Entidades
-- Consulta normalizada de organismos públicos y universo de beneficiarios.
-- Las fuentes se mantienen separadas para evitar doble contabilización.

create index if not exists obs_public_funds_payer_lookup_v2_idx
  on public.obs_public_funds_payer_year (payer_key, period_year, role, rut)
  include (entity_id, payer_name, amount, transaction_count, first_seen, last_seen);

create index if not exists obs_public_funds_payer_name_trgm_idx
  on public.obs_public_funds_payer_year using gin (lower(payer_name) gin_trgm_ops);

create index if not exists aml_mp_buyer_supplier_lookup_idx
  on public.aml_mp_buyer_supplier_month (buyer_rut, month_start, supplier_rut)
  include (buyer_name, supplier_name, order_count, total_clp, first_order_at, last_order_at);

create index if not exists aml_mp_buyer_name_trgm_idx
  on public.aml_mp_buyer_supplier_month using gin (lower(buyer_name) gin_trgm_ops);

create or replace function public.obs_state_agency_beneficiaries(p_request jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security invoker
set search_path to 'public','extensions','pg_temp'
as $$
declare
  v_uid uuid := (select auth.uid());
  v_action text := lower(coalesce(nullif(trim(p_request->>'action'),''),'search'));
  v_q text := trim(coalesce(p_request->>'query',''));
  v_from integer := greatest(2016, least(coalesce(nullif(p_request->>'from_year','')::integer, 2020), extract(year from current_date)::integer));
  v_to integer;
  v_source text := upper(coalesce(nullif(trim(p_request->>'source'),''),'ALL'));
  v_flow text := upper(coalesce(nullif(trim(p_request->>'flow'),''),'ALL'));
  v_agency_name text := trim(coalesce(p_request->>'agency_name',''));
  v_agency_norm text;
  v_funds_key text := nullif(trim(p_request->>'funds_payer_key'),'');
  v_market_key text := nullif(trim(p_request->>'market_buyer_rut'),'');
  v_limit integer := greatest(1,least(coalesce(nullif(p_request->>'limit','')::integer,100),1000));
  v_offset integer := greatest(0,coalesce(nullif(p_request->>'offset','')::integer,0));
  v_result jsonb;
begin
  if v_uid is null or not exists (
    select 1 from public.aml_allowed_users u where u.user_id=v_uid and u.enabled
  ) then
    raise exception 'NOT_AUTHORIZED' using errcode='42501';
  end if;

  v_to := greatest(v_from,least(coalesce(nullif(p_request->>'to_year','')::integer,extract(year from current_date)::integer),extract(year from current_date)::integer));
  if v_action not in ('search','rows') then raise exception 'INVALID_ACTION' using errcode='22023'; end if;
  if v_source not in ('ALL','PUBLIC_FUNDS','MARKET') then raise exception 'INVALID_SOURCE' using errcode='22023'; end if;
  if v_flow not in ('ALL','SUPPLIER','RECIPIENT') then raise exception 'INVALID_FLOW' using errcode='22023'; end if;

  if v_action='search' then
    if length(v_q)<2 then
      return jsonb_build_object('ok',true,'action','search','rows','[]'::jsonb);
    end if;

    with candidates as materialized (
      select
        regexp_replace(lower(translate(max(py.payer_name),'áéíóúüñÁÉÍÓÚÜÑ','aeiouunAEIOUUN')),'[^a-z0-9]+','','g') norm_name,
        max(py.payer_name) label,
        max(py.payer_key) funds_payer_key,
        null::text market_buyer_rut,
        true has_public_funds,
        false has_market,
        min(py.period_year)::integer first_year,
        max(py.period_year)::integer last_year
      from public.obs_public_funds_payer_year py
      where py.period_year between v_from and v_to
        and v_source in ('ALL','PUBLIC_FUNDS')
        and (lower(py.payer_name) like '%'||lower(v_q)||'%' or lower(py.payer_name) % lower(v_q))
      group by py.payer_key
      union all
      select
        regexp_replace(lower(translate(max(mp.buyer_name),'áéíóúüñÁÉÍÓÚÜÑ','aeiouunAEIOUUN')),'[^a-z0-9]+','','g') norm_name,
        max(mp.buyer_name) label,
        null::text funds_payer_key,
        max(mp.buyer_rut) market_buyer_rut,
        false has_public_funds,
        true has_market,
        min(extract(year from mp.month_start))::integer first_year,
        max(extract(year from mp.month_start))::integer last_year
      from public.aml_mp_buyer_supplier_month mp
      where extract(year from mp.month_start)::integer between v_from and v_to
        and v_source in ('ALL','MARKET')
        and (lower(mp.buyer_name) like '%'||lower(v_q)||'%' or lower(mp.buyer_name) % lower(v_q))
      group by mp.buyer_rut
    ), merged as (
      select norm_name,
        max(label) label,
        max(funds_payer_key) funds_payer_key,
        max(market_buyer_rut) market_buyer_rut,
        bool_or(has_public_funds) has_public_funds,
        bool_or(has_market) has_market,
        min(first_year) first_year,max(last_year) last_year
      from candidates
      where norm_name<>''
      group by norm_name
    )
    select jsonb_build_object(
      'ok',true,'action','search','period',jsonb_build_object('from_year',v_from,'to_year',v_to),
      'rows',coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb)
    ) into v_result
    from (
      select * from merged
      order by case when lower(label)=lower(v_q) then 0 else 1 end,
        similarity(lower(label),lower(v_q)) desc nulls last,label
      limit least(v_limit,50)
    ) x;
    return coalesce(v_result,jsonb_build_object('ok',true,'action','search','rows','[]'::jsonb));
  end if;

  if v_agency_name='' and v_funds_key is null and v_market_key is null then
    raise exception 'AGENCY_REQUIRED' using errcode='22023';
  end if;
  v_agency_norm := regexp_replace(lower(translate(v_agency_name,'áéíóúüñÁÉÍÓÚÜÑ','aeiouunAEIOUUN')),'[^a-z0-9]+','','g');

  with
  funds as materialized (
    select py.rut,max(py.entity_id) entity_id,sum(py.amount) amount,
      sum(py.transaction_count) transaction_count,
      coalesce(sum(py.amount) filter (where py.role='SUPPLIER'),0) supplier_amount,
      coalesce(sum(py.amount) filter (where py.role='RECIPIENT'),0) recipient_amount,
      min(py.first_seen) first_seen,max(py.last_seen) last_seen,
      min(py.period_year)::integer first_year,max(py.period_year)::integer last_year
    from public.obs_public_funds_payer_year py
    where v_source in ('ALL','PUBLIC_FUNDS')
      and py.period_year between v_from and v_to
      and (v_flow='ALL' or py.role=v_flow)
      and ((v_funds_key is not null and py.payer_key=v_funds_key)
        or (v_agency_norm<>'' and regexp_replace(lower(translate(py.payer_name,'áéíóúüñÁÉÍÓÚÜÑ','aeiouunAEIOUUN')),'[^a-z0-9]+','','g')=v_agency_norm))
    group by py.rut
  ),
  market as materialized (
    select mp.supplier_rut rut,max(mp.supplier_name) supplier_name,
      sum(mp.total_clp) amount,sum(mp.order_count) order_count,
      min(mp.first_order_at) first_seen,max(mp.last_order_at) last_seen,
      min(extract(year from mp.month_start))::integer first_year,
      max(extract(year from mp.month_start))::integer last_year
    from public.aml_mp_buyer_supplier_month mp
    where v_source in ('ALL','MARKET')
      and extract(year from mp.month_start)::integer between v_from and v_to
      and ((v_market_key is not null and mp.buyer_rut=v_market_key)
        or (v_agency_norm<>'' and regexp_replace(lower(translate(mp.buyer_name,'áéíóúüñÁÉÍÓÚÜÑ','aeiouunAEIOUUN')),'[^a-z0-9]+','','g')=v_agency_norm))
    group by mp.supplier_rut
  ),
  universe as materialized (
    select rut from funds union select rut from market
  ),
  canonical as materialized (
    select e.rut,max(e.entity_id) entity_id,max(e.name) name,max(e.entity_type) entity_type,max(e.region) region
    from public.obs_entity e join universe u on u.rut=e.rut group by e.rut
  ),
  combined as materialized (
    select u.rut,coalesce(f.entity_id,c.entity_id) entity_id,
      coalesce(nullif(m.supplier_name,''),nullif(c.name,''),u.rut) name,
      c.entity_type,c.region,
      f.amount public_funds_amount,f.supplier_amount public_funds_supplier_amount,
      f.recipient_amount public_funds_recipient_amount,
      f.transaction_count public_funds_transaction_count,
      m.amount market_amount,m.order_count market_order_count,
      least(f.first_seen,m.first_seen) first_seen,greatest(f.last_seen,m.last_seen) last_seen,
      least(f.first_year,m.first_year) first_year,greatest(f.last_year,m.last_year) last_year,
      (f.rut is not null) has_public_funds,(m.rut is not null) has_market,
      (coalesce(f.entity_id,c.entity_id) is not null) is_resolved
    from universe u
    left join funds f on f.rut=u.rut
    left join market m on m.rut=u.rut
    left join canonical c on c.rut=u.rut
  ),
  totals as (
    select count(*)::bigint beneficiary_count,
      count(*) filter (where is_resolved)::bigint resolved_count,
      coalesce(sum(public_funds_amount),0) public_funds_amount,
      coalesce(sum(public_funds_transaction_count),0)::bigint public_funds_transactions,
      coalesce(sum(market_amount),0) market_amount,
      coalesce(sum(market_order_count),0)::bigint market_orders
    from combined
  ),
  top_funds as (select coalesce(sum(public_funds_amount),0) amount from (select public_funds_amount from combined where public_funds_amount is not null order by public_funds_amount desc limit 10) s),
  top_market as (select coalesce(sum(market_amount),0) amount from (select market_amount from combined where market_amount is not null order by market_amount desc limit 10) s),
  page as (
    select * from combined
    order by case when v_source='PUBLIC_FUNDS' then public_funds_amount end desc nulls last,
      case when v_source='MARKET' then market_amount end desc nulls last,
      case when v_source='ALL' then greatest(coalesce(public_funds_amount,0),coalesce(market_amount,0)) end desc nulls last,
      name,rut limit v_limit offset v_offset
  )
  select jsonb_build_object(
    'ok',true,'action','rows','schema','OBS_STATE_AGENCY_BENEFICIARIES_V1',
    'agency',jsonb_build_object('name',v_agency_name,'funds_payer_key',v_funds_key,'market_buyer_rut',v_market_key),
    'period',jsonb_build_object('from_year',v_from,'to_year',v_to),'source',v_source,'flow',v_flow,
    'summary',jsonb_build_object(
      'beneficiary_count',t.beneficiary_count,'resolved_count',t.resolved_count,
      'public_funds_amount',t.public_funds_amount,'public_funds_transactions',t.public_funds_transactions,
      'market_amount',t.market_amount,'market_orders',t.market_orders,
      'top10_public_funds_share',case when t.public_funds_amount>0 then round((tf.amount/t.public_funds_amount)*100,1) else null end,
      'top10_market_share',case when t.market_amount>0 then round((tm.amount/t.market_amount)*100,1) else null end),
    'total',t.beneficiary_count,'limit',v_limit,'offset',v_offset,
    'rows',coalesce((select jsonb_agg(to_jsonb(p)) from page p),'[]'::jsonb),
    'semantics',jsonb_build_object(
      'public_funds','Pagos/traspasos observados en Presupuesto Abierto para el organismo y período.',
      'market','Compras observadas en Mercado Público disponibles en la tabla comprador-proveedor.',
      'combined','Las fuentes se muestran separadas y no se suman para evitar doble contabilización.',
      'identity','Los receptores sin entity_id permanecen visibles como no resueltos.')
  ) into v_result
  from totals t cross join top_funds tf cross join top_market tm;

  return v_result;
end
$$;

grant execute on function public.obs_state_agency_beneficiaries(jsonb) to authenticated;
