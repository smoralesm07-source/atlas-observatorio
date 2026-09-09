create or replace function public.obs_fintech_dashboard_v2()
returns jsonb
language plpgsql
stable security definer
set search_path to 'public','extensions','pg_temp'
as $function$
declare
  ok boolean;
  result jsonb;
begin
  select exists(select 1 from public.aml_allowed_users au where au.user_id=auth.uid() and au.enabled) into ok;
  if not ok then return jsonb_build_object('error','NOT_AUTHORIZED'); end if;

  with e as (
    select * from public.aml_v_fintech_entity_current
  ), latest_cov as (
    select * from public.aml_fintech_ecosystem_coverage_snapshot order by snapshot_id desc limit 1
  ), latest_ref as (
    select * from public.aml_fintech_universe_snapshot order by source_date desc, ingested_at desc limit 1
  ), verticals as (
    select coalesce(primary_vertical,'Por clasificar') label,count(*)::int count
    from e group by 1 order by 2 desc,1
  ), models as (
    select coalesce(business_model,'Por clasificar') label,count(*)::int count
    from e group by 1 order by 2 desc,1
  ), operating as (
    select operating_status label,count(*)::int count
    from e group by 1 order by 2 desc,1
  ), regions as (
    select coalesce(region,'Sin región') label,count(*)::int count
    from e group by 1 order by 2 desc,1
  ), actor_kinds as (
    select coalesce(actor_kind,'SIN_DATO') label,count(*)::int count
    from e group by 1 order by 2 desc,1
  ), source_base as (
    select s.source_code,s.label,s.authority_level,s.source_type,s.source_url,s.notes,
      (select count(*)::int from public.aml_fintech_entity_source es where es.source_code=s.source_code and es.status='OBSERVED') entity_count,
      (select count(*)::int from public.aml_fintech_candidate c where c.source_code=s.source_code) candidate_count,
      (select count(*)::int from public.aml_fintech_subject_relationship r where r.source_code=s.source_code and r.active) relationship_count
    from public.aml_fintech_source_catalog s
    where s.active and s.source_code in (
      'FINTECHILE_EY','FINNOVISTA','FINTECHILE_MEMBERS','LATAMFINTECH_CHILE','SII_PUBLIC','CMF_RPSF','UAF_PUBLIC','RES_PUBLIC','INAPI_PUBLIC','COMPANY_OFFICIAL','PRESS_OPEN'
    )
  ), sources as (
    select source_code,label,authority_level,source_type,source_url,notes,entity_count,candidate_count,relationship_count,
      case source_code
        when 'FINTECHILE_EY' then 'Referencia agregada del mercado y tendencias sectoriales'
        when 'FINNOVISTA' then 'Referencia histórica y comparación temporal del ecosistema'
        when 'FINTECHILE_MEMBERS' then 'Directorio sectorial para descubrimiento y pertenencia al ecosistema'
        when 'LATAMFINTECH_CHILE' then 'Discovery complementario de actores con presencia en Chile'
        when 'SII_PUBLIC' then 'Identidad tributaria, actividad económica y escala abierta'
        when 'CMF_RPSF' then 'Huella regulatoria pública y servicios Ley Fintec'
        when 'UAF_PUBLIC' then 'Condición pública de sujeto obligado inscrito, sin datos reservados'
        when 'RES_PUBLIC' then 'Vehículos legales, constitución y hechos societarios'
        when 'INAPI_PUBLIC' then 'Titularidad de marcas y relaciones marca–vehículo'
        when 'COMPANY_OFFICIAL' then 'Vigencia, producto, cliente y evidencia primaria corporativa'
        when 'PRESS_OPEN' then 'Eventos de mercado: rondas, adquisiciones, expansión y cierres'
        else coalesce(notes,'Fuente abierta')
      end role,
      case source_code
        when 'FINTECHILE_EY' then (select reported_total::int from latest_ref)
        when 'FINNOVISTA' then coalesce((select reported_total::int from public.aml_fintech_universe_snapshot where source_code='FINNOVISTA' order by source_date desc limit 1),0)
        when 'INAPI_PUBLIC' then relationship_count
        when 'COMPANY_OFFICIAL' then greatest(entity_count,relationship_count)
        else greatest(entity_count,candidate_count)
      end volume
    from source_base
  ), refs as (
    select us.snapshot_key,us.source_code,sc.label source_label,us.source_date,us.reported_total,us.local_total,us.foreign_total,us.sample_size,us.methodology_note,us.source_url
    from public.aml_fintech_universe_snapshot us
    left join public.aml_fintech_source_catalog sc using(source_code)
    order by us.source_date desc
  ), segments as (
    select segment_label,count_2024,count_2026,(count_2026-count_2024)::int delta,
      case when count_2024>0 then round(((count_2026-count_2024)::numeric/count_2024)*100,1) else null end growth_pct,
      source_url,methodology_note
    from public.aml_fintech_reference_segment_snapshot
    where snapshot_key='FINNOVISTA_SEGMENTS_2026'
    order by count_2026 desc,segment_label
  ), recent_events as (
    select ev.event_id,ev.fintech_id,coalesce(e.brand,e.legal_name,ev.fintech_id) entity_name,ev.event_type,ev.event_date,ev.title,ev.summary,ev.source_code,ev.source_url
    from public.aml_fintech_event ev
    left join public.aml_fintech_entity e on e.fintech_id=ev.fintech_id
    where ev.event_type not in ('CMF_RPSF_REGISTRATION')
    order by ev.event_date desc nulls last,ev.observed_at desc
    limit 8
  ), coverage as (
    select jsonb_build_array(
      jsonb_build_object('label','Identidad con RUT chileno','count',(select count(*) from e where rut is not null),'total',(select count(*) from e),'code','IDENTITY'),
      jsonb_build_object('label','Modelo de negocio','count',(select count(*) from e where business_model is not null),'total',(select count(*) from e),'code','MODEL'),
      jsonb_build_object('label','Cliente objetivo','count',(select count(*) from e where target_customer is not null),'total',(select count(*) from e),'code','CUSTOMER'),
      jsonb_build_object('label','Monetización','count',(select count(*) from e where revenue_model is not null),'total',(select count(*) from e),'code','REVENUE'),
      jsonb_build_object('label','Perfil funcional','count',(select count(distinct subject_key) from public.aml_fintech_function_observation where subject_type='ENTITY'),'total',(select count(*) from e),'code','FUNCTION'),
      jsonb_build_object('label','Vigencia operativa validada','count',(select count(*) from e where operating_status<>'UNKNOWN'),'total',(select count(*) from e),'code','OPERATING'),
      jsonb_build_object('label','Métricas de mercado','count',(select count(distinct subject_key) from public.aml_fintech_market_metric_observation where subject_type='ENTITY' and evidence_type<>'NO_OBSERVABLE'),'total',(select count(*) from e),'code','MARKET')
    ) rows
  )
  select jsonb_build_object(
    'national',jsonb_build_object(
      'reference_total',(select reported_total from latest_ref),
      'reference_local',(select local_total from latest_ref),
      'reference_foreign',(select foreign_total from latest_ref),
      'reference_date',(select source_date from latest_ref),
      'reference_source',(select source_code from latest_ref),
      'sector_observed',(select sector_observed_unique from latest_cov),
      'semantic_resolved',(select semantic_resolved_unique from latest_cov),
      'semantic_product_resolved',(select semantic_product_resolved_unique from latest_cov),
      'semantic_out_of_scope',(select semantic_out_of_scope_unique from latest_cov),
      'atlas_confirmed',(select count(*) from e),
      'with_rut',(select count(*) from e where rut is not null),
      'without_rut',(select count(*) from e where rut is null),
      'with_cmf_public',(select count(*) from e where has_cmf_public),
      'with_uaf_public',(select count(*) from e where has_uaf_public),
      'psav_confirmed',(select count(*) from e where psav_status='CONFIRMED'),
      'business_model_classified',(select count(*) from e where business_model is not null),
      'target_customer_classified',(select count(*) from e where target_customer is not null),
      'revenue_model_classified',(select count(*) from e where revenue_model is not null),
      'function_profiled',(select count(distinct subject_key) from public.aml_fintech_function_observation where subject_type='ENTITY'),
      'with_market_metrics',(select count(distinct subject_key) from public.aml_fintech_market_metric_observation where subject_type='ENTITY' and evidence_type<>'NO_OBSERVABLE'),
      'operating_validated',(select count(*) from e where operating_status<>'UNKNOWN'),
      'operating_unknown',(select count(*) from e where operating_status='UNKNOWN'),
      'structural_events',(select count(*) from public.aml_fintech_event where event_type not in ('CMF_RPSF_REGISTRATION')),
      'refreshed_at',greatest((select max(refreshed_at) from e),(select max(observed_at) from public.aml_fintech_event),(select max(observed_at) from public.aml_fintech_market_metric_observation))
    ),
    'universe_snapshots',(select coalesce(jsonb_agg(to_jsonb(refs) order by source_date desc),'[]'::jsonb) from refs),
    'sources',(select coalesce(jsonb_agg(to_jsonb(sources) order by case source_code when 'FINTECHILE_EY' then 1 when 'FINNOVISTA' then 2 when 'FINTECHILE_MEMBERS' then 3 when 'LATAMFINTECH_CHILE' then 4 when 'SII_PUBLIC' then 5 when 'CMF_RPSF' then 6 when 'UAF_PUBLIC' then 7 when 'RES_PUBLIC' then 8 when 'INAPI_PUBLIC' then 9 when 'COMPANY_OFFICIAL' then 10 else 11 end),'[]'::jsonb) from sources),
    'reference_segments',(select coalesce(jsonb_agg(to_jsonb(segments) order by count_2026 desc),'[]'::jsonb) from segments),
    'verticals',(select coalesce(jsonb_agg(jsonb_build_object('label',label,'count',count) order by count desc),'[]'::jsonb) from verticals),
    'business_models',(select coalesce(jsonb_agg(jsonb_build_object('label',label,'count',count) order by count desc),'[]'::jsonb) from models),
    'operating_status',(select coalesce(jsonb_agg(jsonb_build_object('label',label,'count',count) order by count desc),'[]'::jsonb) from operating),
    'regions',(select coalesce(jsonb_agg(jsonb_build_object('label',label,'count',count) order by count desc),'[]'::jsonb) from regions),
    'actor_kinds',(select coalesce(jsonb_agg(jsonb_build_object('label',label,'count',count) order by count desc),'[]'::jsonb) from actor_kinds),
    'coverage',(select rows from coverage),
    'recent_events',(select coalesce(jsonb_agg(to_jsonb(recent_events) order by event_date desc nulls last),'[]'::jsonb) from recent_events),
    'filters',jsonb_build_object(
      'regions',(select coalesce(jsonb_agg(label order by label),'[]'::jsonb) from regions where label<>'Sin región'),
      'verticals',(select coalesce(jsonb_agg(label order by label),'[]'::jsonb) from verticals where label<>'Por clasificar'),
      'models',(select coalesce(jsonb_agg(label order by label),'[]'::jsonb) from models where label<>'Por clasificar'),
      'sources',(select coalesce(jsonb_agg(jsonb_build_object('code',source_code,'label',label) order by label),'[]'::jsonb) from sources where volume>0)
    ),
    'semantics',jsonb_build_object(
      'universe','Los 557 corresponden al corte sectorial FinteChile/EY 2026. ATLAS mantiene por separado el universo individualizado y deduplicado, evitando convertir marcas, productos o directorios en personas jurídicas ficticias.',
      'coverage','La cobertura analítica muestra cuánto del universo confirmado tiene cada atributo efectivamente respaldado. Un dato ausente se mantiene como no observado; no se imputa.',
      'segments','La comparación 2024–2026 usa conteos agregados del Mapa Fintech 2026/Finnovista y sirve para leer cambios del sector, no para inferir altas o bajas nominales.',
      'boundary','Sólo fuentes abiertas. No incorpora ROS, ROE ni información reservada UAF y no constituye evaluación de riesgo LA/FT.'
    )
  ) into result;
  return result;
end;
$function$;

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
begin
  select exists(select 1 from public.aml_allowed_users au where au.user_id=auth.uid() and au.enabled) into ok;
  if not ok then return jsonb_build_object('error','NOT_AUTHORIZED'); end if;

  with filtered as (
    select e.*,
      coalesce((select jsonb_agg(es.source_code order by es.source_code) from public.aml_fintech_entity_source es where es.fintech_id=e.fintech_id and es.status='OBSERVED'),'[]'::jsonb) source_codes,
      (select count(*) from public.aml_fintech_function_observation fo where fo.subject_type='ENTITY' and fo.subject_key=e.fintech_id)::int function_count
    from public.aml_v_fintech_entity_current e
    where (p_q is null or btrim(p_q)='' or public.obs_normalize_text(coalesce(e.brand,'')) like '%'||public.obs_normalize_text(btrim(p_q))||'%' or public.obs_normalize_text(e.legal_name) like '%'||public.obs_normalize_text(btrim(p_q))||'%' or regexp_replace(upper(coalesce(e.rut,'')),'[^0-9K]','','g') like '%'||regexp_replace(upper(btrim(p_q)),'[^0-9K]','','g')||'%')
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

revoke all on function public.obs_fintech_dashboard_v2() from public,anon;
revoke all on function public.obs_fintech_search_v2(text,text,text,text,text,text,text,text,integer,integer) from public,anon;
grant execute on function public.obs_fintech_dashboard_v2() to authenticated;
grant execute on function public.obs_fintech_search_v2(text,text,text,text,text,text,text,text,integer,integer) to authenticated;
