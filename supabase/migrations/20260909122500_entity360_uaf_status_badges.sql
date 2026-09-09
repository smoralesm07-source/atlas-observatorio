-- Entidad 360 · estado UAF compacto para cabecera
--
-- Publica tres lecturas excluyentes/compatibles para una entidad:
--   * SO inscrito: RUT exacto observado en padrón UAF materializado.
--   * No inscrito: RUT no observado en el padrón UAF materializado.
--   * Potencial SO: sólo si no está inscrito y pertenece al universo vigente
--     de screening de potenciales sujetos obligados.
--
-- Potencial SO es una señal de screening; no constituye conclusión jurídica
-- sobre la obligación de inscripción ni sobre incumplimiento.

create or replace function public.obs_entity_uaf_status(p_entity_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, extensions
as $function$
declare
  v_result jsonb;
  v_rut_key text;
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

  v_rut_key := regexp_replace(
    upper(
      case
        when upper(coalesce(p_entity_id,'')) like 'ENT-RUT-%'
          then regexp_replace(p_entity_id, '^ENT-RUT-', '', 'i')
        else coalesce(p_entity_id,'')
      end
    ),
    '[^0-9K]','','g'
  );

  select jsonb_strip_nulls(jsonb_build_object(
      'entity_id', s.entity_id,
      'rut', s.rut,
      'universe_status', s.universe_status,
      'is_uaf_registered', s.is_uaf_registered,
      'is_potential_screening', s.is_potential_screening,
      'management_bucket', s.management_bucket,
      'uaf_sector', s.uaf_sector,
      'status_basis', s.status_basis,
      'refreshed_at', s.refreshed_at
    ))
    into v_result
  from public.aml_v_entity_uaf_status_current_v0812 s
  where s.entity_id = p_entity_id
     or (v_rut_key <> '' and s.rut_key = v_rut_key)
  order by s.is_uaf_registered desc, s.refreshed_at desc nulls last
  limit 1;

  return coalesce(v_result, jsonb_build_object(
    'entity_id', p_entity_id,
    'universe_status', 'NO_INSCRITO_SIN_SCREENING',
    'is_uaf_registered', false,
    'is_potential_screening', false,
    'status_basis', 'RUT no observado en el padrón UAF materializado y sin pertenencia al universo vigente de screening de potenciales sujetos obligados.'
  ));
end;
$function$;

revoke all on function public.obs_entity_uaf_status(text) from public, anon;
grant execute on function public.obs_entity_uaf_status(text) to authenticated, service_role;

comment on function public.obs_entity_uaf_status(text) is
  'Estado compacto para Entidad 360: inscrito UAF, no inscrito y pertenencia al universo de screening de potenciales SO. Potencial SO es una señal de screening y no una conclusión jurídica.';
