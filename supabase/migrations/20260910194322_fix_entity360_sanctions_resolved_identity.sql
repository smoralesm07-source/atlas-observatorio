-- Entity 360 must reconcile sanctions against the same identity-resolved
-- radiography used by the Sanciones monitor. Legacy aml_sanctions.entity_id can
-- remain null even after the radar resolves an event to a canonical entity.

create or replace function public.obs_entity_detail(p_entity_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public', 'atlas_v2_private', 'extensions'
as $function$
declare
  v_result jsonb;
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
    -- Reconcile sanctions against the same identity-resolved radiography used by
    -- the Sanciones monitor. The legacy aml_sanctions.entity_id can be null even
    -- when the radiography has already resolved the event to a canonical entity.
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
    left join public.aml_sanctions s
      on s.sanction_id = r.event_id
    where r.entity_id = p_entity_id;

    if v_sanction_count > 0 then
      v_result := jsonb_set(v_result, '{sanctions}', v_sanctions, true);
      v_result := jsonb_set(v_result, '{entity,is_sanctioned}', 'true'::jsonb, true);
      v_result := jsonb_set(v_result, '{entity,sanction_count}', to_jsonb(v_sanction_count), true);

      -- Keep the entity source list consistent with the reconciled sanctions.
      v_sources := coalesce(v_result #> '{entity,sources}', '[]'::jsonb);
      if not (v_sources @> '["RADAR_SANCIONES"]'::jsonb) then
        v_sources := v_sources || '["RADAR_SANCIONES"]'::jsonb;
        v_result := jsonb_set(v_result, '{entity,sources}', v_sources, true);
        v_result := jsonb_set(v_result, '{entity,source_count}', to_jsonb(jsonb_array_length(v_sources)), true);
      end if;

      -- Override a stale ABSENT status produced by the legacy materialization.
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
      )
      into v_coverage
      from jsonb_array_elements(coalesce(v_result->'coverage', '[]'::jsonb))
           with ordinality as x(item, ord);

      select exists(
        select 1
        from jsonb_array_elements(v_coverage) c
        where c->>'source_code' = 'RADAR_SANCIONES'
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
          'detail', jsonb_build_object(
            'unidad', 'eventos sancionatorios',
            'identity_basis', 'RADIOGRAPHY_RESOLVED_ENTITY'
          )
        ));
      end if;

      v_result := jsonb_set(v_result, '{coverage}', v_coverage, true);
    end if;

    return v_result;
  end if;

  return atlas_v2_private.entity_detail_federated_core(p_entity_id);
end;
$function$;
