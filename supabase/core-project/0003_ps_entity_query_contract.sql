-- ATLAS core · Mercado Público entity query contract
--
-- Complementa ps_export_for_observatory(). El exportador existente sigue
-- atendiendo el monitor analítico; este contrato atiende búsquedas por entidad.
-- No usa review_priority y nunca limita el universo consultable a los 3.000
-- actores materializados por el Observatorio.
--
-- IMPORTANTE: este archivo se aplica en el proyecto CORE.
-- Historia: provider_analyzer.supplier_year, grano proveedor×año, con compradores
-- compactados como [buyer_id, amount_clp, order_count]. El período por defecto
-- es 2020→actualidad; el contrato admite 2007→actualidad cuando exista backfill.

create index if not exists ps_supplier_metric_entity_lookup_idx
  on public.ps_supplier_metric (supplier_id, snapshot_id);

create index if not exists ps_pair_metric_supplier_lookup_idx
  on public.ps_pair_metric (supplier_id, snapshot_id, buyer_id);

-- Normaliza RUT para búsqueda tolerante a puntos/guion.
create or replace function public.ps_norm_rut(p_value text)
returns text language sql immutable parallel safe as $$
  select upper(regexp_replace(coalesce(p_value,''), '[^0-9Kk]', '', 'g'))
$$;

-- Consulta puntual. Se autentica con el mismo secreto servidor-a-servidor del
-- puente; el navegador no llama esta función directamente.
create or replace function public.ps_entity_query_for_observatory(
  p_token text,
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
set search_path to 'public', 'provider_analyzer', 'vault', 'extensions', 'pg_temp'
as $$
declare
  v_expected text;
  v_snapshot text;
  v_limit integer := greatest(1, least(coalesce(p_limit,100),500));
  v_offset integer := greatest(0,coalesce(p_offset,0));
  v_rut text := public.ps_norm_rut(p_rut);
  v_q_rut text := public.ps_norm_rut(p_query);
  v_from integer := greatest(2007, least(coalesce(p_from_year,2020), extract(year from current_date)::integer));
  v_to integer := greatest(v_from, least(coalesce(p_to_year,extract(year from current_date)::integer), extract(year from current_date)::integer));
  v_rows jsonb;
  v_supplier jsonb;
begin
  select decrypted_secret into v_expected
  from vault.decrypted_secrets where name='obs_bridge_token';

  if v_expected is null or p_token is null
     or length(p_token) <> length(v_expected)
     or encode(digest(p_token,'sha256'),'hex') <> encode(digest(v_expected,'sha256'),'hex') then
    return jsonb_build_object('ok',false,'error','UNAUTHORIZED');
  end if;

  select snapshot_id into v_snapshot
  from public.ps_snapshot order by generated_at desc limit 1;
  if v_snapshot is null then return jsonb_build_object('ok',false,'error','NO_SNAPSHOT'); end if;

  if p_action = 'search' then
    -- El directorio histórico garantiza que un proveedor no desaparezca porque
    -- quedó fuera de la ventana móvil de 12 meses. Los nombres se toman del
    -- directorio corriente cuando existen; un RUT histórico sigue siendo
    -- encontrable aunque no tenga etiqueta actual.
    with hist as (
      select sy.supplier_id,
             min(sy.first_seen) as first_seen,
             max(sy.last_seen) as last_seen,
             sum(sy.amount_total_clp) as amount_clp,
             sum(sy.order_count) as order_count,
             count(*) as active_years
      from provider_analyzer.supplier_year sy
      group by sy.supplier_id
    ), current_dir as (
      select s.supplier_id, max(s.supplier_label) as supplier_label
      from public.ps_supplier_metric s
      where s.snapshot_id=v_snapshot
      group by s.supplier_id
    ), directory as (
      select h.supplier_id as rut, c.supplier_label as label,
             h.first_seen, h.last_seen, h.amount_clp, h.order_count, h.active_years
      from hist h
      left join current_dir c on public.ps_norm_rut(c.supplier_id)=public.ps_norm_rut(h.supplier_id)
      union all
      select c.supplier_id, c.supplier_label, null::date, null::date,
             null::numeric, null::bigint, null::bigint
      from current_dir c
      where not exists (
        select 1 from hist h
        where public.ps_norm_rut(h.supplier_id)=public.ps_norm_rut(c.supplier_id)
      )
    )
    select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into v_rows
    from (
      select d.*
      from directory d
      where (
        (v_q_rut <> '' and public.ps_norm_rut(d.rut) like '%'||v_q_rut||'%')
        or lower(coalesce(d.label,'')) like '%'||lower(coalesce(p_query,''))||'%'
      )
      order by
        case when v_q_rut <> '' and public.ps_norm_rut(d.rut)=v_q_rut then 0 else 1 end,
        d.amount_clp desc nulls last, d.rut
      limit least(v_limit,50) offset v_offset
    ) x;
    return jsonb_build_object(
      'ok',true,'action','search','snapshot_id',v_snapshot,
      'history_storage','SUPPLIER_YEAR_PACKED_V1','rows',v_rows
    );
  end if;

  if v_rut = '' then return jsonb_build_object('ok',false,'error','RUT_REQUIRED'); end if;

  if p_action = 'summary' then
    with years as (
      select sy.*
      from provider_analyzer.supplier_year sy
      where public.ps_norm_rut(sy.supplier_id)=v_rut
        and sy.year between v_from and v_to
    ), buyer_expanded as (
      select (b->>0) as buyer_id,
             (b->>1)::numeric as amount_clp,
             (b->>2)::bigint as order_count
      from years y
      cross join lateral jsonb_array_elements(y.buyers) b
    ), buyer_agg as (
      select buyer_id, sum(amount_clp) amount_clp, sum(order_count) order_count
      from buyer_expanded
      group by buyer_id
    ), totals as (
      select min(year) first_year, max(year) last_year,
             min(first_seen) first_seen, max(last_seen) last_seen,
             sum(amount_total_clp) amount_clp,
             sum(order_count) order_count,
             sum(active_months)::integer active_months,
             count(*)::integer active_years
      from years
    ), top_buyer as (
      select buyer_id, amount_clp, order_count
      from buyer_agg
      order by amount_clp desc nulls last, buyer_id
      limit 1
    ), current_label as (
      select max(s.supplier_label) label
      from public.ps_supplier_metric s
      where s.snapshot_id=v_snapshot and public.ps_norm_rut(s.supplier_id)=v_rut
    ), top_label as (
      select max(b.buyer_label) label
      from public.ps_buyer_metric b, top_buyer t
      where b.snapshot_id=v_snapshot and b.buyer_id=t.buyer_id
    )
    select case when t.first_year is null then null else jsonb_build_object(
      'rut',coalesce((select min(supplier_id) from years),p_rut),
      'label',(select label from current_label),
      'is_state_supplier',true,
      'first_year',t.first_year,'last_year',t.last_year,
      'first_seen',t.first_seen,'last_seen',t.last_seen,
      'amount_clp',t.amount_clp,'order_count',t.order_count,
      'buyer_count',(select count(*) from buyer_agg),
      'active_months',t.active_months,'active_years',t.active_years,
      'top_buyer_id',(select buyer_id from top_buyer),
      'top_buyer_label',(select label from top_label),
      'top_buyer_amount_clp',(select amount_clp from top_buyer),
      'top_buyer_order_count',(select order_count from top_buyer)
    ) end into v_supplier
    from totals t;

    return jsonb_build_object(
      'ok',true,'action','summary','snapshot_id',v_snapshot,
      'requested_period',jsonb_build_object('from_year',v_from,'to_year',v_to),
      'period_scope','HISTORICAL_ANNUAL','history_ready',v_supplier is not null,
      'history_storage','SUPPLIER_YEAR_PACKED_V1','supplier',v_supplier
    );

  elsif p_action = 'buyers' then
    with years as (
      select sy.*
      from provider_analyzer.supplier_year sy
      where public.ps_norm_rut(sy.supplier_id)=v_rut
        and sy.year between v_from and v_to
    ), expanded as (
      select y.year,
             (b->>0) buyer_id,
             (b->>1)::numeric amount_clp,
             (b->>2)::bigint order_count
      from years y cross join lateral jsonb_array_elements(y.buyers) b
    ), agg as (
      select buyer_id, sum(amount_clp) amount_clp, sum(order_count) order_count,
             min(year) first_year, max(year) last_year,
             count(*)::integer active_years
      from expanded
      group by buyer_id
    ), latest_buyer as (
      select buyer_id, max(buyer_label) buyer_label
      from public.ps_buyer_metric
      where snapshot_id=v_snapshot
      group by buyer_id
    )
    select coalesce(jsonb_agg(to_jsonb(x) order by x.amount_clp desc nulls last),'[]'::jsonb) into v_rows
    from (
      select a.buyer_id, b.buyer_label,
             a.amount_clp, a.order_count, a.first_year, a.last_year, a.active_years
      from agg a
      left join latest_buyer b using (buyer_id)
      order by a.amount_clp desc nulls last, a.buyer_id
      limit v_limit offset v_offset
    ) x;
    return jsonb_build_object(
      'ok',true,'action','buyers','snapshot_id',v_snapshot,
      'requested_period',jsonb_build_object('from_year',v_from,'to_year',v_to),
      'period_scope','HISTORICAL_ANNUAL','history_ready',true,
      'history_storage','SUPPLIER_YEAR_PACKED_V1','rows',v_rows
    );

  elsif p_action = 'timeline' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.year),'[]'::jsonb) into v_rows
    from (
      select sy.year, sy.amount_total_clp as amount_clp, sy.order_count,
             sy.buyer_count, sy.active_months, sy.first_seen, sy.last_seen
      from provider_analyzer.supplier_year sy
      where public.ps_norm_rut(sy.supplier_id)=v_rut
        and sy.year between v_from and v_to
      order by sy.year
    ) x;
    return jsonb_build_object(
      'ok',true,'action','timeline','snapshot_id',v_snapshot,
      'requested_period',jsonb_build_object('from_year',v_from,'to_year',v_to),
      'period_scope','HISTORICAL_ANNUAL','history_ready',true,
      'history_storage','SUPPLIER_YEAR_PACKED_V1','rows',v_rows
    );

  elsif p_action = 'orders' then
    -- El libro mayor de OC no se mantiene en el hot path. El detalle deberá
    -- resolverse a demanda contra el bulk/API por RUT + período + comprador.
    return jsonb_build_object(
      'ok',true,'action','orders','snapshot_id',v_snapshot,
      'requested_period',jsonb_build_object('from_year',v_from,'to_year',v_to),
      'available',false,'reason','DETAIL_ON_DEMAND_NOT_YET_PUBLISHED',
      'rows','[]'::jsonb
    );
  else
    return jsonb_build_object('ok',false,'error','UNKNOWN_ACTION');
  end if;
end
$$;

revoke all on function public.ps_entity_query_for_observatory(text,text,text,text,integer,integer,integer,integer)
  from public,anon,authenticated;
grant execute on function public.ps_entity_query_for_observatory(text,text,text,text,integer,integer,integer,integer)
  to service_role;
