create table if not exists public.aml_uaf_case_management (
  case_id uuid primary key default gen_random_uuid(),
  case_kind text not null check (case_kind in ('POTENCIAL','TERMINO')),
  rut text not null,
  rut_key text not null,
  entity_id text,
  entity_name text,
  sector text,
  region text,
  commune text,
  motive text,
  state text not null default 'EN_UBICACION' check (state in ('EN_UBICACION','CONTACTO_OBTENIDO','CONTACTADO','SIN_UBICAR','DESCARTADO')),
  priority text not null default 'MEDIA' check (priority in ('ALTA','MEDIA','BAJA')),
  note text not null default '',
  contact jsonb not null default '{}'::jsonb,
  assigned_to uuid not null,
  assigned_email text not null,
  assigned_name text,
  assigned_at timestamptz not null default now(),
  updated_by uuid not null,
  updated_email text not null,
  contacted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint aml_uaf_case_management_kind_rut_key_uk unique(case_kind, rut_key)
);

create index if not exists aml_uaf_case_management_state_idx on public.aml_uaf_case_management(state, updated_at desc);
create index if not exists aml_uaf_case_management_owner_idx on public.aml_uaf_case_management(assigned_to, updated_at desc);

create table if not exists public.aml_uaf_case_management_event (
  event_id bigint generated always as identity primary key,
  case_id uuid not null references public.aml_uaf_case_management(case_id) on delete cascade,
  case_kind text not null,
  rut_key text not null,
  event_type text not null,
  previous_state text,
  new_state text,
  actor_id uuid not null,
  actor_email text not null,
  actor_name text,
  detail text,
  created_at timestamptz not null default now()
);
create index if not exists aml_uaf_case_management_event_case_idx on public.aml_uaf_case_management_event(case_id, created_at desc);

alter table public.aml_uaf_case_management enable row level security;
alter table public.aml_uaf_case_management_event enable row level security;
revoke all on public.aml_uaf_case_management from anon, authenticated;
revoke all on public.aml_uaf_case_management_event from anon, authenticated;

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
  if auth.uid() is null or not exists (select 1 from public.aml_allowed_users u where u.user_id=auth.uid() and u.enabled=true) then return; end if;
  return query
  select c.case_id,c.case_kind,c.rut,c.rut_key,c.entity_id,c.entity_name,c.sector,c.region,c.commune,c.motive,
         c.state,c.priority,c.note,c.contact,c.assigned_to,c.assigned_email,c.assigned_name,c.assigned_at,
         c.updated_by,c.updated_email,c.contacted_at,c.updated_at,(c.assigned_to=auth.uid())
  from public.aml_uaf_case_management c order by c.updated_at desc;
end $$;

create or replace function public.obs_uaf_case_management_events(p_case_id uuid)
returns table (event_id bigint,event_type text,previous_state text,new_state text,actor_email text,actor_name text,detail text,created_at timestamptz)
language plpgsql stable security definer
set search_path = public, auth, extensions, pg_temp
as $$
begin
  if auth.uid() is null or not exists (select 1 from public.aml_allowed_users u where u.user_id=auth.uid() and u.enabled=true) then return; end if;
  return query select e.event_id,e.event_type,e.previous_state,e.new_state,e.actor_email,e.actor_name,e.detail,e.created_at
  from public.aml_uaf_case_management_event e where e.case_id=p_case_id order by e.created_at desc limit 30;
end $$;

create or replace function public.aml_uaf_case_patch(
  p_kind text,p_rut text,p_subject jsonb default '{}'::jsonb,p_state text default null,p_priority text default null,
  p_note text default null,p_contact jsonb default null,p_claim boolean default false
) returns uuid
language plpgsql security definer
set search_path = public, auth, extensions, pg_temp
as $$
declare
  v_uid uuid:=auth.uid(); v_role text; v_email text; v_name text;
  v_key text:=regexp_replace(upper(coalesce(p_rut,'')),'[^0-9K]','','g');
  v_case public.aml_uaf_case_management%rowtype; v_old_state text; v_new_state text;
begin
  if v_uid is null then raise exception 'Sesión requerida'; end if;
  if p_kind not in ('POTENCIAL','TERMINO') then raise exception 'Tipo de caso no permitido'; end if;
  if nullif(v_key,'') is null then raise exception 'RUT requerido'; end if;
  if p_state is not null and p_state not in ('EN_UBICACION','CONTACTO_OBTENIDO','CONTACTADO','SIN_UBICAR','DESCARTADO') then raise exception 'Estado de gestión no permitido'; end if;
  if p_priority is not null and p_priority not in ('ALTA','MEDIA','BAJA') then raise exception 'Prioridad no permitida'; end if;
  select au.role,coalesce(nullif(au.email,''),u.email,'usuario'),
         coalesce(nullif(u.raw_user_meta_data->>'full_name',''),nullif(u.raw_user_meta_data->>'name',''),split_part(coalesce(nullif(au.email,''),u.email,'usuario'),'@',1))
    into v_role,v_email,v_name from public.aml_allowed_users au left join auth.users u on u.id=au.user_id
    where au.user_id=v_uid and au.enabled=true;
  if v_role is null then raise exception 'Cuenta no habilitada'; end if;
  select * into v_case from public.aml_uaf_case_management c where c.case_kind=p_kind and c.rut_key=v_key for update;
  if not found then
    if not p_claim then raise exception 'El caso aún no fue tomado por un fiscalizador'; end if;
    insert into public.aml_uaf_case_management(case_kind,rut,rut_key,entity_id,entity_name,sector,region,commune,motive,state,priority,note,contact,assigned_to,assigned_email,assigned_name,assigned_at,updated_by,updated_email,contacted_at,updated_at)
    values(p_kind,p_rut,v_key,nullif(p_subject->>'entityId',''),nullif(p_subject->>'name',''),nullif(p_subject->>'sector',''),nullif(p_subject->>'region',''),nullif(p_subject->>'commune',''),nullif(p_subject->>'motive',''),coalesce(p_state,'EN_UBICACION'),coalesce(p_priority,'MEDIA'),coalesce(p_note,''),coalesce(p_contact,'{}'::jsonb),v_uid,v_email,v_name,now(),v_uid,v_email,case when coalesce(p_state,'EN_UBICACION')='CONTACTADO' then now() else null end,now()) returning * into v_case;
    insert into public.aml_uaf_case_management_event(case_id,case_kind,rut_key,event_type,previous_state,new_state,actor_id,actor_email,actor_name,detail)
    values(v_case.case_id,p_kind,v_key,'CLAIM',null,v_case.state,v_uid,v_email,v_name,'Caso tomado para gestión');
    return v_case.case_id;
  end if;
  if v_case.assigned_to<>v_uid and coalesce(v_role,'viewer')<>'admin' then raise exception 'Este caso ya está siendo atendido por %',coalesce(v_case.assigned_name,v_case.assigned_email); end if;
  v_old_state:=v_case.state; v_new_state:=coalesce(p_state,v_case.state);
  update public.aml_uaf_case_management c set
    entity_id=coalesce(nullif(p_subject->>'entityId',''),c.entity_id), entity_name=coalesce(nullif(p_subject->>'name',''),c.entity_name),
    sector=coalesce(nullif(p_subject->>'sector',''),c.sector),region=coalesce(nullif(p_subject->>'region',''),c.region),commune=coalesce(nullif(p_subject->>'commune',''),c.commune),motive=coalesce(nullif(p_subject->>'motive',''),c.motive),
    state=v_new_state,priority=coalesce(p_priority,c.priority),note=case when p_note is null then c.note else left(p_note,1200) end,
    contact=case when p_contact is null then c.contact else c.contact||p_contact end,contacted_at=case when v_new_state='CONTACTADO' and c.contacted_at is null then now() else c.contacted_at end,
    updated_by=v_uid,updated_email=v_email,updated_at=now() where c.case_id=v_case.case_id returning * into v_case;
  if v_old_state is distinct from v_new_state then
    insert into public.aml_uaf_case_management_event(case_id,case_kind,rut_key,event_type,previous_state,new_state,actor_id,actor_email,actor_name,detail)
    values(v_case.case_id,p_kind,v_key,'STATE',v_old_state,v_new_state,v_uid,v_email,v_name,'Estado de gestión actualizado');
  end if;
  return v_case.case_id;
end $$;

revoke all on function public.obs_uaf_case_management() from public,anon;
revoke all on function public.obs_uaf_case_management_events(uuid) from public,anon;
revoke all on function public.aml_uaf_case_patch(text,text,jsonb,text,text,text,jsonb,boolean) from public,anon;
grant execute on function public.obs_uaf_case_management() to authenticated,service_role;
grant execute on function public.obs_uaf_case_management_events(uuid) to authenticated,service_role;
grant execute on function public.aml_uaf_case_patch(text,text,jsonb,text,text,text,jsonb,boolean) to authenticated,service_role;
