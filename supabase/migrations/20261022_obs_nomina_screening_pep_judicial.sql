-- Cribado de nóminas: PEP y Poder Judicial desde fuentes abiertas.
--
-- PEP. No existe un listado PEP oficial y público en Chile. La fuente abierta
-- más amplia son las declaraciones de intereses y patrimonio (Ley 20.880) que
-- publica InfoProbidad, más las nóminas del Senado y la Cámara. OpenSanctions
-- las estructura como datasets PEP (cl_info_probidad, cl_senate,
-- cl_chamber_deputies); atlas-pep-ingest los descarga y los deja aquí.
-- Ninguno trae RUT: toda coincidencia es por nombre y es CANDIDATA.
--
-- Poder Judicial. No hay fuente abierta masiva: la Consulta Unificada de Causas
-- es individual, con CAPTCHA, y busca por RUT sólo a personas jurídicas. Este
-- módulo no la automatiza. Registra la verificación que hace el analista, para
-- que la nómina distinga «sin causas verificado» de «no consultada».
--
-- Todo es aditivo: sólo se crean objetos con prefijo obs_.

create extension if not exists pg_trgm with schema extensions;

/* ───────────────────────────────────────────────────── registro PEP */

create table if not exists public.obs_pep_record (
  record_id     text primary key,
  dataset       text not null,
  name          text not null,
  name_search   text not null,
  name_tokens   text not null,
  aliases       text[] not null default '{}'::text[],
  positions     text[] not null default '{}'::text[],
  source_url    text,
  first_seen    timestamptz,
  last_seen     timestamptz,
  load_id       uuid not null,
  loaded_at     timestamptz not null default now()
);
comment on table public.obs_pep_record is
  'Personas expuestas políticamente desde fuentes abiertas (vía OpenSanctions). Sin RUT: el cruce es por nombre y produce candidatos, nunca identidad.';
comment on column public.obs_pep_record.name_tokens is
  'Tokens del nombre normalizado, ordenados. Hace comparable «PEREZ SOTO JUAN» con «Juan Pérez Soto».';

create index if not exists obs_pep_record_tokens_idx on public.obs_pep_record (name_tokens);
create index if not exists obs_pep_record_tokens_trgm_idx
  on public.obs_pep_record using gin (name_tokens extensions.gin_trgm_ops);
create index if not exists obs_pep_record_dataset_idx on public.obs_pep_record (dataset);

create table if not exists public.obs_pep_load (
  load_id      uuid primary key default gen_random_uuid(),
  dataset      text not null,
  status       text not null check (status in ('RUNNING','LOADED','FAILED')),
  source_url   text not null,
  row_count    integer,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  error        text
);
create index if not exists obs_pep_load_dataset_idx on public.obs_pep_load (dataset, finished_at desc);
comment on table public.obs_pep_load is
  'Bitácora de cargas PEP. Un dataset sin carga LOADED no se consultó: el cribado lo declara como NO_CONSULTADA, nunca como sin registro.';

create or replace function public.obs_name_tokens(p text)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog, pg_temp
as $$
  select coalesce(string_agg(t, ' ' order by t), '')
  from unnest(string_to_array(public.obs_normalize_text(p), ' ')) as t
  where length(t) > 1 and t not in ('de','del','la','las','los','y','van','von');
$$;

/* Recibe un lote de atlas-pep-ingest. Sólo service_role. */
create or replace function public.obs_pep_ingest_batch(p_load_id uuid, p_dataset text, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_n integer;
begin
  insert into public.obs_pep_record
    (record_id, dataset, name, name_search, name_tokens, aliases, positions,
     source_url, first_seen, last_seen, load_id, loaded_at)
  select r->>'id', p_dataset, r->>'name',
         public.obs_normalize_text(r->>'name'), public.obs_name_tokens(r->>'name'),
         coalesce(array(select jsonb_array_elements_text(r->'aliases')), '{}'),
         coalesce(array(select jsonb_array_elements_text(r->'positions')), '{}'),
         nullif(r->>'source_url',''),
         nullif(r->>'first_seen','')::timestamptz, nullif(r->>'last_seen','')::timestamptz,
         p_load_id, now()
  from jsonb_array_elements(p_rows) r
  where coalesce(r->>'id','') <> '' and coalesce(r->>'name','') <> ''
  on conflict (record_id) do update set
    dataset = excluded.dataset, name = excluded.name, name_search = excluded.name_search,
    name_tokens = excluded.name_tokens, aliases = excluded.aliases, positions = excluded.positions,
    source_url = excluded.source_url, first_seen = excluded.first_seen, last_seen = excluded.last_seen,
    load_id = excluded.load_id, loaded_at = excluded.loaded_at;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

/* Cierra una carga: marca LOADED y retira los registros que la fuente ya no publica. */
create or replace function public.obs_pep_finish_load(p_load_id uuid, p_status text, p_error text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_dataset text; v_rows integer; v_removed integer := 0;
begin
  select dataset into v_dataset from public.obs_pep_load where load_id = p_load_id;
  if v_dataset is null then raise exception 'PEP_LOAD_NOT_FOUND'; end if;
  if p_status = 'LOADED' then
    delete from public.obs_pep_record where dataset = v_dataset and load_id <> p_load_id;
    get diagnostics v_removed = row_count;
  end if;
  select count(*) into v_rows from public.obs_pep_record where load_id = p_load_id;
  update public.obs_pep_load
     set status = p_status, finished_at = now(), row_count = v_rows, error = p_error
   where load_id = p_load_id;
  return jsonb_build_object('dataset', v_dataset, 'status', p_status, 'rows', v_rows, 'removed', v_removed);
end $$;

/* ─────────────────────────────────────── verificación judicial asistida */

create table if not exists public.obs_judicial_check (
  check_id     uuid primary key default gen_random_uuid(),
  rut_search   text not null,
  name         text,
  result       text not null check (result in ('CON_CAUSAS','SIN_CAUSAS','NO_VERIFICABLE')),
  detail       text,
  source       text not null default 'PJUD_CONSULTA_UNIFICADA',
  checked_by   uuid not null default auth.uid(),
  checked_at   timestamptz not null default now()
);
create index if not exists obs_judicial_check_rut_idx on public.obs_judicial_check (rut_search, checked_at desc);
comment on table public.obs_judicial_check is
  'Resultado de una consulta manual al Poder Judicial, registrado por el analista. Es una constancia de verificación, no un antecedente penal ni una calificación.';

/* ──────────────────────────────────────────────────────────── RLS */

alter table public.obs_pep_record     enable row level security;
alter table public.obs_pep_load       enable row level security;
alter table public.obs_judicial_check enable row level security;

do $$
declare t text;
begin
  foreach t in array array['obs_pep_record','obs_pep_load','obs_judicial_check'] loop
    execute format('drop policy if exists %I on public.%I', t || '_allowed_read', t);
    execute format($p$
      create policy %I on public.%I
        for select to authenticated
        using (exists (
          select 1 from public.aml_allowed_users au
          where au.user_id = (select auth.uid()) and au.enabled))
    $p$, t || '_allowed_read', t);
  end loop;
end $$;

drop policy if exists obs_judicial_check_allowed_insert on public.obs_judicial_check;
create policy obs_judicial_check_allowed_insert on public.obs_judicial_check
  for insert to authenticated
  with check (
    checked_by = (select auth.uid())
    and exists (select 1 from public.aml_allowed_users au
                where au.user_id = (select auth.uid()) and au.enabled));

revoke all on public.obs_pep_record, public.obs_pep_load, public.obs_judicial_check from anon;
grant select on public.obs_pep_record, public.obs_pep_load to authenticated;
grant select, insert on public.obs_judicial_check to authenticated;

/* ─────────────────────────────────────────────────── utilidades RUT */

create or replace function public.obs_rut_clean(p text)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog, pg_temp
as $$ select regexp_replace(upper(coalesce(p,'')), '[^0-9K]', '', 'g') $$;

/* Dígito verificador módulo 11. */
create or replace function public.obs_rut_is_valid(p text)
returns boolean
language plpgsql
immutable
parallel safe
set search_path = pg_catalog, pg_temp
as $$
declare
  v text := public.obs_rut_clean(p);
  v_body text; v_dv text; v_sum int := 0; v_mul int := 2; v_res int; i int;
begin
  if v !~ '^[0-9]{1,9}[0-9K]$' then return false; end if;
  v_body := left(v, length(v) - 1);
  v_dv := right(v, 1);
  for i in reverse length(v_body)..1 loop
    v_sum := v_sum + substr(v_body, i, 1)::int * v_mul;
    v_mul := case when v_mul = 7 then 2 else v_mul + 1 end;
  end loop;
  v_res := 11 - (v_sum % 11);
  return v_dv = case v_res when 11 then '0' when 10 then 'K' else v_res::text end;
end $$;

/* ───────────────────────────────────────────── contrato de cribado */

/* Recibe la nómina como [{rut, name}] (máx. 2.000 filas) y devuelve, por fila,
   el estado de cada línea con tres valores posibles: CON_REGISTRO, SIN_REGISTRO
   o NO_CONSULTADA (más SIN_NOMBRE cuando no hay con qué cruzar). */
create or replace function public.obs_nomina_screen(p_rows jsonb)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, extensions, pg_temp
as $$
declare
  v_pep_loads jsonb;
  v_pep_ready boolean;
  v_rows jsonb;
begin
  if not exists (select 1 from public.aml_allowed_users au where au.user_id = auth.uid() and au.enabled) then
    raise exception 'Acceso no habilitado para Atlas Observatorio' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'NOMINA_VACIA' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) > 2000 then
    raise exception 'NOMINA_EXCEDE_2000_FILAS' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'dataset', l.dataset, 'row_count', l.row_count, 'loaded_at', l.finished_at)
           order by l.dataset), '[]'::jsonb),
         count(*) > 0
    into v_pep_loads, v_pep_ready
  from (select distinct on (dataset) dataset, row_count, finished_at
          from public.obs_pep_load where status = 'LOADED'
         order by dataset, finished_at desc) l;

  perform set_config('pg_trgm.similarity_threshold', '0.6', true);

  with input as (
    select ord,
           nullif(trim(r->>'rut'), '')  as rut_raw,
           public.obs_rut_clean(r->>'rut') as rut_search,
           nullif(trim(r->>'name'), '') as name_raw
    from jsonb_array_elements(p_rows) with ordinality as x(r, ord)
  ),
  resolved as (
    select i.*,
           public.obs_rut_is_valid(i.rut_raw) as rut_valid,
           coalesce(i.name_raw, e.name) as name,
           case when i.name_raw is not null then 'NOMINA'
                when e.name is not null then 'UNIVERSO_ATLAS' end as name_basis,
           e.entity_id, e.entity_type
    from input i
    left join lateral (
      select o.entity_id, o.name, o.entity_type
      from public.obs_entity o
      where i.rut_search <> '' and o.rut_search = i.rut_search
      limit 1) e on true
  ),
  pep as (
    select r.ord,
           coalesce(jsonb_agg(jsonb_build_object(
             'record_id', c.record_id, 'dataset', c.dataset, 'name', c.name,
             'positions', c.positions, 'source_url', c.source_url,
             'match_method', c.method, 'match_confidence', c.score)
             order by c.score desc) filter (where c.record_id is not null), '[]'::jsonb) as candidates
    from resolved r
    left join lateral (
      select p.record_id, p.dataset, p.name, p.positions, p.source_url,
             case when p.name_tokens = public.obs_name_tokens(r.name) then 'NOMBRE_EXACTO'
                  else 'NOMBRE_APROXIMADO' end as method,
             round(case when p.name_tokens = public.obs_name_tokens(r.name) then 0.99
                        else similarity(p.name_tokens, public.obs_name_tokens(r.name)) end::numeric, 2) as score
      from public.obs_pep_record p
      where r.name is not null
        and public.obs_name_tokens(r.name) <> ''
        and p.name_tokens % public.obs_name_tokens(r.name)
      order by p.name_tokens <-> public.obs_name_tokens(r.name)
      limit 3) c on true
    group by r.ord
  ),
  judicial as (
    select distinct on (j.rut_search) j.rut_search, j.result, j.detail, j.checked_at
    from public.obs_judicial_check j
    where j.rut_search in (select rut_search from resolved where rut_search <> '')
    order by j.rut_search, j.checked_at desc
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'row', r.ord,
    'rut', r.rut_raw,
    'rut_search', nullif(r.rut_search, ''),
    'rut_valid', r.rut_valid,
    'name', r.name,
    'name_basis', r.name_basis,
    'entity_id', r.entity_id,
    'entity_type', r.entity_type,
    'pep', jsonb_build_object(
      'status', case when not v_pep_ready then 'NO_CONSULTADA'
                     when r.name is null then 'SIN_NOMBRE'
                     when jsonb_array_length(p.candidates) > 0 then 'CON_REGISTRO'
                     else 'SIN_REGISTRO' end,
      'candidates', p.candidates),
    'judicial', case when j.rut_search is null
      then jsonb_build_object('status', 'NO_CONSULTADA', 'reason', 'SIN_FUENTE_ABIERTA_MASIVA')
      else jsonb_build_object(
        'status', case j.result when 'CON_CAUSAS' then 'CON_REGISTRO'
                                when 'SIN_CAUSAS' then 'SIN_REGISTRO'
                                else 'NO_CONSULTADA' end,
        'result', j.result, 'detail', j.detail, 'checked_at', j.checked_at) end
  ) order by r.ord), '[]'::jsonb)
  into v_rows
  from resolved r
  join pep p on p.ord = r.ord
  left join judicial j on j.rut_search = r.rut_search;

  return jsonb_build_object(
    'screened_at', now(),
    'pep_sources', v_pep_loads,
    'rows', v_rows,
    'guardrails', jsonb_build_object(
      'persisted', false,
      'pep_match', 'Coincidencia por nombre: las fuentes PEP no publican RUT. Es candidata hasta que el analista la confirme.',
      'judicial', 'Sin fuente abierta masiva. Sólo se informa lo verificado y registrado por un analista.'));
end $$;

revoke all on function public.obs_nomina_screen(jsonb) from public, anon;
grant execute on function public.obs_nomina_screen(jsonb) to authenticated;

/* Registra una verificación judicial hecha a mano. */
create or replace function public.obs_judicial_check_record(
  p_rut text, p_result text, p_detail text default null, p_name text default null)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare v_row public.obs_judicial_check;
begin
  if not public.obs_rut_is_valid(p_rut) then
    raise exception 'RUT_INVALIDO' using errcode = '22023';
  end if;
  insert into public.obs_judicial_check (rut_search, name, result, detail)
  values (public.obs_rut_clean(p_rut), nullif(trim(p_name), ''), p_result, nullif(trim(p_detail), ''))
  returning * into v_row;
  return to_jsonb(v_row);
end $$;

revoke all on function public.obs_judicial_check_record(text, text, text, text) from public, anon;
grant execute on function public.obs_judicial_check_record(text, text, text, text) to authenticated;

revoke all on function public.obs_pep_ingest_batch(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.obs_pep_finish_load(uuid, text, text) from public, anon, authenticated;
grant execute on function public.obs_pep_ingest_batch(uuid, text, jsonb) to service_role;
grant execute on function public.obs_pep_finish_load(uuid, text, text) to service_role;

/* ───────────────────────────────────────────────────── agenda semanal */

create or replace function public.obs_pep_trigger_ingest()
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_token text; v_request bigint;
begin
  select decrypted_secret into v_token from vault.decrypted_secrets where name = 'atlas_pep_cron_token' limit 1;
  if v_token is null then raise exception 'PEP_CRON_TOKEN_MISSING'; end if;
  select net.http_post(
    url := 'https://ldmtlwzqaqmegedktlxr.supabase.co/functions/v1/atlas-pep-ingest',
    body := '{}'::jsonb,
    headers := jsonb_build_object('content-type', 'application/json', 'x-atlas-cron-token', v_token),
    timeout_milliseconds := 300000) into v_request;
  return v_request;
end $$;
revoke all on function public.obs_pep_trigger_ingest() from public, anon, authenticated;
grant execute on function public.obs_pep_trigger_ingest() to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'obs_pep_ingest_weekly';
    perform cron.schedule('obs_pep_ingest_weekly', '17 6 * * 1', 'select public.obs_pep_trigger_ingest()');
  end if;
end $$;
