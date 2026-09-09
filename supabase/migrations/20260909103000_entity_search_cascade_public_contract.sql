create or replace function public.atlas_v2_entity_search_cascade(p_request jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = 'pg_catalog', 'public', 'atlas_v2_private', 'extensions'
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

  return atlas_v2_private.entity_search_cascade_core(coalesce(p_request, '{}'::jsonb));
end;
$$;

revoke all on function public.atlas_v2_entity_search_cascade(jsonb) from public;
revoke all on function public.atlas_v2_entity_search_cascade(jsonb) from anon;
grant execute on function public.atlas_v2_entity_search_cascade(jsonb) to authenticated;
grant execute on function public.atlas_v2_entity_search_cascade(jsonb) to service_role;

comment on function public.atlas_v2_entity_search_cascade(jsonb) is
'ATLAS v2 entity search cascade: UAF -> SII -> RES -> canonical -> OSFL -> sanctions -> public spend -> fintech -> press context; international screening remains on demand. Match percentage is query similarity, not probability of identity.';
