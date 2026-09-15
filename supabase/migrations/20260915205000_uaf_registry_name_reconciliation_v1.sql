create or replace function public.aml_uaf_prefer_registry_name_when_placeholder_v1()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
declare
  v_entity text;
  v_registry text;
  v_sector text;
  v_sector_canonical text;
  v_entity_rut text;
  v_rut text;
begin
  v_entity := public.obs_normalize_text(coalesce(new.entity_name, ''));
  v_registry := public.obs_normalize_text(coalesce(new.registry_name, ''));
  v_sector := public.obs_normalize_text(coalesce(new.uaf_sector, ''));
  v_sector_canonical := public.obs_normalize_text(coalesce(new.uaf_sector_canonical, ''));
  v_entity_rut := nullif(regexp_replace(upper(coalesce(new.entity_name, '')), '[^0-9K]', '', 'g'), '');
  v_rut := nullif(regexp_replace(upper(coalesce(new.rut, '')), '[^0-9K]', '', 'g'), '');

  if nullif(btrim(coalesce(new.registry_name, '')), '') is not null
     and v_registry <> ''
     and v_registry is distinct from v_sector
     and v_registry is distinct from v_sector_canonical
     and (
       nullif(btrim(coalesce(new.entity_name, '')), '') is null
       or v_entity = v_sector
       or v_entity = v_sector_canonical
       or (v_entity_rut is not null and v_entity_rut = v_rut)
     )
  then
    new.entity_name := btrim(new.registry_name);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_aml_uaf_prefer_registry_name_when_placeholder_v1
  on public.aml_uaf_obligated_subject_snapshot;

create trigger trg_aml_uaf_prefer_registry_name_when_placeholder_v1
before insert or update of entity_name, registry_name, uaf_sector, uaf_sector_canonical, rut
on public.aml_uaf_obligated_subject_snapshot
for each row
execute function public.aml_uaf_prefer_registry_name_when_placeholder_v1();

update public.aml_uaf_obligated_subject_snapshot s
set entity_name = btrim(s.registry_name),
    refreshed_at = now()
where nullif(btrim(coalesce(s.registry_name, '')), '') is not null
  and public.obs_normalize_text(s.registry_name) is distinct from public.obs_normalize_text(coalesce(s.uaf_sector, ''))
  and public.obs_normalize_text(s.registry_name) is distinct from public.obs_normalize_text(coalesce(s.uaf_sector_canonical, ''))
  and (
    nullif(btrim(coalesce(s.entity_name, '')), '') is null
    or public.obs_normalize_text(s.entity_name) = public.obs_normalize_text(coalesce(s.uaf_sector, ''))
    or public.obs_normalize_text(s.entity_name) = public.obs_normalize_text(coalesce(s.uaf_sector_canonical, ''))
    or nullif(regexp_replace(upper(coalesce(s.entity_name, '')), '[^0-9K]', '', 'g'), '')
       = nullif(regexp_replace(upper(coalesce(s.rut, '')), '[^0-9K]', '', 'g'), '')
  );

update public.obs_uaf_subject u
set name = s.entity_name,
    name_search = public.obs_normalize_text(s.entity_name),
    refreshed_at = now()
from public.aml_uaf_obligated_subject_snapshot s
where s.rut = u.rut
  and nullif(btrim(coalesce(s.entity_name, '')), '') is not null
  and public.obs_normalize_text(coalesce(u.name, '')) is distinct from public.obs_normalize_text(s.entity_name)
  and (
    nullif(btrim(coalesce(u.name, '')), '') is null
    or public.obs_normalize_text(u.name) = public.obs_normalize_text(coalesce(u.uaf_sector, ''))
    or nullif(regexp_replace(upper(coalesce(u.name, '')), '[^0-9K]', '', 'g'), '')
       = nullif(regexp_replace(upper(coalesce(u.rut, '')), '[^0-9K]', '', 'g'), '')
  );

comment on function public.aml_uaf_prefer_registry_name_when_placeholder_v1() is
'Protege el padrón UAF materializado: cuando el resolvedor de entidad entrega un nombre genérico igual al sector o al RUT, preserva el nombre específico publicado por el registro UAF.';
