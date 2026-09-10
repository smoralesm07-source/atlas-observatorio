-- ATLAS piloto: ChileCompra permanece únicamente como señal binaria de
-- caracterización de entidad. El modelo analítico de gasto público queda fuera
-- del producto y puede evolucionar de forma independiente.

create schema if not exists private;

-- Defensa en profundidad: aunque otro proceso intente escribir métricas del
-- antiguo módulo, Atlas conserva sólo la semántica binaria Proveedor del Estado.
create or replace function public.atlas_keep_supplier_signal_only()
returns trigger
language plpgsql
set search_path = 'public', 'pg_temp'
as $$
declare
  v_detail jsonb := coalesce(new.detail, '{}'::jsonb);
  v_is_supplier boolean;
begin
  if new.source_code <> 'MERCADO_PUBLICO' then
    return new;
  end if;

  v_is_supplier := coalesce((v_detail->'roles') ? 'Proveedor', false)
    or upper(coalesce(v_detail->>'role', '')) = 'PROVEEDOR';

  if not v_is_supplier then
    return null;
  end if;

  new.record_count := null;
  new.detail := jsonb_build_object(
    'basis', 'PRESENCIA_DECLARADA',
    'role', 'Proveedor',
    'source', 'ChileCompra',
    'semantics', 'Señal binaria de presencia como proveedor del Estado; Atlas no publica aquí el modelo analítico de gasto.'
  );
  return new;
end;
$$;

drop trigger if exists trg_atlas_supplier_signal_only on public.obs_entity_source;
create trigger trg_atlas_supplier_signal_only
before insert or update on public.obs_entity_source
for each row
when (new.source_code = 'MERCADO_PUBLICO')
execute function public.atlas_keep_supplier_signal_only();

-- Alimentación liviana propia de Atlas. No depende del ranking/corte de 3.000
-- actores del antiguo monitor de gasto. Cruza el universo disponible de
-- proveedores ChileCompra contra la identidad canónica sólo por RUT exacto.
create or replace function private.obs_refresh_supplier_presence(p_snapshot_id text)
returns jsonb
language plpgsql
security definer
set search_path = 'public', 'private', 'pg_temp'
as $$
declare
  v_matched integer := 0;
  v_last timestamptz;
begin
  delete from public.obs_entity_source
   where source_code = 'MERCADO_PUBLICO';

  insert into public.obs_entity_source (
    entity_id, source_code, status, record_count, last_event_at, detail)
  with suppliers as (
    select
      regexp_replace(upper(coalesce(supplier_rut, '')), '[^0-9K]', '', 'g') as rut_search,
      max(last_order_date) as last_order_date
    from public.aml_v_mp_supplier_2023_2026
    where supplier_rut is not null
    group by 1
  )
  select
    e.entity_id,
    'MERCADO_PUBLICO',
    'PRESENT',
    1,
    max(s.last_order_date)::timestamptz,
    jsonb_build_object(
      'basis', 'PRESENCIA_DECLARADA',
      'role', 'Proveedor',
      'roles', jsonb_build_array('Proveedor'),
      'match_method', 'RUT_EXACTO',
      'signal', 'PROVEEDOR_DEL_ESTADO',
      'source', 'ChileCompra'
    )
  from suppliers s
  join public.obs_entity e
    on e.rut_search = s.rut_search
  where s.rut_search <> ''
  group by e.entity_id;

  get diagnostics v_matched = row_count;

  select max(last_event_at)
    into v_last
    from public.obs_entity_source
   where source_code = 'MERCADO_PUBLICO';

  update public.obs_source_health
     set software_status = 'healthy',
         data_status = case when v_matched > 0 then 'fresh' else 'silent' end,
         records_24h = v_matched,
         last_source_record_at = v_last,
         scope_partial = false,
         notes = 'Señal binaria Proveedor del Estado. Se resuelve por RUT exacto contra el universo completo de proveedores ChileCompra disponible en Atlas; no incorpora montos, compradores, concentraciones ni analítica de gasto público.',
         snapshot_id = p_snapshot_id,
         refreshed_at = now()
   where source_code = 'MERCADO_PUBLICO';

  return jsonb_build_object(
    'matched_entities', v_matched,
    'match_method', 'RUT_EXACTO',
    'coverage', 'ChileCompra 2023-2026',
    'signal_only', true
  );
end;
$$;

revoke all on function private.obs_refresh_supplier_presence(text) from public, anon, authenticated;

-- El refresco canónico del Observatorio reconstruye primero el universo y luego
-- repone esta señal independiente antes de publicar el snapshot completo.
create or replace function public.obs_refresh_full(p_snapshot_id text default null::text)
returns public.obs_snapshot
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_row public.obs_snapshot;
  v_territory integer;
  v_sector integer;
  v_candidate integer;
  v_supplier_presence jsonb;
begin
  v_row := public.obs_refresh_all(p_snapshot_id);
  v_supplier_presence := private.obs_refresh_supplier_presence(v_row.snapshot_id);
  v_territory := public.obs_refresh_territory(v_row.snapshot_id);
  v_sector := public.obs_refresh_sector(v_row.snapshot_id);
  v_candidate := public.obs_refresh_territory_igr_candidate();

  update public.obs_snapshot
     set row_counts = row_counts || jsonb_build_object(
       'obs_territory', case when v_territory >= 0 then v_territory else (select count(*) from public.obs_territory) end,
       'obs_sector', v_sector,
       'obs_territory_igr_candidate', case when v_candidate >= 0 then v_candidate else (select count(*) from public.obs_territory_igr_candidate) end,
       'territorio_actualizado', v_territory >= 0,
       'igr_candidate_actualizado', v_candidate >= 0,
       'mercado_publico_entities', coalesce((v_supplier_presence->>'matched_entities')::integer, 0),
       'mercado_publico_signal_only', true,
       'mercado_publico_match_method', 'RUT_EXACTO'
     )
   where snapshot_id = v_row.snapshot_id
   returning * into v_row;

  return v_row;
end;
$$;
