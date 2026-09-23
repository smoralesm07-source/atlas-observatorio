-- Entidad 360 · precedencia de perfil tributario consolidado para fichas federadas.
-- Si aml_entity_tax_profile ya contiene la entidad (o la incorpora una carga
-- posterior), se usa antes que el histórico anual. Si no existe, se conserva
-- el fallback a aml_sii_entity_year y luego al estado explícito de cobertura.

create or replace function atlas_v2_private.enrich_federated_sii_tax(
  p_entity_id text,
  p_result jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public', 'atlas_v2_private'
as $function$
declare
  v_tax jsonb := coalesce(p_result->'tax', '{}'::jsonb);
  v_profile public.aml_entity_tax_profile%rowtype;
  v_year public.aml_sii_entity_year%rowtype;
  v_has_profile boolean := false;
  v_has_year boolean := false;
  v_has_existing_economic boolean := false;
  v_sales_status text;
  v_workers_status text;
begin
  if p_result is null then return null; end if;

  select p.* into v_profile
  from public.aml_entity_tax_profile p
  where p.entity_id = p_entity_id
  limit 1;
  v_has_profile := found;

  if v_has_profile then
    v_sales_status := case
      when v_profile.sales_band_rank = 1 then 'SII_REPORTED_NO_INFORMATION'
      when v_profile.sales_band_rank between 2 and 13 then 'SII_PROFILE_VALUE'
      else 'SII_NOT_REPORTED'
    end;
    v_workers_status := case
      when v_profile.workers_numeric is not null then 'SII_PROFILE_VALUE'
      else 'SII_NOT_REPORTED'
    end;

    v_tax := v_tax || jsonb_strip_nulls(jsonb_build_object(
      'commercial_year', v_profile.commercial_year,
      'current_status', v_profile.current_status,
      'activity_start_date', v_profile.activity_start_date,
      'termination_date', v_profile.termination_date,
      'first_activity_registration_date', v_profile.first_activity_registration_date,
      'region', v_profile.region,
      'province', v_profile.province,
      'commune', v_profile.commune,
      'main_activity', v_profile.main_activity,
      'economic_sector', v_profile.economic_sector,
      'economic_subsector', v_profile.economic_subsector,
      'activity_count', v_profile.activity_count,
      'activity_codes', v_profile.activity_codes,
      'activity_names', v_profile.activity_names,
      'latest_activity_registration_date', v_profile.latest_activity_registration_date,
      'sales_band', v_profile.sales_band,
      'sales_band_code', v_profile.sales_band_code,
      'sales_band_rank', v_profile.sales_band_rank,
      'sales_band_uf', public.obs_sales_band_uf(v_profile.sales_band_rank),
      'size_label', public.obs_sales_band_size(v_profile.sales_band_rank),
      'workers_numeric', v_profile.workers_numeric,
      'taxpayer_type', v_profile.taxpayer_type,
      'taxpayer_subtype', v_profile.taxpayer_subtype,
      'positive_equity_band', v_profile.positive_equity_band,
      'negative_equity_band', v_profile.negative_equity_band,
      'society_type', v_profile.society_type,
      'society_subtype', v_profile.society_subtype,
      'ownership_edge_count', v_profile.ownership_edge_count,
      'legal_entity_partner_count', v_profile.legal_entity_partner_count,
      'societies_as_partner_count', v_profile.societies_as_partner_count,
      'address_count', v_profile.address_count,
      'current_address_count', v_profile.current_address_count,
      'address_communes', v_profile.communes,
      'signal_count', v_profile.signal_count,
      'signal_types', v_profile.signal_types,
      'updated_at', v_profile.updated_at,
      'economic_data_status', 'SII_PROFILE_OBSERVED',
      'economic_data_source', 'AML_ENTITY_TAX_PROFILE',
      'sales_data_status', v_sales_status,
      'workers_data_status', v_workers_status
    ));
    return jsonb_set(p_result, '{tax}', v_tax, true);
  end if;

  select y.* into v_year
  from public.aml_sii_entity_year y
  where y.entity_id = p_entity_id
  order by y.commercial_year desc
  limit 1;
  v_has_year := found;

  if v_has_year then
    v_sales_status := case
      when v_year.sales_band_rank = 1 then 'SII_REPORTED_NO_INFORMATION'
      when v_year.sales_band_rank between 2 and 13 then 'SII_ANNUAL_VALUE'
      else 'SII_NOT_REPORTED'
    end;
    v_workers_status := case when v_year.workers_numeric is not null then 'SII_ANNUAL_VALUE' else 'SII_NOT_REPORTED' end;

    v_tax := v_tax || jsonb_strip_nulls(jsonb_build_object(
      'commercial_year', v_year.commercial_year,
      'sales_band', v_year.sales_band_code,
      'sales_band_code', v_year.sales_band_code,
      'sales_band_rank', v_year.sales_band_rank,
      'sales_band_uf', public.obs_sales_band_uf(v_year.sales_band_rank),
      'size_label', public.obs_sales_band_size(v_year.sales_band_rank),
      'workers_numeric', v_year.workers_numeric,
      'region', v_year.region,
      'main_activity', v_year.main_activity,
      'economic_sector', v_year.economic_sector,
      'economic_subsector', v_year.economic_subsector,
      'taxpayer_type', v_year.taxpayer_type,
      'taxpayer_subtype', coalesce(v_year.taxpayer_subtype, v_tax->>'taxpayer_subtype'),
      'activity_start_date', coalesce(v_year.activity_start_date::text, v_tax->>'activity_start_date'),
      'termination_date', coalesce(v_year.termination_date::text, v_tax->>'termination_date'),
      'economic_data_status', 'SII_ANNUAL_OBSERVED',
      'economic_data_source', 'RADAR_SII_COMPANY_YEAR',
      'sales_data_status', v_sales_status,
      'workers_data_status', v_workers_status
    ));
  else
    v_has_existing_economic := nullif(v_tax->>'sales_band', '') is not null
      or nullif(v_tax->>'workers_numeric', '') is not null
      or nullif(v_tax->>'main_activity', '') is not null;

    v_tax := v_tax || jsonb_build_object(
      'economic_data_status', case when v_has_existing_economic then 'SII_ENRICHMENT_ONLY' else 'ATLAS_ANNUAL_NOT_MATERIALIZED' end,
      'economic_data_source', case when v_has_existing_economic then 'ATLAS_EXISTING_SII_ENRICHMENT' else 'RADAR_SII_REGISTRY_ONLY' end,
      'sales_data_status', case when nullif(v_tax->>'sales_band', '') is not null then 'SII_ENRICHMENT_VALUE' else 'ATLAS_NOT_MATERIALIZED' end,
      'workers_data_status', case when nullif(v_tax->>'workers_numeric', '') is not null then 'SII_ENRICHMENT_VALUE' else 'ATLAS_NOT_MATERIALIZED' end
    );
  end if;

  return jsonb_set(p_result, '{tax}', v_tax, true);
end;
$function$;
