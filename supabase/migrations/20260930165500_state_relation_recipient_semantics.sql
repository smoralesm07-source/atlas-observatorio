-- Relación con el Estado · semántica estricta de receptor vs proveedor.
--
-- PUBLIC_FUNDS_RECIPIENT representa exclusivamente fondos observados con
-- role='RECIPIENT'. La condición de proveedor permanece independiente y se
-- resuelve con el directorio ChileCompra. Esto evita que un pago por compra
-- pública sea presentado como transferencia/fondo recibido.

create or replace function public.obs_state_relation_detail(p_entity_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public','atlas_private','pg_temp'
as $$
declare
  v_rut text;
  v_supplier jsonb;
  v_funds jsonb;
  v_years jsonb;
  v_mp_status jsonb;
  v_pa_status jsonb;
begin
  if not (
    auth.role() = 'service_role' or (
      auth.uid() is not null and exists (
        select 1
        from public.aml_allowed_users u
        where u.user_id = auth.uid()
          and u.enabled
      )
    )
  ) then
    raise exception 'ATLAS_CORE_FORBIDDEN' using errcode='42501';
  end if;

  select rut
    into v_rut
  from public.obs_entity
  where entity_id = p_entity_id;

  if v_rut is null then
    return jsonb_build_object(
      'entity_id', p_entity_id,
      'rut', null,
      'marks', '[]'::jsonb
    );
  end if;

  select to_jsonb(s)
    into v_supplier
  from public.obs_state_supplier_directory s
  where s.rut = v_rut;

  -- El resumen de fondos se toma del agregado privado receptor-only.
  select jsonb_build_object(
      'rut', r.rut,
      'amount_total', r.amount_total,
      'transaction_count', r.transaction_count,
      'payer_count', r.payer_count,
      'first_seen', r.first_seen,
      'last_seen', r.last_seen,
      'top_payer_key', tp.payer_key,
      'top_payer_name', tp.payer_name,
      'top_payer_amount', tp.amount,
      'source_snapshot_id', r.source_snapshot_id,
      'refreshed_at', r.refreshed_at
    )
    into v_funds
  from atlas_private.obs_public_funds_recipient_entity r
  left join lateral (
    select
      py.payer_key,
      max(py.payer_name) as payer_name,
      sum(py.amount) as amount
    from public.obs_public_funds_payer_year py
    where py.rut = r.rut
      and py.role = 'RECIPIENT'
    group by py.payer_key
    order by sum(py.amount) desc nulls last, py.payer_key
    limit 1
  ) tp on true
  where r.rut = v_rut;

  -- Hitos anuales receptor-only. Se entrega el año, no se fabrica una fecha
  -- exacta dentro del período.
  with recipient_year as (
    select
      py.period_year,
      sum(py.amount) as amount_total,
      count(distinct py.payer_key)::integer as payer_count,
      sum(py.transaction_count)::bigint as transaction_count
    from public.obs_public_funds_payer_year py
    where py.rut = v_rut
      and py.role = 'RECIPIENT'
    group by py.period_year
  ),
  recipient_top as (
    select distinct on (q.period_year)
      q.period_year,
      q.payer_key,
      q.payer_name,
      q.amount
    from (
      select
        py.period_year,
        py.payer_key,
        max(py.payer_name) as payer_name,
        sum(py.amount) as amount
      from public.obs_public_funds_payer_year py
      where py.rut = v_rut
        and py.role = 'RECIPIENT'
      group by py.period_year, py.payer_key
    ) q
    order by q.period_year, q.amount desc nulls last, q.payer_key
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'period_year', y.period_year,
        'amount_total', y.amount_total,
        'amount_transfer', y.amount_total,
        'amount_supplier', 0,
        'payer_count', y.payer_count,
        'transaction_count', y.transaction_count,
        'top_payer_key', t.payer_key,
        'top_payer_name', t.payer_name,
        'top_payer_amount', t.amount
      )
      order by y.period_year desc
    ),
    '[]'::jsonb
  )
  into v_years
  from recipient_year y
  left join recipient_top t
    on t.period_year = y.period_year;

  select to_jsonb(r)
    into v_mp_status
  from public.obs_state_relation_refresh r
  where source_code = 'MERCADO_PUBLICO';

  select to_jsonb(r)
    into v_pa_status
  from public.obs_state_relation_refresh r
  where source_code = 'PRESUPUESTO_ABIERTO';

  return jsonb_build_object(
    'entity_id', p_entity_id,
    'rut', v_rut,
    'marks', jsonb_build_array(
      jsonb_build_object(
        'code', 'STATE_SUPPLIER',
        'label', 'Proveedor del Estado',
        'active', v_supplier is not null,
        'status', case
          when v_supplier is not null then 'PRESENT'
          when v_mp_status->>'status' = 'READY' then 'ABSENT'
          else 'UNKNOWN'
        end,
        'source', 'MERCADO_PUBLICO',
        'included_in_score', false
      ),
      jsonb_build_object(
        'code', 'PUBLIC_FUNDS_RECIPIENT',
        'label', 'Fondos públicos',
        'active', v_funds is not null,
        'status', case
          when v_funds is not null then 'PRESENT'
          when v_pa_status->>'status' = 'READY' then 'ABSENT'
          else 'UNKNOWN'
        end,
        'source', 'PRESUPUESTO_ABIERTO',
        'included_in_score', false
      )
    ),
    'supplier', v_supplier,
    'public_funds', v_funds,
    'public_funds_years', v_years,
    'source_status', jsonb_build_object(
      'mercado_publico', v_mp_status,
      'presupuesto_abierto', v_pa_status
    )
  );
end;
$$;

revoke all on function public.obs_state_relation_detail(text) from public, anon;
grant execute on function public.obs_state_relation_detail(text) to authenticated, service_role;

create or replace function public.obs_public_funds_payer_detail(
  p_entity_id text,
  p_year integer default null,
  p_limit integer default 100,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public','pg_temp'
as $$
declare
  v_rut text;
  v_rows jsonb;
  v_limit integer := greatest(1, least(coalesce(p_limit, 100), 500));
  v_offset integer := greatest(0, coalesce(p_offset, 0));
begin
  if not (
    auth.role() = 'service_role' or (
      auth.uid() is not null and exists (
        select 1
        from public.aml_allowed_users u
        where u.user_id = auth.uid()
          and u.enabled
      )
    )
  ) then
    raise exception 'ATLAS_CORE_FORBIDDEN' using errcode='42501';
  end if;

  select rut
    into v_rut
  from public.obs_entity
  where entity_id = p_entity_id;

  if v_rut is null then
    return jsonb_build_object(
      'rows', '[]'::jsonb,
      'count', 0,
      'limit', v_limit,
      'offset', v_offset,
      'role_filter', 'RECIPIENT'
    );
  end if;

  select coalesce(
    jsonb_agg(to_jsonb(x) order by x.period_year desc, x.amount desc nulls last),
    '[]'::jsonb
  )
  into v_rows
  from (
    select
      payer_key,
      payer_name,
      period_year,
      role,
      amount,
      transaction_count,
      first_seen,
      last_seen
    from public.obs_public_funds_payer_year
    where rut = v_rut
      and role = 'RECIPIENT'
      and (p_year is null or period_year = p_year)
    order by period_year desc, amount desc nulls last, payer_key
    limit v_limit
    offset v_offset
  ) x;

  return jsonb_build_object(
    'rows', v_rows,
    'count', jsonb_array_length(v_rows),
    'limit', v_limit,
    'offset', v_offset,
    'year', p_year,
    'role_filter', 'RECIPIENT'
  );
end;
$$;

revoke all on function public.obs_public_funds_payer_detail(text,integer,integer,integer) from public, anon;
grant execute on function public.obs_public_funds_payer_detail(text,integer,integer,integer) to authenticated, service_role;
