create or replace function public.aml_entity_prefer_uaf_registry_name_v1()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
declare
  v_registry_name text;
  v_sector_names text[];
  v_rut_key text;
begin
  v_rut_key := nullif(regexp_replace(upper(coalesce(new.rut, '')), '[^0-9K]', '', 'g'), '');
  if v_rut_key is null then
    return new;
  end if;

  select p.sector_names, r.registry_name
    into v_sector_names, v_registry_name
  from public.aml_uaf_entity_profile p
  cross join lateral (
    select x as registry_name
    from unnest(coalesce(p.registry_names, '{}'::text[])) with ordinality q(x, ord)
    where nullif(btrim(x), '') is not null
      and not exists (
        select 1
        from unnest(coalesce(p.sector_names, '{}'::text[])) s
        where public.obs_normalize_text(x) = public.obs_normalize_text(s)
      )
    order by ord
    limit 1
  ) r
  where nullif(regexp_replace(upper(coalesce(p.rut, '')), '[^0-9K]', '', 'g'), '') = v_rut_key
  limit 1;

  if v_registry_name is null then
    return new;
  end if;

  if nullif(btrim(coalesce(new.name, '')), '') is null
     or exists (
       select 1
       from unnest(coalesce(v_sector_names, '{}'::text[])) s
       where public.obs_normalize_text(new.name) = public.obs_normalize_text(s)
     )
     or nullif(regexp_replace(upper(coalesce(new.name, '')), '[^0-9K]', '', 'g'), '') = v_rut_key
  then
    new.name := btrim(v_registry_name);
    new.profile := jsonb_set(
      coalesce(new.profile, '{}'::jsonb),
      '{nombre}',
      to_jsonb(btrim(v_registry_name)),
      true
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_aml_entity_prefer_uaf_registry_name_v1 on public.aml_entities;
create trigger trg_aml_entity_prefer_uaf_registry_name_v1
before insert or update of rut, name, profile
on public.aml_entities
for each row
execute function public.aml_entity_prefer_uaf_registry_name_v1();

create or replace function public.aml_uaf_profile_propagate_registry_name_v1()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
declare
  v_registry_name text;
  v_rut_key text;
begin
  v_rut_key := nullif(regexp_replace(upper(coalesce(new.rut, '')), '[^0-9K]', '', 'g'), '');
  if v_rut_key is null then
    return new;
  end if;

  select x into v_registry_name
  from unnest(coalesce(new.registry_names, '{}'::text[])) with ordinality q(x, ord)
  where nullif(btrim(x), '') is not null
    and not exists (
      select 1
      from unnest(coalesce(new.sector_names, '{}'::text[])) s
      where public.obs_normalize_text(x) = public.obs_normalize_text(s)
    )
  order by ord
  limit 1;

  if v_registry_name is null then
    return new;
  end if;

  update public.aml_entities e
  set name = btrim(v_registry_name),
      profile = jsonb_set(
        coalesce(e.profile, '{}'::jsonb),
        '{nombre}',
        to_jsonb(btrim(v_registry_name)),
        true
      ),
      updated_at = now()
  where nullif(regexp_replace(upper(coalesce(e.rut, '')), '[^0-9K]', '', 'g'), '') = v_rut_key
    and (
      nullif(btrim(coalesce(e.name, '')), '') is null
      or exists (
        select 1
        from unnest(coalesce(new.sector_names, '{}'::text[])) s
        where public.obs_normalize_text(e.name) = public.obs_normalize_text(s)
      )
      or nullif(regexp_replace(upper(coalesce(e.name, '')), '[^0-9K]', '', 'g'), '') = v_rut_key
    );

  return new;
end;
$$;

drop trigger if exists trg_aml_uaf_profile_propagate_registry_name_v1 on public.aml_uaf_entity_profile;
create trigger trg_aml_uaf_profile_propagate_registry_name_v1
after insert or update of registry_names, sector_names, rut
on public.aml_uaf_entity_profile
for each row
execute function public.aml_uaf_profile_propagate_registry_name_v1();

with resolved as (
  select
    p.rut,
    p.sector_names,
    (
      select x
      from unnest(coalesce(p.registry_names, '{}'::text[])) with ordinality q(x, ord)
      where nullif(btrim(x), '') is not null
        and not exists (
          select 1
          from unnest(coalesce(p.sector_names, '{}'::text[])) s
          where public.obs_normalize_text(x) = public.obs_normalize_text(s)
        )
      order by ord
      limit 1
    ) as registry_name
  from public.aml_uaf_entity_profile p
)
update public.aml_entities e
set name = btrim(r.registry_name),
    profile = jsonb_set(
      coalesce(e.profile, '{}'::jsonb),
      '{nombre}',
      to_jsonb(btrim(r.registry_name)),
      true
    ),
    updated_at = now()
from resolved r
where r.registry_name is not null
  and nullif(regexp_replace(upper(coalesce(r.rut, '')), '[^0-9K]', '', 'g'), '')
      = nullif(regexp_replace(upper(coalesce(e.rut, '')), '[^0-9K]', '', 'g'), '')
  and (
    nullif(btrim(coalesce(e.name, '')), '') is null
    or exists (
      select 1
      from unnest(coalesce(r.sector_names, '{}'::text[])) s
      where public.obs_normalize_text(e.name) = public.obs_normalize_text(s)
    )
    or nullif(regexp_replace(upper(coalesce(e.name, '')), '[^0-9K]', '', 'g'), '')
       = nullif(regexp_replace(upper(coalesce(e.rut, '')), '[^0-9K]', '', 'g'), '')
  );

with resolved as (
  select
    p.rut,
    p.sector_names,
    (
      select x
      from unnest(coalesce(p.registry_names, '{}'::text[])) with ordinality q(x, ord)
      where nullif(btrim(x), '') is not null
        and not exists (
          select 1
          from unnest(coalesce(p.sector_names, '{}'::text[])) s
          where public.obs_normalize_text(x) = public.obs_normalize_text(s)
        )
      order by ord
      limit 1
    ) as registry_name
  from public.aml_uaf_entity_profile p
)
update public.obs_entity o
set name = btrim(r.registry_name),
    name_search = public.obs_normalize_text(btrim(r.registry_name)),
    refreshed_at = now()
from resolved r
where r.registry_name is not null
  and nullif(regexp_replace(upper(coalesce(r.rut, '')), '[^0-9K]', '', 'g'), '')
      = nullif(regexp_replace(upper(coalesce(o.rut, '')), '[^0-9K]', '', 'g'), '')
  and (
    nullif(btrim(coalesce(o.name, '')), '') is null
    or exists (
      select 1
      from unnest(coalesce(r.sector_names, '{}'::text[])) s
      where public.obs_normalize_text(o.name) = public.obs_normalize_text(s)
    )
    or nullif(regexp_replace(upper(coalesce(o.name, '')), '[^0-9K]', '', 'g'), '')
       = nullif(regexp_replace(upper(coalesce(o.rut, '')), '[^0-9K]', '', 'g'), '')
  );

comment on function public.aml_entity_prefer_uaf_registry_name_v1() is
'Protege la identidad canonica del Entity Hub: si el nombre de una entidad UAF es vacio, el RUT o una etiqueta sectorial generica, usa el nombre individual publicado en el padron UAF.';

comment on function public.aml_uaf_profile_propagate_registry_name_v1() is
'Propaga al Entity Hub el nombre individual del padron UAF cuando el nombre canonico vigente es solo un placeholder sectorial o el RUT.';