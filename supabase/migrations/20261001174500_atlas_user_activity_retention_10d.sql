-- ATLAS · retención liviana de bitácora de navegación.
-- La tabla ya registra sólo navegación de alto nivel (sección/ruta), nunca búsquedas, RUT ni entidades.
-- El histórico visible se acota a 10 días y la limpieza física se ejecuta únicamente al iniciar sesión,
-- evitando trabajo adicional en cada cambio de sección o heartbeat.

delete from public.atlas_user_activity
where created_at < now() - interval '10 days';

create index if not exists atlas_user_activity_created_idx
  on public.atlas_user_activity (created_at desc);

create index if not exists atlas_user_activity_user_created_idx
  on public.atlas_user_activity (user_id, created_at desc);

create or replace function public.atlas_prune_user_activity_10d()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.operation = 'session_start' then
    delete from public.atlas_user_activity
    where user_id = new.user_id
      and created_at < now() - interval '10 days';
  end if;
  return new;
end;
$$;

revoke all on function public.atlas_prune_user_activity_10d() from public;

drop trigger if exists atlas_user_activity_prune_10d on public.atlas_user_activity;
create trigger atlas_user_activity_prune_10d
after insert on public.atlas_user_activity
for each row
execute function public.atlas_prune_user_activity_10d();

comment on function public.atlas_prune_user_activity_10d() is
  'Elimina actividad del usuario con más de 10 días sólo al inicio de una nueva sesión; minimiza costo y mantiene acotada la bitácora.';
