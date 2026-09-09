-- ATLAS Observatorio · Quienes son los potenciales sujetos obligados
--
-- La vista Cobertura publicaba la brecha en agregado: 79.449 RUT observados,
-- 34 gatillantes, la razon por sector. Todo cierto y todo inutil para el turno
-- de un analista, porque ninguna de esas cifras se puede abrir: la linea base
-- llegaba declarada y sin RUT, de modo que la pantalla decia CUANTOS faltan y
-- jamas QUIENES son.
--
-- El dato existia. aml_v_uaf_potential_screening_current_v0812 resuelve entidad
-- por entidad 74.087 observaciones y, sobre ellas, califica 115 con hipotesis
-- de registro accionable: con su indice IVO desglosado, su materialidad, su
-- coherencia de tipo, su territorio, su escala, su estructura societaria y su
-- estado de revision. Nada de eso habia llegado nunca a la interfaz.
--
-- Esta migracion lo publica como read model gobernado, en tres piezas que
-- responden tres preguntas distintas:
--
--   * obs_uaf_potential_total    · de cuanto a cuanto baja el embudo.
--   * obs_uaf_potential_sector   · donde se concentra lo observado.
--   * obs_uaf_potential_candidate· quienes son, uno por uno, los accionables.
--
-- LIMITES DECLARADOS, para que la interfaz no afirme mas de lo que sabe:
--
--  * El candidato es una HIPOTESIS DE REGISTRO, nunca un incumplimiento. La
--    semantica que viaja con cada fila lo dice literal:
--    REGISTRATION_HYPOTHESIS_NOT_PROVEN_NON_COMPLIANCE. Declarar un giro
--    alcanzado no prueba que la entidad reuna los elementos que activan la
--    obligacion de inscribirse.
--  * El IVO ordena revision. No es probabilidad de obligacion ni de LA/FT, y su
--    componente de evidencia regulatoria directa vale 0 en todo el corte: hoy
--    ninguno de los 115 tiene un acto regulatorio que lo respalde, y el indice
--    publica esa ausencia en vez de compensarla.
--  * La credibilidad del IVO se publica junto al puntaje. Un 90 % no es certeza
--    sobre la entidad: es cuanta de la evidencia que el indice espera estaba
--    disponible al calcularlo.
--  * La materialidad mide el costo de incorporar, no la gravedad de nada.
--  * Las 73.972 observaciones no calificadas no traen territorio, escala ni
--    indice: solo nombre, estado y sector implicito. La interfaz las usa como
--    contexto agregado y nunca las presenta como una cola de trabajo.
--  * Ausencia del corte publico UAF no equivale a no estar inscrita.

------------------------------------------------------------------ read model

create table if not exists public.obs_uaf_potential_total (
  singleton          boolean primary key default true check (singleton),
  observadas         integer not null,
  con_res            integer not null,
  accionables        integer not null,
  revisados          integer not null,
  sin_revisar        integer not null,
  sectores           integer not null,
  ivo_medio          numeric,
  ivo_max            numeric,
  materialidad_media numeric,
  -- Corte y procedencia, para que la pantalla no invente su propia fecha.
  sii_periodo        text,
  uaf_corte          text,
  index_version      text,
  refreshed_at       timestamptz not null default now()
);
comment on table public.obs_uaf_potential_total is
  'Embudo de calificacion del screening: de las entidades observadas a las que tienen hipotesis de registro accionable. Ninguna cifra acredita incumplimiento.';

create table if not exists public.obs_uaf_potential_sector (
  sector             text primary key,
  observadas         integer not null,
  con_res            integer not null,
  accionables        integer not null,
  ivo_medio          numeric,
  materialidad_media numeric,
  refreshed_at       timestamptz not null default now()
);
comment on table public.obs_uaf_potential_sector is
  'Distribucion del universo observado por sector implicito. Observadas incluye a las no calificadas; accionables es el subconjunto con hipotesis de registro.';

create table if not exists public.obs_uaf_potential_candidate (
  rut                     text primary key,
  entity_id               text,
  name                    text not null,
  name_search             text,
  rut_search              text,
  -- Por que aparece
  implied_sector          text,
  uaf_sectors             text[],
  matched_activity        text,
  activity_codes          text[],
  -- Cuan caracteristico es ese giro del sector: 0..1
  activity_concentration  numeric,
  activity_registered_n   integer,
  activity_universe_n     integer,
  evidence_class          text,
  detection_tier          text,
  type_coherence_class    text,
  type_share_in_sector    numeric,
  -- Cuanto ordena mirar
  ivo_score               numeric,
  ivo_band                text,
  ivo_credibility_pct     numeric,
  ivo_components          jsonb,
  materiality_score       numeric,
  materiality_components  jsonb,
  -- Quien es
  region                  text,
  commune                 text,
  sii_status              text,
  sii_activity_start_date date,
  activity_years          integer,
  sales_band_rank         integer,
  sales_band_uf           text,
  sales_band_size         text,
  workers                 bigint,
  ownership_edge_count    integer,
  legal_entity_partner_count integer,
  societies_as_partner_count integer,
  -- Que lo respalda
  source_count            integer,
  screening_evidence_count integer,
  res_available           boolean not null default false,
  res_constitution_date   date,
  uaf_sanction_events     integer not null default 0,
  uaf_sanction_last_date  date,
  flags                   text[],
  -- En que va
  review_state            text,
  review_reason_code      text,
  review_rationale        text,
  reviewed_at             timestamptz,
  reviewed_by_email       text,
  semantics               text,
  refreshed_at            timestamptz not null default now()
);
comment on table public.obs_uaf_potential_candidate is
  'Entidad con hipotesis de registro accionable: opera vigente en el corte y declara un giro caracteristico de un sector obligado. Es una hipotesis de inscripcion, jamas una imputacion de incumplimiento.';
comment on column public.obs_uaf_potential_candidate.ivo_score is
  'Indice de verosimilitud de obligacion. Ordena revision; no es probabilidad de obligacion ni de LA/FT.';
comment on column public.obs_uaf_potential_candidate.ivo_credibility_pct is
  'Cuanta de la evidencia que el indice espera estaba disponible al calcularlo. No es certeza sobre la entidad.';
comment on column public.obs_uaf_potential_candidate.materiality_score is
  'Materialidad de incorporacion: cuanto pesa sumar a esta entidad al padron. No mide gravedad ni riesgo.';
comment on column public.obs_uaf_potential_candidate.activity_concentration is
  'Fraccion de los inscritos del sector que declara este mismo giro. Mide cuan caracteristico es el giro, no la conducta de la entidad.';

create index if not exists obs_uaf_potential_candidate_ivo_idx  on public.obs_uaf_potential_candidate (ivo_score desc nulls last);
create index if not exists obs_uaf_potential_candidate_sect_idx on public.obs_uaf_potential_candidate (implied_sector);
create index if not exists obs_uaf_potential_candidate_reg_idx  on public.obs_uaf_potential_candidate (region);

alter table public.obs_uaf_potential_total     enable row level security;
alter table public.obs_uaf_potential_sector    enable row level security;
alter table public.obs_uaf_potential_candidate enable row level security;

do $$
declare t text;
begin
  foreach t in array array['obs_uaf_potential_total','obs_uaf_potential_sector','obs_uaf_potential_candidate'] loop
    execute format('drop policy if exists %I on public.%I', t || '_allowed_read', t);
    execute format($p$
      create policy %I on public.%I
        for select to authenticated
        using (exists (
          select 1 from public.aml_allowed_users au
          where au.user_id = (select auth.uid()) and au.enabled))
    $p$, t || '_allowed_read', t);
    execute format('revoke all on table public.%I from public, anon', t);
    execute format('grant select on table public.%I to authenticated, service_role', t);
  end loop;
end
$$;

---------------------------------------------------------------- materializacion

create or replace function public.obs_refresh_uaf_potential()
returns integer
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare v_n integer;
begin
  delete from public.obs_uaf_potential_candidate;
  delete from public.obs_uaf_potential_sector;
  delete from public.obs_uaf_potential_total;

  insert into public.obs_uaf_potential_candidate (
    rut, entity_id, name, name_search, rut_search,
    implied_sector, uaf_sectors, matched_activity, activity_codes,
    activity_concentration, activity_registered_n, activity_universe_n,
    evidence_class, detection_tier, type_coherence_class, type_share_in_sector,
    ivo_score, ivo_band, ivo_credibility_pct, ivo_components,
    materiality_score, materiality_components,
    region, commune, sii_status, sii_activity_start_date, activity_years,
    sales_band_rank, sales_band_uf, sales_band_size, workers,
    ownership_edge_count, legal_entity_partner_count, societies_as_partner_count,
    source_count, screening_evidence_count, res_available, res_constitution_date,
    uaf_sanction_events, uaf_sanction_last_date, flags,
    review_state, review_reason_code, review_rationale, reviewed_at, reviewed_by_email,
    semantics, refreshed_at)
  select
    p.rut,
    p.entity_id,
    coalesce(nullif(btrim(p.entity_name), ''), p.rut),
    public.obs_normalize_text(coalesce(p.entity_name, p.rut)),
    nullif(regexp_replace(upper(coalesce(p.rut, '')), '[^0-9K]', '', 'g'), ''),
    p.implied_sector,
    p.uaf_sectors,
    p.matched_activity,
    p.activity_codes,
    p.activity_concentration,
    p.activity_registered_n,
    p.activity_universe_n,
    p.evidence_class,
    p.detection_tier,
    p.type_coherence_class,
    p.type_share_in_sector,
    p.ivo_score,
    p.ivo_band,
    p.ivo_credibility_pct,
    p.ivo_components,
    p.materiality_score,
    p.materiality_components,
    p.region,
    p.commune,
    p.sii_status,
    p.sii_activity_start_date,
    case when p.sii_activity_start_date is not null
         then greatest(0, extract(year from age(current_date, p.sii_activity_start_date))::integer)
    end,
    p.sii_sales_band_rank,
    public.obs_sales_band_uf(p.sii_sales_band_rank),
    public.obs_sales_band_size(p.sii_sales_band_rank),
    p.sii_workers,
    p.ownership_edge_count,
    p.legal_entity_partner_count,
    p.societies_as_partner_count,
    p.source_count,
    p.screening_evidence_count,
    coalesce(p.res_available, false),
    p.res_constitution_date,
    coalesce(p.uaf_sanction_events, 0),
    p.uaf_sanction_last_date,
    p.flags,
    p.review_state,
    p.review_reason_code,
    p.review_rationale,
    p.reviewed_at,
    p.reviewed_by_email,
    p.semantics,
    now()
  from public.aml_v_uaf_potential_screening_current_v0812 p
  where p.is_actionable;

  get diagnostics v_n = row_count;

  -- El sector agrega sobre TODO lo observado, calificado o no: es el contexto
  -- que dice de que tamano es el universo del que salieron los accionables.
  insert into public.obs_uaf_potential_sector
    (sector, observadas, con_res, accionables, ivo_medio, materialidad_media, refreshed_at)
  select
    coalesce(p.implied_sector, 'Sin sector implícito'),
    count(*),
    count(*) filter (where p.res_available),
    count(*) filter (where p.is_actionable),
    round(avg(p.ivo_score) filter (where p.is_actionable), 1),
    round(avg(p.materiality_score) filter (where p.is_actionable), 1),
    now()
  from public.aml_v_uaf_potential_screening_current_v0812 p
  group by 1;

  insert into public.obs_uaf_potential_total (
    singleton, observadas, con_res, accionables, revisados, sin_revisar, sectores,
    ivo_medio, ivo_max, materialidad_media, sii_periodo, uaf_corte, index_version, refreshed_at)
  select
    true,
    count(*),
    count(*) filter (where p.res_available),
    count(*) filter (where p.is_actionable),
    count(*) filter (where p.review_state is not null),
    count(*) filter (where p.is_actionable and p.review_state is null),
    count(distinct p.implied_sector),
    round(avg(p.ivo_score) filter (where p.is_actionable), 1),
    round(max(p.ivo_score) filter (where p.is_actionable), 1),
    round(avg(p.materiality_score) filter (where p.is_actionable), 1),
    '2026-05',
    '2026-06-30',
    max(p.index_version),
    now()
  from public.aml_v_uaf_potential_screening_current_v0812 p;

  return v_n;
end
$$;

comment on function public.obs_refresh_uaf_potential() is
  'Materializa el read model de potenciales sujetos obligados desde el screening del workbench. Publica los accionables uno a uno y el universo observado en agregado.';

revoke all on function public.obs_refresh_uaf_potential() from public, anon, authenticated;
grant execute on function public.obs_refresh_uaf_potential() to service_role;

select public.obs_refresh_uaf_potential();

-------------------------------------------------------------------- contrato

create or replace function public.obs_uaf_potential()
returns jsonb
language sql
stable
security invoker
set search_path = public, extensions, pg_temp
as $$
  with t as (select * from public.obs_uaf_potential_total),
  cand as (select * from public.obs_uaf_potential_candidate),
  -- El embudo es la sintesis de la vista: de que universo se parte y con
  -- cuantas entidades termina el analista en la mano. Cada paso declara su
  -- criterio, porque un embudo sin criterios es una figura decorativa.
  embudo as (
    select 1 orden, 'Observadas por giro' etiqueta,
           (select observadas from t) n,
           'RUT que el SII observa declarando un giro caracteristico de un sector obligado y que no figuran en el padron UAF.' glosa
    union all
    select 2, 'Con constitucion verificable',
           (select con_res from t),
           'Ademas aparecen en el Registro de Empresas y Sociedades, de modo que su existencia y su fecha de constitucion son comprobables.'
    union all
    select 3, 'Con hipotesis accionable',
           (select accionables from t),
           'Operacion vigente en el corte y giro caracteristico calificado por el indice IVO. Es la cola que un analista puede efectivamente revisar.'
    union all
    select 4, 'Con revision registrada',
           (select revisados from t),
           'Alguien ya se pronuncio sobre la entidad y dejo constancia de por que.'
  ),
  mix_banda as (
    select coalesce(ivo_band, 'SIN_BANDA') banda, count(*) n, round(avg(ivo_score), 1) ivo_medio
    from cand group by 1
  ),
  mix_coherencia as (
    select coalesce(type_coherence_class, 'SIN_REFERENCIA_DE_TIPO') clase, count(*) n
    from cand group by 1
  ),
  mix_region as (
    select coalesce(region, 'Sin territorio observado') region, count(*) n,
           round(avg(ivo_score), 1) ivo_medio
    from cand group by 1
  ),
  mix_escala as (
    select coalesce(sales_band_size, 'Sin informacion') tramo,
           min(coalesce(sales_band_rank, 0)) orden, count(*) n
    from cand group by 1
  )
  select jsonb_build_object(
    'contract', 'ATLAS_OBS_UAF_POTENTIAL_V1',
    'disponible', (select count(*) > 0 from t),
    'corte', jsonb_build_object(
        'sii_periodo',   (select sii_periodo from t),
        'uaf_corte',     (select uaf_corte from t),
        'index_version', (select index_version from t),
        'refreshed_at',  (select refreshed_at from t),
        'fuente',        'Radar_SII · homologacion empirica UAF–SII sobre la nomina de personas juridicas',
        'fuente_url',    'https://www.sii.cl/sobre_el_sii/nominapersonasjuridicas.html'),
    'totales', (select to_jsonb(x) from (
        select observadas, con_res, accionables, revisados, sin_revisar, sectores,
               ivo_medio, ivo_max, materialidad_media
        from t) x),
    'embudo',  (select coalesce(jsonb_agg(to_jsonb(e) order by e.orden), '[]') from embudo e),
    'mix', jsonb_build_object(
        'banda',      (select coalesce(jsonb_agg(to_jsonb(m) order by m.n desc), '[]') from mix_banda m),
        'coherencia', (select coalesce(jsonb_agg(to_jsonb(m) order by m.n desc), '[]') from mix_coherencia m),
        'region',     (select coalesce(jsonb_agg(to_jsonb(m) order by m.n desc), '[]') from mix_region m),
        'escala',     (select coalesce(jsonb_agg(to_jsonb(m) order by m.orden), '[]') from mix_escala m)),
    'sectores', (select coalesce(jsonb_agg(to_jsonb(s) order by s.accionables desc, s.observadas desc), '[]')
                 from public.obs_uaf_potential_sector s),
    'candidatos', (select coalesce(jsonb_agg(to_jsonb(c) - 'name_search' - 'rut_search'
                     order by c.ivo_score desc nulls last, c.materiality_score desc nulls last), '[]')
                   from cand c),
    'semantics', 'Cada candidato es una hipotesis de registro construida sobre actividad economica publica: la entidad declara ante el SII un giro caracteristico de un sector obligado y no figura en el corte publico del padron UAF. Eso ordena revisarla, y no acredita que reuna los elementos que activan la obligacion de inscribirse ni que este incumpliendo. El IVO ordena esa revision y no es probabilidad de obligacion ni de LA/FT; la materialidad describe el costo de incorporar y no la gravedad de nada. Ausencia del corte publico UAF no equivale a no estar inscrita.'
  );
$$;

comment on function public.obs_uaf_potential() is
  'Quienes son los potenciales sujetos obligados: embudo de calificacion, distribucion del universo observado y la ficha de cada entidad con hipotesis de registro accionable. Ninguna cifra imputa incumplimiento.';

do $$
declare sig text;
begin
  for sig in
    select p.oid::regprocedure::text
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'obs_uaf_potential'
  loop
    execute format('revoke all on function %s from public, anon', sig);
    execute format('grant execute on function %s to authenticated, service_role', sig);
  end loop;
end
$$;
