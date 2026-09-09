alter table public.aml_fintech_entity
  add column if not exists operating_status_confidence numeric,
  add column if not exists operating_status_method text,
  add column if not exists operating_status_version text,
  add column if not exists operating_status_validated_at timestamptz;

create table if not exists public.aml_fintech_operating_status_audit (
  audit_id bigserial primary key,
  fintech_id text not null references public.aml_fintech_entity(fintech_id) on delete cascade,
  previous_status text,
  new_status text not null,
  confidence numeric,
  method text not null,
  basis text not null,
  source_codes text[] not null default '{}',
  source_urls text[] not null default '{}',
  status_as_of date,
  validator_version text not null,
  created_at timestamptz not null default now()
);

create index if not exists aml_fintech_operating_status_audit_entity_idx
  on public.aml_fintech_operating_status_audit(fintech_id,created_at desc);

revoke all on public.aml_fintech_operating_status_audit from public,anon,authenticated;
grant select,insert on public.aml_fintech_operating_status_audit to service_role;
grant usage,select on sequence public.aml_fintech_operating_status_audit_audit_id_seq to service_role;

create or replace function public.aml_fintech_refresh_operating_status_v1()
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  changed_count integer := 0;
  skipped_count integer := 0;
begin
  with web as (
    select
      subject_key as fintech_id,
      max(observed_at) filter(where field_code='WEBSITE_STATUS' and value_text='OK') as web_ok_at,
      max(observed_at) filter(where field_code in ('PRODUCT_SIGNAL','SITE_DESCRIPTION','SITE_TITLE') and evidence_class='DECLARED') as declared_at,
      max(source_url) filter(where field_code='WEBSITE_STATUS' and value_text='OK') as website_source_url
    from public.aml_fintech_enrichment_fact
    where subject_type='ENTITY'
    group by subject_key
  ), eligible as (
    select
      e.fintech_id,
      e.operating_status as previous_status,
      e.website,
      e.rut,
      w.web_ok_at,
      w.declared_at,
      coalesce(w.website_source_url,e.website) as source_url
    from public.aml_fintech_entity e
    join web w on w.fintech_id=e.fintech_id
    join public.aml_sii_registry_company s on s.rut=e.rut
    where e.operating_status='UNKNOWN'
      and s.current_status='ACTIVE_AS_PUBLISHED'
      and w.web_ok_at is not null
      and w.declared_at is not null
      and w.web_ok_at >= now()-interval '30 days'
      and w.declared_at >= now()-interval '30 days'
  ), logged as (
    insert into public.aml_fintech_operating_status_audit(
      fintech_id,previous_status,new_status,confidence,method,basis,source_codes,source_urls,status_as_of,validator_version
    )
    select
      fintech_id,
      previous_status,
      'ACTIVE',
      0.95,
      'AUTO_MULTI_SOURCE',
      'Validación automática conservadora: RUT vigente en SII + sitio corporativo accesible + contenido declarado reciente del propio actor. La vigencia tributaria por sí sola no basta.',
      array['SII_PUBLIC','COMPANY_WEB'],
      array_remove(array[source_url],null),
      current_date,
      'OPERATING-V1.0'
    from eligible
    returning fintech_id
  )
  update public.aml_fintech_entity e
  set operating_status='ACTIVE',
      operating_status_basis='Validación automática conservadora: RUT vigente en SII + sitio corporativo accesible + contenido declarado reciente del propio actor.',
      operating_status_source_code='SII_PUBLIC+COMPANY_WEB',
      operating_status_source_url=coalesce(w.source_url,e.website),
      operating_status_as_of=current_date,
      operating_status_confidence=0.95,
      operating_status_method='AUTO_MULTI_SOURCE',
      operating_status_version='OPERATING-V1.0',
      operating_status_validated_at=now(),
      lifecycle_basis=coalesce(e.lifecycle_basis,'') || case when e.lifecycle_basis is null or e.lifecycle_basis='' then '' else ' · ' end || 'Operación pública validada por evidencia multifuente.',
      lifecycle_validated_at=now(),
      refreshed_at=now()
  from (
    select l.fintech_id, coalesce(f.source_url,e2.website) as source_url
    from logged l
    join public.aml_fintech_entity e2 on e2.fintech_id=l.fintech_id
    left join lateral (
      select source_url
      from public.aml_fintech_enrichment_fact ef
      where ef.subject_type='ENTITY' and ef.subject_key=l.fintech_id
        and ef.field_code='WEBSITE_STATUS' and ef.value_text='OK'
      order by ef.observed_at desc
      limit 1
    ) f on true
  ) w
  where e.fintech_id=w.fintech_id;

  get diagnostics changed_count = row_count;
  select count(*)::int into skipped_count
  from public.aml_fintech_entity
  where operating_status='UNKNOWN';

  return jsonb_build_object(
    'validator_version','OPERATING-V1.0',
    'validated_active',changed_count,
    'remaining_unknown',skipped_count,
    'method','SII activo + web corporativa accesible + contenido declarado reciente'
  );
end;
$function$;

revoke all on function public.aml_fintech_refresh_operating_status_v1() from public,anon,authenticated;
grant execute on function public.aml_fintech_refresh_operating_status_v1() to service_role;

create or replace view public.aml_v_fintech_operating_review_queue
with (security_invoker=true)
as
with web as (
  select
    subject_key as fintech_id,
    max(observed_at) filter(where field_code='WEBSITE_STATUS' and value_text='OK') as web_ok_at,
    max(observed_at) filter(where field_code='WEBSITE_STATUS' and value_text='FETCH_FAILED') as web_failed_at,
    max(observed_at) filter(where field_code in ('PRODUCT_SIGNAL','SITE_DESCRIPTION','SITE_TITLE') and evidence_class='DECLARED') as declared_at
  from public.aml_fintech_enrichment_fact
  where subject_type='ENTITY'
  group by subject_key
), src as (
  select fintech_id,count(distinct source_code)::int as source_count
  from public.aml_fintech_entity_source
  group by fintech_id
)
select
  e.fintech_id,e.brand,e.legal_name,e.rut,e.website,e.actor_kind,e.primary_vertical,
  s.current_status as sii_status,
  w.web_ok_at,w.web_failed_at,w.declared_at,
  coalesce(src.source_count,0) as source_count,
  case
    when e.rut is null and w.web_ok_at is not null then 'NO_RUT_ACTOR_REVIEW'
    when w.web_failed_at is not null and (w.web_ok_at is null or w.web_failed_at>w.web_ok_at) then 'WEBSITE_FETCH_FAILED'
    when w.web_ok_at is null then 'NO_RECENT_WEBSITE_EVIDENCE'
    when e.rut is not null and s.current_status is null then 'NO_SII_MATCH'
    else 'INSUFFICIENT_MULTI_SOURCE_EVIDENCE'
  end as review_reason,
  case
    when w.web_failed_at is not null and (w.web_ok_at is null or w.web_failed_at>w.web_ok_at) then 1
    when e.rut is null then 2
    when w.web_ok_at is null then 3
    else 4
  end as priority
from public.aml_fintech_entity e
left join web w on w.fintech_id=e.fintech_id
left join public.aml_sii_registry_company s on s.rut=e.rut
left join src on src.fintech_id=e.fintech_id
where e.operating_status='UNKNOWN';

revoke all on public.aml_v_fintech_operating_review_queue from public,anon,authenticated;
grant select on public.aml_v_fintech_operating_review_queue to service_role;