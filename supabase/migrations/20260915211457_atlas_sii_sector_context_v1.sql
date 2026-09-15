create or replace function public.obs_sii_entity_sector_context(p_entity_id text)
returns jsonb
language plpgsql
stable
security invoker
set search_path to 'public', 'pg_temp'
as $$
declare
  v_entity public.aml_sii_entity_year%rowtype;
  v_level text;
  v_label text;
  v_peer_count bigint := 0;
  v_prior_count bigint := 0;
  v_active_count bigint := 0;
  v_workers_total numeric := 0;
  v_workers_avg numeric := null;
  v_starts_5y bigint := 0;
  v_terms_5y bigint := 0;
  v_growth numeric := null;
  v_size_mix jsonb := '{}'::jsonb;
  v_regions jsonb := '[]'::jsonb;
  v_benchmark record;
begin
  select y.*
    into v_entity
  from public.aml_sii_entity_year y
  where y.entity_id = p_entity_id
  order by y.commercial_year desc
  limit 1;

  if not found then
    return null;
  end if;

  if nullif(btrim(v_entity.main_activity), '') is not null then
    select count(*)
      into v_peer_count
    from public.aml_sii_entity_year y
    where y.commercial_year = v_entity.commercial_year
      and y.main_activity = v_entity.main_activity;
  end if;

  if v_peer_count >= 30 then
    v_level := 'ACTIVITY';
    v_label := v_entity.main_activity;
  else
    v_level := 'SECTOR';
    v_label := v_entity.economic_sector;
    select count(*)
      into v_peer_count
    from public.aml_sii_entity_year y
    where y.commercial_year = v_entity.commercial_year
      and y.economic_sector is not distinct from v_entity.economic_sector;
  end if;

  if nullif(btrim(coalesce(v_label, '')), '') is null or v_peer_count = 0 then
    return null;
  end if;

  select
    count(*) filter (where y.termination_date is null),
    coalesce(sum(y.workers_numeric), 0),
    round(avg(y.workers_numeric) filter (where y.workers_numeric is not null), 1),
    count(*) filter (
      where y.activity_start_date >= make_date(greatest(v_entity.commercial_year - 4, 1900), 1, 1)
        and y.activity_start_date < make_date(v_entity.commercial_year + 1, 1, 1)
    ),
    count(*) filter (
      where y.termination_date >= make_date(greatest(v_entity.commercial_year - 4, 1900), 1, 1)
        and y.termination_date < make_date(v_entity.commercial_year + 1, 1, 1)
    )
    into v_active_count, v_workers_total, v_workers_avg, v_starts_5y, v_terms_5y
  from public.aml_sii_entity_year y
  where y.commercial_year = v_entity.commercial_year
    and (
      (v_level = 'ACTIVITY' and y.main_activity = v_entity.main_activity)
      or (v_level = 'SECTOR' and y.economic_sector is not distinct from v_entity.economic_sector)
    );

  select count(*)
    into v_prior_count
  from public.aml_sii_entity_year y
  where y.commercial_year = v_entity.commercial_year - 4
    and (
      (v_level = 'ACTIVITY' and y.main_activity = v_entity.main_activity)
      or (v_level = 'SECTOR' and y.economic_sector is not distinct from v_entity.economic_sector)
    );

  if v_prior_count > 0 then
    v_growth := round(((v_peer_count::numeric / v_prior_count::numeric) - 1) * 100, 1);
  end if;

  select jsonb_build_object(
    'micro', round(100.0 * count(*) filter (where y.sales_band_rank between 2 and 4) / nullif(count(*) filter (where y.sales_band_rank between 2 and 13), 0), 1),
    'small', round(100.0 * count(*) filter (where y.sales_band_rank between 5 and 7) / nullif(count(*) filter (where y.sales_band_rank between 2 and 13), 0), 1),
    'medium', round(100.0 * count(*) filter (where y.sales_band_rank between 8 and 9) / nullif(count(*) filter (where y.sales_band_rank between 2 and 13), 0), 1),
    'large', round(100.0 * count(*) filter (where y.sales_band_rank between 10 and 13) / nullif(count(*) filter (where y.sales_band_rank between 2 and 13), 0), 1),
    'with_sales_band', count(*) filter (where y.sales_band_rank between 2 and 13)
  )
    into v_size_mix
  from public.aml_sii_entity_year y
  where y.commercial_year = v_entity.commercial_year
    and (
      (v_level = 'ACTIVITY' and y.main_activity = v_entity.main_activity)
      or (v_level = 'SECTOR' and y.economic_sector is not distinct from v_entity.economic_sector)
    );

  select coalesce(jsonb_agg(jsonb_build_object('region', r.region, 'entities', r.entities) order by r.entities desc), '[]'::jsonb)
    into v_regions
  from (
    select coalesce(nullif(btrim(y.region), ''), 'Sin región') as region, count(*)::bigint as entities
    from public.aml_sii_entity_year y
    where y.commercial_year = v_entity.commercial_year
      and (
        (v_level = 'ACTIVITY' and y.main_activity = v_entity.main_activity)
        or (v_level = 'SECTOR' and y.economic_sector is not distinct from v_entity.economic_sector)
      )
    group by 1
    order by 2 desc
    limit 5
  ) r;

  select b.peer_level, b.peer_n, b.sales_peer_percentile
    into v_benchmark
  from public.aml_v_ipa3_sii_peer_benchmark b
  where b.entity_id = p_entity_id
    and b.commercial_year = v_entity.commercial_year
  limit 1;

  return jsonb_build_object(
    'available', true,
    'coverage_kind', 'ATLAS_SII_OBSERVED_COHORT',
    'comparison_level', v_level,
    'label', v_label,
    'economic_sector', v_entity.economic_sector,
    'main_activity', v_entity.main_activity,
    'commercial_year', v_entity.commercial_year,
    'peer_count', v_peer_count,
    'active_count', v_active_count,
    'workers_total', v_workers_total,
    'workers_avg', v_workers_avg,
    'observed_growth_5y_pct', v_growth,
    'starts_5y', v_starts_5y,
    'terminations_5y', v_terms_5y,
    'size_mix', v_size_mix,
    'top_regions', v_regions,
    'entity_sales_band_rank', v_entity.sales_band_rank,
    'entity_workers', v_entity.workers_numeric,
    'peer_position', case when v_benchmark.peer_n is null then null else jsonb_build_object(
      'peer_level', v_benchmark.peer_level,
      'peer_n', v_benchmark.peer_n,
      'sales_percentile_pct', round(v_benchmark.sales_peer_percentile::numeric * 100, 1)
    ) end,
    'method_note', 'Referencia descriptiva sobre la cohorte SII observada por Atlas. No equivale al universo nacional del sector y no modifica IPA3.'
  );
end;
$$;

revoke all on function public.obs_sii_entity_sector_context(text) from public, anon;
grant execute on function public.obs_sii_entity_sector_context(text) to authenticated, service_role;
comment on function public.obs_sii_entity_sector_context(text) is
'Referencia economica sectorial para Entidad 360. Usa cohortes SII observadas y benchmark IPA3 ya gobernado; es descriptiva, no una señal de riesgo.';

create or replace function public.obs_uaf_sector_economic_context(p_sector text)
returns jsonb
language plpgsql
stable
security invoker
set search_path to 'public', 'pg_temp'
as $$
declare
  v_total bigint := 0;
  v_mapped bigint := 0;
  v_year integer;
  v_observed bigint := 0;
  v_workers numeric := 0;
  v_growth numeric := null;
  v_prior bigint := 0;
  v_size_mix jsonb := '{}'::jsonb;
  v_activities jsonb := '[]'::jsonb;
begin
  if nullif(btrim(coalesce(p_sector, '')), '') is null then
    return null;
  end if;

  select count(*), count(*) filter (where nullif(btrim(s.main_activity), '') is not null)
    into v_total, v_mapped
  from public.obs_uaf_subject s
  where s.uaf_sector = p_sector;

  if v_total = 0 then
    return null;
  end if;

  select max(y.commercial_year) into v_year
  from public.aml_sii_entity_year y;

  with top_activities as (
    select s.main_activity, count(*)::bigint as uaf_subjects
    from public.obs_uaf_subject s
    where s.uaf_sector = p_sector
      and nullif(btrim(s.main_activity), '') is not null
    group by s.main_activity
    order by count(*) desc, s.main_activity
    limit 5
  ), observed as (
    select y.main_activity, count(*)::bigint as observed_entities
    from public.aml_sii_entity_year y
    where y.commercial_year = v_year
      and y.main_activity in (select t.main_activity from top_activities t)
    group by y.main_activity
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'activity', t.main_activity,
      'uaf_subjects', t.uaf_subjects,
      'observed_entities', coalesce(o.observed_entities, 0)
    ) order by t.uaf_subjects desc, t.main_activity), '[]'::jsonb)
    into v_activities
  from top_activities t
  left join observed o using (main_activity);

  with top_activities as (
    select s.main_activity
    from public.obs_uaf_subject s
    where s.uaf_sector = p_sector
      and nullif(btrim(s.main_activity), '') is not null
    group by s.main_activity
    order by count(*) desc, s.main_activity
    limit 5
  ), cohort as (
    select y.*
    from public.aml_sii_entity_year y
    where y.commercial_year = v_year
      and y.main_activity in (select main_activity from top_activities)
  )
  select
    count(*),
    coalesce(sum(c.workers_numeric), 0),
    jsonb_build_object(
      'micro', round(100.0 * count(*) filter (where c.sales_band_rank between 2 and 4) / nullif(count(*) filter (where c.sales_band_rank between 2 and 13), 0), 1),
      'small', round(100.0 * count(*) filter (where c.sales_band_rank between 5 and 7) / nullif(count(*) filter (where c.sales_band_rank between 2 and 13), 0), 1),
      'medium', round(100.0 * count(*) filter (where c.sales_band_rank between 8 and 9) / nullif(count(*) filter (where c.sales_band_rank between 2 and 13), 0), 1),
      'large', round(100.0 * count(*) filter (where c.sales_band_rank between 10 and 13) / nullif(count(*) filter (where c.sales_band_rank between 2 and 13), 0), 1),
      'with_sales_band', count(*) filter (where c.sales_band_rank between 2 and 13)
    )
    into v_observed, v_workers, v_size_mix
  from cohort c;

  with top_activities as (
    select s.main_activity
    from public.obs_uaf_subject s
    where s.uaf_sector = p_sector
      and nullif(btrim(s.main_activity), '') is not null
    group by s.main_activity
    order by count(*) desc, s.main_activity
    limit 5
  )
  select count(*) into v_prior
  from public.aml_sii_entity_year y
  where y.commercial_year = v_year - 4
    and y.main_activity in (select main_activity from top_activities);

  if v_prior > 0 then
    v_growth := round(((v_observed::numeric / v_prior::numeric) - 1) * 100, 1);
  end if;

  return jsonb_build_object(
    'available', true,
    'coverage_kind', 'ATLAS_SII_OBSERVED_COHORT',
    'uaf_sector', p_sector,
    'uaf_subjects', v_total,
    'uaf_subjects_with_sii_activity', v_mapped,
    'uaf_mapping_pct', round(100.0 * v_mapped / nullif(v_total, 0), 1),
    'commercial_year', v_year,
    'observed_comparable_entities', v_observed,
    'observed_workers_total', v_workers,
    'observed_growth_5y_pct', v_growth,
    'size_mix', v_size_mix,
    'top_activities', v_activities,
    'method_note', 'Base comparable observada en Atlas a partir de las principales actividades SII presentes en el sector UAF. No equivale al universo nacional ni a una brecha regulatoria.'
  );
end;
$$;

revoke all on function public.obs_uaf_sector_economic_context(text) from public, anon;
grant execute on function public.obs_uaf_sector_economic_context(text) to authenticated, service_role;
comment on function public.obs_uaf_sector_economic_context(text) is
'Contexto economico SII para Padrón SO. Resume la base comparable observada de las principales actividades tributarias del sector UAF sin inferir cobertura regulatoria.';