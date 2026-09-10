-- Universo SO · hardening de la mesa compartida de gestión
-- Mantiene las tablas cerradas por RLS y ejecuta los RPC con los privilegios
-- del usuario autenticado. Sólo usuarios habilitados pueden leer; sólo el
-- responsable del caso (o un admin) puede modificarlo.

drop policy if exists aml_uaf_case_management_read on public.aml_uaf_case_management;
drop policy if exists aml_uaf_case_management_insert on public.aml_uaf_case_management;
drop policy if exists aml_uaf_case_management_update on public.aml_uaf_case_management;
drop policy if exists aml_uaf_case_management_event_read on public.aml_uaf_case_management_event;
drop policy if exists aml_uaf_case_management_event_insert on public.aml_uaf_case_management_event;

create policy aml_uaf_case_management_read
on public.aml_uaf_case_management for select to authenticated
using (
  exists (
    select 1 from public.aml_allowed_users u
    where u.user_id = (select auth.uid()) and u.enabled = true
  )
);

create policy aml_uaf_case_management_insert
on public.aml_uaf_case_management for insert to authenticated
with check (
  assigned_to = (select auth.uid())
  and updated_by = (select auth.uid())
  and exists (
    select 1 from public.aml_allowed_users u
    where u.user_id = (select auth.uid()) and u.enabled = true
  )
);

create policy aml_uaf_case_management_update
on public.aml_uaf_case_management for update to authenticated
using (
  assigned_to = (select auth.uid())
  or exists (
    select 1 from public.aml_allowed_users u
    where u.user_id = (select auth.uid()) and u.enabled = true and u.role = 'admin'
  )
)
with check (
  updated_by = (select auth.uid())
  and (
    assigned_to = (select auth.uid())
    or exists (
      select 1 from public.aml_allowed_users u
      where u.user_id = (select auth.uid()) and u.enabled = true and u.role = 'admin'
    )
  )
);

create policy aml_uaf_case_management_event_read
on public.aml_uaf_case_management_event for select to authenticated
using (
  exists (
    select 1 from public.aml_allowed_users u
    where u.user_id = (select auth.uid()) and u.enabled = true
  )
);

create policy aml_uaf_case_management_event_insert
on public.aml_uaf_case_management_event for insert to authenticated
with check (
  actor_id = (select auth.uid())
  and exists (
    select 1 from public.aml_allowed_users u
    where u.user_id = (select auth.uid()) and u.enabled = true
  )
);

grant select, insert, update on public.aml_uaf_case_management to authenticated;
grant select, insert on public.aml_uaf_case_management_event to authenticated;
grant usage, select on sequence public.aml_uaf_case_management_event_event_id_seq to authenticated;

create or replace function public.obs_uaf_case_management()
returns table (
  case_id uuid,
  case_kind text,
  rut text,
  rut_key text,
  entity_id text,
  entity_name text,
  sector text,
  region text,
  commune text,
  motive text,
  state text,
  priority text,
  note text,
  contact jsonb,
  assigned_to uuid,
  assigned_email text,
  assigned_name text,
  assigned_at timestamptz,
  updated_by uuid,
  updated_email text,
  contacted_at timestamptz,
  updated_at timestamptz,
  is_mine boolean
)
language sql
stable
security invoker
set search_path = public, extensions, pg_temp
as $$
  select
    c.case_id, c.case_kind, c.rut, c.rut_key, c.entity_id, c.entity_name,
    c.sector, c.region, c.commune, c.motive, c.state, c.priority, c.note,
    c.contact, c.assigned_to, c.assigned_email, c.assigned_name, c.assigned_at,
    c.updated_by, c.updated_email, c.contacted_at, c.updated_at,
    (c.assigned_to = auth.uid()) as is_mine
  from public.aml_uaf_case_management c
  order by c.updated_at desc;
$$;

create or replace function public.obs_uaf_case_management_events(p_case_id uuid)
returns table (
  event_id bigint,
  event_type text,
  previous_state text,
  new_state text,
  actor_email text,
  actor_name text,
  detail text,
  created_at timestamptz
)
language sql
stable
security invoker
set search_path = public, extensions, pg_temp
as $$
  select e.event_id, e.event_type, e.previous_state, e.new_state,
         e.actor_email, e.actor_name, e.detail, e.created_at
  from public.aml_uaf_case_management_event e
  where e.case_id = p_case_id
  order by e.created_at desc
  limit 30;
$$;

create or replace function public.aml_uaf_case_patch(
  p_kind text,
  p_rut text,
  p_subject jsonb default '{}'::jsonb,
  p_state text default null,
  p_priority text default null,
  p_note text default null,
  p_contact jsonb default null,
  p_claim boolean default false
)
returns uuid
language plpgsql
security invoker
set search_path = public, auth, extensions, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_email text;
  v_name text;
  v_key text := regexp_replace(upper(coalesce(p_rut, '')), '[^0-9K]', '', 'g');
  v_case public.aml_uaf_case_management%rowtype;
  v_old_state text;
  v_new_state text;
  v_meta jsonb := coalesce(auth.jwt()->'user_metadata', '{}'::jsonb);
begin
  if v_uid is null then raise exception 'Sesión requerida'; end if;
  if p_kind not in ('POTENCIAL','TERMINO') then raise exception 'Tipo de caso no permitido'; end if;
  if nullif(v_key,'') is null then raise exception 'RUT requerido'; end if;
  if p_state is not null and p_state not in ('EN_UBICACION','CONTACTO_OBTENIDO','CONTACTADO','SIN_UBICAR','DESCARTADO') then
    raise exception 'Estado de gestión no permitido';
  end if;
  if p_priority is not null and p_priority not in ('ALTA','MEDIA','BAJA') then
    raise exception 'Prioridad no permitida';
  end if;

  select u.role, coalesce(nullif(u.email,''), auth.jwt()->>'email', 'usuario')
    into v_role, v_email
  from public.aml_allowed_users u
  where u.user_id = v_uid and u.enabled = true;
  if v_role is null then raise exception 'Cuenta no habilitada'; end if;

  v_name := coalesce(
    nullif(v_meta->>'full_name',''),
    nullif(v_meta->>'name',''),
    split_part(v_email,'@',1)
  );

  -- La combinación kind + RUT es única. Si el caso ya existe, se bloquea esa
  -- fila antes de actualizar para mantener consistente responsable/estado.
  select * into v_case
  from public.aml_uaf_case_management c
  where c.case_kind = p_kind and c.rut_key = v_key
  for update;

  if not found then
    if not p_claim then raise exception 'El caso aún no fue tomado por un fiscalizador'; end if;
    insert into public.aml_uaf_case_management (
      case_kind, rut, rut_key, entity_id, entity_name, sector, region, commune, motive,
      state, priority, note, contact, assigned_to, assigned_email, assigned_name,
      assigned_at, updated_by, updated_email, contacted_at, updated_at
    ) values (
      p_kind, p_rut, v_key,
      nullif(p_subject->>'entityId',''), nullif(p_subject->>'name',''), nullif(p_subject->>'sector',''),
      nullif(p_subject->>'region',''), nullif(p_subject->>'commune',''), nullif(p_subject->>'motive',''),
      coalesce(p_state,'EN_UBICACION'), coalesce(p_priority,'MEDIA'), coalesce(p_note,''), coalesce(p_contact,'{}'::jsonb),
      v_uid, v_email, v_name, now(), v_uid, v_email,
      case when coalesce(p_state,'EN_UBICACION') = 'CONTACTADO' then now() else null end,
      now()
    ) returning * into v_case;

    insert into public.aml_uaf_case_management_event (
      case_id, case_kind, rut_key, event_type, previous_state, new_state,
      actor_id, actor_email, actor_name, detail
    ) values (
      v_case.case_id, p_kind, v_key, 'CLAIM', null, v_case.state,
      v_uid, v_email, v_name, 'Caso tomado para gestión'
    );
    return v_case.case_id;
  end if;

  if v_case.assigned_to <> v_uid and coalesce(v_role,'viewer') <> 'admin' then
    raise exception 'Este caso ya está siendo atendido por %', coalesce(v_case.assigned_name, v_case.assigned_email);
  end if;

  v_old_state := v_case.state;
  v_new_state := coalesce(p_state, v_case.state);

  update public.aml_uaf_case_management c
     set entity_id = coalesce(nullif(p_subject->>'entityId',''), c.entity_id),
         entity_name = coalesce(nullif(p_subject->>'name',''), c.entity_name),
         sector = coalesce(nullif(p_subject->>'sector',''), c.sector),
         region = coalesce(nullif(p_subject->>'region',''), c.region),
         commune = coalesce(nullif(p_subject->>'commune',''), c.commune),
         motive = coalesce(nullif(p_subject->>'motive',''), c.motive),
         state = v_new_state,
         priority = coalesce(p_priority, c.priority),
         note = case when p_note is null then c.note else left(p_note, 1200) end,
         contact = case when p_contact is null then c.contact else c.contact || p_contact end,
         contacted_at = case when v_new_state = 'CONTACTADO' and c.contacted_at is null then now() else c.contacted_at end,
         updated_by = v_uid,
         updated_email = v_email,
         updated_at = now()
   where c.case_id = v_case.case_id
   returning * into v_case;

  if v_old_state is distinct from v_new_state then
    insert into public.aml_uaf_case_management_event (
      case_id, case_kind, rut_key, event_type, previous_state, new_state,
      actor_id, actor_email, actor_name, detail
    ) values (
      v_case.case_id, p_kind, v_key, 'STATE', v_old_state, v_new_state,
      v_uid, v_email, v_name, 'Estado de gestión actualizado'
    );
  end if;

  return v_case.case_id;
end;
$$;

revoke all on function public.obs_uaf_case_management() from public, anon;
revoke all on function public.obs_uaf_case_management_events(uuid) from public, anon;
revoke all on function public.aml_uaf_case_patch(text,text,jsonb,text,text,text,jsonb,boolean) from public, anon;
grant execute on function public.obs_uaf_case_management() to authenticated, service_role;
grant execute on function public.obs_uaf_case_management_events(uuid) to authenticated, service_role;
grant execute on function public.aml_uaf_case_patch(text,text,jsonb,text,text,text,jsonb,boolean) to authenticated, service_role;
