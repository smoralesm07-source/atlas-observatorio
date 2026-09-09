create or replace function public.obs_fintech_search_v2(
  p_q text default null,
  p_region text default null,
  p_vertical text default null,
  p_model text default null,
  p_source text default null,
  p_regulator text default null,
  p_psav text default null,
  p_operating text default null,
  p_limit integer default 10,
  p_offset integer default 0
) returns jsonb
language plpgsql
stable security definer
set search_path to 'public','extensions','pg_temp'
as $function$
declare
  ok boolean;
  result jsonb;
  q_name text := public.obs_normalize_text(btrim(coalesce(p_q,'')));
  q_rut text := regexp_replace(upper(btrim(coalesce(p_q,''))),'[^0-9K]','','g');
begin
  select exists(select 1 from public.aml_allowed_users au where au.user_id=auth.uid() and au.enabled) into ok;
  if not ok then return jsonb_build_object('error','NOT_AUTHORIZED'); end if;

  with filtered as (
    select e.*,
      coalesce((select jsonb_agg(es.source_code order by es.source_code) from public.aml_fintech_entity_source es where es.fintech_id=e.fintech_id and es.status='OBSERVED'),'[]'::jsonb) source_codes,
      (select count(*) from public.aml_fintech_function_observation fo where fo.subject_type='ENTITY' and fo.subject_key=e.fintech_id)::int function_count
    from public.aml_v_fintech_entity_current e
    where (
      q_name=''
      or public.obs_normalize_text(coalesce(e.brand,'')) like '%'||q_name||'%'
      or public.obs_normalize_text(e.legal_name) like '%'||q_name||'%'
      or exists(
        select 1
        from public.aml_fintech_actor_alias a
        where a.fintech_id=e.fintech_id
          and a.active
          and public.obs_normalize_text(a.alias_text) like '%'||q_name||'%'
      )
      or (
        length(q_rut)>=4
        and regexp_replace(upper(coalesce(e.rut,'')),'[^0-9K]','','g') like '%'||q_rut||'%'
      )
    )
      and (p_region is null or p_region='' or e.region=p_region)
      and (p_vertical is null or p_vertical='' or e.primary_vertical=p_vertical)
      and (p_model is null or p_model='' or e.business_model=p_model)
      and (p_source is null or p_source='' or exists(select 1 from public.aml_fintech_entity_source es where es.fintech_id=e.fintech_id and es.source_code=p_source and es.status='OBSERVED'))
      and (p_regulator is null or p_regulator='' or p_regulator='TODOS' or (p_regulator='CMF' and e.has_cmf_public) or (p_regulator='UAF' and e.has_uaf_public))
      and (p_psav is null or p_psav='' or p_psav='TODOS' or (p_psav='SI' and e.psav_status in ('CONFIRMED','PROBABLE')) or (p_psav='NO' and e.psav_status not in ('CONFIRMED','PROBABLE')) or e.psav_status=p_psav)
      and (p_operating is null or p_operating='' or p_operating='TODOS' or e.operating_status=p_operating)
  ), paged as (
    select * from filtered
    order by case operating_status when 'ACTIVE' then 0 when 'LIMITED' then 1 when 'NO_NEW_BUSINESS' then 2 when 'CEASED' then 3 else 4 end,
      coalesce(sii_sales_band_rank,-1) desc,coalesce(sii_workers,0) desc,coalesce(brand,legal_name)
    limit greatest(1,least(coalesce(p_limit,10),100)) offset greatest(coalesce(p_offset,0),0)
  )
  select jsonb_build_object(
    'total',(select count(*) from filtered),
    'rows',coalesce((select jsonb_agg(jsonb_build_object(
      'fintech_id',fintech_id,'atlas_entity_id',atlas_entity_id,'rut',rut,'brand',brand,'legal_name',legal_name,
      'vertical',primary_vertical,'business_model',business_model,'target_customer',target_customer,'revenue_model',revenue_model,'psav_status',psav_status,
      'operating_status',operating_status,'operating_status_as_of',operating_status_as_of,'actor_kind',actor_kind,
      'region',region,'commune',commune,'sii_main_activity',sii_main_activity,'sales_band',sii_sales_band,'sales_band_rank',sii_sales_band_rank,'workers',sii_workers,
      'has_cmf_public',has_cmf_public,'has_uaf_public',has_uaf_public,'market_metric_count',market_metric_count,'function_count',function_count,'source_codes',source_codes,
      'last_seen_at',last_seen_at,'confidence',confidence
    ) order by case operating_status when 'ACTIVE' then 0 when 'LIMITED' then 1 when 'NO_NEW_BUSINESS' then 2 when 'CEASED' then 3 else 4 end,
      coalesce(sii_sales_band_rank,-1) desc,coalesce(sii_workers,0) desc,coalesce(brand,legal_name)) from paged),'[]'::jsonb)
  ) into result;
  return result;
end;
$function$;

revoke all on function public.obs_fintech_search_v2(text,text,text,text,text,text,text,text,integer,integer) from public,anon;
grant execute on function public.obs_fintech_search_v2(text,text,text,text,text,text,text,text,integer,integer) to authenticated;
