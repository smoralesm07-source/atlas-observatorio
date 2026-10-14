
-- ATLAS GAFI PILOT v0.1 | Módulo lateral / shadow analysis.
-- PROHIBIDO actualizar canonicals: obs_entity, obs_uaf_subject, aml_fintech_entity, RES, SII y OSFL.
-- Los resultados son encuadres orientativos, NO dictámenes ni calificaciones de evaluación mutua.
create schema if not exists gafi_pilot;
revoke all on schema gafi_pilot from public, anon, authenticated;
grant usage on schema gafi_pilot to service_role;

create table if not exists gafi_pilot.sector_map (
  uaf_sector text primary key,
  family text not null check (family in ('IF','APNFD','POR_EVALUAR','OTROS')),
  certainty text not null,
  rationale text not null,
  rule_version text not null default '2026-10-14/v1',
  updated_at timestamptz not null default now()
);
create table if not exists gafi_pilot.evaluation_question (
  sequence integer primary key,
  family text not null,
  fatf_recommendations text not null,
  immediate_outcomes text not null,
  title text not null,
  question text not null,
  what_to_request text not null,
  availability text not null check (availability in ('PARCIAL','AGREGADO','NO_INTEGRADO','SIN_DATOS','CONDICIONAL'))
);
create table if not exists gafi_pilot.pilot_run (
  run_id uuid primary key default gen_random_uuid(),
  status text not null default 'BUILDING' check (status in ('BUILDING','READY','FAILED')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  methodology_version text not null default 'GAFI-2022-5R-2026/v1',
  data jsonb
);
create table if not exists gafi_pilot.classification (
  run_id uuid not null references gafi_pilot.pilot_run(run_id),
  source text not null check(source in ('UAF','FINTECH')),
  source_key text not null,
  entity_id text,
  rut text,
  display_name text,
  origin_sector text,
  family text not null,
  classification_status text not null,
  evidence_basis text not null,
  primary key(run_id,source,source_key)
);
create index if not exists gafi_pilot_cls_family_run_idx on gafi_pilot.classification(run_id,family);
create index if not exists gafi_pilot_cls_rut_idx on gafi_pilot.classification(run_id,rut) where rut is not null;
revoke all on all tables in schema gafi_pilot from public,anon,authenticated;
grant select on all tables in schema gafi_pilot to service_role;
insert into gafi_pilot.sector_map(uaf_sector,family,certainty,rationale) values
('Administradoras de Fondos de Inversión','IF','SECTOR_INDICATIVO','Actividad financiera inferida del sector de inscripción UAF; debe verificarse prestación efectiva y encuadre regulatorio.'),
('Administradoras de Fondos de Pensiones','IF','SECTOR_INDICATIVO','Actividad financiera inferida del sector de inscripción UAF; debe verificarse prestación efectiva y encuadre regulatorio.'),
('Administradoras de Mutuos Hipotecarios','IF','SECTOR_INDICATIVO','Actividad financiera inferida del sector de inscripción UAF; debe verificarse prestación efectiva y encuadre regulatorio.'),
('Administradoras Generales de Fondos','IF','SECTOR_INDICATIVO','Actividad financiera inferida del sector de inscripción UAF; debe verificarse prestación efectiva y encuadre regulatorio.'),
('Agentes de Aduana','OTROS','NO_EQUIVALENCIA_AUTOMATICA','Sector obligado en Chile sin equivalencia automática con las categorías IF/APNFD del GAFI.'),
('Agentes de Valores','IF','SECTOR_INDICATIVO','Actividad financiera inferida del sector de inscripción UAF; debe verificarse prestación efectiva y encuadre regulatorio.'),
('Armas: Personas que se Dediquen a la Venta de Armas','OTROS','NO_EQUIVALENCIA_AUTOMATICA','Sector obligado en Chile sin equivalencia automática con las categorías IF/APNFD del GAFI.'),
('Bancos','IF','SECTOR_INDICATIVO','Actividad financiera inferida del sector de inscripción UAF; debe verificarse prestación efectiva y encuadre regulatorio.'),
('Bolsas de Productos','IF','SECTOR_INDICATIVO','Actividad financiera inferida del sector de inscripción UAF; debe verificarse prestación efectiva y encuadre regulatorio.'),
('Bolsas de Valores','IF','SECTOR_INDICATIVO','Actividad financiera inferida del sector de inscripción UAF; debe verificarse prestación efectiva y encuadre regulatorio.'),
('Cajas de Compensación','IF','SECTOR_INDICATIVO','Actividad financiera inferida del sector de inscripción UAF; debe verificarse prestación efectiva y encuadre regulatorio.'),
('Casas de Cambio','IF','SECTOR_INDICATIVO','Actividad financiera inferida del sector de inscripción UAF; debe verificarse prestación efectiva y encuadre regulatorio.'),
('Casas de Remate y Martillo','APNFD','ACTIVIDAD_CONDICIONAL','La inclusión GAFI depende de actividad/operación específica y, según el caso, umbral; inscripción UAF no prueba automáticamente alcance GAFI.'),
('Casinos de Juego','APNFD','ACTIVIDAD_CONDICIONAL','La inclusión GAFI depende de actividad/operación específica y, según el caso, umbral; inscripción UAF no prueba automáticamente alcance GAFI.'),
('Casinos Flotantes de Juego','APNFD','ACTIVIDAD_CONDICIONAL','La inclusión GAFI depende de actividad/operación específica y, según el caso, umbral; inscripción UAF no prueba automáticamente alcance GAFI.'),
('Clubes de Tiro','OTROS','NO_EQUIVALENCIA_AUTOMATICA','Sector obligado en Chile sin equivalencia automática con las categorías IF/APNFD del GAFI.'),
('Comerciantes de Joyas y Piedras Preciosas','APNFD','ACTIVIDAD_CONDICIONAL','La inclusión GAFI depende de actividad/operación específica y, según el caso, umbral; inscripción UAF no prueba automáticamente alcance GAFI.'),
('Comerciantes de Metales Preciosos','APNFD','ACTIVIDAD_CONDICIONAL','La inclusión GAFI depende de actividad/operación específica y, según el caso, umbral; inscripción UAF no prueba automáticamente alcance GAFI.'),
('Compañías de Seguros','IF','SECTOR_INDICATIVO','Actividad financiera inferida del sector de inscripción UAF; debe verificarse prestación efectiva y encuadre regulatorio.'),
('Conservadores','APNFD','ACTIVIDAD_CONDICIONAL','La inclusión GAFI depende de actividad/operación específica y, según el caso, umbral; inscripción UAF no prueba automáticamente alcance GAFI.'),
('Cooperativas de Ahorro y Crédito','IF','SECTOR_INDICATIVO','Actividad financiera inferida del sector de inscripción UAF; debe verificarse prestación efectiva y encuadre regulatorio.'),
('Corredores de Bolsas de Productos','IF','SECTOR_INDICATIVO','Actividad financiera inferida del sector de inscripción UAF; debe verificarse prestación efectiva y encuadre regulatorio.'),
('Corredores de Bolsas de Valores','IF','SECTOR_INDICATIVO','Actividad financiera inferida del sector de inscripción UAF; debe verificarse prestación efectiva y encuadre regulatorio.'),
('Corredores de Propiedades','APNFD','ACTIVIDAD_CONDICIONAL','La inclusión GAFI depende de actividad/operación específica y, según el caso, umbral; inscripción UAF no prueba automáticamente alcance GAFI.'),
('Emisoras y Operadoras de Tarjetas de Pago','IF','SECTOR_INDICATIVO','Actividad financiera inferida del sector de inscripción UAF; debe verificarse prestación efectiva y encuadre regulatorio.'),
('Empresas de Arrendamiento Financiero (Leasing)','IF','SECTOR_INDICATIVO','Actividad financiera inferida del sector de inscripción UAF; debe verificarse prestación efectiva y encuadre regulatorio.'),
('Empresas de Depósitos de Valores','IF','SECTOR_INDICATIVO','Actividad financiera inferida del sector de inscripción UAF; debe verificarse prestación efectiva y encuadre regulatorio.'),
('Empresas de Factoraje (Factoring)','IF','SECTOR_INDICATIVO','Actividad financiera inferida del sector de inscripción UAF; debe verificarse prestación efectiva y encuadre regulatorio.'),
('Empresas de Securitización','IF','SECTOR_INDICATIVO','Actividad financiera inferida del sector de inscripción UAF; debe verificarse prestación efectiva y encuadre regulatorio.'),
('Empresas de Transferencia de Dinero','IF','SECTOR_INDICATIVO','Actividad financiera inferida del sector de inscripción UAF; debe verificarse prestación efectiva y encuadre regulatorio.'),
('Empresas de Transporte de Valores','OTROS','NO_EQUIVALENCIA_AUTOMATICA','Sector obligado en Chile sin equivalencia automática con las categorías IF/APNFD del GAFI.'),
('Empresas Dedicadas a la Gestión Inmobiliaria','APNFD','ACTIVIDAD_CONDICIONAL','La inclusión GAFI depende de actividad/operación específica y, según el caso, umbral; inscripción UAF no prueba automáticamente alcance GAFI.'),
('Fintec: Custodia de Instrumentos Financieros','IF','SECTOR_INDICATIVO','Actividad financiera inferida del sector de inscripción UAF; debe verificarse prestación efectiva y encuadre regulatorio.'),
('Fintec: Intermediación de Instrumentos Financieros','IF','SECTOR_INDICATIVO','Actividad financiera inferida del sector de inscripción UAF; debe verificarse prestación efectiva y encuadre regulatorio.'),
('Fintec: Otros Fiscalizados por la CMF','POR_EVALUAR','SIN_FUNCION_VERIFICADA','No es posible clasificar la función GAFI usando únicamente la etiqueta sectorial.'),
('Fintec: Sistemas Alternativos de Transacción','IF','SECTOR_INDICATIVO','Actividad financiera inferida del sector de inscripción UAF; debe verificarse prestación efectiva y encuadre regulatorio.'),
('Hipódromos','OTROS','NO_EQUIVALENCIA_AUTOMATICA','Sector obligado en Chile sin equivalencia automática con las categorías IF/APNFD del GAFI.'),
('Instituciones Financieras','IF','SECTOR_INDICATIVO','Actividad financiera inferida del sector de inscripción UAF; debe verificarse prestación efectiva y encuadre regulatorio.'),
('Notarios','APNFD','ACTIVIDAD_CONDICIONAL','La inclusión GAFI depende de actividad/operación específica y, según el caso, umbral; inscripción UAF no prueba automáticamente alcance GAFI.'),
('Operadores de Mercados de Futuro y de Opciones','IF','SECTOR_INDICATIVO','Actividad financiera inferida del sector de inscripción UAF; debe verificarse prestación efectiva y encuadre regulatorio.'),
('Organismos públicos','OTROS','NO_EQUIVALENCIA_AUTOMATICA','Sector obligado en Chile sin equivalencia automática con las categorías IF/APNFD del GAFI.'),
('Organizaciones Deportivas Profesionales regidas por la Ley N° 20.019','OTROS','NO_EQUIVALENCIA_AUTOMATICA','Sector obligado en Chile sin equivalencia automática con las categorías IF/APNFD del GAFI.'),
('Otras Entidades Facultadas para Recibir Moneda Extranjera','IF','SECTOR_INDICATIVO','Actividad financiera inferida del sector de inscripción UAF; debe verificarse prestación efectiva y encuadre regulatorio.'),
('Personas que se Dediquen a la Compraventa de Equinos de Raza Pura','OTROS','NO_EQUIVALENCIA_AUTOMATICA','Sector obligado en Chile sin equivalencia automática con las categorías IF/APNFD del GAFI.'),
('Representaciones de Bancos Extranjeros','IF','SECTOR_INDICATIVO','Actividad financiera inferida del sector de inscripción UAF; debe verificarse prestación efectiva y encuadre regulatorio.'),
('Sociedades Administradoras de Zonas Francas','OTROS','NO_EQUIVALENCIA_AUTOMATICA','Sector obligado en Chile sin equivalencia automática con las categorías IF/APNFD del GAFI.'),
('Usuarios de Zonas Francas','OTROS','NO_EQUIVALENCIA_AUTOMATICA','Sector obligado en Chile sin equivalencia automática con las categorías IF/APNFD del GAFI.'),
('Vehículos: Automotoras','OTROS','NO_EQUIVALENCIA_AUTOMATICA','Sector obligado en Chile sin equivalencia automática con las categorías IF/APNFD del GAFI.'),
('Vehículos: Comercializadoras de Vehículos Nuevos o Usados','OTROS','NO_EQUIVALENCIA_AUTOMATICA','Sector obligado en Chile sin equivalencia automática con las categorías IF/APNFD del GAFI.'),
('Vehículos: Empresas de Arriendo de Vehículos','OTROS','NO_EQUIVALENCIA_AUTOMATICA','Sector obligado en Chile sin equivalencia automática con las categorías IF/APNFD del GAFI.')
on conflict (uaf_sector) do nothing;
insert into gafi_pilot.evaluation_question(sequence,family,fatf_recommendations,immediate_outcomes,title,question,what_to_request,availability) values
(1,'IF','R.1','RI.1','Materialidad y exposición al riesgo','¿Cuántos proveedores operan por función financiera, escala y territorio?','Solicitar padrones regulatorios por función, activos/cartera, operación transfronteriza y factores de riesgo; contrastar con registro UAF.','PARCIAL'),
(2,'IF','R.26/R.27','RI.3','Cobertura supervisora basada en riesgo','¿Quién supervisa qué sujetos y con qué intensidad de inspección?','Solicitar censo, inspecciones in situ/extra situ, resultados, remediales y recursos por supervisor y sector.','NO_INTEGRADO'),
(3,'IF','R.10–R.21','RI.4','Aplicación de medidas preventivas','¿Las IF aplican DDC, PEP, monitoreo y controles proporcionalmente?','Revisar resultados de inspecciones, pruebas de controles, cumplimiento Travel Rule cuando corresponda y medidas correctivas.','NO_INTEGRADO'),
(4,'IF','R.20/R.29','RI.4/RI.6','ROS y utilización de inteligencia','¿Qué proporción de IF reporta, con qué calidad y respuesta?','Separar emisores únicos de volumen ROS; observar ROE, tendencias, calidad y uso institucional, evitando inferir efectividad solo desde conteos.','AGREGADO'),
(5,'APNFD','R.22/R.23','RI.4','Perímetro de APNFD','¿Cuántos actores ejercen transacciones cubiertas por GAFI?','Solicitar actividad/operación efectiva: intermediación inmobiliaria, casinos, metales/piedras, notarios y proveedores de servicios; controlar umbrales.','CONDICIONAL'),
(6,'APNFD','R.28','RI.3','Licencias, registro y supervisión','¿Qué actores están dentro o fuera de mecanismos supervisores?','Confrontar autoridades, inspecciones, medidas y sanciones por tipo APNFD, distinguiendo inscripción UAF de supervisión efectiva.','NO_INTEGRADO'),
(7,'APNFD','R.1/R.23','RI.1/RI.4','Riesgo y controles APNFD','¿Cuáles concentran exposición y debilidad de controles?','Solicitar evaluación de riesgo por actividad, canales de efectivo, clientes y operaciones; comprobar DDC y registros de control.','PARCIAL'),
(8,'PSAV','R.15','RI.1','Perímetro funcional de PSAV','¿Qué entidades intercambian, transfieren, custodian o sirven emisiones AV?','Exigir evidencia funcional verificable; separar confirmado, exposición, sin evidencia y proveedor extranjero.','PARCIAL'),
(9,'PSAV','R.15/R.26/R.27','RI.3','Registro, licencia y supervisión PSAV','¿Quién está registrado/autorizado y bajo qué competencia?','Solicitar registros, licencias, inspecciones y medidas; distinguir clasificación funcional GAFI de figura jurídica local.','PARCIAL'),
(10,'PSAV','R.15/R.16','RI.4','Controles y Travel Rule','¿Se implementan controles preventivos y transmisión de datos del ordenante/beneficiario?','Solicitar métricas de cobertura, proveedores interoperables, operaciones alcanzadas y excepciones documentadas.','SIN_DATOS'),
(11,'OSFL','R.8','RI.10','Subconjunto funcional de OSFL','¿Qué OSFL están dentro de definición funcional GAFI, no solo del registro?','Cruzar objeto y actividad verificables, fuentes de financiamiento y operación; excluir del perímetro R.8 aquello no acreditado.','PARCIAL'),
(12,'OSFL','R.8/R.1','RI.10/RI.1','Exposición a FT y proporcionalidad','¿Qué subconjuntos presentan exposición sin afectar indebidamente actividad legítima?','Solicitar análisis FT sectorial, canales/zonas de exposición, acciones focalizadas y evidencia de proporcionalidad.','SIN_DATOS'),
(13,'TRANSVERSAL','R.1/R.2','RI.1','Coherencia país y brechas','¿Cómo se definen los denominadores y responsables por segmento?','Documentar jerarquía de fuentes, corte, RUT único, actores sin RUT, superposiciones, cobertura y vacíos de evidencia.','PARCIAL')
on conflict (sequence) do nothing;

create or replace function gafi_pilot.rebuild()
returns jsonb
language plpgsql
security definer
set search_path=public,gafi_pilot,pg_temp
set statement_timeout='75s'
as $$
declare v_run uuid; v_uaf integer; v_fintech integer; v_expected_uaf integer; v_expected_fintech integer; v_missing integer; v_duplicated integer; v_summary jsonb;
begin
  select count(*) into v_missing from (select distinct s.uaf_sector from public.obs_uaf_subject s except select m.uaf_sector from gafi_pilot.sector_map m) z;
  if v_missing<>0 then raise exception 'GAFI_PILOT_UNMAPPED_UAF_SECTORS: %',v_missing; end if;
  insert into gafi_pilot.pilot_run(status) values('BUILDING') returning run_id into v_run;
  insert into gafi_pilot.classification(run_id,source,source_key,entity_id,rut,display_name,origin_sector,family,classification_status,evidence_basis)
  select v_run,'UAF',s.rut,s.entity_id,s.rut,s.name,s.uaf_sector,m.family,m.certainty,
         'PADRON_UAF_SECTOR/'||m.rule_version
    from public.obs_uaf_subject s
    join gafi_pilot.sector_map m on m.uaf_sector=s.uaf_sector;
  get diagnostics v_uaf=row_count;
  insert into gafi_pilot.classification(run_id,source,source_key,entity_id,rut,display_name,origin_sector,family,classification_status,evidence_basis)
  select v_run,'FINTECH',f.fintech_id,f.atlas_entity_id,f.rut,coalesce(f.legal_name,f.brand),f.primary_vertical,
         case when f.psav_status='CONFIRMED' then 'PSAV'
              when f.psav_status='EXPOSURE' then 'EXPOSICION_AV'
              else 'FINTECH_NO_PSAV_ACREDITADO' end,
         case when f.psav_status='CONFIRMED' then 'FUNCION_PSAV_IDENTIFICADA'
              when f.psav_status='EXPOSURE' then 'INDICIO_REQUIERE_VALIDACION'
              else 'NO_HAY_EVIDENCIA_NO_EQUIVALE_A_DESCARTE' end,
         'FINTECH_CARACTERIZACION_FUNCIONAL/2026-10-14'
    from public.aml_fintech_entity f;
  get diagnostics v_fintech=row_count;
  select count(*) into v_expected_uaf from public.obs_uaf_subject;
  select count(*) into v_expected_fintech from public.aml_fintech_entity;
  if v_uaf<>v_expected_uaf or v_fintech<>v_expected_fintech then
    raise exception 'GAFI_PILOT_SOURCE_COUNTS_CHANGED: UAF % / %, FINTECH % / %', v_uaf,v_expected_uaf,v_fintech,v_expected_fintech;
  end if;
  select count(*) into v_duplicated
    from (select source,source_key,count(*) n from gafi_pilot.classification where run_id=v_run group by 1,2 having count(*)>1) d;
  if v_duplicated>0 then raise exception 'GAFI_PILOT_DUPLICATES'; end if;
  select jsonb_build_object(
    'uaf_source_rows',v_uaf,'fintech_source_rows',v_fintech,
    'uaf_classes',(select coalesce(jsonb_object_agg(family,n),'{}'::jsonb) from (select family,count(*) n from gafi_pilot.classification where run_id=v_run and source='UAF' group by 1) a),
    'fintech_classes',(select coalesce(jsonb_object_agg(family,n),'{}'::jsonb) from (select family,count(*) n from gafi_pilot.classification where run_id=v_run and source='FINTECH' group by 1) b),
    'fintech_uaf_intersection',(select count(*) from gafi_pilot.classification f
      where f.run_id=v_run and f.source='FINTECH' and f.rut is not null
        and exists(select 1 from gafi_pilot.classification u where u.run_id=v_run and u.source='UAF' and u.rut=f.rut)),
    'osfl_context_not_r8',(select atlas_total from public.obs_universe_registry_cache where code='osfl'),
    'uaf_source_at',(select max(refreshed_at) from public.obs_uaf_subject),
    'fintech_source_at',(select max(refreshed_at) from public.aml_fintech_entity),
    'coverage_limits',jsonb_build_array(
       'El padrón UAF es fuente de inscripción, NO universo económico nacional.',
       'Una etiqueta de sector no demuestra alcance jurídico GAFI; APNFD exige actividad/condición específica.',
       'No se clasifica automáticamente a todas las OSFL bajo R.8.',
       'Sin evidencia PSAV no significa no ser PSAV; AV es un fenómeno y no un censo de personas jurídicas.',
       'No se dispone de supervisión ni ROS por entidad para evaluar efectividad.'
    )
  ) into v_summary;
  update gafi_pilot.pilot_run set status='READY',completed_at=now(),data=v_summary where run_id=v_run;
  return jsonb_build_object('run_id',v_run,'status','READY')||v_summary;
end;
$$;
revoke all on function gafi_pilot.rebuild() from public,anon,authenticated;
grant execute on function gafi_pilot.rebuild() to service_role;

create or replace function public.gafi_pilot_overview()
returns jsonb
language plpgsql stable security definer
set search_path=public,gafi_pilot,pg_temp
set statement_timeout='5s'
as $$
declare v_run uuid; v_data jsonb;
begin
  if not exists(select 1 from public.aml_allowed_users
     where user_id=auth.uid() and enabled and role='admin') then
       return jsonb_build_object('status','RESTRICTED','message','Solo administración habilitada: piloto sin publicación general.');
  end if;
  select run_id into v_run from gafi_pilot.pilot_run where status='READY' order by completed_at desc limit 1;
  if v_run is null then return jsonb_build_object('status','EMPTY'); end if;
  select jsonb_build_object(
     'status','READY','pilot',true,'run_id',r.run_id,'completed_at',r.completed_at,
     'methodology_version',r.methodology_version,'counts',r.data,
     'families',(select coalesce(jsonb_agg(z order by z.family,z.source),'[]'::jsonb) from
         (select source,family,count(*) n,count(*) filter(where rut is not null) with_rut from gafi_pilot.classification
          where run_id=r.run_id group by source,family) z),
     'sector_breakdown',(select coalesce(jsonb_agg(z order by z.n desc),'[]'::jsonb) from
         (select c.family,c.origin_sector sector,c.classification_status,count(*) n
          from gafi_pilot.classification c where c.run_id=r.run_id and c.source='UAF'
          group by 1,2,3) z),
     'questions',(select coalesce(jsonb_agg(q order by q.sequence),'[]'::jsonb)
                  from gafi_pilot.evaluation_question q)
   ) into v_data
  from gafi_pilot.pilot_run r where r.run_id=v_run;
  return v_data;
end;
$$;
revoke all on function public.gafi_pilot_overview() from public,anon;
grant execute on function public.gafi_pilot_overview() to authenticated,service_role;

create or replace function public.gafi_pilot_entities(p_family text default null,p_limit integer default 25)
returns jsonb
language plpgsql stable security definer
set search_path=public,gafi_pilot,pg_temp
set statement_timeout='5s'
as $$
declare v_run uuid;v_items jsonb;
begin
  if not exists(select 1 from public.aml_allowed_users where user_id=auth.uid() and enabled and role='admin') then
    return jsonb_build_object('status','RESTRICTED');
  end if;
  select run_id into v_run from gafi_pilot.pilot_run where status='READY' order by completed_at desc limit 1;
  if v_run is null then return jsonb_build_object('status','EMPTY'); end if;
  select coalesce(jsonb_agg(to_jsonb(c) order by c.origin_sector,c.display_name),'[]'::jsonb) into v_items
    from (select source,source_key,entity_id,rut,display_name,origin_sector,family,
      classification_status,evidence_basis from gafi_pilot.classification
      where run_id=v_run and (p_family is null or family=p_family)
      order by origin_sector,display_name limit least(greatest(coalesce(p_limit,25),1),50)) c;
  return jsonb_build_object('status','READY','run_id',v_run,'items',v_items);
end;
$$;
revoke all on function public.gafi_pilot_entities(text,integer) from public,anon;
grant execute on function public.gafi_pilot_entities(text,integer) to authenticated,service_role;
