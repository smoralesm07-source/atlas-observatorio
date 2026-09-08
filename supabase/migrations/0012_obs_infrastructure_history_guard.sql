-- Explicit browser-deny policies keep the infrastructure history table private
-- even if grants are changed later. The service role bypasses RLS and is the
-- only application principal granted SELECT/INSERT by migration 0011.

create policy "obs_infra_history_no_direct_select"
on public.obs_infra_snapshot_history
for select
to authenticated
using (false);

create policy "obs_infra_history_no_direct_insert"
on public.obs_infra_snapshot_history
for insert
to authenticated
with check (false);
