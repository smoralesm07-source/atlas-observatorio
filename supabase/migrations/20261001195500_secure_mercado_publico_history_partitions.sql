-- Mercado Público · hardening de las particiones históricas dinámicas.
-- Las lecturas de usuario siguen entrando por la tabla padre y sus políticas/RPCs;
-- las particiones no quedan expuestas como tablas independientes en PostgREST.

create or replace function public.ensure_aml_mp_year_partition(p_year integer)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','pg_temp'
as $$
declare
  v_now_year integer := extract(year from current_date)::integer;
  v_from date;
  v_to date;
  v_fact text;
  v_item text;
begin
  if p_year < 2000 or p_year > v_now_year + 2 then
    raise exception 'YEAR_OUT_OF_GUARD: %',p_year using errcode='22023';
  end if;
  v_from := make_date(p_year,1,1);
  v_to := make_date(p_year+1,1,1);
  v_fact := format('aml_mp_order_fact_%s',p_year);
  v_item := format('aml_mp_order_item_%s',p_year);

  execute format('create table if not exists public.%I partition of public.aml_mp_order_fact for values from (%L) to (%L)',v_fact,v_from,v_to);
  execute format('create table if not exists public.%I partition of public.aml_mp_order_item for values from (%L) to (%L)',v_item,v_from,v_to);
  execute format('alter table public.%I enable row level security',v_fact);
  execute format('alter table public.%I enable row level security',v_item);
  execute format('revoke all on table public.%I from public, anon, authenticated',v_fact);
  execute format('revoke all on table public.%I from public, anon, authenticated',v_item);

  return jsonb_build_object('ok',true,'year',p_year,'fact_partition',v_fact,'item_partition',v_item,'rls',true);
end
$$;

revoke all on function public.ensure_aml_mp_year_partition(integer) from public,anon,authenticated;
grant execute on function public.ensure_aml_mp_year_partition(integer) to service_role;

do $$
declare r record;
begin
  for r in
    select n.nspname,c.relname
      from pg_class c
      join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='public'
       and c.relkind='r'
       and (c.relname ~ '^aml_mp_order_fact_[0-9]{4}$' or c.relname ~ '^aml_mp_order_item_[0-9]{4}$')
  loop
    execute format('alter table %I.%I enable row level security',r.nspname,r.relname);
    execute format('revoke all on table %I.%I from public, anon, authenticated',r.nspname,r.relname);
  end loop;
end
$$;

alter view public.aml_v_mp_history_coverage set (security_invoker = true);
