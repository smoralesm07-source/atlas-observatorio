-- Corrige el gate introducido en 20260916180000.
--
-- La primera versión decidía con `current_user`. Eso no funciona: dentro de una
-- función SECURITY DEFINER el usuario efectivo pasa a ser el dueño (postgres)
-- para toda la pila de llamada, de modo que la rama de "roles internos" dejaba
-- pasar a cualquiera. Lo mismo invalida apoyarse en RLS desde dentro del RPC.
--
-- Los claims del JWT sí son confiables: son de alcance de request y SECURITY
-- DEFINER no los altera.
--
-- Verificado contra la base con seis casos: usuario habilitado (pasa),
-- autenticado no habilitado (42501), anon (42501), service_role (pasa),
-- conexión directa sin claims (pasa), claims corruptos (42501).

create or replace function public.atlas_require_allowed_user()
returns boolean
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_claims text := nullif(current_setting('request.jwt.claims', true), '');
  v_role   text := nullif(current_setting('request.jwt.claim.role', true), '');
  v_uid    uuid;
begin
  -- Sin contexto de request no hay API de por medio: conexión directa a la base
  -- (migraciones, mantenimiento, tareas internas). Ahí la frontera la impone el
  -- GRANT, no este gate.
  if v_claims is null and v_role is null then
    return true;
  end if;

  if v_role is null and v_claims is not null then
    begin
      v_role := v_claims::jsonb ->> 'role';
    exception when others then
      v_role := null;
    end;
  end if;

  if v_role = 'service_role' then
    return true;
  end if;

  begin
    v_uid := auth.uid();
  exception when others then
    v_uid := null;
  end;

  if v_uid is null
     or not exists (
       select 1 from public.aml_allowed_users au
       where au.user_id = v_uid and au.enabled
     ) then
    raise exception 'atlas_forbidden'
      using errcode = '42501',
            detail  = 'La cuenta no está habilitada en Atlas Observatorio.',
            hint    = 'Solicite acceso al administrador del observatorio.';
  end if;

  return true;
end
$fn$;

comment on function public.atlas_require_allowed_user() is
  'Gate de membresía para RPC SECURITY DEFINER. Decide por claims del JWT (no por current_user, que SECURITY DEFINER sobrescribe). Aborta con 42501 si el request autenticado no está habilitado en aml_allowed_users.';

revoke all on function public.atlas_require_allowed_user() from public, anon;
grant execute on function public.atlas_require_allowed_user() to authenticated, service_role;
