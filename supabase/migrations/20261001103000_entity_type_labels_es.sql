-- ATLAS · Tipos de entidad visibles en español
--
-- Corrige dos casos que hasta ahora compartían la etiqueta "Tipo no resuelto":
-- 1) sujetos obligados cuya naturaleza UAF ya está resuelta como persona natural;
-- 2) entidades levantadas exclusivamente por Radar Prensa y aún sin RUT resuelto.
--
-- La normalización se aplica sobre el modelo de lectura obs_entity. No modifica
-- las fuentes gobernadas de origen y se conserva en cada nueva materialización.

create or replace function public.obs_normalize_entity_type_es()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_subject_nature text;
begin
  -- Los tipos ya resueltos se preservan sin consultas adicionales.
  if new.entity_type is distinct from 'Tipo no resuelto' then
    return new;
  end if;

  -- Una entidad que existe únicamente por Radar Prensa, sin RUT reconciliado,
  -- se identifica por su procedencia y no se fuerza a PN/PJ mediante heurísticas.
  if new.rut is null
     and cardinality(coalesce(new.sources, '{}'::text[])) = 1
     and 'RADAR_PRENSA' = any(coalesce(new.sources, '{}'::text[])) then
    new.entity_type := 'Levantada en prensa';
    return new;
  end if;

  -- Para el universo UAF usamos la naturaleza ya gobernada por el padrón.
  select u.subject_nature
    into v_subject_nature
  from public.aml_uaf_obligated_subject_snapshot u
  where u.entity_id = new.entity_id
  limit 1;

  if v_subject_nature = 'PERSONA_NATURAL' then
    new.entity_type := 'Persona natural';
  end if;

  return new;
end;
$$;

comment on function public.obs_normalize_entity_type_es() is
  'Normaliza en español tipos no resueltos del modelo obs_entity usando evidencia gobernada UAF o procedencia exclusiva de Radar Prensa.';

drop trigger if exists trg_obs_entity_type_es on public.obs_entity;
create trigger trg_obs_entity_type_es
before insert or update of entity_type, rut, sources
on public.obs_entity
for each row
execute function public.obs_normalize_entity_type_es();

-- Backfill inmediato del corte publicado: personas naturales ya resueltas por UAF.
update public.obs_entity e
   set entity_type = 'Persona natural',
       refreshed_at = now()
 where e.entity_type = 'Tipo no resuelto'
   and exists (
     select 1
     from public.aml_uaf_obligated_subject_snapshot u
     where u.entity_id = e.entity_id
       and u.subject_nature = 'PERSONA_NATURAL'
   );

-- Backfill inmediato del corte publicado: registros provenientes solo de prensa.
update public.obs_entity e
   set entity_type = 'Levantada en prensa',
       refreshed_at = now()
 where e.entity_type = 'Tipo no resuelto'
   and e.rut is null
   and cardinality(coalesce(e.sources, '{}'::text[])) = 1
   and 'RADAR_PRENSA' = any(coalesce(e.sources, '{}'::text[]));
