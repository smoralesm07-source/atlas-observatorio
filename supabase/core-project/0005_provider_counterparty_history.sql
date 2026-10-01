-- CORE Mercado Público · detalle anual de la relación proveedor × comprador.
-- Se ejecuta sólo bajo demanda al abrir una ficha en Huella pública.

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
  ), buyer_identity as (
    select i.canonical_label
    from provider_analyzer.party_identity i
    where upper(regexp_replace(i.party_key,'[^0-9A-Za-z]','','g'))=v_buyer
    limit 1
  )
  select jsonb_build_object(
    'ok',true,
    'schema','PROVIDER_COUNTERPARTY_HISTORY_V1',
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
      'buyer_count',(select count(*)::integer from buyer_agg)
    ) else null end,
    'years',coalesce((select jsonb_agg(to_jsonb(x) order by x.year desc) from (
      select byy.year,
             byy.amount_clp,
             byy.order_count,
             byy.supplier_amount_clp,
             case when byy.supplier_amount_clp>0 then round((byy.amount_clp/byy.supplier_amount_clp*100)::numeric,2) else null end as share_pct
      from buyer_year byy
    ) x),'[]'::jsonb),
    'semantics',jsonb_build_object(
      'source','ChileCompra · provider_analyzer.supplier_year',
      'grain','supplier × buyer × year',
      'amounts','Monto agregado por comprador y año; no corresponde a detalle de órdenes individuales.',
      'public_data',true
    )
  ) into v_result;

  return v_result;
end
$$;

revoke all on function public.provider_counterparty_history_v1(text,text,integer,integer) from public,anon,authenticated;
grant execute on function public.provider_counterparty_history_v1(text,text,integer,integer) to service_role;
