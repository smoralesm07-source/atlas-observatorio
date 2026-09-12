-- Gestión SO v3: dos flujos explícitos para Término de giro y Potencial SO.
-- Despliegue compatible con la versión anterior: durante la transición se
-- aceptan estados legacy y nuevos. La interfaz v3 normaliza los legacy al leer.
-- No se reescribe ni elimina historial existente.

alter table public.aml_uaf_case_management
  drop constraint if exists aml_uaf_case_management_state_check;

alter table public.aml_uaf_case_management
  add constraint aml_uaf_case_management_state_check
  check (state in (
    'EN_UBICACION','CONTACTO_OBTENIDO','CONTACTADO','FINALIZADO','DEVUELTO','SIN_UBICAR',
    'GESTIONANDO','PENDIENTE_GESTION','DAR_DE_BAJA','CANDIDATO','DESCARTADO'
  ));

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
security definer
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
  v_contact jsonb;
  v_result text;
  v_meta jsonb := coalesce(auth.jwt()->'user_metadata', '{}'::jsonb);
begin
  if v_uid is null then raise exception 'Sesión requerida'; end if;
  if p_kind not in ('POTENCIAL','TERMINO') then raise exception 'Tipo de caso no permitido'; end if;
  if nullif(v_key,'') is null then raise exception 'RUT requerido'; end if;
  if p_state is not null and p_state not in (
    'EN_UBICACION','CONTACTO_OBTENIDO','CONTACTADO','FINALIZADO','DEVUELTO','SIN_UBICAR',
    'GESTIONANDO','PENDIENTE_GESTION','DAR_DE_BAJA','CANDIDATO','DESCARTADO'
  ) then
    raise exception 'Estado de gestión no permitido';
  end if;
  if p_priority is not null and p_priority not in ('ALTA','MEDIA','BAJA') then
    raise exception 'Prioridad no permitida';
  end if;
  if p_kind = 'TERMINO' and p_state in ('CANDIDATO','DESCARTADO') then
    raise exception 'Ese cierre no corresponde al flujo de término de giro';
  end if;
  if p_kind = 'POTENCIAL' and p_state = 'DAR_DE_BAJA' then
    raise exception 'Ese cierre no corresponde al flujo de potencial SO';
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
    if not p_claim then raise exception 'El caso aún no fue tomado por un analista'; end if;
    if p_state in ('FINALIZADO','DAR_DE_BAJA','CANDIDATO','DESCARTADO') then
      raise exception 'Primero toma y gestiona el caso antes de cerrarlo';
    end if;

    v_new_state := coalesce(p_state,'GESTIONANDO');
    v_contact := coalesce(p_contact,'{}'::jsonb);
    if v_new_state in ('GESTIONANDO','PENDIENTE_GESTION') then
      v_contact := v_contact || jsonb_build_object(
        '_workflow_step', coalesce(nullif(v_contact->>'_workflow_step','')::int, 1),
        '_no_contact', coalesce(nullif(v_contact->>'_no_contact','')::boolean, false)
      );
    end if;

    insert into public.aml_uaf_case_management (
      case_kind, rut, rut_key, entity_id, entity_name, sector, region, commune, motive,
      state, priority, note, contact, assigned_to, assigned_email, assigned_name,
      assigned_at, updated_by, updated_email, contacted_at, updated_at
    ) values (
      p_kind, p_rut, v_key,
      nullif(p_subject->>'entityId',''), nullif(p_subject->>'name',''), nullif(p_subject->>'sector',''),
      nullif(p_subject->>'region',''), nullif(p_subject->>'commune',''), nullif(p_subject->>'motive',''),
      v_new_state, coalesce(p_priority,'MEDIA'), coalesce(p_note,''), v_contact,
      v_uid, v_email, v_name, now(), v_uid, v_email,
      case when v_new_state = 'CONTACTADO' then now() else null end,
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

  -- Los DEVUELTO de la versión anterior permanecen como historial disponible.
  -- Si alguien los retoma, se reasignan de forma trazable sin perder lo previo.
  if v_case.state = 'DEVUELTO' and p_claim then
    v_old_state := v_case.state;
    v_new_state := coalesce(p_state, 'GESTIONANDO');
    v_contact := case when p_contact is null then v_case.contact else v_case.contact || p_contact end;

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
           contact = v_contact,
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
      v_uid, v_email, v_name, 'Caso retomado desde historial de la versión anterior'
    );
    return v_case.case_id;
  end if;

  if v_case.assigned_to <> v_uid and coalesce(v_role,'viewer') <> 'admin' then
    raise exception 'Este caso ya está siendo atendido por %', coalesce(v_case.assigned_name, v_case.assigned_email);
  end if;

  -- Compatibilidad con el cierre de la interfaz anterior mientras termina el
  -- despliegue. En v3 los cierres son DAR_DE_BAJA y CANDIDATO.
  if p_state = 'FINALIZADO' and v_case.state <> 'CONTACTADO' then
    raise exception 'Para finalizar, primero registra que se logró contacto';
  end if;

  v_old_state := v_case.state;
  v_new_state := coalesce(p_state, v_case.state);
  v_contact := case when p_contact is null then v_case.contact else v_case.contact || p_contact end;
  v_result := nullif(v_contact->>'_management_result','');

  if p_kind = 'TERMINO' and v_new_state = 'DAR_DE_BAJA'
     and v_result not in ('UBICABLE','NO_UBICABLE','BAJA_OFICIO') then
    raise exception 'Selecciona el resultado de ubicación antes de finalizar';
  end if;
  if p_kind = 'POTENCIAL' and v_new_state = 'CANDIDATO'
     and v_result not in ('UBICABLE','NO_UBICABLE') then
    raise exception 'Selecciona Ubicable o No ubicable antes de marcar candidato';
  end if;

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
         contact = v_contact,
         contacted_at = case
           when (v_new_state = 'CONTACTADO' or v_result = 'UBICABLE') and c.contacted_at is null then now()
           else c.contacted_at
         end,
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
      case
        when v_new_state = 'DAR_DE_BAJA' then 'READY_FOR_DEREGISTRATION'
        when v_new_state = 'CANDIDATO' then 'CANDIDATE'
        when v_new_state = 'DESCARTADO' then 'DISCARD'
        when v_new_state = 'PENDIENTE_GESTION' then 'PAUSE'
        when v_new_state = 'DEVUELTO' then 'RELEASE'
        when v_new_state = 'FINALIZADO' then 'FINALIZE'
        else 'STATE'
      end,
      v_old_state, v_new_state,
      v_uid, v_email, v_name,
      case
        when v_new_state = 'DAR_DE_BAJA' then 'Gestión analítica finalizada; queda para regularización de baja por Fiscalización'
        when v_new_state = 'CANDIDATO' then 'Gestión analítica finalizada; queda como candidato para tramitación por Fiscalización'
        when v_new_state = 'DESCARTADO' then 'Potencial SO descartado en revisión'
        when v_new_state = 'PENDIENTE_GESTION' then 'Gestión pausada para continuar posteriormente'
        when v_new_state = 'DEVUELTO' then 'Caso devuelto al universo por la interfaz anterior'
        when v_new_state = 'FINALIZADO' then 'Gestión finalizada por la interfaz anterior'
        else 'Gestión reanudada o actualizada'
      end
    );
  end if;

  return v_case.case_id;
end;
$function$;

create or replace function public.aml_uaf_case_cancel(
  p_kind text,
  p_rut text
)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'auth', 'extensions', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_key text := regexp_replace(upper(coalesce(p_rut, '')), '[^0-9K]', '', 'g');
  v_case public.aml_uaf_case_management%rowtype;
begin
  if v_uid is null then raise exception 'Sesión requerida'; end if;
  if p_kind not in ('POTENCIAL','TERMINO') then raise exception 'Tipo de caso no permitido'; end if;

  select u.role into v_role
  from public.aml_allowed_users u
  where u.user_id = v_uid and u.enabled = true;
  if v_role is null then raise exception 'Cuenta no habilitada'; end if;

  select * into v_case
  from public.aml_uaf_case_management c
  where c.case_kind = p_kind and c.rut_key = v_key
  for update;
  if not found then return true; end if;

  if v_case.assigned_to <> v_uid and coalesce(v_role,'viewer') <> 'admin' then
    raise exception 'Sólo el responsable o un administrador puede anular esta gestión';
  end if;

  delete from public.aml_uaf_case_management where case_id = v_case.case_id;
  return true;
end;
$function$;

revoke all on function public.aml_uaf_case_cancel(text,text) from public,anon;
grant execute on function public.aml_uaf_case_cancel(text,text) to authenticated,service_role;

comment on function public.aml_uaf_case_patch(text,text,jsonb,text,text,text,jsonb,boolean) is
  'Gestión SO v3 en dos pasos. Compatible transitoriamente con los estados de la interfaz anterior.';
comment on function public.aml_uaf_case_cancel(text,text) is
  'Anula completamente una gestión y devuelve la entidad a su universo original eliminando el caso y sus eventos asociados.';
