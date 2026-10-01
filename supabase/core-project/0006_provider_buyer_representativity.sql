-- ATLAS core · representatividad del proveedor dentro del organismo comprador.
--
-- Complementa provider_counterparty_history_v1 con la mirada inversa de la
-- relación: cuánto representa el proveedor dentro del total comprado por el
-- organismo, cuántos proveedores tuvo ese comprador y qué posición ocupa el
-- proveedor por monto. La consulta se ejecuta sólo al abrir la ficha.

create index if not exists pair_month_buyer_period_idx
  on provider_analyzer.pair_month (buyer_id, year, supplier_id)
  include (amount_total_clp, order_count)
  where year >= 2016;

create or replace function public.provider_counterparty_history_v1(
  p_rut text,
  p_buyer_id text,
  p_from_year integer default 2020,
  p_to_year integer default extract(year from current_date)::integer
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','provider_analyzer','pg_temp'
as $$
declare
  v_rut text := upper(regexp_replace(coalesce(p_rut,''),'[^0-9Kk]','','g'));
  v_buyer text := upper(regexp_replace(coalesce(p_buyer_id,''),'[^0-9A-Za-z]','','g'));
  v_buyer_key text := upper(trim(coalesce(p_buyer_id,'')));
  v_from integer := greatest(2007, least(coalesce(p_from_year,2020), extract(year from current_date)::integer));
  v_to integer;
  v_result jsonb;
begin
  if v_rut !~ '^[0-9]{6,8}[0-9K]$' then
    raise exception 'INVALID_RUT' using errcode='22023';
  end if;
  if v_buyer='' then
    raise exception 'BUYER_REQUIRED' using errcode='22023';
  end if;

  v_to := greatest(v_from, least(coalesce(p_to_year, extract(year from current_date)::integer), extract(year from current_date)::integer));

  with sy as materialized (
    select year,amount_total_clp,order_count,buyer_count,active_months,first_seen,last_seen,buyers
    from provider_analyzer.supplier_year
    where upper(regexp_replace(supplier_id,'[^0-9Kk]','','g'))=v_rut
      and year between v_from and v_to
  ), all_buyer_year as materialized (
    select sy.year,
           sy.amount_total_clp as supplier_amount_clp,
           b.value->>0 as buyer_id,
           upper(regexp_replace(coalesce(b.value->>0,''),'[^0-9A-Za-z]','','g')) as buyer_norm,
           coalesce((b.value->>1)::numeric,0) as amount_clp,
           coalesce((b.value->>2)::bigint,0) as order_count
    from sy
    cross join lateral jsonb_array_elements(coalesce(sy.buyers,'[]'::jsonb)) b(value)
    where jsonb_typeof(b.value)='array' and jsonb_array_length(b.value)>=3
  ), buyer_year as materialized (
    select year,supplier_amount_clp,buyer_id,amount_clp,order_count
    from all_buyer_year
    where buyer_norm=v_buyer
  ), buyer_agg as materialized (
    select buyer_norm,max(buyer_id) buyer_id,sum(amount_clp) amount_clp,sum(order_count)::bigint order_count
    from all_buyer_year
    where buyer_norm<>''
    group by buyer_norm
  ), ranked as materialized (
    select buyer_norm,buyer_id,amount_clp,order_count,
           row_number() over(order by amount_clp desc nulls last,buyer_id) as rank
    from buyer_agg
  ), supplier_totals as (
    select coalesce(sum(amount_total_clp),0) amount_clp from sy
  ), selected_totals as (
    select min(year)::integer first_year,max(year)::integer last_year,count(*)::integer active_years,
           coalesce(sum(amount_clp),0) amount_clp,coalesce(sum(order_count),0)::bigint order_count
    from buyer_year
  ), buyer_total as materialized (
    select coalesce(sum(amount_total_clp),0) amount_clp,
           coalesce(sum(order_count),0)::bigint order_count
    from provider_analyzer.buyer_month
    where upper(trim(buyer_id))=v_buyer_key
      and year between v_from and v_to
  ), buyer_total_year as materialized (
    select year,
           coalesce(sum(amount_total_clp),0) amount_clp,
           coalesce(sum(order_count),0)::bigint order_count
    from provider_analyzer.buyer_month
    where upper(trim(buyer_id))=v_buyer_key
      and year between v_from and v_to
    group by year
  ), buyer_supplier_agg as materialized (
    select supplier_id,
           upper(regexp_replace(coalesce(supplier_id,''),'[^0-9Kk]','','g')) as supplier_norm,
           coalesce(sum(amount_total_clp),0) amount_clp,
           coalesce(sum(order_count),0)::bigint order_count
    from provider_analyzer.pair_month
    where buyer_id=p_buyer_id
      and year between greatest(v_from,2016) and v_to
    group by supplier_id
  ), buyer_supplier_ranked as materialized (
    select supplier_norm,supplier_id,amount_clp,order_count,
           row_number() over(order by amount_clp desc nulls last,supplier_id) as supplier_rank,
           count(*) over()::integer as supplier_count
    from buyer_supplier_agg
  ), buyer_supplier_year_agg as materialized (
    select year,supplier_id,
           upper(regexp_replace(coalesce(supplier_id,''),'[^0-9Kk]','','g')) as supplier_norm,
           coalesce(sum(amount_total_clp),0) amount_clp,
           coalesce(sum(order_count),0)::bigint order_count
    from provider_analyzer.pair_month
    where buyer_id=p_buyer_id
      and year between greatest(v_from,2016) and v_to
    group by year,supplier_id
  ), buyer_supplier_year_ranked as materialized (
    select year,supplier_norm,supplier_id,amount_clp,order_count,
           row_number() over(partition by year order by amount_clp desc nulls last,supplier_id) as supplier_rank,
           count(*) over(partition by year)::integer as supplier_count
    from buyer_supplier_year_agg
  ), buyer_identity as (
    select i.canonical_label
    from provider_analyzer.party_identity i
    where upper(regexp_replace(i.party_key,'[^0-9A-Za-z]','','g'))=v_buyer
    limit 1
  )
  select jsonb_build_object(
    'ok',true,
    'schema','PROVIDER_COUNTERPARTY_HISTORY_V2',
    'rut',v_rut,
    'buyer_id',p_buyer_id,
    'buyer_label',(select canonical_label from buyer_identity),
    'period',jsonb_build_object('from_year',v_from,'to_year',v_to),
    'summary',case when exists(select 1 from buyer_year) then jsonb_build_object(
      'first_year',(select first_year from selected_totals),
      'last_year',(select last_year from selected_totals),
      'active_years',(select active_years from selected_totals),
      'amount_clp',(select amount_clp from selected_totals),
      'order_count',(select order_count from selected_totals),
      'supplier_amount_clp',(select amount_clp from supplier_totals),
      'share_pct',case when (select amount_clp from supplier_totals)>0 then round(((select amount_clp from selected_totals)/(select amount_clp from supplier_totals)*100)::numeric,2) else null end,
      'rank',(select rank from ranked where buyer_norm=v_buyer),
      'buyer_count',(select count(*)::integer from buyer_agg),
      'buyer_amount_clp',(select amount_clp from buyer_total),
      'buyer_share_pct',case when (select amount_clp from buyer_total)>0 then round(((select amount_clp from selected_totals)/(select amount_clp from buyer_total)*100)::numeric,4) else null end,
      'buyer_supplier_rank',(select supplier_rank from buyer_supplier_ranked where supplier_norm=v_rut),
      'buyer_supplier_count',(select supplier_count from buyer_supplier_ranked where supplier_norm=v_rut)
    ) else null end,
    'years',coalesce((select jsonb_agg(to_jsonb(x) order by x.year desc) from (
      select byy.year,
             byy.amount_clp,
             byy.order_count,
             byy.supplier_amount_clp,
             case when byy.supplier_amount_clp>0 then round((byy.amount_clp/byy.supplier_amount_clp*100)::numeric,2) else null end as share_pct,
             bty.amount_clp as buyer_amount_clp,
             case when coalesce(bty.amount_clp,0)>0 then round((byy.amount_clp/bty.amount_clp*100)::numeric,4) else null end as buyer_share_pct,
             byr.supplier_rank as buyer_supplier_rank,
             byr.supplier_count as buyer_supplier_count
      from buyer_year byy
      left join buyer_total_year bty on bty.year=byy.year
      left join buyer_supplier_year_ranked byr on byr.year=byy.year and byr.supplier_norm=v_rut
    ) x),'[]'::jsonb),
    'semantics',jsonb_build_object(
      'source','ChileCompra · provider_analyzer.supplier_year + pair_month + buyer_month',
      'grain','supplier × buyer × year',
      'share_pct','Dependencia: participación del comprador en las ventas públicas del proveedor.',
      'buyer_share_pct','Representatividad: participación del proveedor en el monto total comprado por el organismo en el período.',
      'buyer_supplier_rank','Posición del proveedor dentro de los proveedores del organismo, ordenados por monto comprado.',
      'amounts','Montos agregados; no corresponde a detalle de órdenes individuales.',
      'public_data',true
    )
  ) into v_result;

  return v_result;
end
$$;
