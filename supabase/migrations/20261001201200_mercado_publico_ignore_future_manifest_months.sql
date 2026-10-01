-- Mercado Público · la cobertura histórica sólo considera meses cerrados.
-- El mes vigente se gobierna día a día por la API y los meses futuros no pueden dejar la fuente en PARTIAL.

create or replace view public.aml_v_mp_history_coverage
with (security_invoker=true) as
select year,
  count(*) filter(where artifact_type='ORDERS' and status in ('DOWNLOADED','NORMALIZED')) as months_downloaded,
  count(*) filter(where artifact_type='ORDERS' and status='NORMALIZED') as months_normalized,
  count(*) filter(where artifact_type='ORDERS' and status in ('PENDING','DISCOVERED','DOWNLOADED')) as months_pending,
  count(*) filter(where artifact_type='ORDERS' and status='ERROR') as months_error,
  sum(coalesce(bytes,0)) filter(where artifact_type='ORDERS') as raw_bytes,
  sum(coalesce(rows_observed,0)) filter(where artifact_type='ORDERS') as rows_observed,
  max(normalized_at) filter(where artifact_type='ORDERS') as last_normalized_at
from public.aml_mp_raw_manifest
where make_date(year,month,1) < date_trunc('month',current_date)::date
group by year
order by year;

create or replace function public.obs_market_public_coverage(
  p_from_year integer default 2000,
  p_to_year integer default extract(year from current_date)::integer
)
returns jsonb
language plpgsql
security invoker
set search_path to 'public','pg_temp'
as $$
declare
  v_uid uuid := auth.uid();
  v_from integer := greatest(2000,least(coalesce(p_from_year,2000),extract(year from current_date)::integer));
  v_to integer;
  v_hist_discovered integer;
  v_hist_normalized integer;
  v_hist_error integer;
  v_hist_pending integer;
  v_first date;
  v_last date;
  v_rows bigint;
  v_orders bigint;
  v_api_expected integer := 0;
  v_api_normalized integer := 0;
  v_api_error integer := 0;
  v_api_from date;
  v_api_to date;
  v_status text;
  v_current_year integer := extract(year from current_date)::integer;
begin
  if v_uid is null or not exists(select 1 from public.aml_allowed_users u where u.user_id=v_uid and u.enabled) then
    raise exception 'NOT_AUTHORIZED' using errcode='42501';
  end if;
  v_to := greatest(v_from,least(coalesce(p_to_year,v_current_year),v_current_year));

  select count(*) filter(where artifact_type='ORDERS'),
         count(*) filter(where artifact_type='ORDERS' and status='NORMALIZED'),
         count(*) filter(where artifact_type='ORDERS' and status='ERROR'),
         count(*) filter(where artifact_type='ORDERS' and status in ('PENDING','DISCOVERED','DOWNLOADED')),
         min(make_date(year,month,1)) filter(where artifact_type='ORDERS'),
         max(make_date(year,month,1)) filter(where artifact_type='ORDERS'),
         coalesce(sum(rows_observed) filter(where artifact_type='ORDERS' and status='NORMALIZED'),0)
    into v_hist_discovered,v_hist_normalized,v_hist_error,v_hist_pending,v_first,v_last,v_rows
    from public.aml_mp_raw_manifest
   where year between v_from and v_to
     and make_date(year,month,1) < date_trunc('month',current_date)::date;

  if v_from <= v_current_year and v_to >= v_current_year and current_date > date_trunc('month',current_date)::date then
    v_api_from := date_trunc('month',current_date)::date;
    v_api_to := current_date-1;
    v_api_expected := (v_api_to-v_api_from)+1;
    select count(*) filter(where status='NORMALIZED'),count(*) filter(where status='ERROR')
      into v_api_normalized,v_api_error
      from public.aml_mp_api_day_manifest
     where day between v_api_from and v_api_to;
  end if;

  select count(*) into v_orders
    from public.aml_mp_order_fact
   where order_date >= make_date(v_from,1,1)
     and order_date < least(make_date(v_to+1,1,1),current_date+1);

  v_status := case
    when coalesce(v_hist_discovered,0)=0 and v_api_expected=0 then 'NONE'
    when coalesce(v_hist_error,0)>0 or v_api_error>0 then 'PARTIAL'
    when coalesce(v_hist_pending,0)>0 or v_hist_normalized<v_hist_discovered or v_api_normalized<v_api_expected then 'PARTIAL'
    when v_hist_normalized>0 or v_api_normalized>0 then 'COMPLETE'
    else 'NONE'
  end;

  return jsonb_build_object(
    'ok',true,'source','MERCADO_PUBLICO','status',v_status,
    'requested_period',jsonb_build_object('from_year',v_from,'to_year',v_to),
    'history',jsonb_build_object('discovered_months',coalesce(v_hist_discovered,0),'normalized_months',coalesce(v_hist_normalized,0),'pending_months',coalesce(v_hist_pending,0),'error_months',coalesce(v_hist_error,0),'first_discovered_month',v_first,'last_discovered_month',v_last,'rows_observed',coalesce(v_rows,0)),
    'live_api',jsonb_build_object('from_day',v_api_from,'to_day',v_api_to,'expected_days',v_api_expected,'normalized_days',v_api_normalized,'error_days',v_api_error),
    'orders_loaded',coalesce(v_orders,0),
    'zero_is_valid',v_status='COMPLETE',
    'message',case
      when v_status='COMPLETE' then 'Cobertura cargada para los meses cerrados oficiales y los días cerrados del mes vigente.'
      when v_status='PARTIAL' then 'Cobertura parcial: existen meses históricos o días recientes cerrados aún pendientes de normalización.'
      else 'Sin cobertura suficiente cargada para interpretar ausencia de órdenes como cero.'
    end
  );
end
$$;

grant execute on function public.obs_market_public_coverage(integer,integer) to authenticated;
