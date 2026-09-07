-- ATLAS Observatorio · Pulso del universo de Sujetos Obligados
--
-- El Pulso dejaba de responder la pregunta del analista UAF. Mostraba senales
-- de patron sobre el universo completo de entidades observadas, cuando lo que
-- se necesita es caracterizar el padron de sujetos obligados: quienes son,
-- en que estado registral estan ante el SII, donde operan, en que industria,
-- y cuales de ellos cruzan con OSFL, compras publicas, sancion o prensa.
--
-- Nada de esto se inventa aqui. El cruce UAF x SII ya vive en
-- aml_uaf_obligated_subject_snapshot (10.294 filas, PK rut) y la caracterizacion
-- cruzada en aml_v_universo_so_entity_explorer_0810. Esta migracion los une con
-- el IGR comunal de obs_territory y los publica como read model gobernado.
--
-- LIMITES DECLARADOS, para que la interfaz no afirme mas de lo que sabe:
--  * No existe fecha de inscripcion UAF ni estado de vigencia registral UAF en
--    ninguna fuente. El unico eje temporal disponible es el ciclo de vida SII.
--  * Los 2.110 sujetos PERSONA_NATURAL no tienen perfil SII de persona
--    juridica. Su sii_status es SIN_PERFIL_SII: eso no es brecha registral.
--  * El padron de proveedores del Estado llega topado a 3.000 filas por rol
--    desde obs_spend_actor. Un sujeto sin marca puede ser proveedor igualmente:
--    la ausencia aqui no acredita ausencia de contratos.
--  * La prensa aterriza como evento con titulo y fecha, sin URL ni resumen. El
--    link al articulo no esta ingerido y la evidencia lo dice.

------------------------------------------------------------------ read model

create table if not exists public.obs_uaf_subject (
  rut                     text primary key,
  rut_search              text,
  entity_id               text,
  name                    text not null,
  name_search             text not null,
  subject_nature          text,
  entity_type             text,
  uaf_sector              text,
  -- Ciclo de vida ante el SII. Es el unico eje temporal del padron.
  sii_status              text,
  sii_activity_start_date date,
  sii_termination_date    date,
  termination_year        integer,
  activity_years          integer,
  -- Industria
  economic_sector         text,
  economic_subsector      text,
  main_activity           text,
  sales_band              text,
  sales_band_rank         integer,
  workers                 bigint,
  -- Territorio. El IGR es contexto comunal, nunca atributo de la entidad.
  region                  text,
  commune                 text,
  territory_basis         text,
  igr_score               numeric,
  igr_level               text,
  -- Caracterizacion cruzada
  is_osfl                 boolean not null default false,
  is_state_supplier       boolean not null default false,
  supplier_amount_12m     numeric,
  supplier_order_count    integer,
  sanction_count          integer not null default 0,
  sanction_count_5y       integer not null default 0,
  sanction_last_date      date,
  -- Antecedentes que el analista puede abrir y leer. La radiografia resuelve
  -- identidad por RUT sobre todas las fuentes sancionatorias y alcanza mas
  -- sujetos que el contador del propio padron: 372 frente a 213. Se publican
  -- las dos cifras porque miden cosas distintas, y ninguna reemplaza a la otra.
  sanction_evidence_count integer not null default 0,
  press_evidence_count    integer not null default 0,
  has_press               boolean not null default false,
  alert_count             integer not null default 0,
  -- Prioridad analitica ya calculada aguas arriba
  ipf_score               numeric,
  ipf_band                text,
  ipa3_score              numeric,
  ipa3_band               text,
  snapshot_id             text not null,
  refreshed_at            timestamptz not null default now()
);
comment on table public.obs_uaf_subject is
  'Una fila por sujeto obligado inscrito en la UAF, con su ciclo de vida SII, industria, territorio y cruces. Caracterizacion descriptiva: no es imputacion de incumplimiento ni probabilidad de LA/FT.';
comment on column public.obs_uaf_subject.sii_status is
  'ACTIVE_AS_PUBLISHED / TERMINATED_AS_PUBLISHED / SIN_PERFIL_SII. SIN_PERFIL_SII corresponde a personas naturales sin perfil de persona juridica y no acredita brecha registral.';
comment on column public.obs_uaf_subject.igr_level is
  'Banda IGR de la comuna donde opera el sujeto. Es contexto territorial: describe el entorno, no al sujeto.';
comment on column public.obs_uaf_subject.is_state_supplier is
  'Marca desde el corte de compras publicas, topado a 3.000 proveedores. La ausencia de marca no acredita ausencia de contratos con el Estado.';

create table if not exists public.obs_uaf_evidence (
  evidence_id  text primary key,
  rut          text not null,
  kind         text not null check (kind in ('SANCION','PRENSA')),
  event_date   date,
  source_label text,
  headline     text,
  summary      text,
  amount_uf    numeric,
  amount_clp   numeric,
  document_url text,
  has_link     boolean not null default false,
  identity_status text,
  snapshot_id  text not null,
  refreshed_at timestamptz not null default now()
);
comment on table public.obs_uaf_evidence is
  'Antecedente que sostiene una marca del Pulso. La sancion trae resumen y link al documento; la prensa llega sin URL desde el productor y has_link lo declara.';

create index if not exists obs_uaf_subject_status_idx    on public.obs_uaf_subject (sii_status);
create index if not exists obs_uaf_subject_region_idx    on public.obs_uaf_subject (region);
create index if not exists obs_uaf_subject_sector_idx    on public.obs_uaf_subject (uaf_sector);
create index if not exists obs_uaf_subject_industry_idx  on public.obs_uaf_subject (economic_sector);
create index if not exists obs_uaf_subject_igr_idx       on public.obs_uaf_subject (igr_level);
create index if not exists obs_uaf_subject_term_idx      on public.obs_uaf_subject (termination_year desc nulls last);
create index if not exists obs_uaf_subject_ipf_idx       on public.obs_uaf_subject (ipf_score desc nulls last);
create index if not exists obs_uaf_subject_name_trgm     on public.obs_uaf_subject using gin (name_search gin_trgm_ops);
create index if not exists obs_uaf_evidence_rut_idx      on public.obs_uaf_evidence (rut, kind);

alter table public.obs_uaf_subject  enable row level security;
alter table public.obs_uaf_evidence enable row level security;

do $$
declare t text;
begin
  foreach t in array array['obs_uaf_subject','obs_uaf_evidence'] loop
    execute format('drop policy if exists %I on public.%I', t || '_allowed_read', t);
    execute format($p$
      create policy %I on public.%I
        for select to authenticated
        using (exists (
          select 1 from public.aml_allowed_users au
          where au.user_id = (select auth.uid()) and au.enabled))
    $p$, t || '_allowed_read', t);
  end loop;
end
$$;

------------------------------------------------------------ materializacion

create or replace function public.obs_refresh_uaf(p_snapshot_id text)
returns integer
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_n integer;
begin
  -- La evidencia se borra primero: cuelga del sujeto y quedaria huerfana.
  delete from public.obs_uaf_evidence;
  delete from public.obs_uaf_subject;

  insert into public.obs_uaf_subject (
    rut, rut_search, entity_id, name, name_search, subject_nature, entity_type,
    uaf_sector, sii_status, sii_activity_start_date, sii_termination_date,
    termination_year, activity_years, economic_sector, economic_subsector,
    main_activity, sales_band, sales_band_rank, workers,
    region, commune, territory_basis, igr_score, igr_level,
    is_osfl, is_state_supplier, supplier_amount_12m, supplier_order_count,
    sanction_count, sanction_count_5y, sanction_last_date, has_press, alert_count,
    ipf_score, ipf_band, ipa3_score, ipa3_band, snapshot_id, refreshed_at)
  select
    s.rut,
    nullif(regexp_replace(upper(coalesce(s.rut,'')), '[^0-9K]', '', 'g'), ''),
    s.entity_id,
    coalesce(nullif(btrim(s.entity_name),''), nullif(btrim(s.registry_name),''), s.rut),
    public.obs_normalize_text(coalesce(s.entity_name, s.registry_name, s.rut)),
    s.subject_nature,
    s.entity_type,
    s.uaf_sector_canonical,
    s.sii_status,
    s.sii_activity_start_date,
    s.sii_termination_date,
    extract(year from s.sii_termination_date)::integer,
    -- Anos de actividad: hasta el termino de giro si lo hubo, si no hasta hoy.
    case when s.sii_activity_start_date is not null
         then greatest(0, extract(year from age(
                coalesce(s.sii_termination_date, current_date),
                s.sii_activity_start_date))::integer)
    end,
    s.sii_economic_sector,
    s.sii_economic_subsector,
    s.sii_main_activity,
    s.sii_sales_band,
    s.sii_sales_band_rank,
    s.sii_workers,
    s.region,
    s.commune,
    s.territory_basis,
    t.igr_score,
    t.igr_level,
    coalesce(x.is_osfl, false),
    (sp.actor_id is not null),
    sp.amount_12m,
    sp.order_count_12m,
    coalesce(s.sanction_event_count, 0),
    coalesce(s.sanction_event_count_5y, 0),
    s.sanction_last_event_date,
    coalesce(x.has_press, false),
    coalesce(x.alert_count, 0),
    s.ipf_score, s.ipf_band, s.ipa3_score, s.ipa3_band,
    p_snapshot_id, now()
  from public.aml_uaf_obligated_subject_snapshot s
  -- El padron no trae codigo CUT, asi que el territorio se une por nombre de
  -- comuna normalizado. obs_territory no tiene nombres repetidos, de modo que
  -- la union es univoca; las comunas sin correspondencia quedan sin IGR y la
  -- interfaz las cuenta aparte en vez de suponerles una banda.
  left join public.obs_territory t
    on t.commune_search = public.obs_normalize_text(s.commune)
  left join public.aml_v_universo_so_entity_explorer_0810 x
    on x.rut = s.rut
  -- obs_spend_actor publica el RUT con guion y el padron tambien, pero no hay
  -- garantia de formato entre productores: se normalizan ambos lados.
  left join public.obs_spend_actor sp
    on sp.actor_role = 'SUPPLIER'
   and regexp_replace(upper(sp.actor_id), '[^0-9K]', '', 'g')
     = nullif(regexp_replace(upper(coalesce(s.rut,'')), '[^0-9K]', '', 'g'), '');

  get diagnostics v_n = row_count;

  ------------------------------------------------------------------ evidencia
  -- Sanciones con documento. La radiografia resuelve identidad y conserva el
  -- extracto y la URL de la resolucion, que es lo que permite profundizar.
  insert into public.obs_uaf_evidence (
    evidence_id, rut, kind, event_date, source_label, headline, summary,
    amount_uf, amount_clp, document_url, has_link, identity_status,
    snapshot_id, refreshed_at)
  select distinct on (r.event_id)
    'sanc:' || r.event_id,
    u.rut,
    'SANCION',
    r.event_date,
    r.regulator,
    coalesce(nullif(btrim(r.reason),''), 'Sancion registrada por ' || coalesce(r.regulator,'el regulador')),
    nullif(btrim(r.document_excerpt),''),
    r.amount_uf,
    r.amount_clp,
    nullif(btrim(r.document_url),''),
    nullif(btrim(r.document_url),'') is not null,
    r.identity_status,
    p_snapshot_id, now()
  from public.aml_sanctions_radiography_runtime_snapshot_v0961 r
  join public.obs_uaf_subject u
    on u.rut = r.rut
  where r.event_id is not null
  order by r.event_id, r.event_date desc nulls last;

  -- Prensa. El productor entrega titulo y fecha; no hay URL ni resumen en la
  -- base, de modo que has_link queda en falso y la ficha lo dice en vez de
  -- ofrecer un enlace que no existe.
  insert into public.obs_uaf_evidence (
    evidence_id, rut, kind, event_date, source_label, headline, summary,
    document_url, has_link, snapshot_id, refreshed_at)
  select distinct on (ev->>'event_id')
    'prensa:' || (ev->>'event_id'),
    u.rut,
    'PRENSA',
    nullif(ev->>'fecha','')::date,
    'Prensa',
    nullif(btrim(ev->>'titulo'),''),
    null,
    null,
    false,
    p_snapshot_id, now()
  from public.obs_uaf_subject u
  join public.aml_entities e on e.entity_id = u.entity_id,
  lateral jsonb_array_elements(coalesce(e.profile->'eventos','[]'::jsonb)) ev
  where ev->>'productor' = 'RADAR_PRENSA'
    and ev->>'event_id' is not null
  order by ev->>'event_id', nullif(ev->>'fecha','')::date desc nulls last;

  -- Contadores de antecedente abribles, para que la cohorte y la ficha no
  -- tengan que recorrer la evidencia en cada lectura.
  update public.obs_uaf_subject u set
    sanction_evidence_count = coalesce(c.sanc, 0),
    press_evidence_count    = coalesce(c.prensa, 0)
  from (
    select rut,
           count(*) filter (where kind = 'SANCION') sanc,
           count(*) filter (where kind = 'PRENSA')  prensa
    from public.obs_uaf_evidence group by rut) c
  where c.rut = u.rut;

  return v_n;
end
$$;
comment on function public.obs_refresh_uaf(text) is
  'Materializa el universo de sujetos obligados y su evidencia. Solo lee aguas arriba; nunca escribe fuera de obs_uaf_*.';

--------------------------------------------------------------- obs_uaf_pulse

create or replace function public.obs_uaf_pulse()
returns jsonb
language sql
stable
security invoker
set search_path = public, extensions, pg_temp
as $$
  with universo as (
    select
      count(*)                                                          total,
      count(*) filter (where sii_status = 'ACTIVE_AS_PUBLISHED')        activos,
      count(*) filter (where sii_status = 'TERMINATED_AS_PUBLISHED')    terminados,
      count(*) filter (where sii_status = 'SIN_PERFIL_SII')             sin_perfil,
      count(*) filter (where sii_activity_start_date is not null)       con_inicio,
      count(*) filter (where subject_nature = 'PERSONA_JURIDICA')       juridicas,
      count(*) filter (where subject_nature = 'PERSONA_NATURAL')        naturales,
      count(*) filter (where subject_nature = 'ORGANISMO_PUBLICO')      organismos,
      count(*) filter (where region is not null)                        con_territorio,
      count(distinct region) filter (where region is not null)          regiones,
      count(distinct uaf_sector)                                        sectores_uaf,
      count(distinct economic_sector) filter (where economic_sector is not null) industrias,
      round(avg(activity_years) filter (where activity_years is not null), 1) antiguedad_media
    from public.obs_uaf_subject
  ),
  cruces as (
    select
      count(*) filter (where is_osfl)                        osfl,
      count(*) filter (where is_state_supplier)              proveedores,
      -- Dos cifras que miden cosas distintas: la que el padron atribuye y la
      -- que el analista puede abrir. Publicar solo una de ellas mentiria.
      count(*) filter (where sanction_count > 0)             sancionados_padron,
      count(*) filter (where sanction_evidence_count > 0)    sancionados_con_antecedente,
      count(*) filter (where sanction_count_5y > 0)          sancionados_5y,
      count(*) filter (where press_evidence_count > 0)       prensa,
      count(*) filter (where alert_count > 0)                con_senal,
      sum(alert_count)                                       senales_totales,
      sum(sanction_evidence_count)                           antecedentes_sancion,
      sum(press_evidence_count)                              antecedentes_prensa
    from public.obs_uaf_subject
  ),
  termino_ano as (
    select termination_year ano, count(*) n
    from public.obs_uaf_subject
    where termination_year is not null
    group by 1 order by 1 desc limit 10
  ),
  por_region as (
    select region,
           count(*)                                          sujetos,
           count(*) filter (where sii_status = 'TERMINATED_AS_PUBLISHED') terminados,
           count(*) filter (where sanction_evidence_count > 0) sancionados,
           count(*) filter (where is_state_supplier)          proveedores,
           round(avg(igr_score) filter (where igr_score is not null), 1) igr_medio,
           -- Banda dominante del territorio donde opera la mayoria.
           mode() within group (order by igr_level)           igr_banda,
           count(*) filter (where igr_level = 'Muy alto')     en_igr_muy_alto,
           count(*) filter (where igr_level in ('Alto','Muy alto')) en_igr_alto
    from public.obs_uaf_subject
    where region is not null
    group by 1 order by count(*) desc
  ),
  por_sector as (
    select uaf_sector sector,
           count(*)                                          sujetos,
           count(*) filter (where sii_status = 'TERMINATED_AS_PUBLISHED') terminados,
           count(*) filter (where sanction_evidence_count > 0) sancionados,
           round(avg(ipf_score) filter (where ipf_score is not null), 1) ipf_medio
    from public.obs_uaf_subject
    where uaf_sector is not null
    group by 1 order by count(*) desc limit 14
  ),
  por_industria as (
    select economic_sector industria,
           count(*)                                          sujetos,
           count(*) filter (where sii_status = 'TERMINATED_AS_PUBLISHED') terminados,
           count(*) filter (where sanction_evidence_count > 0) sancionados,
           round(avg(sales_band_rank) filter (where sales_band_rank is not null), 1) banda_ventas_media
    from public.obs_uaf_subject
    where economic_sector is not null
    group by 1 order by count(*) desc limit 14
  ),
  igr_mix as (
    select coalesce(igr_level,'Sin IGR') banda,
           count(*) sujetos,
           round(avg(igr_score), 1) igr_medio
    from public.obs_uaf_subject
    group by 1
  )
  select jsonb_build_object(
    'contract', 'ATLAS_OBS_UAF_PULSE_V1',
    'universe', (select to_jsonb(u) from universo u),
    'crosscuts', (select to_jsonb(c) from cruces c),
    'lifecycle', jsonb_build_object(
        'terminated_by_year', (select coalesce(jsonb_agg(to_jsonb(t) order by t.ano desc),'[]') from termino_ano t)),
    'by_region',    (select coalesce(jsonb_agg(to_jsonb(r)),'[]') from por_region r),
    'by_sector',    (select coalesce(jsonb_agg(to_jsonb(s)),'[]') from por_sector s),
    'by_industry',  (select coalesce(jsonb_agg(to_jsonb(i)),'[]') from por_industria i),
    'igr_mix',      (select coalesce(jsonb_agg(to_jsonb(g) order by g.igr_medio desc nulls last),'[]') from igr_mix g),
    'coverage', jsonb_build_object(
        'supplier_capped',   true,
        'supplier_cap_note', 'El corte de compras públicas publica 3.000 proveedores. Un sujeto sin marca puede tener contratos igualmente.',
        'press_has_links',   false,
        'press_note',        'La prensa llega con título y fecha, sin URL ni resumen: el enlace al artículo no está ingerido.',
        'sanction_note',     'El padrón atribuye sanción a 213 sujetos; la resolución de identidad por RUT alcanza 372 con antecedente abrible. Miden cosas distintas.',
        'uaf_registration_date', false,
        'uaf_registration_note', 'El registro UAF no publica fecha de inscripción ni estado de vigencia, de modo que el eje temporal es el ciclo de vida ante el SII.'),
    'semantics', 'Caracterización descriptiva del padrón de sujetos obligados. El estado ante el SII describe el ciclo de vida tributario, no el cumplimiento de la obligación de reportar. El IGR describe la comuna donde opera el sujeto, nunca al sujeto.'
  );
$$;

-------------------------------------------------------------- obs_uaf_cohort

-- Una sola puerta de profundizacion: la interfaz pide una cohorte y recibe la
-- lista de sujetos que la componen, siempre con su identidad y su contexto.
create or replace function public.obs_uaf_cohort(
  p_cohort text,
  p_value  text default null,
  p_limit  integer default 50,
  p_offset integer default 0)
returns table (
  rut text, entity_id text, name text, subject_nature text, uaf_sector text,
  sii_status text, sii_activity_start_date date, sii_termination_date date,
  activity_years integer, economic_sector text, main_activity text,
  sales_band text, workers bigint, region text, commune text,
  igr_score numeric, igr_level text,
  is_osfl boolean, is_state_supplier boolean, supplier_amount_12m numeric,
  sanction_count integer, sanction_evidence_count integer,
  sanction_last_date date, has_press boolean, press_evidence_count integer,
  alert_count integer, ipf_score numeric, ipf_band text,
  evidence_count bigint, total_count bigint)
language sql
stable
security invoker
set search_path = public, extensions, pg_temp
as $$
  with filtrado as (
    select s.*
    from public.obs_uaf_subject s
    where case upper(coalesce(p_cohort,''))
      when 'TERMINO_GIRO'     then s.sii_status = 'TERMINATED_AS_PUBLISHED'
      when 'ACTIVO'           then s.sii_status = 'ACTIVE_AS_PUBLISHED'
      when 'SIN_PERFIL_SII'   then s.sii_status = 'SIN_PERFIL_SII'
      when 'OSFL'             then s.is_osfl
      when 'PROVEEDOR_ESTADO' then s.is_state_supplier
      when 'SANCIONADO'       then s.sanction_evidence_count > 0 or s.sanction_count > 0
      when 'PRENSA'           then s.press_evidence_count > 0 or s.has_press
      when 'CON_SENAL'        then s.alert_count > 0
      when 'IGR_ALTO'         then s.igr_level in ('Alto','Muy alto')
      when 'IGR_MUY_ALTO'     then s.igr_level = 'Muy alto'
      when 'REGION'           then s.region = p_value
      when 'SECTOR'           then s.uaf_sector = p_value
      when 'INDUSTRIA'        then s.economic_sector = p_value
      when 'TERMINO_ANO'      then s.termination_year = nullif(p_value,'')::integer
      when 'TODOS'            then true
      else false
    end
  ),
  contado as (select count(*) over () total_count, f.* from filtrado f)
  select c.rut, c.entity_id, c.name, c.subject_nature, c.uaf_sector,
         c.sii_status, c.sii_activity_start_date, c.sii_termination_date,
         c.activity_years, c.economic_sector, c.main_activity,
         c.sales_band, c.workers, c.region, c.commune,
         c.igr_score, c.igr_level,
         c.is_osfl, c.is_state_supplier, c.supplier_amount_12m,
         c.sanction_count, c.sanction_evidence_count,
         c.sanction_last_date, c.has_press, c.press_evidence_count,
         c.alert_count, c.ipf_score, c.ipf_band,
         (select count(*) from public.obs_uaf_evidence ev where ev.rut = c.rut),
         c.total_count
  from contado c
  order by
    -- Lo accionable primero: quien tiene antecedente y prioridad mas alta.
    (c.sanction_evidence_count > 0 or c.sanction_count > 0) desc,
    c.ipf_score desc nulls last,
    c.alert_count desc,
    c.name
  limit greatest(1, least(coalesce(p_limit,50), 200))
  offset greatest(0, coalesce(p_offset,0));
$$;

------------------------------------------------------- obs_uaf_subject_dossier

create or replace function public.obs_uaf_subject_dossier(p_rut text)
returns jsonb
language sql
stable
security invoker
set search_path = public, extensions, pg_temp
as $$
  with s as (
    select * from public.obs_uaf_subject
    where rut_search = nullif(regexp_replace(upper(coalesce(p_rut,'')), '[^0-9K]', '', 'g'), '')
       or rut = p_rut
    limit 1
  ),
  ev as (
    select e.kind, e.event_date, e.source_label, e.headline, e.summary,
           e.amount_uf, e.amount_clp, e.document_url, e.has_link, e.identity_status
    from public.obs_uaf_evidence e
    join s on s.rut = e.rut
    order by e.event_date desc nulls last
    limit 40
  )
  select jsonb_build_object(
    'contract', 'ATLAS_OBS_UAF_DOSSIER_V1',
    'subject',  (select to_jsonb(x) from s x),
    'evidence', (select coalesce(jsonb_agg(to_jsonb(e)),'[]') from ev e),
    'semantics', 'El antecedente se muestra tal como lo publica su fuente. Un registro de prensa no es una sanción, y una sanción no es una imputación de lavado de activos.'
  );
$$;

------------------------------------------------------------------- permisos

do $$
declare sig text;
begin
  foreach sig in array array[
    'public.obs_uaf_pulse()',
    'public.obs_uaf_cohort(text,text,integer,integer)',
    'public.obs_uaf_subject_dossier(text)'
  ] loop
    execute format('revoke all on function %s from public, anon', sig);
    execute format('grant execute on function %s to authenticated, service_role', sig);
  end loop;

  execute 'revoke all on function public.obs_refresh_uaf(text) from public, anon, authenticated';
  execute 'grant execute on function public.obs_refresh_uaf(text) to service_role';
end
$$;

---------------------------------------------------- enganche con la agenda

-- El Pulso se lee en cada visita, de modo que su read model tiene que
-- refrescarse con el resto. obs_refresh_full es el unico punto de entrada de
-- la agenda (pg_cron, migracion 0004): si obs_refresh_uaf no cuelga de ahi,
-- el universo se congela en el corte del dia en que se creo.
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
  v_uaf integer;
begin
  v_row := public.obs_refresh_all(p_snapshot_id);

  v_territory := public.obs_refresh_territory(v_row.snapshot_id);
  v_sector    := public.obs_refresh_sector(v_row.snapshot_id);
  v_spend     := public.obs_refresh_spend(v_row.snapshot_id);
  -- Despues de territorio y de compras: el universo lee el IGR comunal y la
  -- marca de proveedor, y con el orden invertido los leeria del corte anterior.
  v_uaf       := public.obs_refresh_uaf(v_row.snapshot_id);

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
           'compras_disponibles', v_spend->'compras_disponibles',
           'obs_uaf_subject', v_uaf,
           'obs_uaf_evidence', (select count(*) from public.obs_uaf_evidence))
   where snapshot_id = v_row.snapshot_id
  returning * into v_row;

  return v_row;
end
$$;
