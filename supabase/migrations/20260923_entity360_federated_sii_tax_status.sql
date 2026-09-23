-- Entidad 360 · cobertura económica SII para entidades federadas.
--
-- Una entidad puede estar presente en la nómina registral SII y abrirse en
-- Entidad 360 sin pertenecer todavía al universo canónico materializado. En
-- ese caso no es correcto presentar ventas/trabajadores vacíos como si el SII
-- hubiese informado ausencia. Este parche:
--   1) usa el último año de aml_sii_entity_year cuando exista;
--   2) distingue tramo 1 SII (sin información) de dato no materializado;
--   3) conserva el fallback registral/UAF existente sin inventar valores.

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
  v_year public.aml_sii_entity_year%rowtype;
  v_has_year boolean := false;
  v_has_existing_economic boolean := false;
  v_sales_status text;
  v_workers_status text;
begin
  if p_result is null then
    return null;
  end if;

  select y.*
    into v_year
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
    v_workers_status := case
      when v_year.workers_numeric is not null then 'SII_ANNUAL_VALUE'
      else 'SII_NOT_REPORTED'
    end;

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
    v_has_existing_economic :=
      nullif(v_tax->>'sales_band', '') is not null
      or nullif(v_tax->>'workers_numeric', '') is not null
      or nullif(v_tax->>'main_activity', '') is not null;

    v_tax := v_tax || jsonb_build_object(
      'economic_data_status', case
        when v_has_existing_economic then 'SII_ENRICHMENT_ONLY'
        else 'ATLAS_ANNUAL_NOT_MATERIALIZED'
      end,
      'economic_data_source', case
        when v_has_existing_economic then 'ATLAS_EXISTING_SII_ENRICHMENT'
        else 'RADAR_SII_REGISTRY_ONLY'
      end,
      'sales_data_status', case
        when nullif(v_tax->>'sales_band', '') is not null then 'SII_ENRICHMENT_VALUE'
        else 'ATLAS_NOT_MATERIALIZED'
      end,
      'workers_data_status', case
        when nullif(v_tax->>'workers_numeric', '') is not null then 'SII_ENRICHMENT_VALUE'
        else 'ATLAS_NOT_MATERIALIZED'
      end
    );
  end if;

  return jsonb_set(p_result, '{tax}', v_tax, true);
end;
$function$;

revoke all on function atlas_v2_private.enrich_federated_sii_tax(text,jsonb) from public, anon, authenticated;
grant execute on function atlas_v2_private.enrich_federated_sii_tax(text,jsonb) to service_role;

create or replace function public.obs_entity_detail(p_entity_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public', 'atlas_v2_private', 'extensions'
as $function$
declare
  v_result jsonb;
  v_ipa3 jsonb;
  v_sanctions jsonb := '[]'::jsonb;
  v_sanction_count integer := 0;
  v_sanction_last timestamptz;
  v_coverage jsonb := '[]'::jsonb;
  v_sources jsonb := '[]'::jsonb;
  v_has_sanction_coverage boolean := false;
begin
  if not (
    auth.role() = 'service_role'
    or (
      auth.uid() is not null
      and exists (
        select 1
        from public.aml_allowed_users u
        where u.user_id = auth.uid()
          and u.enabled
      )
    )
  ) then
    raise exception 'ATLAS_CORE_FORBIDDEN' using errcode='42501';
  end if;

  v_result := public.obs_entity_detail_published(p_entity_id);

  if v_result is not null then
    v_ipa3 := public.obs_ipa3_entity_runtime(p_entity_id);

    if v_ipa3 is not null then
      v_result := jsonb_set(v_result, '{priority}', coalesce(v_ipa3->'priority', coalesce(v_result->'priority','null'::jsonb)), true);

      if v_ipa3->'press_mark' is not null and v_ipa3->'press_mark' <> 'null'::jsonb
         and coalesce((v_ipa3->'press_mark'->>'contribution')::numeric,0)>0 then
        v_result := jsonb_set(v_result, '{marks}', coalesce(v_result->'marks','[]'::jsonb) || jsonb_build_array(v_ipa3->'press_mark'), true);
      end if;

      v_result := jsonb_set(v_result, '{entity,ipa3_score}', coalesce(v_ipa3->'ipa3_score', coalesce(v_result #> '{entity,ipa3_score}','null'::jsonb)), true);
      v_result := jsonb_set(v_result, '{entity,ipa3_band}', coalesce(v_ipa3->'ipa3_band', coalesce(v_result #> '{entity,ipa3_band}','null'::jsonb)), true);
    end if;

    select
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'sanction_id', r.event_id,
            'event_date', r.event_date,
            'regulator', r.regulator,
            'subject', coalesce(s.subject, r.reason, r.event_kind),
            'identity_status', r.identity_status,
            'laft_direct', s.laft_direct,
            'amount_uf', r.amount_uf,
            'payload', coalesce(s.payload, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
              'event_kind', r.event_kind,
              'reason', r.reason,
              'event_class', r.event_class,
              'amount_clp', r.amount_clp
            )),
            'document_url', r.document_url,
            'document_quality', r.document_quality,
            'document_excerpt', r.document_excerpt,
            'resolution_ref', coalesce(r.resolution_ref, s.payload->'attributes'->>'resolution')
          )
          order by r.event_date desc nulls last, r.event_id
        ),
        '[]'::jsonb
      ),
      count(*)::integer,
      max(r.event_date)::timestamptz
    into v_sanctions, v_sanction_count, v_sanction_last
    from public.aml_v_sanctions_radiography_current_v0960 r
    left join public.aml_sanctions s on s.sanction_id = r.event_id
    where r.entity_id = p_entity_id;

    if v_sanction_count > 0 then
      v_result := jsonb_set(v_result, '{sanctions}', v_sanctions, true);
      v_result := jsonb_set(v_result, '{entity,is_sanctioned}', 'true'::jsonb, true);
      v_result := jsonb_set(v_result, '{entity,sanction_count}', to_jsonb(v_sanction_count), true);

      v_sources := coalesce(v_result #> '{entity,sources}', '[]'::jsonb);
      if not (v_sources @> '["RADAR_SANCIONES"]'::jsonb) then
        v_sources := v_sources || '["RADAR_SANCIONES"]'::jsonb;
        v_result := jsonb_set(v_result, '{entity,sources}', v_sources, true);
        v_result := jsonb_set(v_result, '{entity,source_count}', to_jsonb(jsonb_array_length(v_sources)), true);
      end if;

      select coalesce(
        jsonb_agg(
          case
            when item->>'source_code' = 'RADAR_SANCIONES' then
              item || jsonb_build_object(
                'status', 'PRESENT',
                'record_count', v_sanction_count,
                'last_event_at', v_sanction_last,
                'detail', coalesce(item->'detail', '{}'::jsonb) || jsonb_build_object(
                  'unidad', 'eventos sancionatorios',
                  'identity_basis', 'RADIOGRAPHY_RESOLVED_ENTITY'
                )
              )
            else item
          end
          order by ord
        ),
        '[]'::jsonb
      ) into v_coverage
      from jsonb_array_elements(coalesce(v_result->'coverage', '[]'::jsonb)) with ordinality as x(item, ord);

      select exists(
        select 1 from jsonb_array_elements(v_coverage) c where c->>'source_code' = 'RADAR_SANCIONES'
      ) into v_has_sanction_coverage;

      if not v_has_sanction_coverage then
        v_coverage := v_coverage || jsonb_build_array(jsonb_build_object(
          'source_code', 'RADAR_SANCIONES',
          'source_name', 'Radar Sanciones · eventos regulatorios',
          'source_class', 'producer',
          'integration_mode', 'scheduled',
          'authoritative_source', 'CMF / UAF / SCJ / CGR',
          'source_data_status', 'fresh',
          'status', 'PRESENT',
          'record_count', v_sanction_count,
          'last_event_at', v_sanction_last,
          'detail', jsonb_build_object('unidad', 'eventos sancionatorios', 'identity_basis', 'RADIOGRAPHY_RESOLVED_ENTITY')
        ));
      end if;
      v_result := jsonb_set(v_result, '{coverage}', v_coverage, true);
    end if;

    return v_result;
  end if;

  v_result := atlas_v2_private.entity_detail_federated_core(p_entity_id);
  return atlas_v2_private.enrich_federated_sii_tax(p_entity_id, v_result);
end;
$function$;
