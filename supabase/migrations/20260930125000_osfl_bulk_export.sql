-- Exportación masiva OSFL optimizada para universos de cientos de miles de filas.
-- Usa paginación por cursor y lotes de hasta 10.000 registros para evitar miles
-- de round-trips y el costo de OFFSET sobre páginas profundas.

create or replace function public.obs_osfl_export_page(
  p_q text default null,
  p_region text default null,
  p_type text default null,
  p_activity text default null,
  p_source text default null,
  p_uaf text default null,
  p_public_funds text default null,
  p_sanctions text default null,
  p_after_entity_id text default null,
  p_limit integer default 5000
)
returns jsonb
language sql
stable
set search_path to 'public','extensions','pg_temp'
as $function$
with search_params as (
  select
    nullif(public.obs_normalize_text(btrim(p_q)), '') as q_name,
    nullif(regexp_replace(upper(btrim(p_q)), '[^0-9K]', '', 'g'), '') as q_rut,
    case
      when p_q is not null
       and btrim(p_q) <> ''
       and btrim(p_q) ~ '^[0-9Kk. -]+$'
       and length(regexp_replace(upper(btrim(p_q)), '[^0-9K]', '', 'g')) >= 8
      then true else false
    end as is_full_rut
), candidates as (
  select x.*
  from public.obs_osfl_entity x
  cross join search_params q
  where (p_q is null or btrim(p_q)='')
    and (p_after_entity_id is null or x.entity_id > p_after_entity_id)

  union all

  select x.*
  from public.obs_osfl_entity x
  cross join search_params q
  where p_q is not null and btrim(p_q)<>''
    and q.is_full_rut
    and q.q_rut is not null
    and x.rut_search = q.q_rut
    and (p_after_entity_id is null or x.entity_id > p_after_entity_id)

  union all

  select x.*
  from public.obs_osfl_entity x
  cross join search_params q
  where p_q is not null and btrim(p_q)<>''
    and not q.is_full_rut
    and q.q_name is not null
    and x.name_search like '%'||q.q_name||'%'
    and (p_after_entity_id is null or x.entity_id > p_after_entity_id)
), filtered as (
  select x.*
  from candidates x
  where (p_region is null or p_region='' or x.region=p_region)
    and (p_type is null or p_type='' or x.osfl_type=p_type)
    and (p_activity is null or p_activity='' or x.main_activity=p_activity)
    and (p_source is null or p_source=''
      or (p_source='SII' and x.has_sii_identity)
      or (p_source='UAF' and (x.has_uaf_direct or x.has_uaf_potential))
      or (p_source='19862' and x.registro19862)
      or (p_source='SANCIONES' and x.has_sanctions))
    and (p_uaf is null or p_uaf='' or p_uaf='TODAS'
      or (p_uaf='DIRECTA' and x.has_uaf_direct)
      or (p_uaf='POTENCIAL' and x.has_uaf_potential)
      or (p_uaf='SIN_PUENTE' and not x.has_uaf_direct and not x.has_uaf_potential))
    and (p_public_funds is null or p_public_funds='' or p_public_funds='TODOS'
      or (p_public_funds='SI' and x.public_funds)
      or (p_public_funds='NO' and not x.public_funds))
    and (p_sanctions is null or p_sanctions='' or p_sanctions='TODAS'
      or (p_sanctions='SI' and x.has_sanctions)
      or (p_sanctions='NO' and not x.has_sanctions))
), page as (
  select
    entity_id,
    rut,
    name,
    osfl_type,
    region,
    commune,
    main_activity,
    current_status,
    has_sii_identity,
    has_uaf_direct,
    has_uaf_potential,
    registro19862,
    has_sanctions,
    public_funds
  from filtered
  order by entity_id
  limit greatest(1,least(coalesce(p_limit,5000),10000))
)
select jsonb_build_object(
  'rows', coalesce((select jsonb_agg(jsonb_build_object(
    'entity_id',entity_id,
    'rut',rut,
    'name',name,
    'type',osfl_type,
    'region',region,
    'commune',commune,
    'main_activity',main_activity,
    'status',current_status,
    'sources',jsonb_strip_nulls(jsonb_build_object(
      'SII',case when has_sii_identity then true end,
      'UAF',case when has_uaf_direct then true end,
      'POTENTIAL_UAF',case when has_uaf_potential then true end,
      '19862',case when registro19862 then true end,
      'SANCIONES',case when has_sanctions then true end,
      'FONDOS_PUBLICOS',case when public_funds then true end
    ))
  ) order by entity_id) from page),'[]'::jsonb),
  'next_cursor', (select entity_id from page order by entity_id desc limit 1),
  'has_more', (select count(*) from page) = greatest(1,least(coalesce(p_limit,5000),10000))
);
$function$;

grant execute on function public.obs_osfl_export_page(text,text,text,text,text,text,text,text,text,integer) to authenticated;
grant execute on function public.obs_osfl_export_page(text,text,text,text,text,text,text,text,text,integer) to service_role;
