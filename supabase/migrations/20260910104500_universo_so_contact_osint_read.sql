create or replace function public.obs_uaf_contact_osint(
  p_rut text,
  p_entity_id text default null
)
returns table (
  contact_id uuid,
  contact_type text,
  contact_value text,
  source_label text,
  source_url text,
  confidence_pct numeric,
  verification_status text,
  evidence_note text,
  evidence_count integer,
  source_domains text[],
  last_observed_at timestamptz,
  updated_at timestamptz,
  analyst_note text
)
language sql
stable
security invoker
set search_path = public, extensions, pg_temp
as $$
  select
    c.contact_id,
    c.contact_type,
    c.contact_value,
    c.source_label,
    c.source_url,
    c.confidence_pct,
    c.verification_status,
    c.evidence_note,
    coalesce(c.evidence_count, 1),
    c.source_domains,
    c.last_observed_at,
    c.updated_at,
    c.analyst_note
  from public.aml_uaf_candidate_contact_osint c
  where
    (
      regexp_replace(upper(coalesce(c.rut, '')), '[^0-9K]', '', 'g') =
      regexp_replace(upper(coalesce(p_rut, '')), '[^0-9K]', '', 'g')
      or (
        nullif(btrim(p_entity_id), '') is not null
        and c.entity_id = p_entity_id
      )
    )
    and coalesce(c.verification_status, 'NO_VERIFICADO') <> 'DESCARTADO'
  order by
    case coalesce(c.verification_status, 'NO_VERIFICADO')
      when 'VERIFICADO' then 0
      when 'PROBABLE' then 1
      else 2
    end,
    c.confidence_pct desc nulls last,
    c.last_observed_at desc nulls last,
    c.updated_at desc
  limit 24;
$$;

comment on function public.obs_uaf_contact_osint(text, text) is
  'Read model de contactos observados en fuentes abiertas para una entidad de Universo SO. Los hallazgos no acreditan vigencia ni representación y excluyen los descartados por analista.';

revoke all on function public.obs_uaf_contact_osint(text, text) from public, anon;
grant execute on function public.obs_uaf_contact_osint(text, text) to authenticated, service_role;

create or replace function public.obs_uaf_contact_osint_coverage(p_ruts text[])
returns table (
  rut_key text,
  finding_count bigint,
  channel_count bigint,
  verified_count bigint,
  probable_count bigint,
  last_observed_at timestamptz
)
language sql
stable
security invoker
set search_path = public, extensions, pg_temp
as $$
  with wanted as (
    select distinct regexp_replace(upper(coalesce(x, '')), '[^0-9K]', '', 'g') as rut_key
    from unnest(coalesce(p_ruts, array[]::text[])) x
    where nullif(regexp_replace(upper(coalesce(x, '')), '[^0-9K]', '', 'g'), '') is not null
  )
  select
    regexp_replace(upper(coalesce(c.rut, '')), '[^0-9K]', '', 'g') as rut_key,
    count(*)::bigint as finding_count,
    count(distinct c.contact_type)::bigint as channel_count,
    count(*) filter (where c.verification_status = 'VERIFICADO')::bigint as verified_count,
    count(*) filter (where c.verification_status = 'PROBABLE')::bigint as probable_count,
    max(c.last_observed_at) as last_observed_at
  from public.aml_uaf_candidate_contact_osint c
  join wanted w
    on w.rut_key = regexp_replace(upper(coalesce(c.rut, '')), '[^0-9K]', '', 'g')
  where coalesce(c.verification_status, 'NO_VERIFICADO') <> 'DESCARTADO'
  group by 1;
$$;

comment on function public.obs_uaf_contact_osint_coverage(text[]) is
  'Cobertura liviana de hallazgos de contacto abierto para las filas visibles de Universo SO.';

revoke all on function public.obs_uaf_contact_osint_coverage(text[]) from public, anon;
grant execute on function public.obs_uaf_contact_osint_coverage(text[]) to authenticated, service_role;
