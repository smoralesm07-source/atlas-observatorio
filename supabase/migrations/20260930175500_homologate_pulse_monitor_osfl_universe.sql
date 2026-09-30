-- Homologa el cruce OSFL de Pulso con el universo canónico del Monitor OSFL.
--
-- Problema observado: Pulso leía obs_uaf_subject.is_osfl, una marca heredada
-- desde aml_v_universo_so_entity_explorer_0810 al refrescar el padrón UAF.
-- El Monitor OSFL, en cambio, publica la intersección vigente mediante
-- obs_osfl_entity.has_uaf_direct. Esto produjo 11 SO-OSFL en Pulso versus 40
-- en el Monitor OSFL aun cuando los 40 RUT están presentes en el padrón UAF.
--
-- Regla canónica desde esta migración:
--   SO que es OSFL = obs_osfl_entity.has_uaf_direct = true
--   conciliado por rut_search contra obs_uaf_subject.
--
-- La sincronización se ejecuta tanto cuando cambia/refresca el Monitor OSFL
-- como cuando se reconstruye el padrón de Pulso, evitando que el orden de los
-- refresh vuelva a separar ambas cifras.

create or replace function public.obs_sync_uaf_osfl_flags()
returns integer
language plpgsql
security definer
set search_path = 'pg_catalog', 'public', 'extensions', 'pg_temp'
as $$
declare
  v_changed integer;
begin
  update public.obs_uaf_subject u
     set is_osfl = exists (
       select 1
       from public.obs_osfl_entity o
       where o.has_uaf_direct
         and o.rut_search = u.rut_search
     )
   where u.is_osfl is distinct from exists (
       select 1
       from public.obs_osfl_entity o
       where o.has_uaf_direct
         and o.rut_search = u.rut_search
     );

  get diagnostics v_changed = row_count;
  return v_changed;
end;
$$;

revoke all on function public.obs_sync_uaf_osfl_flags() from public, anon;
grant execute on function public.obs_sync_uaf_osfl_flags() to authenticated, service_role;

create or replace function public.obs_sync_uaf_osfl_flags_trigger()
returns trigger
language plpgsql
security definer
set search_path = 'pg_catalog', 'public', 'extensions', 'pg_temp'
as $$
begin
  perform public.obs_sync_uaf_osfl_flags();
  return null;
end;
$$;

-- El Monitor OSFL se reconstruye con TRUNCATE + INSERT ... SELECT. Al ser
-- triggers por sentencia, la sincronización cuesta una pasada por el padrón,
-- no una ejecución por cada OSFL.
drop trigger if exists obs_osfl_sync_uaf_after_change on public.obs_osfl_entity;
create trigger obs_osfl_sync_uaf_after_change
after insert or delete or truncate on public.obs_osfl_entity
for each statement execute function public.obs_sync_uaf_osfl_flags_trigger();

drop trigger if exists obs_osfl_sync_uaf_after_update on public.obs_osfl_entity;
create trigger obs_osfl_sync_uaf_after_update
after update of has_uaf_direct, rut_search on public.obs_osfl_entity
for each statement execute function public.obs_sync_uaf_osfl_flags_trigger();

-- Si el padrón UAF se refresca después del Monitor, la nueva carga también
-- queda homologada inmediatamente.
drop trigger if exists obs_uaf_sync_osfl_after_insert on public.obs_uaf_subject;
create trigger obs_uaf_sync_osfl_after_insert
after insert on public.obs_uaf_subject
for each statement execute function public.obs_sync_uaf_osfl_flags_trigger();

-- Corrige el corte actualmente publicado sin esperar un nuevo refresh.
select public.obs_sync_uaf_osfl_flags();
