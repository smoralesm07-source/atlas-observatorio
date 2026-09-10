-- ATLAS Core · refresco territorial por lotes.
-- Sustituye operacionalmente el refresco monolítico para proteger disponibilidad.

create or replace function atlas_core.load_territory_res_prefix(p_prefix text)
returns jsonb
language plpgsql
security definer
set search_path = public, atlas_core, pg_temp
as $$
declare
  v_from text;
  v_to text;
  v_rows bigint;
begin
  if p_prefix !~ '^[0-9]{3}$' then
    raise exception 'prefix must have exactly 3 digits';
  end if;
  v_from := p_prefix;
  v_to := lpad((p_prefix::integer + 1)::text, 3, '0');

  with geo_map as (
    select g.raw_commune,
           t.territory_id,
           t.commune_search as commune_key,
           t.commune_name,
           t.region_name
    from (
      select distinct coalesce(nullif(btrim(r.tax_commune), ''), nullif(btrim(r.social_commune), '')) as raw_commune
      from public.aml_res_company r
      where r.rut >= v_from and r.rut < v_to
        and coalesce(nullif(btrim(r.tax_commune), ''), nullif(btrim(r.social_commune), '')) is not null
    ) g
    left join public.obs_territory t on t.commune_search = public.obs_commune_key(g.raw_commune)
  ), ins as (
    insert into atlas_core.territory_entity (
      rut, name, name_search, entity_type, territory_id, commune_key, commune_name, region_name, geo_source,
      in_res, in_sii, in_atlas, in_uaf, in_osfl, in_potential, in_fintech,
      sii_status, sii_activity_start_date, sii_termination_date, res_constitution_date,
      atlas_entity_id, source_count, refreshed_at
    )
    select
      r.rut,
      coalesce(nullif(s.legal_name, ''), nullif(r.legal_name, ''), r.rut),
      public.obs_normalize_text(coalesce(nullif(s.legal_name, ''), nullif(r.legal_name, ''), r.rut)),
      'EMPRESA',
      gm.territory_id, gm.commune_key, gm.commune_name, gm.region_name,
      case when nullif(btrim(r.tax_commune), '') is not null then 'RES_TAX' else 'RES_SOCIAL' end,
      true, s.rut is not null, false, false, false, false, false,
      s.current_status, s.activity_start_date, s.termination_date, r.constitution_date,
      null, (1 + case when s.rut is not null then 1 else 0 end)::smallint, clock_timestamp()
    from public.aml_res_company r
    left join public.aml_sii_registry_company s on s.rut=r.rut
    left join geo_map gm on gm.raw_commune=coalesce(nullif(btrim(r.tax_commune), ''), nullif(btrim(r.social_commune), ''))
    where r.rut >= v_from and r.rut < v_to
    on conflict (rut) do update set
      name=excluded.name,
      name_search=excluded.name_search,
      entity_type='EMPRESA',
      territory_id=excluded.territory_id,
      commune_key=excluded.commune_key,
      commune_name=excluded.commune_name,
      region_name=excluded.region_name,
      geo_source=excluded.geo_source,
      in_res=true,
      in_sii=excluded.in_sii,
      sii_status=excluded.sii_status,
      sii_activity_start_date=excluded.sii_activity_start_date,
      sii_termination_date=excluded.sii_termination_date,
      res_constitution_date=excluded.res_constitution_date,
      source_count=(1 + case when excluded.in_sii then 1 else 0 end
        + case when atlas_core.territory_entity.in_atlas then 1 else 0 end
        + case when atlas_core.territory_entity.in_uaf then 1 else 0 end
        + case when atlas_core.territory_entity.in_osfl then 1 else 0 end
        + case when atlas_core.territory_entity.in_potential then 1 else 0 end
        + case when atlas_core.territory_entity.in_fintech then 1 else 0 end)::smallint,
      refreshed_at=excluded.refreshed_at
    returning 1
  )
  select count(*) into v_rows from ins;

  return jsonb_build_object('prefix',p_prefix,'rows',v_rows);
end;
$$;
revoke all on function atlas_core.load_territory_res_prefix(text) from public, anon, authenticated;
grant execute on function atlas_core.load_territory_res_prefix(text) to service_role;

create or replace function atlas_core.overlay_territory_atlas()
returns bigint
language plpgsql
security definer
set search_path = public, atlas_core, pg_temp
as $$
declare v_rows bigint;
begin
  with src as (
    select distinct on (e.rut)
      e.rut,e.name,e.entity_type,e.commune,e.entity_id,e.is_uaf_observed,e.sources,e.source_count,e.refreshed_at
    from public.obs_entity e
    where e.rut is not null and btrim(e.rut)<>'' and e.commune is not null and btrim(e.commune)<>''
    order by e.rut,e.source_count desc nulls last,e.refreshed_at desc nulls last
  ), ins as (
    insert into atlas_core.territory_entity (
      rut,name,name_search,entity_type,territory_id,commune_key,commune_name,region_name,geo_source,
      in_res,in_sii,in_atlas,in_uaf,in_osfl,in_potential,in_fintech,
      sii_status,sii_activity_start_date,sii_termination_date,atlas_entity_id,source_count,refreshed_at
    )
    select
      e.rut,e.name,public.obs_normalize_text(e.name),coalesce(e.entity_type,'ENTIDAD'),
      t.territory_id,t.commune_search,t.commune_name,t.region_name,'ATLAS_OBSERVED',
      false,s.rut is not null,true,coalesce(e.is_uaf_observed,false),coalesce('RADAR_OSFL'=any(e.sources),false),false,false,
      s.current_status,s.activity_start_date,s.termination_date,e.entity_id,
      (1 + case when s.rut is not null then 1 else 0 end + case when e.is_uaf_observed then 1 else 0 end + case when 'RADAR_OSFL'=any(e.sources) then 1 else 0 end)::smallint,
      clock_timestamp()
    from src e
    left join public.aml_sii_registry_company s on s.rut=e.rut
    left join public.obs_territory t on t.commune_search=public.obs_commune_key(e.commune)
    on conflict (rut) do update set
      in_atlas=true,
      in_uaf=atlas_core.territory_entity.in_uaf or excluded.in_uaf,
      in_osfl=atlas_core.territory_entity.in_osfl or excluded.in_osfl,
      atlas_entity_id=excluded.atlas_entity_id,
      source_count=(atlas_core.territory_entity.source_count
        + case when not atlas_core.territory_entity.in_atlas then 1 else 0 end
        + case when excluded.in_uaf and not atlas_core.territory_entity.in_uaf then 1 else 0 end
        + case when excluded.in_osfl and not atlas_core.territory_entity.in_osfl then 1 else 0 end)::smallint,
      entity_type=case when atlas_core.territory_entity.in_res then atlas_core.territory_entity.entity_type else excluded.entity_type end,
      territory_id=case when atlas_core.territory_entity.in_res then atlas_core.territory_entity.territory_id else excluded.territory_id end,
      commune_key=case when atlas_core.territory_entity.in_res then atlas_core.territory_entity.commune_key else excluded.commune_key end,
      commune_name=case when atlas_core.territory_entity.in_res then atlas_core.territory_entity.commune_name else excluded.commune_name end,
      region_name=case when atlas_core.territory_entity.in_res then atlas_core.territory_entity.region_name else excluded.region_name end,
      geo_source=case when atlas_core.territory_entity.in_res then atlas_core.territory_entity.geo_source else excluded.geo_source end,
      refreshed_at=excluded.refreshed_at
    returning 1
  ) select count(*) into v_rows from ins;
  return v_rows;
end;
$$;
revoke all on function atlas_core.overlay_territory_atlas() from public, anon, authenticated;
grant execute on function atlas_core.overlay_territory_atlas() to service_role;

create or replace function atlas_core.overlay_territory_uaf()
returns bigint language plpgsql security definer set search_path=public,atlas_core,pg_temp as $$
declare v_rows bigint;
begin
  with ins as (
    insert into atlas_core.territory_entity (
      rut,name,name_search,entity_type,territory_id,commune_key,commune_name,region_name,geo_source,
      in_res,in_sii,in_atlas,in_uaf,in_osfl,in_potential,in_fintech,sii_status,sii_activity_start_date,sii_termination_date,atlas_entity_id,source_count,refreshed_at
    )
    select u.rut,u.name,public.obs_normalize_text(u.name),coalesce(u.entity_type,'ENTIDAD'),
      t.territory_id,t.commune_search,t.commune_name,t.region_name,'UAF',false,s.rut is not null,false,true,coalesce(u.is_osfl,false),false,false,
      coalesce(u.sii_status,s.current_status),coalesce(u.sii_activity_start_date,s.activity_start_date),coalesce(u.sii_termination_date,s.termination_date),u.entity_id,
      (1+case when s.rut is not null then 1 else 0 end+case when u.is_osfl then 1 else 0 end)::smallint,clock_timestamp()
    from public.obs_uaf_subject u
    left join public.aml_sii_registry_company s on s.rut=u.rut
    left join public.obs_territory t on t.commune_search=public.obs_commune_key(u.commune)
    where u.rut is not null and u.commune is not null and btrim(u.commune)<>''
    on conflict(rut) do update set
      in_uaf=true,
      in_osfl=atlas_core.territory_entity.in_osfl or excluded.in_osfl,
      source_count=(atlas_core.territory_entity.source_count
        + case when not atlas_core.territory_entity.in_uaf then 1 else 0 end
        + case when excluded.in_osfl and not atlas_core.territory_entity.in_osfl then 1 else 0 end)::smallint,
      refreshed_at=excluded.refreshed_at
    returning 1
  ) select count(*) into v_rows from ins;
  return v_rows;
end;$$;
revoke all on function atlas_core.overlay_territory_uaf() from public,anon,authenticated;
grant execute on function atlas_core.overlay_territory_uaf() to service_role;

create or replace function atlas_core.overlay_territory_potential()
returns bigint language plpgsql security definer set search_path=public,atlas_core,pg_temp as $$
declare v_rows bigint;
begin
  with ins as (
    insert into atlas_core.territory_entity (
      rut,name,name_search,entity_type,territory_id,commune_key,commune_name,region_name,geo_source,
      in_res,in_sii,in_atlas,in_uaf,in_osfl,in_potential,in_fintech,sii_status,sii_activity_start_date,atlas_entity_id,source_count,refreshed_at
    )
    select p.rut,p.name,public.obs_normalize_text(p.name),'EMPRESA',t.territory_id,t.commune_search,t.commune_name,t.region_name,'POTENTIAL_UAF',
      false,s.rut is not null,false,false,false,true,false,coalesce(p.sii_status,s.current_status),coalesce(p.sii_activity_start_date,s.activity_start_date),p.entity_id,
      (1+case when s.rut is not null then 1 else 0 end)::smallint,clock_timestamp()
    from public.obs_uaf_potential_candidate p
    left join public.aml_sii_registry_company s on s.rut=p.rut
    left join public.obs_territory t on t.commune_search=public.obs_commune_key(p.commune)
    where p.rut is not null and p.commune is not null and btrim(p.commune)<>''
    on conflict(rut) do update set
      in_potential=true,
      source_count=(atlas_core.territory_entity.source_count+case when not atlas_core.territory_entity.in_potential then 1 else 0 end)::smallint,
      refreshed_at=excluded.refreshed_at
    returning 1
  ) select count(*) into v_rows from ins;
  return v_rows;
end;$$;
revoke all on function atlas_core.overlay_territory_potential() from public,anon,authenticated;
grant execute on function atlas_core.overlay_territory_potential() to service_role;

create or replace function atlas_core.overlay_territory_osfl()
returns bigint language plpgsql security definer set search_path=public,atlas_core,pg_temp as $$
declare v_rows bigint;
begin
  with src as (
    select distinct on(o.rut) o.* from public.obs_osfl_entity o
    where o.rut is not null and o.commune is not null and btrim(o.commune)<>''
    order by o.rut,o.refreshed_at desc nulls last
  ), ins as (
    insert into atlas_core.territory_entity (
      rut,name,name_search,entity_type,territory_id,commune_key,commune_name,region_name,geo_source,
      in_res,in_sii,in_atlas,in_uaf,in_osfl,in_potential,in_fintech,sii_status,sii_activity_start_date,sii_termination_date,atlas_entity_id,source_count,refreshed_at
    )
    select o.rut,o.name,public.obs_normalize_text(o.name),'OSFL',t.territory_id,t.commune_search,t.commune_name,t.region_name,'OSFL',
      false,s.rut is not null,false,coalesce(o.has_uaf_direct,false),true,coalesce(o.has_uaf_potential,false),false,
      coalesce(o.current_status,s.current_status),coalesce(o.activity_start_date,s.activity_start_date),coalesce(o.termination_date,s.termination_date),o.entity_id,
      (1+case when s.rut is not null then 1 else 0 end+case when o.has_uaf_direct then 1 else 0 end+case when o.has_uaf_potential then 1 else 0 end)::smallint,clock_timestamp()
    from src o
    left join public.aml_sii_registry_company s on s.rut=o.rut
    left join public.obs_territory t on t.commune_search=public.obs_commune_key(o.commune)
    on conflict(rut) do update set
      in_osfl=true,
      in_uaf=atlas_core.territory_entity.in_uaf or excluded.in_uaf,
      in_potential=atlas_core.territory_entity.in_potential or excluded.in_potential,
      source_count=(atlas_core.territory_entity.source_count
        + case when not atlas_core.territory_entity.in_osfl then 1 else 0 end
        + case when excluded.in_uaf and not atlas_core.territory_entity.in_uaf then 1 else 0 end
        + case when excluded.in_potential and not atlas_core.territory_entity.in_potential then 1 else 0 end)::smallint,
      refreshed_at=excluded.refreshed_at
    returning 1
  ) select count(*) into v_rows from ins;
  return v_rows;
end;$$;
revoke all on function atlas_core.overlay_territory_osfl() from public,anon,authenticated;
grant execute on function atlas_core.overlay_territory_osfl() to service_role;

create or replace function atlas_core.overlay_territory_fintech()
returns bigint language plpgsql security definer set search_path=public,atlas_core,pg_temp as $$
declare v_rows bigint;
begin
  with src as (
    select distinct on(f.rut) f.* from public.aml_v_fintech_entity_current f
    where f.rut is not null and f.commune is not null and btrim(f.commune)<>'' and coalesce(f.entity_status,'ACTIVE')<>'EXCLUDED'
    order by f.rut,f.confidence desc nulls last,f.refreshed_at desc nulls last
  ), ins as (
    insert into atlas_core.territory_entity (
      rut,name,name_search,entity_type,territory_id,commune_key,commune_name,region_name,geo_source,
      in_res,in_sii,in_atlas,in_uaf,in_osfl,in_potential,in_fintech,sii_status,sii_activity_start_date,atlas_entity_id,source_count,refreshed_at
    )
    select f.rut,coalesce(nullif(f.legal_name,''),nullif(f.brand,''),f.rut),public.obs_normalize_text(coalesce(nullif(f.legal_name,''),nullif(f.brand,''),f.rut)),'FINTECH',
      t.territory_id,t.commune_search,t.commune_name,t.region_name,'FINTECH',false,s.rut is not null,f.atlas_entity_id is not null,coalesce(f.has_uaf_public,false),false,false,true,
      s.current_status,coalesce(f.sii_activity_start_date,s.activity_start_date),f.atlas_entity_id,
      (1+case when s.rut is not null then 1 else 0 end+case when f.atlas_entity_id is not null then 1 else 0 end+case when f.has_uaf_public then 1 else 0 end)::smallint,clock_timestamp()
    from src f
    left join public.aml_sii_registry_company s on s.rut=f.rut
    left join public.obs_territory t on t.commune_search=public.obs_commune_key(f.commune)
    on conflict(rut) do update set
      in_fintech=true,
      in_atlas=atlas_core.territory_entity.in_atlas or excluded.in_atlas,
      in_uaf=atlas_core.territory_entity.in_uaf or excluded.in_uaf,
      atlas_entity_id=coalesce(atlas_core.territory_entity.atlas_entity_id,excluded.atlas_entity_id),
      source_count=(atlas_core.territory_entity.source_count
        + case when not atlas_core.territory_entity.in_fintech then 1 else 0 end
        + case when excluded.in_atlas and not atlas_core.territory_entity.in_atlas then 1 else 0 end
        + case when excluded.in_uaf and not atlas_core.territory_entity.in_uaf then 1 else 0 end)::smallint,
      refreshed_at=excluded.refreshed_at
    returning 1
  ) select count(*) into v_rows from ins;
  return v_rows;
end;$$;
revoke all on function atlas_core.overlay_territory_fintech() from public,anon,authenticated;
grant execute on function atlas_core.overlay_territory_fintech() to service_role;

create or replace function atlas_core.refresh_territory_snapshot()
returns jsonb language plpgsql security definer set search_path=public,atlas_core,pg_temp as $$
declare v_refresh timestamptz:=clock_timestamp();
begin
  insert into atlas_core.territory_snapshot(
    territory_id,commune_name,region_name,universe_total,sii_total,sii_active,sii_terminated,res_total,atlas_observed,uaf_observed,osfl_observed,potential_observed,fintech_observed,atlas_coverage_pct,refreshed_at
  )
  select t.territory_id,t.commune_name,t.region_name,count(e.rut)::bigint,
    count(e.rut) filter(where e.in_sii)::bigint,
    count(e.rut) filter(where e.sii_status='ACTIVE_AS_PUBLISHED')::bigint,
    count(e.rut) filter(where e.sii_status='TERMINATED_AS_PUBLISHED')::bigint,
    count(e.rut) filter(where e.in_res)::bigint,
    count(e.rut) filter(where e.in_atlas)::bigint,
    count(e.rut) filter(where e.in_uaf)::bigint,
    count(e.rut) filter(where e.in_osfl)::bigint,
    count(e.rut) filter(where e.in_potential)::bigint,
    count(e.rut) filter(where e.in_fintech)::bigint,
    case when count(e.rut)=0 then null else round(100.0*count(e.rut) filter(where e.in_atlas)/count(e.rut),4) end,
    v_refresh
  from public.obs_territory t left join atlas_core.territory_entity e on e.territory_id=t.territory_id
  group by t.territory_id,t.commune_name,t.region_name
  on conflict(territory_id) do update set
    commune_name=excluded.commune_name,region_name=excluded.region_name,universe_total=excluded.universe_total,sii_total=excluded.sii_total,
    sii_active=excluded.sii_active,sii_terminated=excluded.sii_terminated,res_total=excluded.res_total,atlas_observed=excluded.atlas_observed,
    uaf_observed=excluded.uaf_observed,osfl_observed=excluded.osfl_observed,potential_observed=excluded.potential_observed,fintech_observed=excluded.fintech_observed,
    atlas_coverage_pct=excluded.atlas_coverage_pct,refreshed_at=excluded.refreshed_at;
  return jsonb_build_object('territories',(select count(*) from atlas_core.territory_snapshot),'entities',(select count(*) from atlas_core.territory_entity),'territorialized',(select count(*) from atlas_core.territory_entity where territory_id is not null),'refreshed_at',v_refresh);
end;$$;
revoke all on function atlas_core.refresh_territory_snapshot() from public,anon,authenticated;
grant execute on function atlas_core.refresh_territory_snapshot() to service_role;
