-- ATLAS Core · optimización del directorio territorial amplio.
-- Separa el conteo del page fetch y habilita ordenación indexada.

create index if not exists atlas_core_territory_entity_coverage_idx
  on atlas_core.territory_entity (territory_id, source_count desc, in_atlas desc, name);
create index if not exists atlas_core_territory_entity_status_coverage_idx
  on atlas_core.territory_entity (territory_id, sii_status, source_count desc, in_atlas desc, name);
create index if not exists atlas_core_territory_entity_name_idx
  on atlas_core.territory_entity (territory_id, name);
create index if not exists atlas_core_territory_entity_status_name_idx
  on atlas_core.territory_entity (territory_id, sii_status, name);

create or replace function public.obs_territory_universe_directory(
  p_territory_id text,
  p_q text default null,
  p_status text default 'ALL',
  p_order text default 'coverage',
  p_limit integer default 80,
  p_offset integer default 0
)
returns table(
  rut text,
  name text,
  entity_type text,
  region text,
  commune text,
  geo_source text,
  sii_status text,
  in_res boolean,
  in_sii boolean,
  in_atlas boolean,
  in_uaf boolean,
  in_osfl boolean,
  in_potential boolean,
  in_fintech boolean,
  atlas_entity_id text,
  source_count integer,
  total_count bigint
)
language plpgsql
stable
security invoker
set search_path = public, atlas_core, pg_temp
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit,80),200));
  v_offset integer := greatest(0, coalesce(p_offset,0));
  v_status text := upper(coalesce(p_status,'ALL'));
  v_order text := lower(coalesce(p_order,'coverage'));
  v_q text := nullif(trim(p_q),'');
  v_name_q text;
  v_rut_q text;
  v_total bigint;
begin
  if v_q is not null then
    v_name_q := public.obs_normalize_text(v_q);
    v_rut_q := regexp_replace(upper(v_q), '[^0-9K]', '', 'g');
  end if;

  select count(*) into v_total
  from atlas_core.territory_entity e
  where e.territory_id=p_territory_id
    and case v_status
      when 'ACTIVE' then e.sii_status='ACTIVE_AS_PUBLISHED'
      when 'TERMINATED' then e.sii_status='TERMINATED_AS_PUBLISHED'
      when 'ATLAS' then e.in_atlas
      else true
    end
    and (
      v_q is null
      or e.name_search like v_name_q || '%'
      or regexp_replace(upper(e.rut), '[^0-9K]', '', 'g') like v_rut_q || '%'
    );

  if v_order='name' then
    return query
    select e.rut,e.name,e.entity_type,e.region_name,e.commune_name,e.geo_source,e.sii_status,
           e.in_res,e.in_sii,e.in_atlas,e.in_uaf,e.in_osfl,e.in_potential,e.in_fintech,
           e.atlas_entity_id,e.source_count::integer,v_total
    from atlas_core.territory_entity e
    where e.territory_id=p_territory_id
      and case v_status
        when 'ACTIVE' then e.sii_status='ACTIVE_AS_PUBLISHED'
        when 'TERMINATED' then e.sii_status='TERMINATED_AS_PUBLISHED'
        when 'ATLAS' then e.in_atlas
        else true
      end
      and (
        v_q is null
        or e.name_search like v_name_q || '%'
        or regexp_replace(upper(e.rut), '[^0-9K]', '', 'g') like v_rut_q || '%'
      )
    order by e.name
    limit v_limit offset v_offset;
  else
    return query
    select e.rut,e.name,e.entity_type,e.region_name,e.commune_name,e.geo_source,e.sii_status,
           e.in_res,e.in_sii,e.in_atlas,e.in_uaf,e.in_osfl,e.in_potential,e.in_fintech,
           e.atlas_entity_id,e.source_count::integer,v_total
    from atlas_core.territory_entity e
    where e.territory_id=p_territory_id
      and case v_status
        when 'ACTIVE' then e.sii_status='ACTIVE_AS_PUBLISHED'
        when 'TERMINATED' then e.sii_status='TERMINATED_AS_PUBLISHED'
        when 'ATLAS' then e.in_atlas
        else true
      end
      and (
        v_q is null
        or e.name_search like v_name_q || '%'
        or regexp_replace(upper(e.rut), '[^0-9K]', '', 'g') like v_rut_q || '%'
      )
    order by e.source_count desc, e.in_atlas desc, e.name
    limit v_limit offset v_offset;
  end if;
end;
$$;
revoke all on function public.obs_territory_universe_directory(text,text,text,text,integer,integer) from public, anon;
grant execute on function public.obs_territory_universe_directory(text,text,text,text,integer,integer) to authenticated, service_role;
