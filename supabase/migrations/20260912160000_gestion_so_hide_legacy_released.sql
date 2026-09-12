-- Los casos DEVUELTO pertenecen al flujo anterior. Se conservan físicamente
-- para no perder historial, pero dejan de presentarse como gestión activa.
-- Si vuelven a tomarse desde su cola original, aml_uaf_case_patch los reasigna.
create or replace function public.obs_uaf_case_management()
returns table (
  case_id uuid, case_kind text, rut text, rut_key text, entity_id text, entity_name text,
  sector text, region text, commune text, motive text, state text, priority text, note text,
  contact jsonb, assigned_to uuid, assigned_email text, assigned_name text, assigned_at timestamptz,
  updated_by uuid, updated_email text, contacted_at timestamptz, updated_at timestamptz, is_mine boolean
)
language plpgsql stable security definer
set search_path = public, auth, extensions, pg_temp
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.aml_allowed_users u
    where u.user_id = auth.uid() and u.enabled = true
  ) then return; end if;

  return query
  select c.case_id,c.case_kind,c.rut,c.rut_key,c.entity_id,c.entity_name,c.sector,c.region,c.commune,c.motive,
         c.state,c.priority,c.note,c.contact,c.assigned_to,c.assigned_email,c.assigned_name,c.assigned_at,
         c.updated_by,c.updated_email,c.contacted_at,c.updated_at,(c.assigned_to=auth.uid())
  from public.aml_uaf_case_management c
  where c.state <> 'DEVUELTO'
  order by c.updated_at desc;
end $$;

revoke all on function public.obs_uaf_case_management() from public,anon;
grant execute on function public.obs_uaf_case_management() to authenticated,service_role;
