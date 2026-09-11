-- ATLAS Observatorio · Territorio
-- Corrige el detalle comunal después de desacoplar Gasto Público.
-- La señal "Proveedor del Estado" debe provenir de obs_entity_source
-- (MERCADO_PUBLICO), no del modelo analítico obs_spend_actor cuyo acceso
-- cliente fue revocado deliberadamente para el piloto multiusuario.

do $fix$
declare
  v_detail text;
  v_directory text;
begin
  select pg_get_functiondef('public.obs_territory_detail(text)'::regprocedure)
    into v_detail;

  if position('from public.obs_spend_actor sa' in v_detail) > 0 then
    v_detail := replace(
      v_detail,
      $old$      coalesce(u.is_state_supplier, false)
        or exists (
          select 1
          from public.obs_spend_actor sa
          where sa.entity_id = e.entity_id and sa.actor_role = 'SUPPLIER'
        ) as is_state_supplier,$old$,
      $new$      coalesce(u.is_state_supplier, false)
        or exists (
          select 1
          from public.obs_entity_source es
          where es.entity_id = e.entity_id
            and es.source_code = 'MERCADO_PUBLICO'
            and es.status = 'PRESENT'
        ) as is_state_supplier,$new$
    );

    if position('from public.obs_spend_actor sa' in v_detail) > 0 then
      raise exception 'obs_territory_detail still depends on obs_spend_actor';
    end if;

    execute v_detail;
  end if;

  -- El directorio v2 ya corre como SECURITY DEFINER, por lo que no era la
  -- causa visible del 42501; aun así se elimina la dependencia residual para
  -- mantener Territorio completamente desacoplado del modelo de gasto.
  select pg_get_functiondef(
    'public.obs_territory_entity_directory_v2(text,text,text,text,text,integer,integer)'::regprocedure
  ) into v_directory;

  if position('from public.obs_spend_actor sa' in v_directory) > 0 then
    v_directory := replace(
      v_directory,
      $old$    (coalesce(u.is_state_supplier, false) or exists (
      select 1 from public.obs_spend_actor sa
      where sa.entity_id = e.entity_id and sa.actor_role = 'SUPPLIER'
    )) as is_state_supplier,$old$,
      $new$    (coalesce(u.is_state_supplier, false) or exists (
      select 1 from public.obs_entity_source es
      where es.entity_id = e.entity_id
        and es.source_code = 'MERCADO_PUBLICO'
        and es.status = 'PRESENT'
    )) as is_state_supplier,$new$
    );

    if position('from public.obs_spend_actor sa' in v_directory) > 0 then
      raise exception 'obs_territory_entity_directory_v2 still depends on obs_spend_actor';
    end if;

    execute v_directory;
  end if;
end
$fix$;

revoke all on function public.obs_territory_detail(text) from public, anon;
grant execute on function public.obs_territory_detail(text) to authenticated, service_role;

revoke all on function public.obs_territory_entity_directory_v2(text,text,text,text,text,integer,integer) from public, anon;
grant execute on function public.obs_territory_entity_directory_v2(text,text,text,text,text,integer,integer) to authenticated, service_role;

comment on function public.obs_territory_detail(text) is
  'Detalle comunal Atlas. La señal Proveedor del Estado se lee desde obs_entity_source (MERCADO_PUBLICO) y no depende del modelo desacoplado de gasto público.';
