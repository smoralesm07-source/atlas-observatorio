create table if not exists public.aml_sii_entity_history (
  entity_id text not null,
  commercial_year integer not null,
  rut text,
  legal_name text,
  sales_band text,
  sales_band_code text,
  sales_band_rank integer,
  workers_numeric integer,
  region text,
  commune text,
  economic_sector text,
  economic_subsector text,
  main_activity text,
  activity_start_date date,
  termination_date date,
  source_run_id text,
  source_manifest jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (entity_id, commercial_year),
  constraint aml_sii_entity_history_year_chk check (commercial_year between 1900 and 2200),
  constraint aml_sii_entity_history_sales_band_rank_chk check (sales_band_rank is null or sales_band_rank between 1 and 13),
  constraint aml_sii_entity_history_workers_chk check (workers_numeric is null or workers_numeric >= 0)
);

create index if not exists aml_sii_entity_history_rut_year_idx
  on public.aml_sii_entity_history (rut, commercial_year desc);

alter table public.aml_sii_entity_history enable row level security;
revoke all on table public.aml_sii_entity_history from anon, authenticated;
grant select, insert, update, delete on table public.aml_sii_entity_history to service_role;

comment on table public.aml_sii_entity_history is
  'Serie anual SII source-native por entidad, independiente del universo canónico Atlas; alimenta Evolución tributaria de Entidades 360.';

create or replace function public.obs_entity_tax_history(p_entity_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public', 'atlas_v2_private', 'extensions'
as $function$
declare
  v_result jsonb;
begin
  if not (
    current_user = 'service_role'
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

  with combined as (
    select
      y.entity_id,
      y.commercial_year,
      y.sales_band_code::text as sales_band,
      y.sales_band_code::text as sales_band_code,
      y.sales_band_rank,
      y.workers_numeric,
      y.region,
      y.main_activity,
      y.economic_sector,
      y.economic_subsector,
      'RADAR_SII_COMPANY_YEAR_CANONICAL'::text as source,
      1 as source_priority
    from public.aml_sii_entity_year y
    where y.entity_id = p_entity_id

    union all

    select
      h.entity_id,
      h.commercial_year,
      h.sales_band,
      h.sales_band_code,
      h.sales_band_rank,
      h.workers_numeric,
      h.region,
      h.main_activity,
      h.economic_sector,
      h.economic_subsector,
      'RADAR_SII_COMPANY_YEAR_SOURCE_NATIVE'::text as source,
      2 as source_priority
    from public.aml_sii_entity_history h
    where h.entity_id = p_entity_id
  ), dedup as (
    select distinct on (commercial_year)
      commercial_year,
      sales_band,
      sales_band_code,
      sales_band_rank,
      public.obs_sales_band_uf(sales_band_rank) as sales_band_uf,
      public.obs_sales_band_size(sales_band_rank) as size_label,
      workers_numeric,
      region,
      main_activity,
      economic_sector,
      economic_subsector,
      source
    from combined
    order by commercial_year, source_priority asc
  )
  select coalesce(jsonb_agg(to_jsonb(d) order by d.commercial_year), '[]'::jsonb)
  into v_result
  from dedup d;

  return v_result;
end;
$function$;

revoke all on function public.obs_entity_tax_history(text) from public, anon;
grant execute on function public.obs_entity_tax_history(text) to authenticated, service_role;
