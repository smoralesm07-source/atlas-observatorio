-- Mesa de casos v2: cierre exitoso y devolución trazable al universo.
-- FINALIZADO sólo se admite después de CONTACTADO. DEVUELTO saca el caso de
-- gestión activa sin borrar identidad, contacto, notas, responsable ni eventos.

alter table public.aml_uaf_case_management
  drop constraint if exists aml_uaf_case_management_state_check;

alter table public.aml_uaf_case_management
  add constraint aml_uaf_case_management_state_check
  check (state in ('EN_UBICACION','CONTACTO_OBTENIDO','CONTACTADO','FINALIZADO','DEVUELTO','SIN_UBICAR','DESCARTADO'));

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
set search_path to 'public', 'auth', 'extensions', 'pg_temp'
as $function$
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
  if p_state is not null and p_state not in ('EN_UBICACION','CONTACTO_OBTENIDO','CONTACTADO','FINALIZADO','DEVUELTO','SIN_UBICAR','DESCARTADO') then
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

  select * into v_case
  from public.aml_uaf_case_management c
  where c.case_kind = p_kind and c.rut_key = v_key
  for update;

  if not found then
    -- Estados terminales requieren un caso previamente gestionado.
    if p_state in ('FINALIZADO','DEVUELTO') then
      raise exception 'El caso debe ser tomado y gestionado antes de cerrarlo o devolverlo';
    end if;
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

  -- Un caso devuelto puede ser retomado por cualquier usuario habilitado. La
  -- asignación anterior queda preservada en eventos y es reemplazada sólo al retomar.
  if v_case.state = 'DEVUELTO' and p_claim then
    v_old_state := v_case.state;
    v_new_state := coalesce(p_state, 'EN_UBICACION');
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
           assigned_to = v_uid,
           assigned_email = v_email,
           assigned_name = v_name,
           assigned_at = now(),
           updated_by = v_uid,
           updated_email = v_email,
           updated_at = now()
     where c.case_id = v_case.case_id
     returning * into v_case;

    insert into public.aml_uaf_case_management_event (
      case_id, case_kind, rut_key, event_type, previous_state, new_state,
      actor_id, actor_email, actor_name, detail
    ) values (
      v_case.case_id, p_kind, v_key, 'RECLAIM', v_old_state, v_new_state,
      v_uid, v_email, v_name, 'Caso retomado desde el universo sin gestión activa'
    );
    return v_case.case_id;
  end if;

  if v_case.assigned_to <> v_uid and coalesce(v_role,'viewer') <> 'admin' then
    raise exception 'Este caso ya está siendo atendido por %', coalesce(v_case.assigned_name, v_case.assigned_email);
  end if;

  if v_case.state = 'FINALIZADO' and p_state is distinct from 'FINALIZADO' then
    raise exception 'El caso ya está finalizado';
  end if;
  if p_state = 'FINALIZADO' and v_case.state <> 'CONTACTADO' then
    raise exception 'Para finalizar, primero registra que se logró contacto';
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
      v_case.case_id, p_kind, v_key,
      case when v_new_state = 'DEVUELTO' then 'RELEASE'
           when v_new_state = 'FINALIZADO' then 'FINALIZE'
           else 'STATE' end,
      v_old_state, v_new_state,
      v_uid, v_email, v_name,
      case when v_new_state = 'DEVUELTO' then 'Caso devuelto al universo sin gestión activa; se conserva la traza'
           when v_new_state = 'FINALIZADO' then 'Gestión finalizada exitosamente después de contacto'
           else 'Estado de gestión actualizado' end
    );
  end if;

  return v_case.case_id;
end;
$function$;

comment on function public.aml_uaf_case_patch(text,text,jsonb,text,text,text,jsonb,boolean) is
  'Gestiona casos compartidos. FINALIZADO exige contacto previo. DEVUELTO libera el caso hacia el universo manteniendo historial y permite retoma trazable.';
