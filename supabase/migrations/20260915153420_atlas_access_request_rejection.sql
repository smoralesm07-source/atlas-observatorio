alter table public.atlas_access_requests
  drop constraint if exists atlas_access_requests_status_check;

alter table public.atlas_access_requests
  add constraint atlas_access_requests_status_check
  check (status in ('pending','approved','rejected'));

alter table public.atlas_user_access_audit
  drop constraint if exists atlas_user_access_audit_action_check;

alter table public.atlas_user_access_audit
  add constraint atlas_user_access_audit_action_check
  check (action in ('grant','role_change','enable','disable','reject','reopen'));

create or replace function public.atlas_admin_set_request_status(
  p_actor_user_id uuid,
  p_actor_email text,
  p_target_user_id uuid,
  p_target_email text,
  p_status text
)
returns table(user_id uuid, status text, resolved_at timestamptz)
language plpgsql
set search_path = ''
as $function$
declare
  v_old_status text;
begin
  if p_status not in ('pending','rejected') then
    raise exception using errcode = '22023', message = 'ATLAS_INVALID_REQUEST_STATUS';
  end if;
  if p_target_email is null or btrim(p_target_email) = '' then
    raise exception using errcode = '22023', message = 'ATLAS_TARGET_EMAIL_REQUIRED';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(194913822);

  select r.status
    into v_old_status
  from public.atlas_access_requests as r
  where r.user_id = p_target_user_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'ATLAS_ACCESS_REQUEST_NOT_FOUND';
  end if;

  if v_old_status = p_status then
    return query
    select r.user_id, r.status, r.resolved_at
    from public.atlas_access_requests as r
    where r.user_id = p_target_user_id;
    return;
  end if;

  if p_status = 'rejected' then
    update public.atlas_access_requests as r
       set status = 'rejected',
           resolved_at = now(),
           resolved_by = p_actor_user_id,
           resolved_by_email = lower(nullif(btrim(p_actor_email), '')),
           last_seen_at = now()
     where r.user_id = p_target_user_id;
  else
    update public.atlas_access_requests as r
       set status = 'pending',
           resolved_at = null,
           resolved_by = null,
           resolved_by_email = null,
           last_seen_at = now()
     where r.user_id = p_target_user_id;
  end if;

  insert into public.atlas_user_access_audit (
    actor_user_id, actor_email, target_user_id, target_email,
    action, old_role, new_role, old_enabled, new_enabled
  ) values (
    p_actor_user_id,
    lower(nullif(btrim(p_actor_email), '')),
    p_target_user_id,
    lower(btrim(p_target_email)),
    case when p_status = 'rejected' then 'reject' else 'reopen' end,
    null,
    'viewer',
    null,
    false
  );

  return query
  select r.user_id, r.status, r.resolved_at
  from public.atlas_access_requests as r
  where r.user_id = p_target_user_id;
end;
$function$;
