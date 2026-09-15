drop policy if exists atlas_presence_select_own on public.atlas_user_presence;
create policy atlas_presence_select_own
  on public.atlas_user_presence
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists atlas_presence_insert_own on public.atlas_user_presence;
create policy atlas_presence_insert_own
  on public.atlas_user_presence
  for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1
      from public.aml_allowed_users a
      where a.user_id = (select auth.uid())
        and a.enabled = true
    )
  );

drop policy if exists atlas_presence_update_own on public.atlas_user_presence;
create policy atlas_presence_update_own
  on public.atlas_user_presence
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1
      from public.aml_allowed_users a
      where a.user_id = (select auth.uid())
        and a.enabled = true
    )
  );

drop policy if exists atlas_activity_insert_own on public.atlas_user_activity;
create policy atlas_activity_insert_own
  on public.atlas_user_activity
  for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1
      from public.aml_allowed_users a
      where a.user_id = (select auth.uid())
        and a.enabled = true
    )
    and char_length(route) between 1 and 80
    and char_length(section) between 1 and 120
    and jsonb_typeof(metadata) = 'object'
  );
