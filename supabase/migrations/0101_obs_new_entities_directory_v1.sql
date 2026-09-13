create or replace function public.obs_new_entities_directory(
  p_q text default null,
  p_source text default 'TODAS',
  p_visibility text default 'TODAS',
  p_region text default null,
  p_activity text default null,
  p_potential_only boolean default false,
  p_from date default null,
  p_to date default null,
  p_limit integer default 100,
  p_offset integer default 0
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_reference date;
  v_from date;
  v_to date;
  v_limit integer := least(greatest(coalesce(p_limit,100),1),200);
  v_offset integer := greatest(coalesce(p_offset,0),0);
  v_result jsonb;
begin
  select greatest(
    (select max(constitution_date) from public.aml_res_company where constitution_date <= current_date),
    (select max(activity_start_date) from public.aml_sii_registry_company where activity_start_date <= current_date)
  ) into v_reference;

  v_to := least(coalesce(p_to, v_reference), v_reference);
  v_from := coalesce(p_from, v_to - 29);
  if v_from > v_to then
    raise exception 'p_from no puede ser posterior a p_to';
  end if;

  with recent_ruts as (
    select r.rut
    from public.aml_res_company r
    where r.constitution_date between v_from and v_to
      and r.constitution_date <= current_date
    union
    select s.rut
    from public.aml_sii_registry_company s
    where s.activity_start_date between v_from and v_to
      and s.activity_start_date <= current_date
  ), base as (
    select
      rr.rut,
      coalesce(s.legal_name, r.legal_name, e.name, p.name, 'Entidad sin nombre') as name,
      case when r.constitution_date between v_from and v_to then r.constitution_date end as constitution_date,
      case when s.activity_start_date between v_from and v_to then s.activity_start_date end as activity_start_date,
      greatest(
        case when r.constitution_date between v_from and v_to then r.constitution_date end,
        case when s.activity_start_date between v_from and v_to then s.activity_start_date end
      ) as event_date,
      (r.constitution_date between v_from and v_to) as has_res,
      (s.activity_start_date between v_from and v_to) as has_sii,
      coalesce(p.region, e.region,
        case coalesce(r.social_region, r.tax_region)
          when 1 then 'Tarapacá'
          when 2 then 'Antofagasta'
          when 3 then 'Atacama'
          when 4 then 'Coquimbo'
          when 5 then 'Valparaíso'
          when 6 then 'Libertador General Bernardo O''Higgins'
          when 7 then 'Maule'
          when 8 then 'Biobío'
          when 9 then 'La Araucanía'
          when 10 then 'Los Lagos'
          when 11 then 'Aysén del General Carlos Ibáñez del Campo'
          when 12 then 'Magallanes y de la Antártica Chilena'
          when 13 then 'Metropolitana de Santiago'
          when 14 then 'Los Ríos'
          when 15 then 'Arica y Parinacota'
          when 16 then 'Ñuble'
          else null
        end
      ) as region,
      coalesce(p.commune, e.commune, r.social_commune, r.tax_commune) as commune,
      coalesce(a.activity_name, p.matched_activity) as activity,
      s.current_status as sii_status,
      e.entity_id,
      (e.entity_id is not null) as visible_in_atlas,
      coalesce(e.is_uaf_observed,false) as is_uaf_observed,
      e.uaf_sector,
      (p.rut is not null) as is_potential_so,
      p.implied_sector as potential_sector,
      p.ivo_score,
      p.ivo_band
    from recent_ruts rr
    left join public.aml_res_company r on r.rut = rr.rut
    left join public.aml_sii_registry_company s on s.rut = rr.rut
    left join public.obs_entity e on e.rut = rr.rut
    left join public.obs_uaf_potential_candidate p on p.rut = rr.rut
    left join lateral (
      select a0.activity_name
      from public.aml_sii_registry_activity a0
      where a0.rut = rr.rut
      order by a0.activity_registration_date desc nulls last, a0.activity_record_id
      limit 1
    ) a on true
  ), filtered as (
    select *
    from base b
    where
      case upper(coalesce(p_source,'TODAS'))
        when 'RES' then b.has_res
        when 'SII' then b.has_sii
        when 'AMBAS' then b.has_res and b.has_sii
        else true
      end
      and case upper(coalesce(p_visibility,'TODAS'))
        when 'EN_ATLAS' then b.visible_in_atlas
        when 'FUERA_ATLAS' then not b.visible_in_atlas
        else true
      end
      and (not coalesce(p_potential_only,false) or b.is_potential_so)
      and (nullif(trim(coalesce(p_region,'')),'') is null or b.region = trim(p_region))
      and (
        nullif(trim(coalesce(p_activity,'')),'') is null
        or coalesce(b.activity,'') ilike '%' || trim(p_activity) || '%'
        or coalesce(b.potential_sector,'') ilike '%' || trim(p_activity) || '%'
      )
      and (
        nullif(trim(coalesce(p_q,'')),'') is null
        or b.name ilike '%' || trim(p_q) || '%'
        or b.rut ilike '%' || trim(p_q) || '%'
      )
  ), paged as (
    select * from filtered
    order by event_date desc, name asc, rut asc
    limit v_limit offset v_offset
  )
  select jsonb_build_object(
    'contract','ATLAS_OBS_NEW_ENTITIES_DIRECTORY_V1',
    'reference_date',v_reference,
    'from_date',v_from,
    'to_date',v_to,
    'total',(select count(*) from filtered),
    'limit',v_limit,
    'offset',v_offset,
    'rows',coalesce((select jsonb_agg(jsonb_build_object(
      'rut',x.rut,
      'name',x.name,
      'event_date',x.event_date,
      'constitution_date',x.constitution_date,
      'activity_start_date',x.activity_start_date,
      'sources',to_jsonb(array_remove(array[case when x.has_res then 'RES' end, case when x.has_sii then 'SII' end],null)),
      'region',x.region,
      'commune',x.commune,
      'activity',x.activity,
      'sii_status',x.sii_status,
      'entity_id',x.entity_id,
      'visible_in_atlas',x.visible_in_atlas,
      'is_uaf_observed',x.is_uaf_observed,
      'uaf_sector',x.uaf_sector,
      'is_potential_so',x.is_potential_so,
      'potential_sector',x.potential_sector,
      'ivo_score',x.ivo_score,
      'ivo_band',x.ivo_band
    ) order by x.event_date desc, x.name asc, x.rut asc) from paged x),'[]'::jsonb),
    'semantics','Directorio de altas observadas por RES (constitución) y/o SII (inicio de actividades). Una fecha SII no implica necesariamente creación jurídica. Las fechas futuras se excluyen.'
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.obs_new_entities_directory(text,text,text,text,text,boolean,date,date,integer,integer) from public;
revoke all on function public.obs_new_entities_directory(text,text,text,text,text,boolean,date,date,integer,integer) from anon;
grant execute on function public.obs_new_entities_directory(text,text,text,text,text,boolean,date,date,integer,integer) to authenticated;

comment on function public.obs_new_entities_directory(text,text,text,text,text,boolean,date,date,integer,integer) is
'Directorio paginado de altas recientes RES/SII para Pulso. Filtra por fuente, visibilidad Atlas, región, actividad, potencial SO y fecha.';
