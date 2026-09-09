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
    f.lifecycle_validated_at,
    f.operating_status_confidence,
    f.operating_status_method,
    f.operating_status_version,
    f.operating_status_validated_at
from public.aml_fintech_entity f
left join public.aml_uaf_obligated_subject_snapshot u on u.entity_id=f.atlas_entity_id;

revoke all on public.aml_v_fintech_entity_current from public,anon,authenticated;
grant select on public.aml_v_fintech_entity_current to service_role;