create or replace view public.aml_v_fintech_entity_current
with (security_invoker=true)
as
select
    f.fintech_id,
    f.atlas_entity_id,
    f.rut,
    f.brand,
    f.legal_name,
    f.website,
    f.origin_country,
    f.presence_chile,
    f.entity_status,
    f.identification_status,
    f.identification_basis,
    f.primary_vertical,
    f.business_model,
    f.target_customer,
    f.revenue_model,
    f.psav_status,
    f.confidence,
    f.first_seen_at,
    f.last_seen_at,
    f.refreshed_at,
    u.region,
    u.commune,
    u.sii_main_activity,
    u.sii_economic_sector,
    u.sii_sales_band,
    u.sii_sales_band_rank,
    u.sii_workers,
    u.sii_activity_start_date,
    u.uaf_sector_canonical,
    exists(select 1 from public.aml_fintech_regulatory_status r where r.fintech_id=f.fintech_id and r.regulator='CMF' and r.status in ('VIGENTE','AUTORIZADO','INSCRITO')) as has_cmf_public,
    exists(select 1 from public.aml_fintech_regulatory_status r where r.fintech_id=f.fintech_id and r.regulator='UAF' and r.status='INSCRITO_PUBLICADO') as has_uaf_public,
    (select count(*) from public.aml_fintech_market_metric m where m.fintech_id=f.fintech_id) as market_metric_count,
    (select max(m.observed_at) from public.aml_fintech_market_metric m where m.fintech_id=f.fintech_id) as market_metric_last_at,
    f.operating_status,
    f.operating_status_basis,
    f.operating_status_source_code,
    f.operating_status_source_url,
    f.operating_status_as_of,
    f.actor_kind,
    f.lifecycle_basis,
    f.lifecycle_validated_at
from public.aml_fintech_entity f
left join public.aml_uaf_obligated_subject_snapshot u on u.entity_id=f.atlas_entity_id;

revoke all on public.aml_v_fintech_entity_current from public,anon,authenticated;
grant select on public.aml_v_fintech_entity_current to service_role;

create or replace function public.obs_fintech_search(
  p_q text default null,
  p_vertical text default null,
  p_model text default null,
  p_psav text default null,
  p_regulator text default null,
  p_limit integer default 25,
  p_offset integer default 0
) returns jsonb
language plpgsql
stable security definer
set search_path to 'public','extensions','pg_temp'
as $$
declare ok boolean; result jsonb;
begin
  select exists(select 1 from public.aml_allowed_users au where au.user_id=auth.uid() and au.enabled) into ok;
  if not ok then return jsonb_build_object('error','NOT_AUTHORIZED'); end if;
  with filtered as (
    select e.*
    from public.aml_v_fintech_entity_current e
    where (p_q is null or btrim(p_q)='' or public.obs_normalize_text(coalesce(e.brand,'')) like '%'||public.obs_normalize_text(btrim(p_q))||'%' or public.obs_normalize_text(e.legal_name) like '%'||public.obs_normalize_text(btrim(p_q))||'%' or regexp_replace(upper(coalesce(e.rut,'')),'[^0-9K]','','g') like '%'||regexp_replace(upper(btrim(p_q)),'[^0-9K]','','g')||'%')
      and (p_vertical is null or p_vertical='' or e.primary_vertical=p_vertical)
      and (p_model is null or p_model='' or coalesce(e.business_model,'Por clasificar')=p_model)
      and (p_psav is null or p_psav='' or p_psav='TODOS' or e.psav_status=p_psav)
      and (p_regulator is null or p_regulator='' or p_regulator='TODOS' or (p_regulator='CMF' and e.has_cmf_public) or (p_regulator='UAF' and e.has_uaf_public))
  ), pg as (
    select * from filtered
    order by case operating_status when 'ACTIVE' then 0 when 'LIMITED' then 1 when 'NO_NEW_BUSINESS' then 2 when 'CEASED' then 3 else 4 end,
             coalesce(sii_sales_band_rank,-1) desc,coalesce(sii_workers,0) desc,legal_name
    limit greatest(1,least(coalesce(p_limit,25),100)) offset greatest(coalesce(p_offset,0),0)
  )
  select jsonb_build_object(
    'total',(select count(*) from filtered),
    'rows',coalesce((select jsonb_agg(jsonb_build_object(
      'fintech_id',fintech_id,'atlas_entity_id',atlas_entity_id,'rut',rut,'brand',brand,'legal_name',legal_name,
      'vertical',primary_vertical,'business_model',business_model,'target_customer',target_customer,'revenue_model',revenue_model,'psav_status',psav_status,
      'operating_status',operating_status,'operating_status_as_of',operating_status_as_of,'actor_kind',actor_kind,
      'region',region,'commune',commune,'sii_main_activity',sii_main_activity,'sales_band',sii_sales_band,'sales_band_rank',sii_sales_band_rank,'workers',sii_workers,
      'has_cmf_public',has_cmf_public,'has_uaf_public',has_uaf_public,'market_metric_count',market_metric_count,'last_seen_at',last_seen_at,'confidence',confidence
    ) order by case operating_status when 'ACTIVE' then 0 when 'LIMITED' then 1 when 'NO_NEW_BUSINESS' then 2 when 'CEASED' then 3 else 4 end,
      coalesce(sii_sales_band_rank,-1) desc,coalesce(sii_workers,0) desc,legal_name) from pg),'[]'::jsonb)
  ) into result;
  return result;
end;
$$;

create or replace function public.obs_fintech_entity_detail(p_fintech_id text)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public','extensions','pg_temp'
as $$
declare ok boolean; result jsonb;
begin
  select exists(select 1 from public.aml_allowed_users au where au.user_id=auth.uid() and au.enabled) into ok;
  if not ok then return jsonb_build_object('error','NOT_AUTHORIZED'); end if;
  select jsonb_build_object(
    'entity',to_jsonb(e),
    'aliases',coalesce((select jsonb_agg(to_jsonb(al) order by al.active desc,al.alias_type,al.alias_text) from public.aml_fintech_actor_alias al where al.fintech_id=e.fintech_id),'[]'::jsonb),
    'legal_vehicles',coalesce((select jsonb_agg(to_jsonb(v) order by v.is_primary desc,v.role_code,v.legal_name) from public.aml_fintech_legal_vehicle v where v.fintech_id=e.fintech_id),'[]'::jsonb),
    'relationships',coalesce((
      select jsonb_agg(to_jsonb(x) order by x.confidence desc,x.relation_type,x.target_label)
      from (
        select r.*
        from public.aml_fintech_subject_relationship r
        where r.active=true and (
          (r.subject_type='ENTITY' and r.subject_key=e.fintech_id)
          or (r.subject_type='CANDIDATE' and exists(select 1 from public.aml_fintech_candidate c where c.candidate_id::text=r.subject_key and c.matched_fintech_id=e.fintech_id))
        )
      ) x
    ),'[]'::jsonb),
    'activities',coalesce((select jsonb_agg(to_jsonb(a) order by a.is_primary desc,a.activity_label) from public.aml_fintech_activity a where a.fintech_id=e.fintech_id),'[]'::jsonb),
    'regulation',coalesce((select jsonb_agg(to_jsonb(r) order by r.regulator,r.registry,r.service) from public.aml_fintech_regulatory_status r where r.fintech_id=e.fintech_id),'[]'::jsonb),
    'market_metrics',coalesce((select jsonb_agg(jsonb_build_object('metric_id',o.observation_id,'metric_code',o.metric_code,'value_numeric',o.value_numeric,'value_text',o.value_text,'unit',o.unit,'currency',o.currency,'period_start',o.period_start,'period_end',o.period_end,'evidence_type',o.evidence_type,'confidence',o.confidence,'source_code',o.source_code,'source_url',o.source_url,'observed_at',o.observed_at) order by coalesce(o.period_end,o.period_start) desc nulls last,o.observed_at desc) from public.aml_fintech_market_metric_observation o where o.subject_type='ENTITY' and o.subject_key=e.fintech_id),'[]'::jsonb),
    'events',coalesce((select jsonb_agg(to_jsonb(ev) order by ev.event_date desc nulls last,ev.observed_at desc) from public.aml_fintech_event ev where ev.fintech_id=e.fintech_id),'[]'::jsonb),
    'sources',coalesce((select jsonb_agg(jsonb_build_object('source_code',es.source_code,'source_label',es.source_label,'source_url',es.source_url,'status',es.status,'evidence',es.evidence,'first_seen_at',es.first_seen_at,'last_seen_at',es.last_seen_at,'catalog_label',sc.label,'authority_level',sc.authority_level) order by sc.authority_level,sc.label) from public.aml_fintech_entity_source es join public.aml_fintech_source_catalog sc using(source_code) where es.fintech_id=e.fintech_id),'[]'::jsonb),
    'market_weight',jsonb_build_object('sales_band',e.sii_sales_band,'sales_band_rank',e.sii_sales_band_rank,'workers',e.sii_workers,'metric_count',(select count(*) from public.aml_fintech_market_metric_observation o where o.subject_type='ENTITY' and o.subject_key=e.fintech_id and o.evidence_type<>'NO_OBSERVABLE'),'dimensions',coalesce((select jsonb_agg(to_jsonb(d) order by d.dimension) from public.aml_fintech_market_dimension_snapshot d where d.subject_type='ENTITY' and d.subject_key=e.fintech_id),'[]'::jsonb),'note','Escala observable: combina dimensiones separadas y métricas comparables sólo dentro de la misma métrica. No constituye un score de riesgo ni un ranking universal.'),
    'fatf_context',public.aml_fintech_fatf_profile_internal(e.fintech_id)||jsonb_build_object('characterization_themes',public.aml_fintech_fatf_theme_profile_internal(e.fintech_id)),
    'boundary_note','Ficha construida sólo con fuentes abiertas. El estado operativo distingue vigencia jurídica de actividad comercial observada. El contexto GAFI indica pertinencia funcional y no constituye evaluación de riesgo, cumplimiento ni conclusión jurídica. Los datos reservados UAF deben incorporarse únicamente en el estudio posterior y fuera de ATLAS.'
  ) into result from public.aml_v_fintech_entity_current e where e.fintech_id=p_fintech_id;
  return result;
end;
$$;

revoke all on function public.obs_fintech_search(text,text,text,text,text,integer,integer) from public,anon;
revoke all on function public.obs_fintech_entity_detail(text) from public,anon;
grant execute on function public.obs_fintech_search(text,text,text,text,text,integer,integer) to authenticated;
grant execute on function public.obs_fintech_entity_detail(text) to authenticated;