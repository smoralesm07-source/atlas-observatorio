-- ATLAS core (proyecto bzqxvidggykkdouotylg) · exportador para el Observatorio
--
-- ESTE ARCHIVO NO CORRE EN EL PROYECTO DEL OBSERVATORIO. Vive aqui para que el
-- puente quede versionado completo, pero se aplica en el proyecto core.
--
-- Es lo unico que el Observatorio agrega al proyecto de ATLAS: una funcion de
-- solo lectura y un indice. No modifica ninguna tabla, ninguna vista y ninguna
-- funcion existente de ATLAS.
--
-- AUTORIZACION. El token vive en Vault en los dos proyectos y se compara en
-- tiempo constante: una comparacion normal filtraria el prefijo correcto por el
-- tiempo de respuesta. La funcion es SECURITY DEFINER porque debe leer ps_* y
-- vault sin exponer privilegios al llamador.
--
-- PAGINACION. El lado core responde por PostgREST, con statement_timeout de 8 s
-- en el rol authenticator. Ese tope es de la sentencia de nivel superior, asi
-- que un SET dentro de la funcion no lo levanta: la unica salida es que cada
-- pagina quepa. De ahi los limites y el indice de abajo.

create index if not exists ps_pair_metric_export_idx
  on public.ps_pair_metric (snapshot_id, review_priority desc nulls last, pair_id);
comment on index public.ps_pair_metric_export_idx is
  'Ordena exactamente como pagina el exportador. Sin el, cada pagina de 500 pares cuesta un seq scan sobre 494.867 filas (3,8 s) y el puente muere en el tope de 8 s; con el, 56 ms.';

create or replace function public.ps_export_for_observatory(
  p_token text, p_section text default 'meta',
  p_limit integer default 1500, p_offset integer default 0)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'vault', 'extensions', 'pg_temp'
as $$
declare
  v_expected text;
  v_snapshot text;
  v_limit integer := greatest(1, least(coalesce(p_limit, 1500), 2000));
  v_offset integer := greatest(0, coalesce(p_offset, 0));
  v_rows jsonb;
begin
  select decrypted_secret into v_expected
  from vault.decrypted_secrets where name = 'obs_bridge_token';

  -- Comparacion de longitud constante: una comparacion normal filtra el prefijo
  -- correcto por el tiempo de respuesta.
  if v_expected is null
     or p_token is null
     or length(p_token) <> length(v_expected)
     or encode(digest(p_token, 'sha256'), 'hex')
        <> encode(digest(v_expected, 'sha256'), 'hex') then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHORIZED');
  end if;

  select ps.snapshot_id into v_snapshot
  from public.ps_snapshot ps order by ps.generated_at desc limit 1;

  if v_snapshot is null then
    return jsonb_build_object('ok', false, 'error', 'NO_SNAPSHOT');
  end if;

  if p_section = 'meta' then
    return jsonb_build_object(
      'ok', true, 'section', 'meta', 'snapshot_id', v_snapshot,
      'snapshot',  (select to_jsonb(s) from public.ps_snapshot s where s.snapshot_id = v_snapshot),
      'readiness', (select coalesce(jsonb_agg(to_jsonb(r) order by r.sort_order), '[]')
                    from public.ps_readiness r),
      'universo', jsonb_build_object(
        'pairs_total',     (select count(*) from public.ps_pair_metric where snapshot_id = v_snapshot),
        'suppliers_total', (select count(*) from public.ps_supplier_metric where snapshot_id = v_snapshot),
        'buyers_total',    (select count(*) from public.ps_buyer_metric where snapshot_id = v_snapshot),
        'findings_total',  (select count(*) from public.ps_finding where snapshot_id = v_snapshot)),
      'exported_at', now());

  elsif p_section = 'findings' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'finding_id', f.finding_id, 'finding_type', f.finding_type, 'family', f.family,
      'supplier_id', f.supplier_id, 'buyer_id', f.buyer_id, 'pair_id', f.pair_id,
      'review_priority', f.review_priority, 'severity_band', f.severity_band,
      'materiality_clp', f.materiality_clp, 'title', f.title, 'summary', f.summary,
      'source_status', f.source_status)), '[]')
    into v_rows
    from (select * from public.ps_finding
          where snapshot_id = v_snapshot
          order by review_priority desc nulls last, finding_id
          limit v_limit offset v_offset) f;

  elsif p_section = 'buyers' then
    select coalesce(jsonb_agg(to_jsonb(b)), '[]') into v_rows
    from (select * from public.ps_buyer_metric
          where snapshot_id = v_snapshot
          order by review_priority desc nulls last, buyer_id
          limit v_limit offset v_offset) b;

  elsif p_section = 'suppliers' then
    select coalesce(jsonb_agg(to_jsonb(x)), '[]') into v_rows
    from (select * from public.ps_supplier_metric
          where snapshot_id = v_snapshot
          order by review_priority desc nulls last, supplier_id
          limit v_limit offset v_offset) x;

  elsif p_section = 'pairs' then
    select coalesce(jsonb_agg(to_jsonb(p)), '[]') into v_rows
    from (select snapshot_id, pair_id, buyer_id, supplier_id, buyer_label, supplier_label,
                 amount_12m, order_count_12m, buyer_share, supplier_share, active_months,
                 first_seen, last_seen, acceleration_ratio, acceleration_percentile,
                 price_signal_count, max_price_priority, max_price_ratio,
                 convergence_count, review_priority, flags
          from public.ps_pair_metric
          where snapshot_id = v_snapshot
          order by review_priority desc nulls last, pair_id
          limit v_limit offset v_offset) p;

  else
    return jsonb_build_object('ok', false, 'error', 'UNKNOWN_SECTION');
  end if;

  return jsonb_build_object(
    'ok', true, 'section', p_section, 'snapshot_id', v_snapshot,
    'limit', v_limit, 'offset', v_offset,
    'count', jsonb_array_length(v_rows), 'rows', v_rows);
end
$$;

revoke all on function public.ps_export_for_observatory(text,text,integer,integer)
  from public, anon, authenticated;
grant execute on function public.ps_export_for_observatory(text,text,integer,integer)
  to service_role;
