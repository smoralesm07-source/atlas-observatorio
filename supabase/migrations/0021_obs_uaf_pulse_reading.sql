-- ATLAS Observatorio · La lectura del corte
--
-- El Pulso abria con cinco KPI y, debajo, nueve bloques del mismo peso visual.
-- Ninguno decia que mirar primero, de modo que el hallazgo del corte —la cifra
-- por la que este corte se diferencia del anterior— quedaba enterrado a media
-- pagina dentro de un callout, o simplemente no se decia.
--
-- Esta migracion publica esa lectura como dato gobernado: tres hallazgos
-- escritos por corte, con su cifra, su tono y la lente a la que llevan.
--
-- POR QUE CURADA Y NO DERIVADA DE UMBRALES:
-- Un umbral produce una frase con el mismo enfasis siempre, incluso cuando no
-- hay nada que decir, y obliga a la interfaz a afirmar como hallazgo lo que
-- solo es una cifra que cruzo una linea. Aqui el hallazgo lo escribe quien lee
-- el corte. La contrapartida esta declarada en el contrato: si el snapshot
-- vigente no trae lectura, 'reading' llega vacio y la franja no se dibuja. La
-- ausencia de texto no se rellena con texto generado.
--
-- LIMITES DECLARADOS:
--  * La lectura cuelga de un snapshot. Al publicarse un corte nuevo, el texto
--    del anterior deja de mostrarse: describia otras cifras.
--  * 'destino' nombra una lente del Pulso, no una entidad ni una cohorte. Un
--    hallazgo del corte orienta donde mirar; no imputa nada a nadie.
--  * 'cifra' se guarda ya formateada porque es una frase, no una medida: puede
--    ser un porcentaje, un conteo o una relacion como "37 / 39". La interfaz la
--    imprime tal cual y nunca opera con ella.

create table if not exists public.obs_uaf_pulse_reading (
  snapshot_id text not null,
  orden       integer not null,
  -- Ya formateada por quien la escribe: la interfaz no la recalcula.
  cifra       text not null,
  -- Nombre de token del sistema de diseno, sin var(). La interfaz valida el
  -- valor contra su propia lista y dibuja neutro cualquier otro: un color
  -- arbitrario guardado aqui no debe poder pintar la pantalla.
  tono        text not null default 'accent',
  titulo      text not null,
  glosa       text not null,
  -- Lente del Pulso a la que lleva el hallazgo, o nulo si no navega.
  destino     text check (destino in ('reportabilidad','revision','territorio','ciclo')),
  written_at  timestamptz not null default now(),
  primary key (snapshot_id, orden)
);

comment on table public.obs_uaf_pulse_reading is
  'Hallazgos curados del corte que abren el Pulso. Se escriben por snapshot; su ausencia oculta la franja en vez de generar texto automatico. Ningun hallazgo imputa incumplimiento ni riesgo LA/FT.';
comment on column public.obs_uaf_pulse_reading.cifra is
  'Cifra ya formateada: es una frase, no una medida. La interfaz la imprime tal cual y nunca opera con ella.';
comment on column public.obs_uaf_pulse_reading.tono is
  'Token de color del sistema sin var(): accent, present, unknown, absent, sig-critical, sig-high, sig-medium, sig-watch.';
comment on column public.obs_uaf_pulse_reading.destino is
  'Lente del Pulso a la que lleva el hallazgo. Orienta donde mirar; no atribuye conducta.';

alter table public.obs_uaf_pulse_reading enable row level security;

do $$
begin
  drop policy if exists obs_uaf_pulse_reading_allowed_read on public.obs_uaf_pulse_reading;
  create policy obs_uaf_pulse_reading_allowed_read on public.obs_uaf_pulse_reading
    for select to authenticated
    using (exists (
      select 1 from public.aml_allowed_users au
      where au.user_id = (select auth.uid()) and au.enabled));
end
$$;

revoke all on table public.obs_uaf_pulse_reading from public, anon;
grant select on table public.obs_uaf_pulse_reading to authenticated, service_role;

------------------------------------------------------------------- lectura

-- Los tres hallazgos del corte vigente. Cada cifra sale del propio contrato y
-- se deja escrita, no calculada: 16.711 de 21.828 ROS en tres sectores, 128 de
-- 147 sancionados recientes con IPF alto, y 37 altas contra 39 terminos en el
-- ano en curso.
insert into public.obs_uaf_pulse_reading (snapshot_id, orden, cifra, tono, titulo, glosa, destino)
select s.snapshot_id, v.orden, v.cifra, v.tono, v.titulo, v.glosa, v.destino
from (select snapshot_id from public.obs_snapshot order by generated_at desc limit 1) s
cross join (values
  (1, '76,6%', 'sig-medium',
   'Tres sectores explican tres de cada cuatro ROS de 2025',
   '16.711 de 21.828 reportes. Los tres sectores más numerosos del padrón —6.543 inscritos— aportan 46.',
   'reportabilidad'),
  (2, '128', 'sig-critical',
   'Sancionados en 5 años que además tienen IPF alto',
   'De 147 con sanción reciente, 128 caen en la banda alta del índice. Es la cola más corta y la más densa del turno.',
   'revision'),
  (3, '37 / 39', 'sig-high',
   'En 2026 el padrón deja de crecer por primera vez',
   '37 inicios de actividad contra 39 términos de giro. En 2019 la relación era de 420 contra 21.',
   'ciclo')
) as v(orden, cifra, tono, titulo, glosa, destino)
on conflict (snapshot_id, orden) do nothing;

--------------------------------------------------------------- el contrato

-- Se republica el Pulso completo con el bloque 'reading'. El resto del cuerpo
-- es el de la migracion 0011, sin cambios.

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
      round(avg(activity_years) filter (where activity_years is not null), 1) antiguedad_media,
      count(*) filter (where ipf_score is not null)                     con_ipf,
      round(avg(ipf_score) filter (where ipf_score is not null), 1)     ipf_medio,
      round((percentile_cont(0.9) within group (order by ipf_score))::numeric, 1) ipf_p90,
      count(*) filter (where ipf_band in ('MUY_ALTA','ALTA'))           ipf_alto,
      count(*) filter (where activity_atypicality >= 0.90)              giro_atipico,
      count(*) filter (where sii_activity_changed)                      cambio_actividad,
      count(*) filter (where sii_region_changed)                        cambio_region,
      count(*) filter (where ownership_edge_count >= 5)                 estructura_amplia,
      sum(workers) filter (where workers is not null)                   trabajadores,
      count(*) filter (where attention_rank is not null)                en_atencion
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
  ipf_bandas as (
    select coalesce(ipf_band,'SIN_IPF') banda, count(*) sujetos,
           round(avg(ipf_score),1) ipf_medio
    from public.obs_uaf_subject group by 1
  ),
  atencion_mix as (
    select attention_motive motivo, attention_rank orden, count(*) sujetos,
           count(*) filter (where ipf_band in ('MUY_ALTA','ALTA')) con_ipf_alto
    from public.obs_uaf_subject
    where attention_motive is not null
    group by 1, 2
  ),
  atencion_top as (
    select rut, entity_id, name, uaf_sector, economic_sector, main_activity,
           region, commune, igr_level, sii_status, sii_termination_date,
           attention_motive motivo, attention_rank orden,
           ipf_score, ipf_band, sanction_evidence_count, sanction_last_date,
           press_evidence_count, alert_count, activity_atypicality,
           is_state_supplier, workers, sales_band
    from public.obs_uaf_subject
    where attention_rank is not null
    order by attention_rank asc,
             sanction_evidence_count desc,
             ipf_score desc nulls last,
             name
    limit 24
  ),
  termino_ano as (
    select termination_year ano, count(*) n
    from public.obs_uaf_subject
    where termination_year is not null
    group by 1 order by 1 desc limit 12
  ),
  inicio_ano as (
    select extract(year from sii_activity_start_date)::integer ano, count(*) n
    from public.obs_uaf_subject
    where sii_activity_start_date is not null
      and sii_activity_start_date >= date '2010-01-01'
    group by 1 order by 1
  ),
  sancion_ano as (
    select extract(year from event_date)::integer ano,
           count(*) eventos,
           count(distinct rut) sujetos,
           round(sum(amount_uf) filter (where amount_uf is not null), 0) monto_uf,
           count(*) filter (where has_link) con_documento
    from public.obs_uaf_evidence
    where kind = 'SANCION' and event_date is not null
    group by 1 order by 1
  ),
  por_region as (
    select region,
           count(*)                                          sujetos,
           count(*) filter (where sii_status = 'TERMINATED_AS_PUBLISHED') terminados,
           count(*) filter (where sanction_evidence_count > 0) sancionados,
           count(*) filter (where is_state_supplier)          proveedores,
           count(*) filter (where attention_rank is not null) en_atencion,
           round(avg(igr_score) filter (where igr_score is not null), 1) igr_medio,
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
           count(*) filter (where attention_rank is not null) en_atencion,
           round(avg(ipf_score) filter (where ipf_score is not null), 1) ipf_medio
    from public.obs_uaf_subject
    where uaf_sector is not null
    group by 1 order by count(*) desc limit 20
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
  ),
  -- ─────────────────────────────────────────────────── reportabilidad
  padron_sector as (
    select uaf_sector, count(*) sujetos,
           count(*) filter (where sanction_evidence_count > 0) sancionados,
           count(*) filter (where attention_rank is not null) en_atencion,
           round(avg(ipf_score) filter (where ipf_score is not null), 1) ipf_medio
    from public.obs_uaf_subject group by 1
  ),
  rep_sector as (
    select r.sector_official, r.sector_canonical,
           coalesce(r.sector_canonical, r.sector_official) etiqueta,
           p.sujetos padron_sujetos, p.sancionados, p.en_atencion, p.ipf_medio,
           r.registered_so_2025, r.ros_2021, r.ros_2022, r.ros_2023, r.ros_2024,
           r.ros_2025, r.ros_total_2021_2025, r.ros_per_100_so_2025,
           r.delta_ros_2025_vs_2024_pct, r.silence_5y,
           r.indicios_total_2021_2025,
           case when coalesce(r.ros_total_2021_2025,0) > 0
                then round(100.0 * coalesce(r.indicios_total_2021_2025,0)
                                 / r.ros_total_2021_2025, 1) end icr_pct,
           r.has_conversion
    from public.obs_uaf_reporting_sector r
    left join padron_sector p on p.uaf_sector = r.sector_canonical
  ),
  rep_nacional as (
    select metric,
           jsonb_agg(jsonb_build_object('periodo', period, 'valor', value)
                     order by period) puntos,
           max(unit) unidad, max(category) categoria,
           max(source_url) fuente, max(as_of_date) corte
    from public.obs_uaf_reporting_national
    group by metric
  ),
  rep_totales as (
    select
      (select sum(ros_2025) from public.obs_uaf_reporting_sector)   ros_2025,
      (select sum(ros_total_2021_2025) from public.obs_uaf_reporting_sector) ros_5y,
      (select sum(indicios_total_2021_2025) from public.obs_uaf_reporting_sector) indicios_5y,
      (select max(ros_2025) from public.obs_uaf_reporting_sector)   ros_2025_max,
      (select count(*) from public.obs_uaf_reporting_sector where silence_5y) sectores_silenciosos,
      (select count(*) from public.obs_uaf_reporting_sector where sector_canonical is null) sectores_sin_inscritos,
      (select coalesce(sum(p.sujetos),0)
         from public.obs_uaf_reporting_sector r
         join padron_sector p on p.uaf_sector = r.sector_canonical
        where r.silence_5y)                                          sujetos_en_silencio,
      (select coalesce(sum(ros_2025),0) from (
          select ros_2025 from public.obs_uaf_reporting_sector
          order by ros_2025 desc nulls last limit 3) t)               ros_top3
  )
  select jsonb_build_object(
    'contract', 'ATLAS_OBS_UAF_PULSE_V3',
    'snapshot', (select to_jsonb(x) from (
        select snapshot_id, generated_at, published_at, status
        from public.obs_snapshot order by generated_at desc limit 1) x),
    'universe',  (select to_jsonb(u) from universo u),
    'crosscuts', (select to_jsonb(c) from cruces c),
    'ipf_bands', (select coalesce(jsonb_agg(to_jsonb(b) order by b.sujetos desc),'[]') from ipf_bandas b),
    'attention', jsonb_build_object(
        'total',   (select en_atencion from universo),
        'motivos', (select coalesce(jsonb_agg(to_jsonb(a) order by a.orden),'[]') from atencion_mix a),
        'top',     (select coalesce(jsonb_agg(to_jsonb(t)),'[]') from atencion_top t)),
    'lifecycle', jsonb_build_object(
        'terminated_by_year', (select coalesce(jsonb_agg(to_jsonb(t) order by t.ano desc),'[]') from termino_ano t),
        'started_by_year',    (select coalesce(jsonb_agg(to_jsonb(i) order by i.ano),'[]') from inicio_ano i)),
    'sanctions', jsonb_build_object(
        'by_year', (select coalesce(jsonb_agg(to_jsonb(s) order by s.ano),'[]') from sancion_ano s),
        'eventos', (select count(*) from public.obs_uaf_evidence where kind = 'SANCION'),
        'con_documento', (select count(*) from public.obs_uaf_evidence where kind = 'SANCION' and has_link),
        'monto_uf', (select round(sum(amount_uf),0) from public.obs_uaf_evidence where kind = 'SANCION'),
        'ultimo', (select max(event_date) from public.obs_uaf_evidence where kind = 'SANCION')),
    'reporting', jsonb_build_object(
        'disponible', (select count(*) > 0 from public.obs_uaf_reporting_sector),
        'corte', jsonb_build_object(
            'periodo', '2021-2025',
            'padron_referencia', 9911,
            'padron_referencia_corte', '2025-12-31',
            'fuente', 'Informe Estadístico UAF 2025',
            'fuente_url', 'https://www.uaf.cl/media/documentos/Informe_Estadistico_2025.pdf'),
        'nacional', (select coalesce(jsonb_object_agg(metric, jsonb_build_object(
                        'puntos', puntos, 'unidad', unidad, 'categoria', categoria,
                        'fuente', fuente, 'corte', corte)), '{}') from rep_nacional),
        'sectores', (select coalesce(jsonb_agg(to_jsonb(r)
                        order by r.padron_sujetos desc nulls last,
                                 r.registered_so_2025 desc nulls last), '[]') from rep_sector r),
        'totales', (select to_jsonb(t) from rep_totales t)),
    'screening', public.obs_uaf_screening_block(),
    -- Lectura curada del corte. Se escribe por snapshot y no se deriva de
    -- umbrales: si nadie la escribio, el arreglo llega vacio y la franja no se
    -- dibuja. Un hallazgo automatico de relleno diria con el mismo enfasis algo
    -- que ningun analista reviso.
    'reading', (
        select coalesce(jsonb_agg(to_jsonb(r) - 'snapshot_id' - 'written_at' order by r.orden), '[]')
        from public.obs_uaf_pulse_reading r
        where r.snapshot_id = (
          select snapshot_id from public.obs_snapshot order by generated_at desc limit 1)),
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
        'uaf_registration_note', 'El registro UAF no publica fecha de inscripción ni estado de vigencia, de modo que el eje temporal es el ciclo de vida ante el SII.',
        'reporting_level',   'SECTOR',
        'reporting_note',    'La reportabilidad es sectorial y agregada: no existe ROS por sujeto en ninguna fuente disponible, de modo que ningún ROS se atribuye aquí a una entidad.',
        'silence_note',      'Silencio sectorial no prueba incumplimiento. El ROS se emite ante una operación sospechosa y no tiene periodicidad mínima.',
        'denominator_note',  'La intensidad usa el padrón del Informe Estadístico al 31-12-2025 (9.911). El padrón operativo del Observatorio corta al 30-06-2026 (10.294) y se muestra aparte.'),
    'semantics', 'Caracterización descriptiva del padrón de sujetos obligados y de su reportabilidad sectorial publicada. El estado ante el SII describe el ciclo de vida tributario, no el cumplimiento de la obligación de reportar. El IGR describe la comuna donde opera el sujeto, nunca al sujeto. El motivo de atención ordena revisión y no imputa incumplimiento.'
  );
$$;

comment on function public.obs_uaf_pulse() is
  'Pulso v3 del universo obligado, con la lectura curada del corte: composicion del padron, reportabilidad sectorial publicada, brecha de screening SII<->UAF, cola de revision con su motivo, territorio e industria. Ninguna cifra imputa incumplimiento.';

do $$
declare sig text;
begin
  for sig in
    select p.oid::regprocedure::text
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'obs_uaf_pulse'
  loop
    execute format('revoke all on function %s from public, anon', sig);
    execute format('grant execute on function %s to authenticated, service_role', sig);
  end loop;
end
$$;
