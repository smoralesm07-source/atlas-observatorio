-- ATLAS Fintech market-weight runtime, read contracts and Radar integration.

create table if not exists public.aml_fintech_market_weight_run (
  run_id bigint generated always as identity primary key,
  status text not null check(status in ('STARTED','COMPLETED','FAILED')),
  adapter text not null,
  observations_upserted integer not null default 0,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  detail jsonb not null default '{}'::jsonb
);
alter table public.aml_fintech_market_weight_run enable row level security;
revoke all on public.aml_fintech_market_weight_run from anon,authenticated;

create or replace function public.aml_fintech_refresh_market_weight_internal(p_token text)
returns jsonb
language plpgsql
security definer
set search_path='public','atlas_private','pg_temp'
as $fn$
begin
  if not public.aml_fintech_validate_internal_token(p_token) then raise exception 'INVALID_INTERNAL_TOKEN'; end if;
  return atlas_private.aml_fintech_refresh_market_weight();
end
$fn$;
revoke all on function public.aml_fintech_refresh_market_weight_internal(text) from public,anon,authenticated;
grant execute on function public.aml_fintech_refresh_market_weight_internal(text) to service_role;

create or replace function public.aml_fintech_trigger_market_weight()
returns bigint
language plpgsql
security definer
set search_path='public','vault','net','pg_temp'
as $fn$
declare v_token text; v_request bigint;
begin
  select decrypted_secret into v_token from vault.decrypted_secrets where name='atlas_fintech_cron_token' limit 1;
  if v_token is null then raise exception 'FINTECH_CRON_TOKEN_MISSING'; end if;
  select net.http_post(
    url:='https://ldmtlwzqaqmegedktlxr.supabase.co/functions/v1/atlas-fintech-market-weight',
    body:='{"adapter":"all"}'::jsonb,
    headers:=jsonb_build_object('content-type','application/json','x-atlas-cron-token',v_token),
    timeout_milliseconds:=120000
  ) into v_request;
  return v_request;
end
$fn$;
revoke all on function public.aml_fintech_trigger_market_weight() from public,anon,authenticated;
grant execute on function public.aml_fintech_trigger_market_weight() to postgres,service_role;

do $$ begin
  if exists(select 1 from cron.job where jobname='atlas-fintech-market-weight') then perform cron.unschedule('atlas-fintech-market-weight'); end if;
end $$;
select cron.schedule('atlas-fintech-market-weight','37 4 * * *','select public.aml_fintech_trigger_market_weight();');

create or replace function public.obs_fintech_market_weight_status()
returns jsonb
language plpgsql
stable security definer
set search_path='public','extensions','pg_temp'
as $fn$
declare ok boolean; outj jsonb;
begin
  select exists(select 1 from public.aml_allowed_users au where au.user_id=auth.uid() and au.enabled) into ok;
  if not ok then return jsonb_build_object('error','NOT_AUTHORIZED'); end if;
  select jsonb_build_object(
    'observations',(select count(*) from public.aml_fintech_market_metric_observation),
    'subjects_profiled',(select count(distinct subject_type||'|'||subject_key) from public.aml_fintech_market_metric_observation where evidence_type<>'NO_OBSERVABLE'),
    'entities_profiled',(select count(distinct subject_key) from public.aml_fintech_market_metric_observation where subject_type='ENTITY' and evidence_type<>'NO_OBSERVABLE'),
    'candidates_profiled',(select count(distinct subject_key) from public.aml_fintech_market_metric_observation where subject_type='CANDIDATE' and evidence_type<>'NO_OBSERVABLE'),
    'dimensions',coalesce((select jsonb_agg(x order by x.dimension) from (
      select c.dimension,count(distinct o.subject_type||'|'||o.subject_key)::int actors,count(*)::int observations
      from public.aml_fintech_market_metric_observation o join public.aml_fintech_market_metric_catalog c using(metric_code)
      where o.evidence_type<>'NO_OBSERVABLE' group by c.dimension) x),'[]'::jsonb),
    'top_metrics',coalesce((select jsonb_agg(x order by x.actors desc,x.metric_code) from (
      select o.metric_code,c.label,c.dimension,count(distinct o.subject_type||'|'||o.subject_key)::int actors
      from public.aml_fintech_market_metric_observation o join public.aml_fintech_market_metric_catalog c using(metric_code)
      where o.evidence_type<>'NO_OBSERVABLE' group by o.metric_code,c.label,c.dimension limit 12) x),'[]'::jsonb),
    'benchmarks',coalesce((select jsonb_agg(to_jsonb(z) order by z.order_key,z.display_name) from (
      select distinct on(o.subject_type,o.subject_key,o.metric_code)
        o.subject_type,o.subject_key,
        case when o.subject_type='ENTITY' then coalesce(e.brand,e.legal_name,o.subject_key) else coalesce(ca.name_raw,o.subject_key) end display_name,
        o.metric_code,mc.label,mc.dimension,o.value_numeric,o.value_text,o.unit,o.currency,o.qualifier,o.period_start,o.period_end,
        o.evidence_type,o.confidence,o.source_code,o.source_url,o.observed_at,
        case o.metric_code when 'ANNUAL_TRANSACTION_VOLUME_USD' then 1 when 'ANNUALIZED_TRANSACTION_VOLUME_USD_EST' then 2 when 'CUMULATIVE_TRANSACTION_VOLUME_USD' then 3 when 'USERS' then 4 when 'FUNDING_RAISED_USD' then 5 else 9 end order_key
      from public.aml_fintech_market_metric_observation o
      join public.aml_fintech_market_metric_catalog mc using(metric_code)
      left join public.aml_fintech_entity e on o.subject_type='ENTITY' and e.fintech_id=o.subject_key
      left join public.aml_fintech_candidate ca on o.subject_type='CANDIDATE' and ca.candidate_id::text=o.subject_key
      where o.metric_code in ('ANNUAL_TRANSACTION_VOLUME_USD','ANNUALIZED_TRANSACTION_VOLUME_USD_EST','CUMULATIVE_TRANSACTION_VOLUME_USD','USERS','FUNDING_RAISED_USD')
        and o.evidence_type<>'NO_OBSERVABLE'
      order by o.subject_type,o.subject_key,o.metric_code,coalesce(o.period_end,o.period_start) desc nulls last,o.observed_at desc
    ) z),'[]'::jsonb),
    'latest_run',coalesce((select to_jsonb(r) from public.aml_fintech_market_weight_run r order by r.run_id desc limit 1),'null'::jsonb),
    'refreshed_at',(select max(observed_at) from public.aml_fintech_market_metric_observation),
    'methodology','Peso observable por métricas homogéneas. Los percentiles sólo se calculan dentro de la misma métrica y con al menos 3 pares; no existe un score universal.'
  ) into outj;
  return outj;
end
$fn$;
revoke all on function public.obs_fintech_market_weight_status() from public,anon;
grant execute on function public.obs_fintech_market_weight_status() to authenticated;

create or replace function public.obs_fintech_market_weight_detail(p_subject_type text,p_subject_key text)
returns jsonb
language plpgsql
stable security definer
set search_path='public','extensions','pg_temp'
as $fn$
declare ok boolean; outj jsonb;
begin
  select exists(select 1 from public.aml_allowed_users au where au.user_id=auth.uid() and au.enabled) into ok;
  if not ok then return jsonb_build_object('error','NOT_AUTHORIZED'); end if;
  select jsonb_build_object(
    'subject_type',upper(p_subject_type),'subject_key',p_subject_key,
    'metrics',coalesce((select jsonb_agg(to_jsonb(x) order by x.dimension,x.sort_order,x.observed_at desc) from (
      select o.observation_id,o.metric_code,c.label,c.dimension,o.value_numeric,o.value_text,o.unit,o.currency,o.qualifier,
             o.period_start,o.period_end,o.geography,o.evidence_type,o.confidence,o.source_code,o.source_url,o.published_at,o.observed_at,
             o.basis,o.evidence_excerpt,p.peer_count,p.peer_rank,p.percentile,p.tier,c.sort_order
      from public.aml_fintech_market_metric_observation o join public.aml_fintech_market_metric_catalog c using(metric_code)
      left join public.aml_fintech_market_peer_position p on p.subject_type=o.subject_type and p.subject_key=o.subject_key and p.metric_code=o.metric_code and p.peer_group=o.metric_code
      where o.subject_type=upper(p_subject_type) and o.subject_key=p_subject_key
    ) x),'[]'::jsonb),
    'dimensions',coalesce((select jsonb_agg(to_jsonb(d) order by case d.dimension when 'ECONOMIC_SCALE' then 1 when 'BUSINESS_ACTIVITY' then 2 when 'REACH' then 3 else 4 end)
      from public.aml_fintech_market_dimension_snapshot d where d.subject_type=upper(p_subject_type) and d.subject_key=p_subject_key),'[]'::jsonb),
    'note','No se suman TPV, AUM, capital levantado, ventas ni volumen cripto. Cada métrica conserva su significado, período, fuente y tipo de evidencia.'
  ) into outj;
  return outj;
end
$fn$;
revoke all on function public.obs_fintech_market_weight_detail(text,text) from public,anon;
grant execute on function public.obs_fintech_market_weight_detail(text,text) to authenticated;

-- Wire current Radar cards and entity detail to the new market-weight observations.
create or replace function public.obs_fintech_entity_detail(p_fintech_id text)
returns jsonb
language plpgsql
stable security definer
set search_path='public','extensions','pg_temp'
as $fn$
declare ok boolean; result jsonb;
begin
  select exists(select 1 from public.aml_allowed_users au where au.user_id=auth.uid() and au.enabled) into ok;
  if not ok then return jsonb_build_object('error','NOT_AUTHORIZED'); end if;
  select jsonb_build_object(
    'entity',to_jsonb(e),
    'activities',coalesce((select jsonb_agg(to_jsonb(a) order by a.is_primary desc,a.activity_label) from public.aml_fintech_activity a where a.fintech_id=e.fintech_id),'[]'::jsonb),
    'regulation',coalesce((select jsonb_agg(to_jsonb(r) order by r.regulator,r.registry,r.service) from public.aml_fintech_regulatory_status r where r.fintech_id=e.fintech_id),'[]'::jsonb),
    'market_metrics',coalesce((select jsonb_agg(jsonb_build_object(
      'metric_id',o.observation_id,'metric_code',o.metric_code,'value_numeric',o.value_numeric,'value_text',o.value_text,'unit',o.unit,
      'currency',o.currency,'period_start',o.period_start,'period_end',o.period_end,'evidence_type',o.evidence_type,
      'confidence',o.confidence,'source_code',o.source_code,'source_url',o.source_url,'observed_at',o.observed_at
    ) order by coalesce(o.period_end,o.period_start) desc nulls last,o.observed_at desc)
    from public.aml_fintech_market_metric_observation o where o.subject_type='ENTITY' and o.subject_key=e.fintech_id),'[]'::jsonb),
    'events',coalesce((select jsonb_agg(to_jsonb(ev) order by ev.event_date desc nulls last,ev.observed_at desc) from public.aml_fintech_event ev where ev.fintech_id=e.fintech_id),'[]'::jsonb),
    'sources',coalesce((select jsonb_agg(jsonb_build_object('source_code',es.source_code,'source_label',es.source_label,'source_url',es.source_url,'status',es.status,'evidence',es.evidence,'first_seen_at',es.first_seen_at,'last_seen_at',es.last_seen_at,'catalog_label',sc.label,'authority_level',sc.authority_level) order by sc.authority_level,sc.label) from public.aml_fintech_entity_source es join public.aml_fintech_source_catalog sc using(source_code) where es.fintech_id=e.fintech_id),'[]'::jsonb),
    'market_weight',jsonb_build_object(
      'sales_band',e.sii_sales_band,'sales_band_rank',e.sii_sales_band_rank,'workers',e.sii_workers,
      'metric_count',(select count(*) from public.aml_fintech_market_metric_observation o where o.subject_type='ENTITY' and o.subject_key=e.fintech_id and o.evidence_type<>'NO_OBSERVABLE'),
      'dimensions',coalesce((select jsonb_agg(to_jsonb(d) order by d.dimension) from public.aml_fintech_market_dimension_snapshot d where d.subject_type='ENTITY' and d.subject_key=e.fintech_id),'[]'::jsonb),
      'note','Escala observable por dimensiones separadas y métricas comparables sólo dentro de la misma métrica. No constituye un score de riesgo ni un ranking universal.'
    ),
    'boundary_note','Ficha construida sólo con fuentes abiertas. Los datos reservados UAF deben incorporarse únicamente en el estudio posterior y fuera de ATLAS.'
  ) into result from public.aml_v_fintech_entity_current e where e.fintech_id=p_fintech_id;
  return result;
end
$fn$;

-- Keep the existing dashboard contract but count the new observations.
create or replace function public.obs_fintech_dashboard()
returns jsonb
language plpgsql
stable security definer
set search_path='public','extensions','pg_temp'
as $fn$
declare ok boolean; result jsonb;
begin
  select exists(select 1 from public.aml_allowed_users au where au.user_id=auth.uid() and au.enabled) into ok;
  if not ok then return jsonb_build_object('error','NOT_AUTHORIZED'); end if;
  with e as (select * from public.aml_v_fintech_entity_current),
  verticals as (select coalesce(primary_vertical,'Por clasificar') label,count(*)::int count from e group by 1 order by 2 desc),
  models as (select coalesce(business_model,'Por clasificar') label,count(*)::int count from e group by 1 order by 2 desc),
  candidate_stats as (select source_code,count(*)::int candidate_count,count(*) filter(where matched_fintech_id is not null)::int matched_count,count(*) filter(where matched_fintech_id is null)::int unresolved_count,max(last_seen_at) last_candidate_at from public.aml_fintech_candidate group by source_code),
  identity_stats as (select count(*) filter(where c.matched_fintech_id is null and sc.entity_id is not null)::int identity_resolved_pending from public.aml_fintech_candidate c left join public.aml_sii_registry_company sc on sc.rut=c.rut_raw where c.source_code='CMF_RPSF'),
  sources as (
    select s.source_code,s.label,s.source_type,s.authority_level,s.cadence,s.source_url,
      case when coalesce(cs.candidate_count,0)>0 then coalesce(s.notes,'') || ' Descubrimiento: '||cs.candidate_count||' observados · '||cs.matched_count||' vinculados · '||cs.unresolved_count||' pendientes.' else s.notes end notes,
      greatest(s.refreshed_at,coalesce(cs.last_candidate_at,s.refreshed_at)) refreshed_at,
      (select count(*) from public.aml_fintech_entity_source es where es.source_code=s.source_code and es.status='OBSERVED')::int entity_count,
      coalesce(cs.candidate_count,0)::int candidate_count,coalesce(cs.unresolved_count,0)::int unresolved_count
    from public.aml_fintech_source_catalog s left join candidate_stats cs using(source_code) where s.active order by s.authority_level,s.label
  ),
  universe as (select us.*,sc.label source_label from public.aml_fintech_universe_snapshot us join public.aml_fintech_source_catalog sc using(source_code) order by source_date desc),
  discovery as (select count(*)::int total_candidates,count(*) filter(where matched_fintech_id is not null)::int matched_candidates,count(*) filter(where matched_fintech_id is null)::int unresolved_candidates,max(last_seen_at) refreshed_at from public.aml_fintech_candidate)
  select jsonb_build_object(
    'national',jsonb_build_object(
      'atlas_confirmed',(select count(*) from e),'with_rut',(select count(*) from e where rut is not null),
      'with_cmf_public',(select count(*) from e where has_cmf_public),'with_uaf_public',(select count(*) from e where has_uaf_public),
      'psav_confirmed',(select count(*) from e where psav_status='CONFIRMED'),'psav_probable',(select count(*) from e where psav_status='PROBABLE'),
      'business_model_classified',(select count(*) from e where business_model is not null),
      'with_market_metrics',(select count(distinct subject_key) from public.aml_fintech_market_metric_observation where subject_type='ENTITY' and evidence_type<>'NO_OBSERVABLE'),
      'refreshed_at',greatest((select max(refreshed_at) from e),(select refreshed_at from discovery),(select max(observed_at) from public.aml_fintech_market_metric_observation))
    ),
    'discovery',jsonb_build_object('total_candidates',(select total_candidates from discovery),'matched_candidates',(select matched_candidates from discovery),'unresolved_candidates',(select unresolved_candidates from discovery),'identity_resolved_pending',(select identity_resolved_pending from identity_stats),'refreshed_at',(select refreshed_at from discovery),'rule','Un candidato no integra el universo confirmado hasta que su pertenencia al mercado y su identidad hayan sido resueltas con evidencia abierta trazable.'),
    'universe_snapshots',(select coalesce(jsonb_agg(jsonb_build_object('snapshot_key',snapshot_key,'source_code',source_code,'source_label',source_label,'source_date',source_date,'reported_total',reported_total,'local_total',local_total,'foreign_total',foreign_total,'sample_size',sample_size,'methodology_note',methodology_note,'source_url',source_url,'metadata',metadata) order by source_date desc),'[]'::jsonb) from universe),
    'verticals',(select coalesce(jsonb_agg(jsonb_build_object('label',label,'count',count) order by count desc),'[]'::jsonb) from verticals),
    'business_models',(select coalesce(jsonb_agg(jsonb_build_object('label',label,'count',count) order by count desc),'[]'::jsonb) from models),
    'sources',(select coalesce(jsonb_agg(to_jsonb(sources) order by label),'[]'::jsonb) from sources),
    'semantics',jsonb_build_object(
      'mission','Inteligencia de mercado y caracterización del ecosistema Fintech/PSAV con fuentes abiertas. No es un módulo de riesgo LA/FT.',
      'universe','Las cifras sectoriales son cortes de fuente. ATLAS mantiene cada corte y construye por separado su universo individualizado y deduplicado.',
      'market_weight','El peso de mercado se construye por métricas homogéneas y dimensiones separadas. La ausencia de una métrica abierta no implica baja escala.',
      'reserved_boundary','Este radar no incorpora ROS, ROE ni información reservada UAF. Su salida está diseñada para ser congelada y exportada como contexto abierto para estudios posteriores fuera de ATLAS.'
    )
  ) into result;
  return result;
end
$fn$;