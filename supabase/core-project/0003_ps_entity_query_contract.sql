-- ATLAS core · Mercado Publico entity query contract
--
-- Complementa ps_export_for_observatory(). El exportador existente sigue
-- atendiendo el monitor analitico; este contrato atiende busquedas por entidad.
-- No usa review_priority y nunca limita el universo consultable a los 3.000
-- actores materializados por el Observatorio.
--
-- IMPORTANTE: este archivo se aplica en el proyecto CORE.
-- La primera version usa las metricas disponibles del snapshot vigente. El
-- detalle historico/OC se habilita cuando el pipeline publique la capa anual y
-- la tabla de ordenes normalizada descritas en docs/INTERACCION_ESTADO_V2.md.

create index if not exists ps_supplier_metric_entity_lookup_idx
  on public.ps_supplier_metric (supplier_id, snapshot_id);

create index if not exists ps_pair_metric_supplier_lookup_idx
  on public.ps_pair_metric (supplier_id, snapshot_id, buyer_id);

-- Normaliza RUT para busqueda tolerante a puntos/guion.
create or replace function public.ps_norm_rut(p_value text)
returns text language sql immutable parallel safe as $$
  select upper(regexp_replace(coalesce(p_value,''), '[^0-9Kk]', '', 'g'))
$$;

-- Consulta puntual. Se autentica con el mismo secreto servidor-a-servidor del
-- puente; el navegador no llama esta funcion directamente.
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
set search_path to 'public', 'vault', 'extensions', 'pg_temp'
as $$
declare
  v_expected text;
  v_snapshot text;
  v_limit integer := greatest(1, least(coalesce(p_limit,100),500));
  v_offset integer := greatest(0,coalesce(p_offset,0));
  v_rut text := public.ps_norm_rut(p_rut);
  v_from integer := greatest(2000, least(coalesce(p_from_year,2020), extract(year from current_date)::integer));
  v_to integer := greatest(v_from, least(coalesce(p_to_year,extract(year from current_date)::integer), extract(year from current_date)::integer));
  v_rows jsonb;
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
    select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into v_rows
    from (
      select s.supplier_id as rut, s.supplier_label as label,
             s.first_seen, s.last_seen,
             s.amount_12m, s.order_count_12m, s.buyer_count
      from public.ps_supplier_metric s
      where s.snapshot_id=v_snapshot
        and (
          public.ps_norm_rut(s.supplier_id) like '%'||public.ps_norm_rut(coalesce(p_query,''))||'%'
          or lower(coalesce(s.supplier_label,'')) like '%'||lower(coalesce(p_query,''))||'%'
        )
      order by
        case when public.ps_norm_rut(s.supplier_id)=public.ps_norm_rut(coalesce(p_query,'')) then 0 else 1 end,
        s.amount_12m desc nulls last, s.supplier_id
      limit least(v_limit,50) offset v_offset
    ) x;
    return jsonb_build_object('ok',true,'action','search','snapshot_id',v_snapshot,'rows',v_rows);
  end if;

  if v_rut = '' then return jsonb_build_object('ok',false,'error','RUT_REQUIRED'); end if;

  if p_action = 'summary' then
    return jsonb_build_object(
      'ok',true,'action','summary','snapshot_id',v_snapshot,
      'requested_period',jsonb_build_object('from_year',v_from,'to_year',v_to),
      'period_scope','CURRENT_SNAPSHOT_12M',
      'history_ready',false,
      'supplier',(
        select jsonb_build_object(
          'rut',s.supplier_id,'label',s.supplier_label,
          'is_state_supplier',true,
          'amount_clp',s.amount_12m,'order_count',s.order_count_12m,
          'buyer_count',s.buyer_count,'top_buyer_id',s.top_buyer_id,
          'top_buyer_share',s.top_buyer_share,'active_months',s.active_months,
          'first_seen',s.first_seen,'last_seen',s.last_seen
        )
        from public.ps_supplier_metric s
        where s.snapshot_id=v_snapshot and public.ps_norm_rut(s.supplier_id)=v_rut
        limit 1
      ));

  elsif p_action = 'buyers' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.amount_clp desc nulls last),'[]'::jsonb) into v_rows
    from (
      select p.buyer_id, p.buyer_label,
             p.amount_12m as amount_clp, p.order_count_12m as order_count,
             p.supplier_share, p.active_months, p.first_seen, p.last_seen
      from public.ps_pair_metric p
      where p.snapshot_id=v_snapshot and public.ps_norm_rut(p.supplier_id)=v_rut
      order by p.amount_12m desc nulls last
      limit v_limit offset v_offset
    ) x;
    return jsonb_build_object(
      'ok',true,'action','buyers','snapshot_id',v_snapshot,
      'requested_period',jsonb_build_object('from_year',v_from,'to_year',v_to),
      'period_scope','CURRENT_SNAPSHOT_12M','history_ready',false,
      'rows',v_rows);

  elsif p_action in ('timeline','orders') then
    -- Fail closed: no se inventa historia a partir de metricas de 12 meses.
    return jsonb_build_object(
      'ok',true,'action',p_action,'snapshot_id',v_snapshot,
      'requested_period',jsonb_build_object('from_year',v_from,'to_year',v_to),
      'available',false,'reason','HISTORICAL_LAYER_NOT_PUBLISHED',
      'rows','[]'::jsonb);
  else
    return jsonb_build_object('ok',false,'error','UNKNOWN_ACTION');
  end if;
end
$$;

revoke all on function public.ps_entity_query_for_observatory(text,text,text,text,integer,integer,integer,integer)
  from public,anon,authenticated;
grant execute on function public.ps_entity_query_for_observatory(text,text,text,text,integer,integer,integer,integer)
  to service_role;
