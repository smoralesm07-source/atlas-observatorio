-- Huella pública: corrige el falso "usuario no habilitado" y acelera el buscador de organismos.

-- 1) La cobertura de Mercado Público lee manifiestos internos. Mantener esas tablas
-- privadas y ejecutar la lectura bajo un SECURITY DEFINER con allowlist explícita.
alter function public.obs_market_public_coverage(integer, integer) security definer;
alter function public.obs_market_public_coverage(integer, integer)
  set search_path to 'pg_catalog','public','pg_temp';
revoke all on function public.obs_market_public_coverage(integer, integer) from public, anon;
grant execute on function public.obs_market_public_coverage(integer, integer) to authenticated;

-- 2) Directorio compacto de organismos. Evita buscar en ~600k filas agregadas en
-- cada tecla y conserva los identificadores de ambas fuentes.
drop materialized view if exists public.obs_state_agency_directory;
create materialized view public.obs_state_agency_directory as
with funds as (
  select
    regexp_replace(
      lower(translate(max(py.payer_name),'áéíóúüñÁÉÍÓÚÜÑ','aeiouunAEIOUUN')),
      '[^a-z0-9]+','','g'
    ) as norm_name,
    max(py.payer_name) as label,
    max(py.payer_key) as funds_payer_key,
    min(py.period_year)::integer as funds_first_year,
    max(py.period_year)::integer as funds_last_year,
    null::text as market_buyer_rut,
    null::integer as market_first_year,
    null::integer as market_last_year
  from public.obs_public_funds_payer_year py
  where py.payer_name is not null and py.payer_key is not null
  group by py.payer_key
),
market as (
  select
    regexp_replace(
      lower(translate(max(mp.buyer_name),'áéíóúüñÁÉÍÓÚÜÑ','aeiouunAEIOUUN')),
      '[^a-z0-9]+','','g'
    ) as norm_name,
    max(mp.buyer_name) as label,
    null::text as funds_payer_key,
    null::integer as funds_first_year,
    null::integer as funds_last_year,
    max(mp.buyer_rut) as market_buyer_rut,
    min(extract(year from mp.month_start))::integer as market_first_year,
    max(extract(year from mp.month_start))::integer as market_last_year
  from public.aml_mp_buyer_supplier_month mp
  where mp.buyer_name is not null and mp.buyer_rut is not null
  group by mp.buyer_rut
),
merged as (
  select
    norm_name,
    max(label) as label,
    max(funds_payer_key) as funds_payer_key,
    min(funds_first_year) as funds_first_year,
    max(funds_last_year) as funds_last_year,
    max(market_buyer_rut) as market_buyer_rut,
    min(market_first_year) as market_first_year,
    max(market_last_year) as market_last_year
  from (
    select * from funds
    union all
    select * from market
  ) s
  where norm_name <> ''
  group by norm_name
)
select
  norm_name,
  label,
  funds_payer_key,
  market_buyer_rut,
  (funds_payer_key is not null) as has_public_funds,
  (market_buyer_rut is not null) as has_market,
  least(funds_first_year, market_first_year) as first_year,
  greatest(funds_last_year, market_last_year) as last_year,
  funds_first_year,
  funds_last_year,
  market_first_year,
  market_last_year
from merged;

create unique index obs_state_agency_directory_norm_uidx
  on public.obs_state_agency_directory(norm_name);
create index obs_state_agency_directory_label_trgm_idx
  on public.obs_state_agency_directory using gin (lower(label) extensions.gin_trgm_ops);

revoke all on public.obs_state_agency_directory from public, anon, authenticated;

-- 3) RPC dedicado de búsqueda sobre el directorio compacto.
create or replace function public.obs_state_agency_search(p_request jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','extensions','pg_temp'
as $$
declare
  v_uid uuid := auth.uid();
  v_q text := trim(coalesce(p_request->>'query',''));
  v_q_norm text;
  v_from integer := greatest(2016, least(coalesce(nullif(p_request->>'from_year','')::integer, 2020), extract(year from current_date)::integer));
  v_to integer;
  v_source text := upper(coalesce(nullif(trim(p_request->>'source'),''),'ALL'));
  v_limit integer := greatest(1, least(coalesce(nullif(p_request->>'limit','')::integer,20),50));
  v_result jsonb;
begin
  if v_uid is null or not exists (
    select 1 from public.aml_allowed_users u where u.user_id=v_uid and u.enabled
  ) then
    raise exception 'NOT_AUTHORIZED' using errcode='42501';
  end if;

  v_to := greatest(v_from, least(coalesce(nullif(p_request->>'to_year','')::integer, extract(year from current_date)::integer), extract(year from current_date)::integer));
  if v_source not in ('ALL','PUBLIC_FUNDS','MARKET') then
    raise exception 'INVALID_SOURCE' using errcode='22023';
  end if;
  if length(v_q) < 2 then
    return jsonb_build_object('ok',true,'action','search','rows','[]'::jsonb);
  end if;

  v_q_norm := regexp_replace(lower(translate(v_q,'áéíóúüñÁÉÍÓÚÜÑ','aeiouunAEIOUUN')),'[^a-z0-9]+','','g');

  select jsonb_build_object(
    'ok',true,
    'action','search',
    'period',jsonb_build_object('from_year',v_from,'to_year',v_to),
    'rows',coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb)
  )
  into v_result
  from (
    select
      d.norm_name,
      d.label,
      d.funds_payer_key,
      d.market_buyer_rut,
      d.has_public_funds,
      d.has_market,
      case
        when v_source='PUBLIC_FUNDS' then d.funds_first_year
        when v_source='MARKET' then d.market_first_year
        else least(d.funds_first_year,d.market_first_year)
      end as first_year,
      case
        when v_source='PUBLIC_FUNDS' then d.funds_last_year
        when v_source='MARKET' then d.market_last_year
        else greatest(d.funds_last_year,d.market_last_year)
      end as last_year
    from public.obs_state_agency_directory d
    where
      (
        (v_source='PUBLIC_FUNDS' and d.has_public_funds and d.funds_first_year <= v_to and d.funds_last_year >= v_from)
        or
        (v_source='MARKET' and d.has_market and d.market_first_year <= v_to and d.market_last_year >= v_from)
        or
        (v_source='ALL' and (
          (d.has_public_funds and d.funds_first_year <= v_to and d.funds_last_year >= v_from)
          or (d.has_market and d.market_first_year <= v_to and d.market_last_year >= v_from)
        ))
      )
      and (
        lower(d.label) like '%' || lower(v_q) || '%'
        or d.norm_name like '%' || v_q_norm || '%'
        or similarity(lower(d.label), lower(v_q)) >= 0.18
      )
    order by
      case
        when lower(d.label)=lower(v_q) then 0
        when lower(d.label) like lower(v_q) || '%' then 1
        when lower(d.label) like '%' || lower(v_q) || '%' then 2
        when d.norm_name like '%' || v_q_norm || '%' then 3
        else 4
      end,
      similarity(lower(d.label),lower(v_q)) desc,
      d.label
    limit v_limit
  ) x;

  return coalesce(v_result,jsonb_build_object('ok',true,'action','search','rows','[]'::jsonb));
end
$$;

revoke all on function public.obs_state_agency_search(jsonb) from public, anon;
grant execute on function public.obs_state_agency_search(jsonb) to authenticated;

-- Refrescar el directorio fuera de la ruta interactiva. Cada 6 horas es más que
-- suficiente para una dimensión de organismos y evita costo en cada búsqueda.
do $$
declare v_jobid bigint;
begin
  select jobid into v_jobid from cron.job where jobname='obs-state-agency-directory-refresh' limit 1;
  if v_jobid is not null then
    perform cron.unschedule(v_jobid);
  end if;
end
$$;
select cron.schedule(
  'obs-state-agency-directory-refresh',
  '23 */6 * * *',
  'refresh materialized view concurrently public.obs_state_agency_directory'
);
