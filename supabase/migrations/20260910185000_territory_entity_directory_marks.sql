-- ATLAS Observatorio · Territorio: directorio de entidades con marcas propias.
--
-- El IGR sigue describiendo exclusivamente el territorio. Esta ampliación sólo
-- enriquece la lista de entidades domiciliadas con evidencia propia de cada
-- entidad para homologarla visual y semánticamente con el Directorio de SO.

create or replace function public.obs_territory_detail(p_territory_id text)
returns jsonb
language sql
stable
security invoker
set search_path = public, extensions, pg_temp
as $$
  with t as (
    select * from public.obs_territory where territory_id = p_territory_id
  ),
  pares as (
    select round(avg(o.igr_score), 1) igr_region,
           count(*) comunas_region,
           (select count(*) + 1 from public.obs_territory x
             where x.region_name = (select region_name from t)
               and x.igr_score > (select igr_score from t)) posicion_en_region
    from public.obs_territory o
    where o.region_name = (select region_name from t)
  ),
  nacional as (
    select (select count(*) + 1 from public.obs_territory x
             where x.igr_score > (select igr_score from t)) posicion_nacional,
           count(*) comunas_pais
    from public.obs_territory
  ),
  base_entidades as (
    select e.entity_id, e.rut, e.rut_search, e.name, e.entity_type, e.region, e.commune,
           e.uaf_sector, e.is_uaf_observed, e.is_sanctioned,
           e.ipa3_score, e.ipa3_band, e.source_count, e.alert_count,
           e.finding_count, e.sanction_count
    from public.obs_entity e
    where e.commune is not null
      and public.obs_normalize_text(e.commune) = (select commune_search from t)
    order by e.ipa3_score desc nulls last, e.source_count desc
    limit 40
  ),
  entidades as (
    select
      e.entity_id,
      e.rut,
      e.name,
      e.entity_type,
      coalesce(u.uaf_sector, e.uaf_sector) as uaf_sector,
      e.is_uaf_observed,
      e.is_sanctioned,
      greatest(coalesce(e.sanction_count, 0), coalesce(u.sanction_count, 0), coalesce(u.sanction_evidence_count, 0))::integer as sanction_count,
      coalesce(u.is_osfl, false)
        or exists (
          select 1
          from public.obs_osfl_entity oe
          where oe.entity_id = e.entity_id
             or (e.rut_search is not null and oe.rut_search = e.rut_search)
        ) as is_osfl,
      coalesce(u.is_state_supplier, false)
        or exists (
          select 1
          from public.obs_spend_actor sa
          where sa.entity_id = e.entity_id and sa.actor_role = 'SUPPLIER'
        ) as is_state_supplier,
      coalesce(
        u.press_evidence_count,
        (
          select count(distinct m.article_id)::integer
          from public.atlas_press_entity_link l
          join public.atlas_press_mention_history m on m.press_entity_id = l.press_entity_id
          where l.link_status = 'RESOLVED'
            and (
              l.canonical_entity_id = e.entity_id
              or (
                e.rut_search is not null
                and public.obs_normalize_text(coalesce(l.canonical_rut, '')) = e.rut_search
              )
            )
        ),
        0
      )::integer as press_evidence_count,
      coalesce(u.has_press, false)
        or exists (
          select 1
          from public.atlas_press_entity_link l
          where l.link_status = 'RESOLVED'
            and (
              l.canonical_entity_id = e.entity_id
              or (
                e.rut_search is not null
                and public.obs_normalize_text(coalesce(l.canonical_rut, '')) = e.rut_search
              )
            )
        ) as has_press,
      coalesce(u.sii_status, tax.current_status) as sii_status,
      coalesce(u.sii_termination_date, tax.termination_date) as sii_termination_date,
      coalesce(u.main_activity, tax.main_activity, osfl.main_activity) as main_activity,
      coalesce(u.economic_sector, tax.economic_sector) as economic_sector,
      coalesce(u.ipf_score, e.ipa3_score) as priority_score,
      case when e.is_uaf_observed then coalesce(u.ipf_band, e.ipa3_band) else e.ipa3_band end as priority_band,
      case when e.is_uaf_observed then 'IPF' else 'IPA' end as priority_metric,
      u.attention_motive,
      e.source_count,
      e.alert_count,
      e.finding_count,
      e.region,
      e.commune
    from base_entidades e
    left join public.obs_uaf_subject u
      on u.entity_id = e.entity_id
      or (e.rut_search is not null and u.rut_search = e.rut_search)
    left join lateral (
      select p.current_status, p.termination_date, p.main_activity, p.economic_sector
      from public.aml_entity_tax_profile p
      where p.entity_id = e.entity_id
      order by p.commercial_year desc nulls last
      limit 1
    ) tax on true
    left join lateral (
      select oe.main_activity
      from public.obs_osfl_entity oe
      where oe.entity_id = e.entity_id
         or (e.rut_search is not null and oe.rut_search = e.rut_search)
      order by oe.refreshed_at desc nulls last
      limit 1
    ) osfl on true
    order by e.ipa3_score desc nulls last, e.source_count desc
  ),
  sectores as (
    select e.uaf_sector, count(*) n
    from public.obs_entity e
    where e.uaf_sector is not null
      and e.commune is not null
      and public.obs_normalize_text(e.commune) = (select commune_search from t)
    group by 1 order by 2 desc limit 10
  )
  select case when (select count(*) from t) = 0 then null else jsonb_build_object(
    'contract', 'ATLAS_OBS_TERRITORY_DETAIL_V1',
    'territorio', (select to_jsonb(x) from t x),
    'posicion',   (select to_jsonb(p) from pares p) || (select to_jsonb(n) from nacional n),
    'entidades',  (select coalesce(jsonb_agg(to_jsonb(e)), '[]') from entidades e),
    'sectores',   (select coalesce(jsonb_agg(to_jsonb(s)), '[]') from sectores s),
    'semantics',  'Las entidades listadas están domiciliadas en esta comuna. Las marcas SO UAF, OSFL, sanciones, prensa y proveedor del Estado describen evidencia propia de cada entidad y no provienen del IGR. El IGR describe la amenaza del territorio y no se atribuye a ninguna de ellas: estar aquí no es un indicio sobre la entidad.'
  ) end;
$$;

revoke all on function public.obs_territory_detail(text) from public, anon;
grant execute on function public.obs_territory_detail(text) to authenticated, service_role;

comment on function public.obs_territory_detail(text) is
  'Detalle territorial con directorio enriquecido de entidades domiciliadas. Expone marcas propias de entidad (SO UAF, OSFL, sanción, prensa, proveedor Estado) separadas semánticamente del IGR.';
