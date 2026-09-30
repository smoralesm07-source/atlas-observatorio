-- ATLAS Observatorio · OSFL · búsqueda de RUT y semántica de fuente SII
--
-- Objetivos:
-- 1) evitar el full scan que provocaba timeout al buscar un RUT completo;
-- 2) usar igualdad exacta sobre rut_search para aprovechar el índice btree;
-- 3) considerar como fuente SII toda entidad con has_sii_identity=true,
--    aunque todavía no tenga historia anual en aml_sii_entity_year.

create or replace function public.obs_osfl_search(
  p_q text default null,p_region text default null,p_type text default null,p_activity text default null,
  p_source text default null,p_uaf text default null,p_public_funds text default null,p_sanctions text default null,
  p_limit integer default 25,p_offset integer default 0
)
returns jsonb
language sql
stable
security invoker
set search_path=public,extensions,pg_temp
as $$
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
  where p_q is null or btrim(p_q)=''

  union all

  select x.*
  from public.obs_osfl_entity x
  cross join search_params q
  where p_q is not null and btrim(p_q)<>''
    and q.is_full_rut
    and q.q_rut is not null
    and x.rut_search = q.q_rut

  union all

  select x.*
  from public.obs_osfl_entity x
  cross join search_params q
  where p_q is not null and btrim(p_q)<>''
    and not q.is_full_rut
    and q.q_name is not null
    and x.name_search like '%'||q.q_name||'%'
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
  select * from filtered
  order by has_sanctions desc,has_uaf_direct desc,public_funds desc,name asc
  limit greatest(1,least(coalesce(p_limit,25),100)) offset greatest(coalesce(p_offset,0),0)
)
select jsonb_build_object(
  'total',(select count(*) from filtered),
  'limit',greatest(1,least(coalesce(p_limit,25),100)),
  'offset',greatest(coalesce(p_offset,0),0),
  'rows',coalesce((select jsonb_agg(jsonb_build_object(
    'entity_id',entity_id,'rut',rut,'name',name,'type',osfl_type,'region',region,'commune',commune,
    'activity_group',activity_group,'main_activity',main_activity,'status',current_status,
    'identity_basis',identity_basis,'confirmation_level',confirmation_level,
    'sources',jsonb_strip_nulls(jsonb_build_object(
      'SII',case when has_sii_identity then true end,
      'UAF',case when has_uaf_direct then true end,
      'POTENTIAL_UAF',case when has_uaf_potential then true end,
      '19862',case when registro19862 then true end,
      'SANCIONES',case when has_sanctions then true end)),
    'uaf_class',uaf_class,'uaf_label',uaf_label,'uaf_sector',uaf_sector,
    'public_funds',public_funds,'transfer_count',transfer_count,'transfer_amount_clp',transfer_amount_clp,
    'sanctions',has_sanctions,'sanction_count',sanction_count,'source_count',source_count,
    'activity_start_date',activity_start_date,'termination_date',termination_date
  ) order by has_sanctions desc,has_uaf_direct desc,public_funds desc,name asc) from page),'[]'::jsonb)
);
$$;

revoke all on function public.obs_osfl_search(text,text,text,text,text,text,text,text,integer,integer) from public,anon;
grant execute on function public.obs_osfl_search(text,text,text,text,text,text,text,text,integer,integer) to authenticated,service_role;
