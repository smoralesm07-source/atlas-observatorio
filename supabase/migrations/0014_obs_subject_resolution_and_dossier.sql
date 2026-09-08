-- ATLAS Observatorio · resolución de sujeto y dossier de entidad
--
-- Dos cambios que van juntos porque atacan la misma queja: la búsqueda devolvía
-- filas de fuente y no sujetos, y la ficha no contaba qué le había pasado a la
-- entidad.
--
-- 1. obs_subject_search consolida. Una consulta por "sartor" devolvía dos
--    sociedades con RUT y veintiocho entidades de prensa sin RUT, todas con el
--    mismo peso visual. Ahora las menciones de prensa se ofrecen como ALIAS
--    CANDIDATOS de la sociedad cuyo nombre las contiene, y el resultado declara,
--    padrón por padrón, dónde figura el sujeto: UAF, SII, OSFL, sanciones,
--    prensa, compras públicas y ejecución presupuestaria.
--
-- 2. obs_entity_timeline reúne en una sola serie fechada todo lo que las
--    fuentes registran sobre una entidad, cada fila con su enlace al documento
--    oficial cuando la fuente lo publica.
--
-- Reglas que no se rompen aquí:
--   · Un alias de prensa es un CANDIDATO. No crea identidad canónica, no se
--     persiste y no altera la prioridad analítica de nadie. El contrato entrega
--     los miembros del clúster para que la interfaz siempre pueda mostrarlos.
--   · La ausencia de una fuente es ausencia, nunca un cero. Una fuente de
--     alcance parcial o bajo demanda que no miró a esta entidad se declara
--     NO_CONSULTADA y jamás SIN_REGISTRO.
--   · Compras públicas y ejecución presupuestaria son universos distintos y
--     viajan en bloques separados: no se suman.

------------------------------------------------------------------ tokens

-- Términos distintivos de una razón social. Se descartan las formas jurídicas y
-- los conectores, que no distinguen a nadie, y los términos de menos de cuatro
-- letras, que producen colisiones absurdas.
create or replace function public.obs_name_tokens(p_name text)
returns text[]
language sql
immutable
parallel safe
set search_path = pg_catalog, pg_temp
as $$
  select coalesce(array_agg(t order by t), '{}'::text[])
  from (
    select distinct t
    from unnest(string_to_array(coalesce(p_name,''), ' ')) as t
    where length(t) >= 4
      and t not in (
        'sociedad','sociedades','limitada','ltda','spa','eirl','anonima',
        'compania','cia','grupo','group','caso','casos','para','este','esta',
        'esto','estos','estas','como','sobre','entre','desde','hasta','contra',
        'segun','tras','ante','bajo','cabe','sino','pero','porque','cuando',
        'donde','quien','cual','cuales','otro','otra','otros','otras'
      )
  ) s;
$$;
comment on function public.obs_name_tokens(text) is
  'Terminos distintivos de un nombre normalizado. Descarta formas juridicas, conectores y terminos de menos de cuatro letras.';

-- Palabra cabecera: la marca con la que empieza la razón social, antes de su
-- forma jurídica o su giro.
create or replace function public.obs_name_head(p_name text)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog, pg_temp
as $$
  select coalesce(
    (select t from unnest(string_to_array(coalesce(p_name,''), ' ')) with ordinality as u(t, ord)
      where length(t) >= 4 order by ord limit 1),
    (select t from unnest(string_to_array(coalesce(p_name,''), ' ')) with ordinality as u(t, ord)
      where t <> '' order by ord limit 1)
  );
$$;
comment on function public.obs_name_head(text) is
  'Primer termino significativo de un nombre normalizado. Es la palabra que identifica a la entidad antes de su forma juridica o su giro.';

--------------------------------------------------- regla de adhesión de alias

-- Una mención de prensa se adhiere a una razón social cuando la nombra, no
-- cuando aparece dentro del nombre de un tercero que la menciona.
create or replace function public.obs_press_attaches(
  p_press_name_search text, p_canonical_name_search text)
returns boolean
language sql
immutable
parallel safe
set search_path = public, pg_temp
as $$
  select
    -- Todos los términos distintivos de la mención están en la razón social…
    public.obs_name_tokens(p_press_name_search) <@ public.obs_name_tokens(p_canonical_name_search)
    and cardinality(public.obs_name_tokens(p_press_name_search)) > 0
    -- …incluida la palabra con la que la razón social empieza. Sin esta
    -- condición, "Codelco" se adhiere a "Sindicato de Trabajadores de Codelco",
    -- que es otra entidad.
    and public.obs_name_head(p_canonical_name_search) = any(public.obs_name_tokens(p_press_name_search))
    -- …y la razón social no agrega un giro entero de términos propios.
    and cardinality(public.obs_name_tokens(p_canonical_name_search))
        <= cardinality(public.obs_name_tokens(p_press_name_search)) + 4;
$$;
comment on function public.obs_press_attaches(text,text) is
  'Regla de adhesion de una mencion de prensa a una razon social. Produce un alias CANDIDATO: no acredita identidad ni participacion.';

------------------------------------------------------- obs_subject_search

-- Un sujeto es una entidad del universo observado con todo lo que las fuentes
-- dicen de ella colgando de una sola fila. Las entidades de prensa sin RUT que
-- no logran adherirse a ninguna razón social se devuelven igual, marcadas como
-- tales: perderlas sería peor que mostrarlas mal.
create or replace function public.obs_subject_search(
  p_q          text default null,
  p_limit      integer default 25,
  p_offset     integer default 0,
  p_region     text default null,
  p_source     text default null,
  p_only_uaf   boolean default false,
  p_only_sanctioned boolean default false,
  p_min_sources integer default null,
  p_only_supplier boolean default false)
returns table (
  entity_id text, rut text, name text, entity_type text,
  region text, commune text, source_count integer, sources text[], roles text[],
  is_uaf_observed boolean, is_sanctioned boolean, uaf_sector text,
  ipa3_score numeric, ipa3_band text,
  event_count integer, finding_count integer, alert_count integer,
  sanction_count integer, match_kind text, match_rank real,
  tax_status text, tax_activity text, tax_region text,
  tax_activity_start date, tax_termination date,
  tax_sales_band_rank integer, tax_sales_band_uf text, tax_size text,
  tax_workers bigint, tax_economic_sector text,
  -- coincidencia padrón por padrón
  in_uaf boolean, in_sii boolean, in_osfl boolean, in_press boolean,
  osfl_registro19862 boolean, osfl_type text,
  spend_role text, spend_amount_12m numeric, spend_orders_12m bigint,
  budget_signal_count integer,
  -- clúster de alias
  is_press_only boolean, press_alias_count integer, press_aliases jsonb,
  total_count bigint)
language plpgsql
stable
security invoker
set search_path = public, extensions, pg_temp
as $$
declare
  v_raw    text := nullif(btrim(coalesce(p_q,'')),'');
  v_norm   text := btrim(public.obs_normalize_text(coalesce(p_q,'')));
  v_rut    text := nullif(regexp_replace(upper(coalesce(p_q,'')), '[^0-9K]', '', 'g'), '');
  v_limit  integer := greatest(1, least(coalesce(p_limit,25), 100));
  v_off    integer := greatest(0, coalesce(p_offset,0));
  v_is_rut boolean := v_rut is not null and length(v_rut) >= 4
                      and length(v_rut) >= (length(regexp_replace(coalesce(p_q,''),'[^A-Za-z0-9]','','g')) - 1);
begin
  return query
  with matched as (
    -- Universo que responde a la consulta, con la misma semántica de
    -- coincidencia que ya usaba el listado.
    select e.*,
      case
        when v_is_rut and e.rut_search = v_rut then 'RUT_EXACTO'
        when v_is_rut then 'RUT_PARCIAL'
        when v_norm = '' then 'SIN_CONSULTA'
        when e.name_search = v_norm then 'NOMBRE_EXACTO'
        when e.name_search like v_norm || '%' then 'NOMBRE_INICIO'
        when e.name_search like '%' || v_norm || '%' then 'NOMBRE_CONTIENE'
        else 'NOMBRE_APROXIMADO'
      end as mk,
      case when v_norm = '' or v_is_rut then 0::real
           else extensions.similarity(e.name_search, v_norm) end as sim
    from public.obs_entity e
    where
      case
        when v_raw is null then true
        when v_is_rut then e.rut_search like v_rut || '%'
        when v_norm = '' then true
        when length(v_norm) < 3 then e.name_search like v_norm || '%'
        else e.name_search operator(extensions.%) v_norm
          or e.name_search like '%' || v_norm || '%'
      end
      and (p_region is null or e.region = p_region)
      and (p_source is null or p_source = any(e.sources))
      and (not p_only_uaf or e.is_uaf_observed)
      and (not p_only_sanctioned or e.is_sanctioned)
      and (p_min_sources is null or e.source_count >= p_min_sources)
  ),
  -- Se califican las columnas: `rut` y `name` colisionan con los parámetros de
  -- salida de la función, que en plpgsql tienen precedencia sobre la columna.
  canonical as (select m.* from matched m where m.rut is not null),
  press as (
    -- Entidad de prensa: sin RUT y reportada únicamente por Radar Prensa.
    select m.* from matched m
    where m.rut is null and m.sources = array['RADAR_PRENSA']::text[]
  ),
  -- Adhesión de alias: todos los términos distintivos de la mención de prensa
  -- están en la razón social, y la razón social no agrega más de cuatro
  -- términos propios. El techo evita que "Codelco" se adhiera a un sindicato de
  -- trabajadores de Codelco, que es otra entidad.
  attach as (
    select p.entity_id as press_id, p.name as press_name,
           c.entity_id as canonical_id
    from press p
    join canonical c on public.obs_press_attaches(p.name_search, c.name_search)
  ),
  alias_agg as (
    select a.canonical_id,
           count(*)::integer as n,
           jsonb_agg(jsonb_build_object(
             'entity_id', a.press_id, 'name', a.press_name, 'source', 'RADAR_PRENSA'
           ) order by a.press_name) as aliases
    from attach a group by a.canonical_id
  ),
  -- Sólo se devuelven por separado las menciones que no se adhirieron a nada.
  press_loose as (
    select p.* from press p
    where not exists (select 1 from attach a where a.press_id = p.entity_id)
  ),
  subjects as (
    select c.*, false as press_only from canonical c
    union all
    select p.*, true from press_loose p
  ),
  enriched as (
    select
      s.entity_id, s.rut, s.name, s.entity_type, s.region, s.commune,
      s.source_count, s.sources, s.roles,
      s.is_uaf_observed, s.is_sanctioned, s.uaf_sector,
      s.ipa3_score, s.ipa3_band,
      s.event_count, s.finding_count, s.alert_count, s.sanction_count,
      s.mk, s.sim, s.press_only,
      t.current_status, t.main_activity, t.region as t_region,
      t.activity_start_date, t.termination_date,
      t.sales_band_rank,
      public.obs_sales_band_uf(t.sales_band_rank) as sales_band_uf,
      public.obs_sales_band_size(t.sales_band_rank) as size_label,
      t.workers_numeric, t.economic_sector,
      o.registro19862, o.osfl_type as o_osfl_type,
      sp.actor_role, sp.amount_12m, sp.order_count_12m,
      coalesce(bs.n, 0)::integer as budget_n,
      coalesce(al.n, 0)::integer as alias_n,
      coalesce(al.aliases, '[]'::jsonb) as alias_rows
    from subjects s
    left join public.aml_entity_tax_profile t on t.entity_id = s.entity_id
    left join public.obs_osfl_entity o on o.entity_id = s.entity_id
    left join alias_agg al on al.canonical_id = s.entity_id
    -- Compras públicas cruzan por RUT: obs_spend_actor.actor_id es el RUT del
    -- actor. Un proveedor fuera del universo observado sigue siendo proveedor.
    left join lateral (
      select a.actor_role, a.amount_12m, a.order_count_12m
      from public.obs_spend_actor a
      where s.rut is not null
        and upper(regexp_replace(a.actor_id, '[^0-9Kk]', '', 'g')) = s.rut_search
      order by a.amount_12m desc nulls last
      limit 1
    ) sp on true
    left join lateral (
      select count(*) as n from public.obs_budget_signal b
      where b.entity_id = s.entity_id
         or (s.rut is not null and b.provider_rut is not null
             and upper(regexp_replace(b.provider_rut, '[^0-9Kk]', '', 'g')) = s.rut_search)
    ) bs on true
  ),
  filtered as (
    select f.* from enriched f
    where not p_only_supplier or f.actor_role is not null
  ),
  counted as (select count(*) over () as total_count, f.* from filtered f)
  select
    c.entity_id, c.rut, c.name, c.entity_type, c.region, c.commune,
    c.source_count, c.sources, c.roles,
    c.is_uaf_observed, c.is_sanctioned, c.uaf_sector,
    c.ipa3_score, c.ipa3_band,
    c.event_count, c.finding_count, c.alert_count, c.sanction_count,
    c.mk, c.sim,
    c.current_status, c.main_activity, c.t_region,
    c.activity_start_date, c.termination_date,
    c.sales_band_rank, c.sales_band_uf, c.size_label,
    c.workers_numeric, c.economic_sector,
    c.is_uaf_observed,
    ('RADAR_SII' = any(c.sources)),
    ('RADAR_OSFL' = any(c.sources)),
    ('RADAR_PRENSA' = any(c.sources)) or c.alias_n > 0,
    coalesce(c.registro19862, false), c.o_osfl_type,
    c.actor_role, c.amount_12m, c.order_count_12m,
    c.budget_n,
    c.press_only, c.alias_n, c.alias_rows,
    c.total_count
  from counted c
  order by
    -- La identidad manda sobre el parecido de texto. Una razón social con RUT y
    -- cuatro fuentes nunca vuelve a quedar debajo de una mención genérica de
    -- prensa que coincidió exacto por ser corta.
    c.press_only,
    case c.mk
      when 'RUT_EXACTO' then 0 when 'RUT_PARCIAL' then 1
      when 'NOMBRE_EXACTO' then 2 when 'NOMBRE_INICIO' then 3
      when 'NOMBRE_CONTIENE' then 4 when 'NOMBRE_APROXIMADO' then 5
      else 6 end,
    (c.source_count + least(c.alias_n, 5)) desc,
    c.sanction_count desc,
    round(c.sim::numeric, 1) desc,
    c.ipa3_score desc nulls last,
    c.name
  limit v_limit offset v_off;
end
$$;
comment on function public.obs_subject_search(text,integer,integer,text,text,boolean,boolean,integer,boolean) is
  'Busqueda consolidada por sujeto. Las menciones de prensa se adhieren como alias candidatos: no crean identidad canonica ni alteran prioridad. Declara coincidencia padron por padron.';

------------------------------------------------------ obs_entity_timeline

-- Todo lo que las fuentes registran sobre una entidad, en una sola serie
-- fechada. date_precision declara si la fuente publica el día o sólo el año,
-- para que la interfaz no invente una exactitud que el dato no tiene.
create or replace function public.obs_entity_timeline(p_entity_id text)
returns table (
  kind text, event_date date, date_precision text,
  source_code text, source_label text,
  title text, summary text,
  amount_uf numeric, amount_clp numeric,
  document_url text, has_link boolean,
  identity_status text)
language sql
stable
security invoker
set search_path = public, extensions, pg_temp
as $$
  with e as (select * from public.obs_entity where entity_id = p_entity_id),
  tax as (
    select * from public.aml_entity_tax_profile where entity_id = p_entity_id limit 1
  ),
  uaf as (
    select * from public.aml_uaf_obligated_subject_snapshot
    where entity_id = p_entity_id limit 1
  ),
  -- La evidencia sancionatoria del Pulso cruza por RUT y conserva el enlace a
  -- la resolución del regulador. Es la única fuente del corte que trae el
  -- documento oficial en el 100% de sus filas.
  ev as (
    select v.* from public.obs_uaf_evidence v join e on v.rut = e.rut
  ),
  rows_all as (
    select 'SANCION'::text kind, v.event_date, 'DIA'::text date_precision,
           'RADAR_SANCIONES'::text source_code,
           coalesce(v.source_label, 'Regulador') source_label,
           coalesce(v.headline, 'Evento sancionatorio') title,
           v.summary, v.amount_uf, v.amount_clp,
           v.document_url, coalesce(v.has_link, v.document_url is not null) has_link,
           v.identity_status
    from ev v where v.kind = 'SANCION'

    union all
    -- Sanciones que no tienen fila en la evidencia por RUT: se muestran igual,
    -- declarando que no traen documento.
    select 'SANCION', s.event_date, 'DIA',
           'RADAR_SANCIONES', coalesce(s.regulator, 'Regulador'),
           coalesce(nullif(s.subject,''), 'Evento sancionatorio'),
           nullif(s.payload->'attributes'->>'resolution',''),
           s.amount_uf, null::numeric,
           null::text, false, s.identity_status
    from public.aml_sanctions s
    where s.entity_id = p_entity_id
      and not exists (select 1 from ev v where v.kind='SANCION' and v.event_date = s.event_date)

    union all
    select 'PRENSA', v.event_date,
           case when v.event_date is null then 'SIN_FECHA' else 'DIA' end,
           'RADAR_PRENSA', coalesce(v.source_label, 'Prensa'),
           coalesce(v.headline, 'Mención en prensa'), v.summary,
           null::numeric, null::numeric,
           v.document_url, coalesce(v.has_link, false), v.identity_status
    from ev v where v.kind = 'PRENSA'

    union all
    -- Ejecución presupuestaria, auditoría CGR y audiencias de lobby. Universo
    -- distinto al de compras públicas: nunca se agregan en una sola cifra.
    select 'PRESUPUESTO', b.event_date,
           case when b.event_date is null then 'SIN_FECHA' else 'DIA' end,
           b.source_code, coalesce(b.source_code, 'Fuente fiscal'),
           coalesce(b.title, b.signal_code, 'Señal presupuestaria'),
           b.summary, null::numeric, b.amount_clp,
           b.source_url, b.source_url is not null, b.match_method
    from public.obs_budget_signal b, e
    where b.entity_id = p_entity_id
       or (e.rut is not null and b.provider_rut is not null
           and upper(regexp_replace(b.provider_rut,'[^0-9Kk]','','g')) = e.rut_search)

    union all
    -- Relación con el Estado como comprador o proveedor. La fecha es el primer
    -- registro observado en la ventana de 12 meses del corte de compras.
    select 'COMPRAS', a.first_seen,
           case when a.first_seen is null then 'SIN_FECHA' else 'DIA' end,
           'MERCADO_PUBLICO', 'Mercado Público · ChileCompra',
           case a.actor_role when 'SUPPLIER' then 'Proveedor del Estado'
                             when 'BUYER' then 'Comprador público'
                             else 'Actor de compras públicas' end,
           concat_ws(' · ',
             a.order_count_12m || ' órdenes en 12 meses',
             a.counterpart_count || ' contrapartes',
             case when a.last_seen is not null then 'último registro ' || to_char(a.last_seen,'DD-MM-YYYY') end),
           null::numeric, a.amount_12m,
           null::text, false, null::text
    from public.obs_spend_actor a, e
    where e.rut is not null
      and upper(regexp_replace(a.actor_id,'[^0-9Kk]','','g')) = e.rut_search

    union all
    -- Hitos tributarios. Enmarcan a los hechos puntuales: sin ellos, una
    -- sanción de 2019 no dice nada sobre una sociedad constituida en 2018.
    select 'SII', t.activity_start_date, 'DIA', 'RADAR_SII',
           'Servicio de Impuestos Internos', 'Inicio de actividades',
           t.main_activity, null::numeric, null::numeric, null::text, false, null::text
    from tax t where t.activity_start_date is not null

    union all
    select 'SII', t.termination_date, 'DIA', 'RADAR_SII',
           'Servicio de Impuestos Internos', 'Término de giro',
           'La entidad cerró su giro tributario',
           null::numeric, null::numeric, null::text, false, null::text
    from tax t where t.termination_date is not null

    union all
    select 'SII', t.latest_activity_registration_date, 'DIA', 'RADAR_SII',
           'Servicio de Impuestos Internos', 'Última actividad económica declarada',
           nullif(t.activity_names,''), null::numeric, null::numeric, null::text, false, null::text
    from tax t
    where t.latest_activity_registration_date is not null
      and t.latest_activity_registration_date is distinct from t.activity_start_date

    union all
    -- El padrón UAF no publica fecha de inscripción. Lo único fechado es cuándo
    -- el Observatorio observó a la entidad en el corte, y así se rotula.
    select 'PADRON_UAF', u.registry_observed_at::date, 'DIA', 'RADAR_UAF',
           'Unidad de Análisis Financiero',
           'Observada en el padrón de sujetos obligados',
           concat_ws(' · ', u.uaf_sector_canonical, u.subject_nature),
           null::numeric, null::numeric, null::text, false, null::text
    from uaf u where u.registry_observed_at is not null
  )
  select r.kind, r.event_date, r.date_precision, r.source_code, r.source_label,
         r.title, r.summary, r.amount_uf, r.amount_clp,
         r.document_url, r.has_link, r.identity_status
  from rows_all r
  order by r.event_date desc nulls last,
           case r.kind when 'SANCION' then 0 when 'PRENSA' then 1
                       when 'PRESUPUESTO' then 2 when 'COMPRAS' then 3
                       when 'PADRON_UAF' then 4 else 5 end;
$$;
comment on function public.obs_entity_timeline(text) is
  'Serie fechada de todo lo que las fuentes gobernadas registran sobre una entidad, con enlace al documento oficial cuando la fuente lo publica. date_precision declara la exactitud del dato.';

-------------------------------------------- obs_entity_detail · bloques nuevos

-- Se extiende el contrato existente de forma aditiva: las claves que la ficha
-- ya consume no cambian de forma ni de nombre.
create or replace function public.obs_entity_dossier(p_entity_id text)
returns jsonb
language sql
stable
security invoker
set search_path = public, extensions, pg_temp
as $$
  with base as (select public.obs_entity_detail(p_entity_id) as d),
  e as (select * from public.obs_entity where entity_id = p_entity_id),
  spend as (
    select a.actor_role, a.label, a.amount_12m, a.order_count_12m,
           a.counterpart_count, a.top_counterpart_share, a.hhi,
           a.concentration_percentile, a.materiality_percentile,
           a.growth_ratio, a.active_months, a.first_seen, a.last_seen,
           a.review_priority
    from public.obs_spend_actor a, e
    where e.rut is not null
      and upper(regexp_replace(a.actor_id,'[^0-9Kk]','','g')) = e.rut_search
    order by a.amount_12m desc nulls last
    limit 1
  ),
  budget as (
    select b.evidence_id, b.source_code, b.evidence_type, b.signal_code,
           b.severity, b.priority_tier, b.event_date, b.amount_clp,
           b.title, b.summary, b.source_url, b.match_method
    from public.obs_budget_signal b, e
    where b.entity_id = p_entity_id
       or (e.rut is not null and b.provider_rut is not null
           and upper(regexp_replace(b.provider_rut,'[^0-9Kk]','','g')) = e.rut_search)
    order by b.event_date desc nulls last
    limit 40
  ),
  osfl_reg as (
    select o.osfl_type, o.activity_group, o.main_activity, o.current_status,
           o.registro19862, o.public_funds, o.transfer_count, o.transfer_amount_clp,
           o.uaf_class, o.uaf_label, o.sales_band, o.workers_numeric
    from public.obs_osfl_entity o where o.entity_id = p_entity_id limit 1
  ),
  timeline as (select * from public.obs_entity_timeline(p_entity_id))
  select case when (select d from base) is null then null else
    (select d from base) || jsonb_build_object(
      'spend',    (select to_jsonb(s) from spend s),
      'budget',   (select coalesce(jsonb_agg(to_jsonb(b)), '[]') from budget b),
      'osfl_registry', (select to_jsonb(o) from osfl_reg o),
      'timeline', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from timeline t),
      'dossier_semantics', jsonb_build_object(
        'spend_note',
          'Compras públicas y ejecución presupuestaria son universos distintos y no se suman. La ventana de compras es de 12 meses al corte publicado.',
        'timeline_note',
          'La línea de tiempo reúne lo que las fuentes registran. Una fila sin enlace es una fuente que no publica el documento, no una afirmación sin respaldo.',
        'press_note',
          'Las coincidencias de prensa son contexto abierto: no acreditan identidad canónica ni participación.')
    ) end;
$$;
comment on function public.obs_entity_dossier(text) is
  'Ficha de observacion ampliada: obs_entity_detail mas compras publicas, senales presupuestarias, registro OSFL y linea de tiempo con documento oficial.';

------------------------------------------------------------------ permisos

do $$
declare sig text;
begin
  foreach sig in array array[
    'public.obs_name_tokens(text)',
    'public.obs_name_head(text)',
    'public.obs_press_attaches(text,text)',
    'public.obs_subject_search(text,integer,integer,text,text,boolean,boolean,integer,boolean)',
    'public.obs_entity_timeline(text)',
    'public.obs_entity_dossier(text)'
  ] loop
    execute format('revoke all on function %s from public, anon', sig);
    execute format('grant execute on function %s to authenticated, service_role', sig);
  end loop;
end
$$;
