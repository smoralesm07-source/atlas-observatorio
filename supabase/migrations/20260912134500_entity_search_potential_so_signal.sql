-- Entidades: enriquece los resultados de búsqueda con el estado UAF/potencial SO
-- usando la misma lectura canónica que alimenta Entidad 360.

create or replace function atlas_v2_private.enrich_entity_search_uaf_status(p_result jsonb)
returns jsonb
language sql
stable
security definer
set search_path to 'pg_catalog', 'public', 'atlas_v2_private'
as $$
  with items as (
    select
      x.item,
      x.ord,
      regexp_replace(upper(coalesce(x.item->>'rut','')), '[^0-9K]', '', 'g') as rut_key
    from jsonb_array_elements(coalesce(p_result->'items', '[]'::jsonb)) with ordinality as x(item, ord)
  ),
  enriched as (
    select
      i.ord,
      i.item || case
        when s.rut_key is null then '{}'::jsonb
        else jsonb_strip_nulls(jsonb_build_object(
          'is_uaf_registered', s.is_uaf_registered,
          'is_potential_screening', s.is_potential_screening,
          'uaf_universe_status', s.universe_status,
          'management_bucket', s.management_bucket,
          'potential_uaf_sector', s.uaf_sector,
          'uaf_status_basis', s.status_basis,
          'uaf_status_refreshed_at', s.refreshed_at
        ))
      end as item
    from items i
    left join lateral (
      select
        s.rut_key,
        s.universe_status,
        s.is_uaf_registered,
        s.is_potential_screening,
        s.management_bucket,
        s.uaf_sector,
        s.status_basis,
        s.refreshed_at
      from public.aml_v_entity_uaf_status_current_v0812 s
      where (
          coalesce(i.item->>'entity_id','') <> ''
          and s.entity_id = i.item->>'entity_id'
        )
        or (
          i.rut_key <> ''
          and s.rut_key = i.rut_key
        )
      order by
        (s.entity_id = i.item->>'entity_id') desc,
        s.is_uaf_registered desc,
        s.is_potential_screening desc,
        s.refreshed_at desc nulls last
      limit 1
    ) s on true
  )
  select jsonb_set(
    coalesce(p_result, '{}'::jsonb),
    '{items}',
    coalesce((select jsonb_agg(e.item order by e.ord) from enriched e), '[]'::jsonb),
    true
  );
$$;

create or replace function public.atlas_v2_entity_search(p_request jsonb)
returns jsonb
language sql
stable
set search_path to 'pg_catalog', 'public', 'atlas_v2_private'
as $$
  select atlas_v2_private.enrich_entity_search_uaf_status(
    atlas_v2_private.entity_search(p_request)
  );
$$;

create or replace function public.atlas_v2_entity_search_cascade(p_request jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public', 'atlas_v2_private', 'extensions'
as $$
begin
  if not (
    auth.role() = 'service_role'
    or (
      auth.uid() is not null
      and exists (
        select 1
        from public.aml_allowed_users u
        where u.user_id = auth.uid()
          and u.enabled
      )
    )
  ) then
    raise exception 'ATLAS_CORE_FORBIDDEN' using errcode='42501';
  end if;

  return atlas_v2_private.enrich_entity_search_uaf_status(
    atlas_v2_private.entity_search_cascade_core(coalesce(p_request, '{}'::jsonb))
  );
end;
$$;
