create or replace function public.aml_fintech_refresh_operating_status_v1()
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  changed_web_rut integer := 0;
  changed_foreign integer := 0;
  changed_regulatory integer := 0;
  remaining_count integer := 0;
begin
  with web as (
    select subject_key as fintech_id,
      max(observed_at) filter(where field_code='WEBSITE_STATUS' and value_text='OK') as web_ok_at,
      max(observed_at) filter(where field_code in ('PRODUCT_SIGNAL','SITE_DESCRIPTION','SITE_TITLE') and evidence_class='DECLARED') as declared_at,
      max(source_url) filter(where field_code='WEBSITE_STATUS' and value_text='OK') as source_url
    from public.aml_fintech_enrichment_fact
    where subject_type='ENTITY'
    group by subject_key
  ), eligible as (
    select e.fintech_id,e.operating_status previous_status,coalesce(w.source_url,e.website) source_url
    from public.aml_fintech_entity e
    join web w on w.fintech_id=e.fintech_id
    join public.aml_sii_registry_company s on s.rut=e.rut
    where e.operating_status='UNKNOWN'
      and s.current_status='ACTIVE_AS_PUBLISHED'
      and w.web_ok_at>=now()-interval '30 days'
      and w.declared_at>=now()-interval '30 days'
  ), logged as (
    insert into public.aml_fintech_operating_status_audit(fintech_id,previous_status,new_status,confidence,method,basis,source_codes,source_urls,status_as_of,validator_version)
    select fintech_id,previous_status,'ACTIVE',0.95,'AUTO_MULTI_SOURCE',
      'RUT vigente en SII + sitio corporativo accesible + contenido declarado reciente del propio actor.',
      array['SII_PUBLIC','COMPANY_WEB'],array_remove(array[source_url],null),current_date,'OPERATING-V1.1'
    from eligible returning fintech_id
  )
  update public.aml_fintech_entity e
  set operating_status='ACTIVE',operating_status_basis='RUT vigente en SII + sitio corporativo accesible + contenido declarado reciente del propio actor.',
      operating_status_source_code='SII_PUBLIC+COMPANY_WEB',operating_status_source_url=coalesce(x.source_url,e.website),
      operating_status_as_of=current_date,operating_status_confidence=0.95,operating_status_method='AUTO_MULTI_SOURCE',
      operating_status_version='OPERATING-V1.1',operating_status_validated_at=now(),lifecycle_validated_at=now(),refreshed_at=now()
  from (select l.fintech_id,el.source_url from logged l join eligible el using(fintech_id)) x
  where e.fintech_id=x.fintech_id;
  get diagnostics changed_web_rut=row_count;

  with web as (
    select subject_key as fintech_id,
      max(observed_at) filter(where field_code='WEBSITE_STATUS' and value_text='OK') as web_ok_at,
      max(observed_at) filter(where field_code in ('PRODUCT_SIGNAL','SITE_DESCRIPTION','SITE_TITLE') and evidence_class='DECLARED') as declared_at,
      max(source_url) filter(where field_code='WEBSITE_STATUS' and value_text='OK') as source_url
    from public.aml_fintech_enrichment_fact
    where subject_type='ENTITY'
    group by subject_key
  ), eligible as (
    select e.fintech_id,e.operating_status previous_status,coalesce(w.source_url,e.website) source_url
    from public.aml_fintech_entity e
    join web w on w.fintech_id=e.fintech_id
    where e.operating_status='UNKNOWN' and e.rut is null
      and e.presence_chile='CONFIRMED_NO_CHILE_VEHICLE'
      and w.web_ok_at>=now()-interval '30 days'
      and w.declared_at>=now()-interval '30 days'
      and exists (
        select 1 from public.aml_fintech_entity_source es
        where es.fintech_id=e.fintech_id
          and es.source_code in ('FINTECHILE_MEMBERS','LATAMFINTECH_CHILE')
          and es.last_seen_at>=now()-interval '60 days'
      )
  ), logged as (
    insert into public.aml_fintech_operating_status_audit(fintech_id,previous_status,new_status,confidence,method,basis,source_codes,source_urls,status_as_of,validator_version)
    select fintech_id,previous_status,'ACTIVE',0.93,'AUTO_SECTOR_CHILE_WEB',
      'Presencia Chile previamente confirmada + directorio sectorial Chile observado recientemente + sitio corporativo accesible con contenido declarado.',
      array['SECTOR_DIRECTORY_CHILE','COMPANY_WEB'],array_remove(array[source_url],null),current_date,'OPERATING-V1.1'
    from eligible returning fintech_id
  )
  update public.aml_fintech_entity e
  set operating_status='ACTIVE',operating_status_basis='Presencia Chile previamente confirmada + directorio sectorial Chile observado recientemente + sitio corporativo accesible con contenido declarado.',
      operating_status_source_code='SECTOR_DIRECTORY_CHILE+COMPANY_WEB',operating_status_source_url=coalesce(x.source_url,e.website),
      operating_status_as_of=current_date,operating_status_confidence=0.93,operating_status_method='AUTO_SECTOR_CHILE_WEB',
      operating_status_version='OPERATING-V1.1',operating_status_validated_at=now(),lifecycle_validated_at=now(),refreshed_at=now()
  from (select l.fintech_id,el.source_url from logged l join eligible el using(fintech_id)) x
  where e.fintech_id=x.fintech_id;
  get diagnostics changed_foreign=row_count;

  with eligible as (
    select e.fintech_id,e.operating_status previous_status,max(r.source_url) source_url
    from public.aml_fintech_entity e
    join public.aml_sii_registry_company s on s.rut=e.rut and s.current_status='ACTIVE_AS_PUBLISHED'
    join public.aml_fintech_regulatory_status r on r.fintech_id=e.fintech_id
      and r.regulator='CMF' and r.status in ('VIGENTE','AUTORIZADO','INSCRITO')
      and r.observed_at>=now()-interval '30 days'
    where e.operating_status='UNKNOWN'
    group by e.fintech_id,e.operating_status
  ), logged as (
    insert into public.aml_fintech_operating_status_audit(fintech_id,previous_status,new_status,confidence,method,basis,source_codes,source_urls,status_as_of,validator_version)
    select fintech_id,previous_status,'ACTIVE',0.97,'AUTO_REGULATORY_CURRENT',
      'RUT vigente en SII + registro CMF vigente observado recientemente.',
      array['SII_PUBLIC','CMF_PUBLIC'],array_remove(array[source_url],null),current_date,'OPERATING-V1.1'
    from eligible returning fintech_id
  )
  update public.aml_fintech_entity e
  set operating_status='ACTIVE',operating_status_basis='RUT vigente en SII + registro CMF vigente observado recientemente.',
      operating_status_source_code='SII_PUBLIC+CMF_PUBLIC',operating_status_source_url=x.source_url,
      operating_status_as_of=current_date,operating_status_confidence=0.97,operating_status_method='AUTO_REGULATORY_CURRENT',
      operating_status_version='OPERATING-V1.1',operating_status_validated_at=now(),lifecycle_validated_at=now(),refreshed_at=now()
  from (select l.fintech_id,el.source_url from logged l join eligible el using(fintech_id)) x
  where e.fintech_id=x.fintech_id;
  get diagnostics changed_regulatory=row_count;

  select count(*)::int into remaining_count from public.aml_fintech_entity where operating_status='UNKNOWN';
  return jsonb_build_object(
    'validator_version','OPERATING-V1.1',
    'validated_web_rut',changed_web_rut,
    'validated_foreign_chile',changed_foreign,
    'validated_regulatory',changed_regulatory,
    'validated_total',changed_web_rut+changed_foreign+changed_regulatory,
    'remaining_unknown',remaining_count
  );
end;
$function$;

revoke all on function public.aml_fintech_refresh_operating_status_v1() from public,anon,authenticated;
grant execute on function public.aml_fintech_refresh_operating_status_v1() to service_role;