-- ATLAS Observatorio · Sanciones agrupadas por acto/resolución
-- Una sanción/caso se identifica por entidad + supervisor + resolución pública.
-- Si no existe resolución, se usa el documento y, como último recurso, el event_id.
-- Los montos se deduplican por hecho/evidencia para no multiplicar un mismo monto
-- cuando una resolución contiene varias medidas (reparo, disciplinaria, remisiones, etc.).

create or replace view public.aml_v_sanctions_cases_current_v1
with (security_invoker = true)
as
with raw as (
  select
    r.*,
    'SAN-' || substr(
      md5(concat_ws('|',
        coalesce(
          nullif(r.entity_key,''),
          nullif(r.rut,''),
          nullif(lower(trim(r.canonical_name)),''),
          nullif(lower(trim(r.source_entity_name)),''),
          r.event_id
        ),
        upper(coalesce(r.regulator,'')),
        case
          when nullif(trim(coalesce(r.resolution_ref,'')),'') is not null then 'RES:' || trim(r.resolution_ref)
          when nullif(trim(coalesce(r.document_url,'')),'') is not null then 'DOC:' || trim(r.document_url)
          else 'EVT:' || r.event_id
        end
      )),
      1, 20
    ) as sanction_case_id
  from public.aml_v_sanctions_radiography_current_v0960 r
),
amount_atoms as (
  select
    sanction_case_id,
    coalesce(amount_clp,0)::numeric as amount_clp,
    coalesce(amount_uf,0)::double precision as amount_uf
  from raw
  group by
    sanction_case_id,
    coalesce(reason,''),
    coalesce(amount_clp,0),
    coalesce(amount_uf,0)
),
amounts as (
  select
    sanction_case_id,
    sum(amount_clp)::numeric as amount_clp,
    sum(amount_uf)::double precision as amount_uf
  from amount_atoms
  group by sanction_case_id
)
select
  r.sanction_case_id as event_id,
  min(r.event_id) as representative_event_id,
  max(r.event_date) as event_date,
  max(r.event_year) as event_year,
  max(r.regulator) as regulator,
  case when count(distinct r.event_class) = 1 then max(r.event_class) else 'MULTI_CLASS' end as event_class,
  (array_agg(distinct r.event_kind order by r.event_kind)
    filter (where nullif(r.event_kind,'') is not null))[1] as event_kind,
  coalesce(
    array_agg(distinct r.event_class order by r.event_class)
      filter (where nullif(r.event_class,'') is not null),
    array[]::text[]
  ) as event_classes,
  coalesce(
    array_agg(distinct r.event_kind order by r.event_kind)
      filter (where nullif(r.event_kind,'') is not null),
    array[]::text[]
  ) as event_kinds,
  bool_or(coalesce(r.sanction_record,false)) as sanction_record,
  max(r.entity_id) as entity_id,
  max(r.entity_key) as entity_key,
  max(r.rut) as rut,
  max(r.canonical_name) as canonical_name,
  max(r.source_entity_name) as source_entity_name,
  max(r.entity_type) as entity_type,
  max(r.identity_status) as identity_status,
  max(r.identity_method) as identity_method,
  max(r.identity_confidence) as identity_confidence,
  max(r.region) as region,
  max(r.commune) as commune,
  max(r.territory_basis) as territory_basis,
  max(r.current_condition) as current_condition,
  max(r.condition_basis) as condition_basis,
  bool_or(coalesce(r.is_uaf_registered,false)) as is_uaf_registered,
  bool_or(coalesce(r.is_potential_screening,false)) as is_potential_screening,
  max(r.uaf_sector) as uaf_sector,
  bool_or(coalesce(r.is_osfl_observed,false)) as is_osfl_observed,
  bool_or(coalesce(r.is_res_observed,false)) as is_res_observed,
  a.amount_uf,
  a.amount_clp,
  (array_agg(r.reason order by length(coalesce(r.reason,'')) desc)
    filter (where nullif(r.reason,'') is not null))[1] as reason,
  coalesce(
    array_agg(distinct r.reason)
      filter (where nullif(r.reason,'') is not null),
    array[]::text[]
  ) as reasons,
  max(r.resolution_ref) as resolution_ref,
  max(r.document_url) as document_url,
  max(r.document_quality) as document_quality,
  max(r.document_excerpt) as document_excerpt,
  (array_agg(distinct r.cgr_stage order by r.cgr_stage)
    filter (where nullif(r.cgr_stage,'') is not null))[1] as cgr_stage,
  (array_agg(distinct r.cgr_risk_family order by r.cgr_risk_family)
    filter (where nullif(r.cgr_risk_family,'') is not null))[1] as cgr_risk_family,
  (array_agg(distinct r.cgr_severity order by r.cgr_severity)
    filter (where nullif(r.cgr_severity,'') is not null))[1] as cgr_severity,
  coalesce(
    array_agg(distinct r.cgr_stage order by r.cgr_stage)
      filter (where nullif(r.cgr_stage,'') is not null),
    array[]::text[]
  ) as cgr_stages,
  coalesce(
    array_agg(distinct r.cgr_risk_family order by r.cgr_risk_family)
      filter (where nullif(r.cgr_risk_family,'') is not null),
    array[]::text[]
  ) as cgr_risk_families,
  coalesce(
    array_agg(distinct r.cgr_severity order by r.cgr_severity)
      filter (where nullif(r.cgr_severity,'') is not null),
    array[]::text[]
  ) as cgr_severities,
  bool_or(coalesce(r.in_sii_registry,false)) as in_sii_registry,
  bool_or(coalesce(r.in_uaf_registry,false)) as in_uaf_registry,
  bool_or(coalesce(r.in_osfl_registry,false)) as in_osfl_registry,
  bool_or(coalesce(r.in_unified_universe,false)) as in_unified_universe,
  max(r.refreshed_at) as refreshed_at,
  count(*)::integer as component_count,
  count(distinct nullif(r.reason,''))::integer as finding_count,
  array_agg(r.event_id order by r.event_id) as component_event_ids
from raw r
join amounts a using (sanction_case_id)
group by r.sanction_case_id, a.amount_uf, a.amount_clp;

grant select on public.aml_v_sanctions_cases_current_v1 to authenticated, service_role;
revoke all on public.aml_v_sanctions_cases_current_v1 from anon;

comment on view public.aml_v_sanctions_cases_current_v1 is
'ATLAS: una fila por sanción/acto público y entidad. Consolida tipos de medida y deduplica montos repetidos por el mismo hecho.';

create or replace function public.atlas_v2_sanctions_query(p_request jsonb)
returns jsonb
language plpgsql
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_kind text := lower(trim(coalesce(p_request->>'kind','overview')));
  v_limit integer := greatest(1, least(coalesce(nullif(p_request->>'limit','')::integer, 40), 100));
  v_offset integer := greatest(0, coalesce(nullif(p_request->>'offset','')::integer, 0));
  v_search text := lower(trim(coalesce(p_request->>'search',p_request->>'q','')));
  v_regulator text := upper(trim(coalesce(p_request->>'regulator','')));
  v_region text := trim(coalesce(p_request->>'region',''));
  v_event_class text := upper(trim(coalesce(p_request->>'event_class','')));
  v_event_kind text := trim(coalesce(p_request->>'event_kind',''));
  v_subject_condition text := upper(trim(coalesce(p_request->>'subject_condition','')));
  v_universe text := upper(trim(coalesce(p_request->>'universe','')));
  v_amount_band text := upper(trim(coalesce(p_request->>'amount_band','')));
  v_event_id text := trim(coalesce(p_request->>'event_id',''));
  v_year integer := nullif(p_request->>'year','')::integer;
  v_result jsonb;
begin
  if not exists (
    select 1 from public.aml_allowed_users au
    where au.user_id = auth.uid() and au.enabled
  ) then
    raise exception 'FORBIDDEN' using errcode='42501';
  end if;

  if v_kind = 'overview' then
    select jsonb_build_object(
      'schema','ATLAS_SANCTIONS_QUERY_V2','kind','overview','generated_at',now(),
      'snapshot_id',coalesce((select max(refreshed_at)::text from public.aml_v_sanctions_radiography_current_v0960),now()::text),
      'overview',coalesce((select to_jsonb(o) from public.aml_v_sanctions_overview_current_v0960 o limit 1),'{}'::jsonb),
      'universe',coalesce((select to_jsonb(u) from public.aml_v_sanctions_universe_summary_current_v0960 u limit 1),'{}'::jsonb),
      'year_source',coalesce((select jsonb_agg(to_jsonb(y) order by y.event_year,y.regulator,y.event_class) from public.aml_v_sanctions_year_source_current_v0960 y),'[]'::jsonb),
      'regions',coalesce((select jsonb_agg(to_jsonb(r) order by r.event_count desc,r.region,r.regulator) from public.aml_v_sanctions_region_current_v0960 r),'[]'::jsonb),
      'sectors',coalesce((select jsonb_agg(to_jsonb(s) order by s.event_count desc,s.subject_condition,s.sector,s.regulator) from public.aml_v_sanctions_sector_current_v0960 s),'[]'::jsonb),
      'semantics',jsonb_build_object(
        'universe','SII + padrón UAF + padrón OSFL, deduplicados por RUT. La membresía puede superponerse.',
        'regulatory','CMF/UAF/SCJ se conservan como eventos regulatorios según su fuente.',
        'cgr','Las acciones CGR se muestran separadas como enforcement. No se promueven automáticamente a sanción regulatoria firme.',
        'aml','Sanción administrativa no equivale por sí sola a evidencia LA/FT.',
        'currency','Montos UF y CLP no se suman entre sí.'
      )
    ) into v_result;
    return v_result;

  elsif v_kind = 'dashboard' then
    with filtered as materialized (
      select c.*
      from public.aml_v_sanctions_cases_current_v1 c
      where (v_search='' or lower(coalesce(c.canonical_name,'')) like '%'||v_search||'%' or lower(coalesce(c.source_entity_name,'')) like '%'||v_search||'%' or lower(coalesce(c.rut,'')) like '%'||v_search||'%' or lower(coalesce(array_to_string(c.reasons,' '),'')) like '%'||v_search||'%' or lower(coalesce(c.resolution_ref,'')) like '%'||v_search||'%')
        and (v_regulator='' or upper(coalesce(c.regulator,''))=v_regulator)
        and (v_region='' or coalesce(c.region,'')=v_region)
        and (v_event_class='' or v_event_class=any(c.event_classes))
        and (v_event_kind='' or v_event_kind=any(c.event_kinds))
        and (v_year is null or c.event_year=v_year)
        and (v_universe='' or (case v_universe when 'UAF' then coalesce(c.in_uaf_registry,false) when 'SII' then coalesce(c.in_sii_registry,false) when 'OSFL' then coalesce(c.in_osfl_registry,false) else true end))
        and (v_amount_band='' or (case v_amount_band when 'CLP' then coalesce(c.amount_clp,0)>0 when 'UF' then coalesce(c.amount_uf,0)>0 when 'NO_AMOUNT' then coalesce(c.amount_clp,0)=0 and coalesce(c.amount_uf,0)=0 else true end))
        and (v_subject_condition='' or (case v_subject_condition when 'SO' then coalesce(c.is_uaf_registered,false) when 'POTENTIAL_SO' then coalesce(c.is_potential_screening,false) when 'OSFL' then coalesce(c.is_osfl_observed,false) when 'RES' then coalesce(c.is_res_observed,false) else true end))
    ), universe_meta as (
      select * from public.aml_v_sanctions_universe_summary_current_v0960 limit 1
    ), metrics as (
      select count(*)::bigint event_count,
             count(distinct entity_key) filter (where entity_key is not null)::bigint entity_count,
             count(*) filter (where 'REGULATORY_SANCTION_OBSERVED'=any(event_classes))::bigint regulatory_event_count,
             count(*) filter (where 'CGR_ENFORCEMENT_ACTION'=any(event_classes))::bigint cgr_event_count,
             count(*) filter (where document_url is not null and document_url<>'')::bigint document_count,
             count(distinct regulator)::bigint supervisor_count,
             coalesce(sum(amount_clp),0)::numeric amount_clp,
             coalesce(sum(amount_uf),0)::double precision amount_uf,
             min(event_date) min_date,
             max(event_date) max_date
      from filtered
    ), universe_cards as (
      select 'UAF' code, (select uaf_registry_count from universe_meta)::bigint evaluated_count,
             count(*) filter (where in_uaf_registry)::bigint event_count,
             count(distinct entity_key) filter (where in_uaf_registry and entity_key is not null)::bigint entity_count
      from filtered
      union all
      select 'SII', (select sii_registry_count from universe_meta)::bigint,
             count(*) filter (where in_sii_registry)::bigint,
             count(distinct entity_key) filter (where in_sii_registry and entity_key is not null)::bigint
      from filtered
      union all
      select 'OSFL', (select osfl_registry_count from universe_meta)::bigint,
             count(*) filter (where in_osfl_registry)::bigint,
             count(distinct entity_key) filter (where in_osfl_registry and entity_key is not null)::bigint
      from filtered
    ), supervisors as (
      select regulator,
             count(*)::bigint event_count,
             count(distinct entity_key) filter (where entity_key is not null)::bigint entity_count,
             count(*) filter (where 'REGULATORY_SANCTION_OBSERVED'=any(event_classes))::bigint regulatory_event_count,
             count(*) filter (where 'CGR_ENFORCEMENT_ACTION'=any(event_classes))::bigint cgr_event_count,
             coalesce(sum(amount_clp),0)::numeric amount_clp,
             coalesce(sum(amount_uf),0)::double precision amount_uf
      from filtered group by regulator
    ), regions as (
      select coalesce(nullif(region,''),'Sin región informada') region,
             count(*)::bigint event_count,
             count(distinct entity_key) filter (where entity_key is not null)::bigint entity_count,
             coalesce(sum(amount_clp),0)::numeric amount_clp,
             coalesce(sum(amount_uf),0)::double precision amount_uf
      from filtered group by 1
    ), types as (
      select k.event_kind,
             count(*)::bigint event_count,
             count(distinct f.entity_key) filter (where f.entity_key is not null)::bigint entity_count
      from filtered f
      cross join lateral unnest(case when cardinality(f.event_kinds)>0 then f.event_kinds else array['Sin clasificación']::text[] end) as k(event_kind)
      group by k.event_kind
    ), years as (
      select event_year,
             count(*)::bigint event_count,
             count(distinct entity_key) filter (where entity_key is not null)::bigint entity_count,
             count(*) filter (where 'REGULATORY_SANCTION_OBSERVED'=any(event_classes))::bigint regulatory_event_count,
             count(*) filter (where 'CGR_ENFORCEMENT_ACTION'=any(event_classes))::bigint cgr_event_count
      from filtered where event_year is not null group by event_year
    )
    select jsonb_build_object(
      'schema','ATLAS_SANCTIONS_QUERY_V2','kind','dashboard','generated_at',now(),
      'snapshot_id',coalesce((select max(refreshed_at)::text from public.aml_v_sanctions_cases_current_v1),now()::text),
      'metrics',(select to_jsonb(m) || jsonb_build_object('unified_universe_count',(select unified_universe_count from universe_meta)) from metrics m),
      'universes',coalesce((select jsonb_agg(to_jsonb(u) order by case code when 'UAF' then 1 when 'SII' then 2 else 3 end) from universe_cards u),'[]'::jsonb),
      'supervisors',coalesce((select jsonb_agg(to_jsonb(s) order by s.event_count desc,s.regulator) from supervisors s),'[]'::jsonb),
      'regions',coalesce((select jsonb_agg(to_jsonb(r) order by r.event_count desc,r.region) from regions r),'[]'::jsonb),
      'types',coalesce((select jsonb_agg(to_jsonb(t) order by t.event_count desc,t.event_kind) from types t),'[]'::jsonb),
      'years',coalesce((select jsonb_agg(to_jsonb(y) order by y.event_year) from years y),'[]'::jsonb),
      'filters',jsonb_build_object(
        'regulators',coalesce((select jsonb_agg(x order by x) from (select distinct regulator x from public.aml_v_sanctions_cases_current_v1 where regulator is not null and regulator<>'') q),'[]'::jsonb),
        'regions',coalesce((select jsonb_agg(x order by x) from (select distinct region x from public.aml_v_sanctions_cases_current_v1 where region is not null and region<>'') q),'[]'::jsonb),
        'types',coalesce((select jsonb_agg(x order by x) from (select distinct k.event_kind x from public.aml_v_sanctions_cases_current_v1 c cross join lateral unnest(c.event_kinds) as k(event_kind) where k.event_kind is not null and k.event_kind<>'') q),'[]'::jsonb),
        'years',coalesce((select jsonb_agg(x order by x desc) from (select distinct event_year x from public.aml_v_sanctions_cases_current_v1 where event_year is not null) q),'[]'::jsonb)
      ),
      'semantics',jsonb_build_object(
        'universe','UAF, SII y OSFL son membresías superpuestas dentro del universo consolidado; sus conteos no deben sumarse.',
        'regulatory','CMF/UAF/SCJ son sanciones regulatorias observadas.',
        'cgr','CGR se presenta como acciones de enforcement separadas.',
        'priority','La priorización de casos se calcula sobre sanciones únicas, no sobre filas de medidas de una misma resolución.',
        'currency','UF y CLP permanecen separados. Dentro de una sanción, un mismo monto repetido por varias medidas se contabiliza una sola vez.'
      )
    ) into v_result;
    return v_result;

  elsif v_kind = 'events' then
    with filtered_base as materialized (
      select c.*,
             count(*) over (partition by c.entity_key) as recurrence_count
      from public.aml_v_sanctions_cases_current_v1 c
      where (v_search='' or lower(coalesce(c.canonical_name,'')) like '%'||v_search||'%' or lower(coalesce(c.source_entity_name,'')) like '%'||v_search||'%' or lower(coalesce(c.rut,'')) like '%'||v_search||'%' or lower(coalesce(array_to_string(c.reasons,' '),'')) like '%'||v_search||'%' or lower(coalesce(c.resolution_ref,'')) like '%'||v_search||'%')
        and (v_regulator='' or upper(coalesce(c.regulator,''))=v_regulator)
        and (v_region='' or coalesce(c.region,'')=v_region)
        and (v_event_class='' or v_event_class=any(c.event_classes))
        and (v_event_kind='' or v_event_kind=any(c.event_kinds))
        and (v_year is null or c.event_year=v_year)
        and (v_universe='' or (case v_universe when 'UAF' then coalesce(c.in_uaf_registry,false) when 'SII' then coalesce(c.in_sii_registry,false) when 'OSFL' then coalesce(c.in_osfl_registry,false) else true end))
        and (v_amount_band='' or (case v_amount_band when 'CLP' then coalesce(c.amount_clp,0)>0 when 'UF' then coalesce(c.amount_uf,0)>0 when 'NO_AMOUNT' then coalesce(c.amount_clp,0)=0 and coalesce(c.amount_uf,0)=0 else true end))
        and (coalesce(p_request->>'unified_only','')='' or coalesce(c.in_unified_universe,false)=(p_request->>'unified_only')::boolean)
        and (v_subject_condition='' or (case v_subject_condition when 'SO' then coalesce(c.is_uaf_registered,false) when 'POTENTIAL_SO' then coalesce(c.is_potential_screening,false) when 'OSFL' then coalesce(c.is_osfl_observed,false) when 'RES' then coalesce(c.is_res_observed,false) else true end))
    ), scored as (
      select f.*,
        least(100,
          (case when f.is_uaf_registered then 20 else 0 end) +
          (case when f.is_osfl_observed then 10 else 0 end) +
          (case when coalesce(f.amount_clp,0)>0 or coalesce(f.amount_uf,0)>0 then 15 else 0 end) +
          (case when f.document_url is not null and f.document_url<>'' then 10 else 0 end) +
          (case when f.recurrence_count>=3 then 20 when f.recurrence_count=2 then 12 else 0 end) +
          (case when lower(coalesce(array_to_string(f.event_kinds,' '),'')||' '||coalesce(array_to_string(f.reasons,' '),'')) ~ '(ala/cft|la/ft|lavado|debida diligencia)' then 20 else 0 end) +
          (case when coalesce(f.identity_confidence,0)>=0.9 then 5 else 0 end)
        )::integer as priority_score
      from filtered_base f
    ), page_rows as (
      select * from scored
      order by priority_score desc, event_date desc nulls last, regulator, event_id
      limit v_limit offset v_offset
    )
    select jsonb_build_object(
      'schema','ATLAS_SANCTIONS_QUERY_V2','kind','events','generated_at',now(),
      'snapshot_id',coalesce((select max(refreshed_at)::text from public.aml_v_sanctions_cases_current_v1),now()::text),
      'page',jsonb_build_object('limit',v_limit,'offset',v_offset,'total',(select count(*) from scored)),
      'items',coalesce((select jsonb_agg(to_jsonb(p) order by p.priority_score desc,p.event_date desc nulls last,p.regulator,p.event_id) from page_rows p),'[]'::jsonb),
      'semantics',jsonb_build_object(
        'grouping','Una fila representa una sanción/acto por entidad y resolución; sus medidas internas se muestran en la ficha.',
        'amount','El monto del caso suma hechos monetarios distintos y evita repetir el mismo importe cuando aparece bajo varias medidas.',
        'priority','Prioridad analítica explicable para ordenar revisión; no es probabilidad LA/FT.',
        'cgr','CGR enforcement se conserva separado de sanciones regulatorias.',
        'identity','Identidades candidatas o no resueltas mantienen su estado y confianza.',
        'document','El enlace documental se expone solo cuando existe evidencia pública registrada.'
      )
    ) into v_result;
    return v_result;

  elsif v_kind = 'detail' then
    if v_event_id='' then
      return jsonb_build_object('schema','ATLAS_SANCTIONS_QUERY_V2','kind','detail','error','EVENT_ID_REQUIRED','generated_at',now());
    end if;
    with chosen as (
      select c.*
      from public.aml_v_sanctions_cases_current_v1 c
      where c.event_id=v_event_id or v_event_id=any(c.component_event_ids)
      order by (c.event_id=v_event_id) desc
      limit 1
    ), components as (
      select r.*
      from public.aml_v_sanctions_radiography_current_v0960 r
      where r.event_id=any(coalesce((select component_event_ids from chosen),array[]::text[]))
      order by r.event_kind, r.reason nulls last, r.event_id
    ), related as (
      select c.*
      from public.aml_v_sanctions_cases_current_v1 c
      where c.entity_key is not null and c.entity_key=(select entity_key from chosen)
      order by c.event_date desc nulls last, c.regulator, c.event_id
      limit 20
    )
    select jsonb_build_object(
      'schema','ATLAS_SANCTIONS_QUERY_V2','kind','detail','generated_at',now(),
      'snapshot_id',coalesce((select max(refreshed_at)::text from public.aml_v_sanctions_cases_current_v1),now()::text),
      'event',coalesce((select to_jsonb(c) from chosen c),'{}'::jsonb),
      'components',coalesce((select jsonb_agg(to_jsonb(c) order by c.event_kind,c.reason nulls last,c.event_id) from components c),'[]'::jsonb),
      'related_events',coalesce((select jsonb_agg(to_jsonb(r) order by r.event_date desc nulls last,r.regulator,r.event_id) from related r),'[]'::jsonb),
      'semantics',jsonb_build_object(
        'grouping','La ficha consolida todas las medidas que pertenecen a la misma entidad y resolución pública.',
        'amount','El total evita duplicar importes repetidos por distintas medidas del mismo hecho.',
        'cgr','CGR enforcement se conserva separado de sanciones regulatorias.',
        'document','El documento corresponde a evidencia pública registrada por la fuente.',
        'aml','Una sanción administrativa no equivale por sí sola a evidencia LA/FT.'
      )
    ) into v_result;
    return v_result;
  else
    return jsonb_build_object('schema','ATLAS_SANCTIONS_QUERY_V2','kind',v_kind,'error','UNSUPPORTED_KIND','generated_at',now());
  end if;
end;
$function$;

grant execute on function public.atlas_v2_sanctions_query(jsonb) to authenticated, service_role;
revoke execute on function public.atlas_v2_sanctions_query(jsonb) from anon;
