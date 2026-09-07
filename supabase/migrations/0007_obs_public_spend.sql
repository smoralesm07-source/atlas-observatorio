-- ATLAS Observatorio · gasto público y compras
--
-- Dos universos que NO se suman:
--
--   COMPRAS PUBLICAS  ChileCompra OC/licitaciones, procesadas por el pipeline
--                     de perfilado del proyecto core. Grano: comprador,
--                     proveedor y par comprador-proveedor en ventana de 12
--                     meses. Poblacion: 2.005 compradores, 72.802 proveedores,
--                     494.867 pares.
--
--   EJECUCION         Presupuesto Abierto y CGR, ya materializadas en el
--   PRESUPUESTARIA    proyecto como evidencia de contexto. Grano: senal con
--                     monto devengado. Poblacion: organismos, no proveedores.
--
-- Sumarlas produciria un total que no describe ninguna poblacion real. El
-- contrato las publica separadas y lo dice en su propia semantica.
--
-- PUENTE ENTRE PROYECTOS. Las metricas de compras viven en el proyecto core
-- (bzqxvidggykkdouotylg) y el Observatorio en el suyo. En vez de darle al
-- navegador una segunda sesion contra otro proyecto -- que duplicaria la
-- superficie de autorizacion -- el puente es servidor a servidor:
-- obs_bridge_fetch() llama por HTTP a ps_export_for_observatory() con un token
-- guardado en Vault, y ese token se compara en tiempo constante del lado del
-- core. El navegador nunca ve el token ni la URL del otro proyecto.
--
-- El objeto del lado core esta versionado aparte, en
-- supabase/core-project/0001_ps_export_for_observatory.sql.
--
-- TOPES DELIBERADOS. Los hallazgos se traen completos porque son la superficie
-- analitica. Actores y pares se acotan a 3.000 por prioridad de revision: el
-- Observatorio publica lo que se mira, no el libro mayor. Los topes quedan
-- escritos en obs_spend_snapshot.ingested y la vista los declara.

------------------------------------------------------------------ read models

create table if not exists public.obs_spend_snapshot (
  snapshot_id         text primary key,
  source_snapshot_id  text,
  generated_at        timestamptz,
  period_start        date,
  period_end          date,
  window_months       integer,
  amount_total_clp    numeric,
  order_count         bigint,
  buyer_count         integer,
  supplier_count      integer,
  pair_count          bigint,
  signal_count        integer,
  universe            jsonb not null default '{}'::jsonb,
  readiness           jsonb not null default '[]'::jsonb,
  source_coverage     jsonb not null default '{}'::jsonb,
  ingested            jsonb not null default '{}'::jsonb,
  refreshed_at        timestamptz not null default now()
);
comment on table public.obs_spend_snapshot is
  'Identidad del corte de compras publicas. universe = poblacion completa en el core; ingested = lo que efectivamente se trajo, con sus topes y errores.';
comment on column public.obs_spend_snapshot.readiness is
  'Hipotesis del pipeline con su estado real: AVAILABLE, PARTIAL o REQUIRES_SOURCE. Una hipotesis sin fuente se declara, no se simula.';

create table if not exists public.obs_spend_finding (
  finding_id       text primary key,
  finding_type     text not null,
  family           text not null,
  supplier_id      text,
  buyer_id         text,
  pair_id          text,
  review_priority  numeric,
  severity_band    text,
  materiality_clp  numeric,
  title            text,
  summary          text,
  source_status    text,
  snapshot_id      text not null,
  refreshed_at     timestamptz not null default now()
);
comment on table public.obs_spend_finding is
  'Patron observado en la relacion comprador-proveedor. Prioridad de revision, no irregularidad acreditada.';

create table if not exists public.obs_spend_actor (
  actor_id                  text not null,
  actor_role                text not null,
  label                     text,
  entity_id                 text,
  amount_12m                numeric,
  order_count_12m           bigint,
  counterpart_count         integer,
  top_counterpart_id        text,
  top_counterpart_share     numeric,
  hhi                       numeric,
  concentration_percentile  numeric,
  materiality_percentile    numeric,
  growth_ratio              numeric,
  growth_percentile         numeric,
  active_months             integer,
  first_seen                date,
  last_seen                 date,
  review_priority           numeric,
  snapshot_id               text not null,
  refreshed_at              timestamptz not null default now(),
  primary key (actor_id, actor_role)
);
comment on column public.obs_spend_actor.actor_id is
  'Es un RUT. Por eso el cruce contra obs_entity es exacto y no por nombre.';
comment on column public.obs_spend_actor.label is
  'La fuente casi no trae razon social de proveedor (39 de 72.802). Se rellena desde obs_entity y desde las etiquetas de los pares; cuando queda nula, el RUT es el identificador y la vista lo dice.';
comment on column public.obs_spend_actor.counterpart_count is
  'Contrapartes en el universo completo del core, no en los pares publicados aqui: puede exceder lo que muestra la ficha por el tope de 3.000 pares.';

create table if not exists public.obs_spend_pair (
  pair_id                  text primary key,
  buyer_id                 text,
  supplier_id              text,
  buyer_label              text,
  supplier_label           text,
  buyer_entity_id          text,
  supplier_entity_id       text,
  amount_12m               numeric,
  order_count_12m          bigint,
  buyer_share              numeric,
  supplier_share           numeric,
  active_months            integer,
  first_seen               date,
  last_seen                date,
  acceleration_ratio       numeric,
  acceleration_percentile  numeric,
  price_signal_count       integer,
  max_price_priority       numeric,
  max_price_ratio          numeric,
  convergence_count        integer,
  review_priority          numeric,
  flags                    jsonb not null default '[]'::jsonb,
  snapshot_id              text not null,
  refreshed_at             timestamptz not null default now()
);
comment on column public.obs_spend_pair.supplier_share is
  'Cuanto de las compras publicas OBSERVADAS del proveedor viene de este comprador. No es dependencia sobre sus ventas totales: el pipeline no ve ventas privadas.';

create table if not exists public.obs_budget_signal (
  evidence_id    text primary key,
  source_code    text not null,
  evidence_type  text not null,
  buyer_key      text,
  buyer_name     text,
  provider_key   text,
  provider_rut   text,
  provider_name  text,
  entity_id      text,
  region         text,
  event_date     date,
  period_year    integer,
  period_month   integer,
  signal_code    text,
  severity       text,
  priority_tier  text,
  confidence     numeric,
  amount_clp     numeric,
  title          text,
  summary        text,
  source_url     text,
  match_method   text,
  snapshot_id    text not null,
  refreshed_at   timestamptz not null default now()
);
comment on table public.obs_budget_signal is
  'Ejecucion presupuestaria y contraloria. Universo distinto al de compras: no se suma con obs_spend_*.';

create index if not exists obs_spend_finding_family_idx
  on public.obs_spend_finding (family, review_priority desc nulls last);
create index if not exists obs_spend_finding_actor_idx
  on public.obs_spend_finding (supplier_id, buyer_id);
create index if not exists obs_spend_actor_priority_idx
  on public.obs_spend_actor (actor_role, review_priority desc nulls last);
create index if not exists obs_spend_actor_entity_idx
  on public.obs_spend_actor (entity_id) where entity_id is not null;
create index if not exists obs_spend_pair_actors_idx
  on public.obs_spend_pair (supplier_id, buyer_id);
create index if not exists obs_spend_pair_priority_idx
  on public.obs_spend_pair (review_priority desc nulls last);
create index if not exists obs_budget_signal_source_idx
  on public.obs_budget_signal (source_code, severity);
create index if not exists obs_budget_signal_entity_idx
  on public.obs_budget_signal (entity_id) where entity_id is not null;

-------------------------------------------------------------------------- RLS

do $$
declare t text;
begin
  foreach t in array array['obs_spend_snapshot','obs_spend_finding','obs_spend_actor',
                           'obs_spend_pair','obs_budget_signal'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_allowed_read', t);
    execute format($p$create policy %I on public.%I for select to authenticated
                      using (exists (select 1 from public.aml_allowed_users au
                                      where au.user_id = (select auth.uid()) and au.enabled))$p$,
                   t || '_allowed_read', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end
$$;

----------------------------------------------------------------------- puente

create or replace function public.obs_bridge_fetch(
  p_section text, p_limit integer, p_offset integer)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'vault', 'extensions', 'pg_temp'
as $$
declare
  v_url text; v_tok text; v_key text;
  v_resp extensions.http_response;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'obs_bridge_url';
  select decrypted_secret into v_tok from vault.decrypted_secrets where name = 'obs_bridge_token';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'obs_bridge_apikey';
  if v_url is null or v_tok is null or v_key is null then
    return jsonb_build_object('ok', false, 'error', 'BRIDGE_NOT_CONFIGURED');
  end if;

  select * into v_resp from extensions.http((
    'POST', v_url,
    array[extensions.http_header('apikey', v_key),
          extensions.http_header('Authorization', 'Bearer ' || v_key)],
    'application/json',
    jsonb_build_object('p_token', v_tok, 'p_section', p_section,
                       'p_limit', p_limit, 'p_offset', p_offset)::text
  )::extensions.http_request);

  if v_resp.status <> 200 then
    return jsonb_build_object('ok', false, 'error', 'HTTP_' || v_resp.status);
  end if;
  return v_resp.content::jsonb;
end
$$;

------------------------------------------------------------------ refresco

create or replace function public.obs_refresh_spend(p_snapshot_id text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  v_meta jsonb;
  v_page jsonb;
  v_off integer;
  v_got integer;
  -- Los hallazgos van completos porque son la superficie analitica; actores y
  -- pares se acotan por prioridad de revision. El Observatorio publica lo que se
  -- mira, no el libro mayor completo.
  v_cap_actors constant integer := 3000;
  v_cap_pairs  constant integer := 3000;
  v_findings integer := 0;
  v_buyers integer := 0;
  v_suppliers integer := 0;
  v_pairs integer := 0;
  v_budget integer := 0;
  v_errors text[] := '{}';

  -- Cada pagina viaja dentro del tope de 8 s de PostgREST del lado core. Los
  -- pares se piden de a 500 porque su tabla es dos ordenes de magnitud mayor.
  function_page_findings constant integer := 1500;
  function_page_actors   constant integer := 1500;
  function_page_pairs    constant integer := 500;
begin
  v_meta := public.obs_bridge_fetch('meta', 1, 0);

  if coalesce((v_meta->>'ok')::boolean, false) then
    delete from public.obs_spend_finding;
    delete from public.obs_spend_actor;
    delete from public.obs_spend_pair;

    ---------------------------------------------------------------- hallazgos
    v_off := 0;
    loop
      v_page := public.obs_bridge_fetch('findings', function_page_findings, v_off);
      if not coalesce((v_page->>'ok')::boolean, false) then
        v_errors := v_errors || ('findings@' || v_off || ':' || coalesce(v_page->>'error','?'));
        exit;
      end if;
      v_got := coalesce((v_page->>'count')::int, 0);
      exit when v_got = 0;

      insert into public.obs_spend_finding (
        finding_id, finding_type, family, supplier_id, buyer_id, pair_id,
        review_priority, severity_band, materiality_clp, title, summary,
        source_status, snapshot_id, refreshed_at)
      select r->>'finding_id', r->>'finding_type', r->>'family',
             r->>'supplier_id', r->>'buyer_id', r->>'pair_id',
             nullif(r->>'review_priority','')::numeric, r->>'severity_band',
             nullif(r->>'materiality_clp','')::numeric, r->>'title', r->>'summary',
             r->>'source_status', p_snapshot_id, now()
      from jsonb_array_elements(v_page->'rows') r
      on conflict (finding_id) do nothing;

      v_findings := v_findings + v_got;
      exit when v_got < function_page_findings;
      v_off := v_off + function_page_findings;
    end loop;

    -------------------------------------------------------------- compradores
    v_off := 0;
    while v_buyers < v_cap_actors loop
      v_page := public.obs_bridge_fetch('buyers', function_page_actors, v_off);
      if not coalesce((v_page->>'ok')::boolean, false) then
        v_errors := v_errors || ('buyers@' || v_off || ':' || coalesce(v_page->>'error','?'));
        exit;
      end if;
      v_got := coalesce((v_page->>'count')::int, 0);
      exit when v_got = 0;

      insert into public.obs_spend_actor (
        actor_id, actor_role, label, amount_12m, order_count_12m,
        counterpart_count, top_counterpart_id, top_counterpart_share, hhi,
        concentration_percentile, materiality_percentile, review_priority,
        snapshot_id, refreshed_at)
      select r->>'buyer_id', 'BUYER', r->>'buyer_label',
             nullif(r->>'amount_12m','')::numeric, nullif(r->>'order_count_12m','')::bigint,
             nullif(r->>'supplier_count','')::int, r->>'top_supplier_id',
             nullif(r->>'top_supplier_share','')::numeric, nullif(r->>'hhi','')::numeric,
             nullif(r->>'concentration_percentile','')::numeric,
             nullif(r->>'materiality_percentile','')::numeric,
             nullif(r->>'review_priority','')::numeric, p_snapshot_id, now()
      from jsonb_array_elements(v_page->'rows') r
      on conflict (actor_id, actor_role) do nothing;

      v_buyers := v_buyers + v_got;
      exit when v_got < function_page_actors;
      v_off := v_off + function_page_actors;
    end loop;

    --------------------------------------------------------------- proveedores
    v_off := 0;
    while v_suppliers < v_cap_actors loop
      v_page := public.obs_bridge_fetch('suppliers', function_page_actors, v_off);
      if not coalesce((v_page->>'ok')::boolean, false) then
        v_errors := v_errors || ('suppliers@' || v_off || ':' || coalesce(v_page->>'error','?'));
        exit;
      end if;
      v_got := coalesce((v_page->>'count')::int, 0);
      exit when v_got = 0;

      insert into public.obs_spend_actor (
        actor_id, actor_role, label, amount_12m, order_count_12m,
        counterpart_count, top_counterpart_id, top_counterpart_share, hhi,
        concentration_percentile, materiality_percentile,
        growth_ratio, growth_percentile, active_months, first_seen, last_seen,
        review_priority, snapshot_id, refreshed_at)
      select r->>'supplier_id', 'SUPPLIER', r->>'supplier_label',
             nullif(r->>'amount_12m','')::numeric, nullif(r->>'order_count_12m','')::bigint,
             nullif(r->>'buyer_count','')::int, r->>'top_buyer_id',
             nullif(r->>'top_buyer_share','')::numeric, nullif(r->>'hhi','')::numeric,
             nullif(r->>'concentration_percentile','')::numeric,
             nullif(r->>'materiality_percentile','')::numeric,
             nullif(r->>'growth_ratio','')::numeric, nullif(r->>'growth_percentile','')::numeric,
             nullif(r->>'active_months','')::int, nullif(r->>'first_seen','')::date,
             nullif(r->>'last_seen','')::date,
             nullif(r->>'review_priority','')::numeric, p_snapshot_id, now()
      from jsonb_array_elements(v_page->'rows') r
      on conflict (actor_id, actor_role) do nothing;

      v_suppliers := v_suppliers + v_got;
      exit when v_got < function_page_actors;
      v_off := v_off + function_page_actors;
    end loop;

    --------------------------------------------------------------------- pares
    v_off := 0;
    while v_pairs < v_cap_pairs loop
      v_page := public.obs_bridge_fetch('pairs', function_page_pairs, v_off);
      if not coalesce((v_page->>'ok')::boolean, false) then
        v_errors := v_errors || ('pairs@' || v_off || ':' || coalesce(v_page->>'error','?'));
        exit;
      end if;
      v_got := coalesce((v_page->>'count')::int, 0);
      exit when v_got = 0;

      insert into public.obs_spend_pair (
        pair_id, buyer_id, supplier_id, buyer_label, supplier_label,
        amount_12m, order_count_12m, buyer_share, supplier_share, active_months,
        first_seen, last_seen, acceleration_ratio, acceleration_percentile,
        price_signal_count, max_price_priority, max_price_ratio,
        convergence_count, review_priority, flags, snapshot_id, refreshed_at)
      select r->>'pair_id', r->>'buyer_id', r->>'supplier_id',
             r->>'buyer_label', r->>'supplier_label',
             nullif(r->>'amount_12m','')::numeric, nullif(r->>'order_count_12m','')::bigint,
             nullif(r->>'buyer_share','')::numeric, nullif(r->>'supplier_share','')::numeric,
             nullif(r->>'active_months','')::int, nullif(r->>'first_seen','')::date,
             nullif(r->>'last_seen','')::date,
             nullif(r->>'acceleration_ratio','')::numeric,
             nullif(r->>'acceleration_percentile','')::numeric,
             nullif(r->>'price_signal_count','')::int,
             nullif(r->>'max_price_priority','')::numeric,
             nullif(r->>'max_price_ratio','')::numeric,
             nullif(r->>'convergence_count','')::int,
             nullif(r->>'review_priority','')::numeric,
             coalesce(r->'flags','[]'::jsonb), p_snapshot_id, now()
      from jsonb_array_elements(v_page->'rows') r
      on conflict (pair_id) do nothing;

      v_pairs := v_pairs + v_got;
      exit when v_got < function_page_pairs;
      v_off := v_off + function_page_pairs;
    end loop;

    -- Resolucion por RUT contra el universo observado: los identificadores de
    -- comprador y proveedor son RUTs, asi que el cruce es exacto, no por nombre.
    update public.obs_spend_actor a
       set entity_id = e.entity_id
      from public.obs_entity e
     where e.rut_search = regexp_replace(upper(a.actor_id), '[^0-9K]', '', 'g');

    update public.obs_spend_pair p
       set buyer_entity_id = eb.entity_id
      from public.obs_entity eb
     where eb.rut_search = regexp_replace(upper(p.buyer_id), '[^0-9K]', '', 'g');

    update public.obs_spend_pair p
       set supplier_entity_id = es.entity_id
      from public.obs_entity es
     where es.rut_search = regexp_replace(upper(p.supplier_id), '[^0-9K]', '', 'g');

    -- La fuente casi no trae razon social de proveedor: 39 etiquetas para 72.802
    -- proveedores. Sin nombre, un hallazgo se lee como un RUT suelto. Se rellena
    -- primero desde el universo observado (identidad canonica) y despues desde
    -- las etiquetas que si vienen en los pares. Lo que queda nulo se muestra
    -- como RUT y la vista lo declara; no se inventa un nombre.
    update public.obs_spend_actor a
       set label = e.name
      from public.obs_entity e
     where a.label is null and e.entity_id = a.entity_id and e.name is not null;

    update public.obs_spend_actor a
       set label = b.l
      from (select buyer_id id, 'BUYER' r, min(buyer_label) l
              from public.obs_spend_pair where buyer_label is not null group by 1,2
            union all
            select supplier_id, 'SUPPLIER', min(supplier_label)
              from public.obs_spend_pair where supplier_label is not null group by 1,2) b
     where a.label is null and b.id = a.actor_id and b.r = a.actor_role;

    delete from public.obs_spend_snapshot;
    insert into public.obs_spend_snapshot (
      snapshot_id, source_snapshot_id, generated_at, period_start, period_end,
      window_months, amount_total_clp, order_count, buyer_count, supplier_count,
      pair_count, signal_count, universe, readiness, source_coverage, ingested,
      refreshed_at)
    select
      p_snapshot_id,
      v_meta->>'snapshot_id',
      nullif(v_meta->'snapshot'->>'generated_at','')::timestamptz,
      nullif(v_meta->'snapshot'->>'period_start','')::date,
      nullif(v_meta->'snapshot'->>'period_end','')::date,
      nullif(v_meta->'snapshot'->>'window_months','')::int,
      nullif(v_meta->'snapshot'->>'amount_total_clp','')::numeric,
      nullif(v_meta->'snapshot'->>'order_count','')::bigint,
      nullif(v_meta->'snapshot'->>'buyer_count','')::int,
      nullif(v_meta->'snapshot'->>'supplier_count','')::int,
      nullif(v_meta->'snapshot'->>'pair_count','')::bigint,
      nullif(v_meta->'snapshot'->>'signal_count','')::int,
      coalesce(v_meta->'universo','{}'::jsonb),
      coalesce(v_meta->'readiness','[]'::jsonb),
      coalesce(v_meta->'snapshot'->'source_coverage','{}'::jsonb),
      jsonb_build_object('findings', v_findings, 'buyers', v_buyers,
                         'suppliers', v_suppliers, 'pairs', v_pairs,
                         'cap_actors', v_cap_actors, 'cap_pairs', v_cap_pairs,
                         'errores', to_jsonb(v_errors)),
      now();
  end if;

  ------------------------------------------- ejecucion presupuestaria y lobby
  delete from public.obs_budget_signal;
  insert into public.obs_budget_signal (
    evidence_id, source_code, evidence_type, buyer_key, buyer_name,
    provider_key, provider_rut, provider_name, entity_id, region,
    event_date, period_year, period_month, signal_code, severity,
    priority_tier, confidence, amount_clp, title, summary, source_url,
    match_method, snapshot_id, refreshed_at)
  select ev.evidence_id, ev.source_code, ev.evidence_type, ev.buyer_key, ev.buyer_name,
         ev.provider_key, ev.provider_rut, ev.provider_name, e.entity_id, ev.region,
         ev.event_date, ev.period_year, ev.period_month, ev.signal_code, ev.severity,
         ev.priority_tier, ev.confidence, ev.amount_clp, ev.title, ev.summary,
         ev.source_url, ev.match_method, p_snapshot_id, now()
  from public.aml_public_spend_context_evidence ev
  left join public.obs_entity e
    on ev.provider_rut is not null
   and e.rut_search = regexp_replace(upper(ev.provider_rut), '[^0-9K]', '', 'g')
  -- Las audiencias de lobby llegan sin comprador, proveedor ni monto: son
  -- volumen sin vinculo analitico, y publicarlas junto a las senales con
  -- materialidad las haria parecer equivalentes.
  where ev.evidence_type <> 'LOBBY_AUDIENCE';

  get diagnostics v_budget = row_count;

  return jsonb_build_object(
    'compras_disponibles', coalesce((v_meta->>'ok')::boolean, false),
    'compras_error', v_meta->>'error',
    'findings', v_findings, 'buyers', v_buyers,
    'suppliers', v_suppliers, 'pairs', v_pairs,
    'budget_signals', v_budget,
    'errores', to_jsonb(v_errors));
end
$$;

create or replace function public.obs_refresh_full(p_snapshot_id text default null)
returns public.obs_snapshot
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_row public.obs_snapshot;
  v_territory integer;
  v_sector integer;
  v_spend jsonb;
begin
  v_row := public.obs_refresh_all(p_snapshot_id);

  v_territory := public.obs_refresh_territory(v_row.snapshot_id);
  v_sector    := public.obs_refresh_sector(v_row.snapshot_id);
  v_spend     := public.obs_refresh_spend(v_row.snapshot_id);

  update public.obs_snapshot
     set row_counts = row_counts || jsonb_build_object(
           'obs_territory', case when v_territory >= 0 then v_territory
                                 else (select count(*) from public.obs_territory) end,
           'obs_sector', v_sector,
           'territorio_actualizado', v_territory >= 0,
           'obs_spend_finding', v_spend->'findings',
           'obs_spend_actor', (coalesce((v_spend->>'buyers')::int,0)
                             + coalesce((v_spend->>'suppliers')::int,0)),
           'obs_spend_pair', v_spend->'pairs',
           'obs_budget_signal', v_spend->'budget_signals',
           'compras_disponibles', v_spend->'compras_disponibles')
   where snapshot_id = v_row.snapshot_id
  returning * into v_row;

  return v_row;
end
$$;

--------------------------------------------------------------------- contratos

create or replace function public.obs_spend_overview()
returns jsonb
language sql
stable
set search_path to 'public', 'extensions', 'pg_temp'
as $$
  with snap as (select * from public.obs_spend_snapshot limit 1),
  familias as (
    select family,
           count(*) hallazgos,
           count(*) filter (where severity_band in ('CRITICAL','HIGH')) urgentes,
           round(sum(materiality_clp)/1e9, 1) materialidad_mm,
           round(avg(review_priority), 1) prioridad_media
    from public.obs_spend_finding group by 1
  ),
  severidades as (
    select severity_band,
           count(*) hallazgos,
           case severity_band when 'CRITICAL' then 0 when 'HIGH' then 1
                              when 'MEDIUM' then 2 when 'LOW' then 3 else 4 end orden
    from public.obs_spend_finding group by 1
  ),
  cobertura as (
    select count(*) filter (where actor_role='SUPPLIER') proveedores,
           count(*) filter (where actor_role='SUPPLIER' and entity_id is not null) proveedores_en_universo,
           count(*) filter (where actor_role='SUPPLIER' and label is not null) proveedores_con_nombre,
           count(*) filter (where actor_role='BUYER') compradores,
           count(*) filter (where actor_role='BUYER' and entity_id is not null) compradores_en_universo,
           count(*) filter (where actor_role='BUYER' and label is not null) compradores_con_nombre
    from public.obs_spend_actor
  ),
  presupuesto as (
    select source_code,
           count(*) señales,
           count(*) filter (where entity_id is not null) con_entidad,
           round(sum(amount_clp)/1e9, 1) monto_mm,
           count(*) filter (where severity = 'HIGH') altas
    from public.obs_budget_signal group by 1
  ),
  -- El top se resuelve con las mismas etiquetas que el feed: un hallazgo sin
  -- nombre se lee como un RUT suelto y no es accionable.
  top as (
    select f.finding_id, f.family, f.finding_type, f.severity_band, f.review_priority,
           f.materiality_clp, f.title, f.summary, f.supplier_id, f.buyer_id, f.pair_id,
           sup.label supplier_label, buy.label buyer_label,
           sup.entity_id supplier_entity_id, buy.entity_id buyer_entity_id
    from public.obs_spend_finding f
    left join public.obs_spend_actor sup
      on sup.actor_id = f.supplier_id and sup.actor_role = 'SUPPLIER'
    left join public.obs_spend_actor buy
      on buy.actor_id = f.buyer_id and buy.actor_role = 'BUYER'
    order by f.review_priority desc nulls last, f.finding_id limit 12
  )
  select jsonb_build_object(
    'contract', 'ATLAS_OBS_SPEND_V1',
    'disponible', (select count(*) from snap) > 0,
    'corte',      (select to_jsonb(s) from snap s),
    'familias',   (select coalesce(jsonb_agg(to_jsonb(f) order by f.hallazgos desc), '[]') from familias f),
    'severidades',(select coalesce(jsonb_agg(jsonb_build_object(
                     'severity_band', sv.severity_band, 'hallazgos', sv.hallazgos)
                     order by sv.orden), '[]') from severidades sv),
    'cobertura',  (select to_jsonb(c) from cobertura c),
    'presupuesto',(select coalesce(jsonb_agg(to_jsonb(p) order by p.señales desc), '[]') from presupuesto p),
    'top',        (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from top t),
    'semantics',  'Ejecución presupuestaria y compras públicas son universos distintos y no se suman: describen poblaciones diferentes, con grano y fuente diferentes. Un hallazgo de compras señala un patrón en la relación comprador-proveedor, no una irregularidad acreditada.'
  );
$$;

create or replace function public.obs_spend_finding_feed(
  p_family text default null, p_severity text default null,
  p_limit integer default 50, p_offset integer default 0)
returns table (
  finding_id text, family text, finding_type text, severity_band text,
  review_priority numeric, materiality_clp numeric, title text, summary text,
  supplier_id text, buyer_id text, pair_id text,
  supplier_label text, buyer_label text,
  supplier_entity_id text, buyer_entity_id text, total_count bigint)
language sql
stable
set search_path to 'public', 'extensions', 'pg_temp'
as $$
  with filtrado as (
    select f.* from public.obs_spend_finding f
    where (p_family is null or f.family = p_family)
      and (p_severity is null or f.severity_band = p_severity)
  ),
  contado as (select count(*) over () total_count, x.* from filtrado x)
  select c.finding_id, c.family, c.finding_type, c.severity_band,
         c.review_priority, c.materiality_clp, c.title, c.summary,
         c.supplier_id, c.buyer_id, c.pair_id,
         sup.label, buy.label,
         sup.entity_id, buy.entity_id,
         c.total_count
  from contado c
  left join public.obs_spend_actor sup
    on sup.actor_id = c.supplier_id and sup.actor_role = 'SUPPLIER'
  left join public.obs_spend_actor buy
    on buy.actor_id = c.buyer_id and buy.actor_role = 'BUYER'
  order by c.review_priority desc nulls last, c.finding_id
  limit greatest(1, least(coalesce(p_limit,50), 200))
  offset greatest(0, coalesce(p_offset,0));
$$;

create or replace function public.obs_spend_actor_detail(p_actor_id text, p_role text)
returns jsonb
language sql
stable
set search_path to 'public', 'extensions', 'pg_temp'
as $$
  with a as (
    select * from public.obs_spend_actor
    where actor_id = p_actor_id and actor_role = upper(p_role) limit 1
  ),
  contrapartes as (
    select p.pair_id, p.buyer_id, p.supplier_id, p.buyer_label, p.supplier_label,
           p.buyer_entity_id, p.supplier_entity_id,
           p.amount_12m, p.order_count_12m, p.buyer_share, p.supplier_share,
           p.active_months, p.acceleration_ratio, p.acceleration_percentile,
           p.price_signal_count, p.convergence_count, p.review_priority, p.flags
    from public.obs_spend_pair p
    where (upper(p_role) = 'SUPPLIER' and p.supplier_id = p_actor_id)
       or (upper(p_role) = 'BUYER'    and p.buyer_id = p_actor_id)
    order by p.review_priority desc nulls last limit 30
  ),
  hallazgos as (
    select f.finding_id, f.family, f.finding_type, f.severity_band,
           f.review_priority, f.materiality_clp, f.title, f.summary
    from public.obs_spend_finding f
    where (upper(p_role) = 'SUPPLIER' and f.supplier_id = p_actor_id)
       or (upper(p_role) = 'BUYER'    and f.buyer_id = p_actor_id)
    order by f.review_priority desc nulls last limit 40
  )
  select case when (select count(*) from a) = 0 then null else jsonb_build_object(
    'contract', 'ATLAS_OBS_SPEND_ACTOR_V1',
    'actor',        (select to_jsonb(x) from a x),
    'contrapartes', (select coalesce(jsonb_agg(to_jsonb(c)), '[]') from contrapartes c),
    'hallazgos',    (select coalesce(jsonb_agg(to_jsonb(h)), '[]') from hallazgos h),
    'semantics',    'Concentración y aceleración describen la forma de la relación comercial, no su licitud. Un proveedor concentrado puede ser el único capaz de proveer ese bien.'
  ) end;
$$;

------------------------------------------------------------------- privilegios

do $$
declare sig text;
begin
  -- El puente y el refresco solo los ejecuta el planificador.
  foreach sig in array array[
    'public.obs_bridge_fetch(text,integer,integer)',
    'public.obs_refresh_spend(text)',
    'public.obs_refresh_full(text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', sig);
    execute format('grant execute on function %s to service_role', sig);
  end loop;

  -- Los contratos son SECURITY INVOKER: la RLS de las tablas decide.
  foreach sig in array array[
    'public.obs_spend_overview()',
    'public.obs_spend_finding_feed(text,text,integer,integer)',
    'public.obs_spend_actor_detail(text,text)'
  ] loop
    execute format('revoke all on function %s from public, anon', sig);
    execute format('grant execute on function %s to authenticated, service_role', sig);
  end loop;
end
$$;
