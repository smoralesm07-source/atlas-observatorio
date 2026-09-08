-- ATLAS Observatorio · Brecha de screening SII ↔ UAF
--
-- El Pulso ya decía quiénes están inscritos y si su sector reporta. Faltaba el
-- reverso: qué entidades el SII observa haciendo actividades alcanzadas por la
-- Ley 19.913 sin figurar en el padrón UAF. Ese complemento es el que permite
-- leer el padrón como una cobertura y no como un total.
--
-- El panel que ocupaba este lugar explicaba en prosa que el estado tributario
-- no mide cumplimiento. Era cierto y seguía siendo una nota al pie. Se retira
-- en favor de la medición que sí ordena trabajo: dónde el universo observable
-- excede al padrón, por cuánto, y con qué riesgo de falso positivo.
--
-- MÉTODO (homologación empírica, no taxonomía escrita a mano)
--
-- La correspondencia giro ↔ sector obligado se mide sobre los propios
-- inscritos: si el 86 % de los corredores de propiedades inscritos declara
-- ACTECO 682000, ese código caracteriza al sector, y quienes lo declaran sin
-- figurar en el padrón son observaciones de screening. Radar_SII produce esa
-- homologación y la gobierna en uaf_sii_screening_policy.csv; esta migración la
-- trae al Observatorio con sus métricas empíricas intactas.
--
-- LÍMITES DECLARADOS:
--  * Un ACTECO es una señal OSINT de screening, nunca una conclusión jurídica.
--    Declarar un giro alcanzado no prueba que la entidad reúna los elementos
--    que activan la obligación de inscribirse, ni que esté incumpliendo.
--  * Ausencia del corte público UAF ≠ no inscrita. El padrón que Atlas lee es
--    una publicación, no el registro vivo de la UAF.
--  * universe_sii_not_uaf es exacto POR CÓDIGO: RUT del SII con ese ACTECO que
--    no aparecen en el padrón. Sumarlo entre códigos cuenta dos veces al RUT
--    que declara dos giros alcanzados, de modo que toda suma se publica como
--    BRUTA y jamás como conteo de entidades distintas.
--  * El universo consolidado de RUT distintos (79.449, corte SII 2026-05) es
--    una línea base DECLARADA por Radar_SII: no está materializada RUT a RUT en
--    este proyecto, y el contrato la publica con ese estado a la vista.
--  * El riesgo de falso positivo de un agregado es el del PEOR código que lo
--    compone. Ordenar por texto lo invertiría: alfabeticamente ALTO va antes
--    que BAJO y que MEDIO.
--  * Los sectores que dependen de una calidad jurídica —notarios, conservadores,
--    agentes de aduana, zonas francas, fintec CMF— no admiten screening por
--    ACTECO. Su universo se construye desde el registro sectorial. Se declaran
--    aparte en vez de aparecer con brecha cero, que sugeriría cobertura total.

------------------------------------------------------------- gatillantes

create table if not exists public.obs_uaf_screening_acteco (
  acteco                   text not null,
  glosa                    text not null,
  uaf_sector_policy        text not null,
  uaf_sector               text,
  tier                     text not null check (tier in ('A','B')),
  universe_sii_not_uaf     integer,
  sii_ruts_with_code       integer,
  uaf_registered_with_code integer,
  support_uaf_sector       integer,
  coverage_sector          numeric,
  coverage_wilson_low      numeric,
  code_purity              numeric,
  lift_vs_uaf              numeric,
  false_positive_risk      text,
  screening_class          text,
  primary key (acteco, uaf_sector_policy)
);

comment on table public.obs_uaf_screening_acteco is
  'Homologacion empirica ACTECO SII <-> sector obligado Ley 19.913, producida por Radar_SII. Tier A gatilla screening; tier B solo pondera. universe_sii_not_uaf es exacto por codigo y no sumable entre codigos sin duplicar RUT.';
comment on column public.obs_uaf_screening_acteco.universe_sii_not_uaf is
  'RUT del SII con este ACTECO que no figuran en el padron UAF. Observacion de screening, no incumplimiento.';
comment on column public.obs_uaf_screening_acteco.coverage_sector is
  'Fraccion de inscritos del sector que declara este ACTECO. Mide al codigo contra el padron, no a la entidad candidata.';
comment on column public.obs_uaf_screening_acteco.false_positive_risk is
  'Riesgo de falso positivo del codigo: un ACTECO amplio arrastra entidades ajenas al sector obligado.';

------------------------------------------------------- modo de evaluacion

create table if not exists public.obs_uaf_screening_sector_mode (
  uaf_sector      text primary key,
  mode            text not null
                  check (mode in ('ACTECO','REGISTRO_EXTERNO','NO_EVALUABLE_SII_PJ')),
  external_source text,
  note            text
);

comment on table public.obs_uaf_screening_sector_mode is
  'Sectores cuyo universo potencial NO se construye desde ACTECO. Se declaran para que su ausencia de brecha no se lea como cobertura completa.';

--------------------------------------------------------------------- carga

truncate table public.obs_uaf_screening_acteco;
truncate table public.obs_uaf_screening_sector_mode;

insert into public.obs_uaf_screening_acteco
  (acteco, glosa, uaf_sector_policy, uaf_sector, tier, universe_sii_not_uaf,
   sii_ruts_with_code, uaf_registered_with_code, support_uaf_sector,
   coverage_sector, coverage_wilson_low, code_purity, lift_vs_uaf,
   false_positive_risk, screening_class)
values
  ('682000', 'ACTIVIDADES INMOBILIARIAS REALIZADAS A CAMBIO DE UNA RETRIBUCION O POR CONTRATA', 'Corredores de propiedades', 'Corredores de Propiedades', 'A', 25062, 25909, 847, 646, 0.857902, 0.831144, 0.762692, 7.316, 'MEDIO', 'ACTECO_PRIORITARIO_RESPALDADO'),
  ('771000', 'ALQUILER DE VEHICULOS AUTOMOTORES SIN CHOFER', 'Vehículos: Empresas de Arriendo de Vehículos', 'Vehículos: Empresas de Arriendo de Vehículos', 'A', 24592, 24863, 271, 43, 0.895833, 0.778323, 0.158672, 23.8768, 'ALTO', 'ACTECO_PRIORITARIO_RESPALDADO'),
  ('451002', 'VENTA AL POR MENOR DE VEHICULOS AUTOMOTORES NUEVOS O USADOS (INCLUYE COMPRAVENTA)', 'Vehículos: Automotoras', 'Vehículos: Automotoras', 'A', 11367, 12130, 763, 14, 0.7, 0.481023, 0.018349, 6.6266, 'MEDIO', 'ACTECO_PRIORITARIO_RESPALDADO'),
  ('451002', 'VENTA AL POR MENOR DE VEHICULOS AUTOMOTORES NUEVOS O USADOS (INCLUYE COMPRAVENTA)', 'Vehículos: Comercializadoras de Vehículos Nuevos o Usados', 'Vehículos: Comercializadoras de Vehículos Nuevos o Usados', 'A', 11367, 12130, 763, 474, 0.902857, 0.874521, 0.621232, 8.547, 'MEDIO', 'ACTECO_PRIORITARIO_RESPALDADO'),
  ('477394', 'VENTA AL POR MENOR DE ARTICULOS DE JOYERIA, BISUTERIA Y RELOJERIA EN COMERCIOS ESPECIALIZADOS', 'Comerciantes de Joyas y Piedras Preciosas', 'Comerciantes de Joyas y Piedras Preciosas', 'A', 11064, 11133, 69, 27, 0.870968, 0.711472, 0.391304, 91.1739, 'ALTO', 'ACTECO_PRIORITARIO_RESPALDADO'),
  ('663091', 'ADMINISTRADORAS DE FONDOS DE INVERSION', 'Administradoras de fondos de inversión', 'Administradoras de Fondos de Inversión', 'A', 1819, 2028, 209, 149, 0.91411, 0.861001, 0.712919, 31.5915, 'MEDIO', 'ACTECO_PRIORITARIO_RESPALDADO'),
  ('451001', 'VENTA AL POR MAYOR DE VEHICULOS AUTOMOTORES', 'Vehículos: Automotoras', 'Vehículos: Automotoras', 'A', 1714, 2144, 430, 17, 0.85, 0.639577, 0.039535, 14.278, 'BAJO', 'ACTECO_PRIORITARIO_RESPALDADO'),
  ('451001', 'VENTA AL POR MAYOR DE VEHICULOS AUTOMOTORES', 'Vehículos: Comercializadoras de Vehículos Nuevos o Usados', 'Vehículos: Comercializadoras de Vehículos Nuevos o Usados', 'A', 1714, 2144, 430, 80, 0.152381, 0.124171, 0.186047, 2.5596, 'BAJO', 'ACTECO_PRIORITARIO_RESPALDADO'),
  ('931201', 'ACTIVIDADES DE CLUBES DE FUTBOL AMATEUR Y PROFESIONAL', 'Organizaciones Deportivas Profesionales', 'Organizaciones Deportivas Profesionales regidas por la Ley N° 20.019', 'A', 723, 743, 20, 20, 0.666667, 0.487797, 1.0, 240.7667, 'ALTO', 'ACTECO_PRIORITARIO_RESPALDADO'),
  ('661204', 'ACTIVIDADES DE CASAS DE CAMBIO Y OPERADORES DE DIVISA', 'Casas de cambio', 'Casas de Cambio', 'A', 528, 754, 226, 208, 0.855967, 0.806275, 0.920354, 27.3569, 'BAJO', 'ACTECO_PRIORITARIO_RESPALDADO'),
  ('649100', 'LEASING FINANCIERO', 'Empresas de arrendamiento financiero (Leasing)', 'Empresas de Arrendamiento Financiero (Leasing)', 'A', 361, 463, 102, 48, 0.774194, 0.655941, 0.470588, 54.8235, 'BAJO', 'ACTECO_PRIORITARIO_RESPALDADO'),
  ('661100', 'ADMINISTRACION DE MERCADOS FINANCIEROS', 'Bolsas de valores', 'Bolsas de Valores', 'A', 340, 362, 22, 2, 1.0, 0.342372, 0.090909, 328.3182, 'MEDIO', 'ACTECO_PRIORITARIO_RESPALDADO'),
  ('651210', 'SEGUROS GENERALES, EXCEPTO ACTIVIDADES DE ISAPRES', 'Compañías de Seguro', 'Compañías de Seguros', 'A', 241, 280, 39, 37, 0.569231, 0.448328, 0.948718, 105.4245, 'MEDIO', 'ACTECO_PRIORITARIO_RESPALDADO'),
  ('651100', 'SEGUROS DE VIDA', 'Compañías de Seguro', 'Compañías de Seguros', 'A', 145, 175, 30, 30, 0.461538, 0.345901, 1.0, 111.1231, 'MEDIO', 'ACTECO_PRIORITARIO_RESPALDADO'),
  ('801002', 'SERVICIO DE TRANSPORTE DE VALORES EN VEHICULOS BLINDADOS', 'Empresas de transporte de valores', 'Empresas de Transporte de Valores', 'A', 85, 90, 5, 5, 1.0, 0.565509, 1.0, 1444.6, 'MEDIO', 'ACTECO_PRIORITARIO_RESPALDADO'),
  ('477392', 'VENTA AL POR MENOR DE ARMAS Y MUNICIONES EN COMERCIOS ESPECIALIZADOS', 'Armas: Personas que se Dediquen a la Venta de Armas', 'Armas: Personas que se Dediquen a la Venta de Armas', 'A', 74, 80, 6, 4, 0.8, 0.375528, 0.666667, 963.0667, 'MEDIO', 'ACTECO_PRIORITARIO_RESPALDADO'),
  ('920010', 'ACTIVIDADES DE CASINOS DE JUEGOS', 'Casinos de Juego', 'Casinos de Juego', 'A', 66, 91, 25, 25, 1.0, 0.866804, 1.0, 288.92, 'BAJO', 'ACTECO_PRIORITARIO_RESPALDADO'),
  ('661202', 'CORREDORES DE BOLSA', 'Corredores de bolsa de valores', 'Corredores de Bolsas de Valores', 'A', 60, 92, 32, 25, 0.961538, 0.811068, 0.78125, 217.0373, 'BAJO', 'ACTECO_PRIORITARIO_RESPALDADO'),
  ('661203', 'AGENTES DE VALORES', 'Agentes de valores', 'Agentes de Valores', 'A', 38, 54, 16, 7, 0.875, 0.529105, 0.4375, 395.0078, 'BAJO', 'ACTECO_PRIORITARIO_RESPALDADO'),
  ('641910', 'ACTIVIDADES BANCARIAS', 'Bancos', 'Bancos', 'A', 38, 59, 21, 18, 1.0, 0.824115, 0.857143, 343.9524, 'BAJO', 'ACTECO_PRIORITARIO_RESPALDADO'),
  ('661902', 'ADMINISTRACION DE TARJETAS DE CREDITO', 'Emisores de Tarjetas de Pago con provisión de fondos, o cualquier otro sistema similar a los referidos medios de pago', 'Emisoras y Operadoras de Tarjetas de Pago', 'A', 32, 43, 11, 4, 0.333333, 0.138118, 0.363636, 218.8788, 'BAJO', 'ACTECO_PRIORITARIO_RESPALDADO'),
  ('931101', 'HIPODROMOS', 'Hipódromos', 'Hipódromos', 'A', 6, 12, 6, 6, 1.0, 0.609657, 1.0, 1203.8333, 'BAJO', 'ACTECO_PRIORITARIO_RESPALDADO'),
  ('661201', 'ACTIVIDADES DE SECURITIZADORAS', 'Empresas de securitización', 'Empresas de Securitización', 'A', 5, 9, 4, 4, 0.444444, 0.188775, 1.0, 802.5556, 'BAJO', 'ACTECO_PRIORITARIO_RESPALDADO'),
  ('649203', 'CAJAS DE COMPENSACION', 'Cajas de Compensación', 'Cajas de Compensación', 'A', 3, 7, 4, 4, 1.0, 0.5101, 1.0, 1805.75, 'BAJO', 'ACTECO_PRIORITARIO_RESPALDADO'),
  ('663010', 'ADMINISTRADORAS DE FONDOS DE PENSIONES (AFP)', 'Administradores de Fondos de Pensiones (AFP)', 'Administradoras de Fondos de Pensiones', 'A', 2, 10, 8, 7, 1.0, 0.645661, 0.875, 902.875, 'BAJO', 'ACTECO_PRIORITARIO_RESPALDADO'),
  ('681012', 'COMPRA, VENTA Y ALQUILER (EXCEPTO AMOBLADOS) DE INMUEBLES', 'Empresas dedicadas a la gestión inmobiliaria', 'Empresas Dedicadas a la Gestión Inmobiliaria', 'B', 92918, 95390, 2472, 1926, 0.893321, 0.879583, 0.779126, 2.6102, 'ALTO', 'ACTECO_CANDIDATO_RESPALDADO'),
  ('931209', 'ACTIVIDADES DE OTROS CLUBES DEPORTIVOS N.C.P.', 'Organizaciones Deportivas Profesionales', 'Organizaciones Deportivas Profesionales regidas por la Ley N° 20.019', 'B', 5488, 5513, 25, 24, 0.8, 0.62694, 0.96, 231.136, 'ALTO', 'ACTECO_CANDIDATO_RESPALDADO'),
  ('661909', 'OTRAS ACTIVIDADES AUXILIARES DE LAS ACTIVIDADES DE SERVICIOS FINANCIEROS N.C.P.', 'Emisores de Tarjetas de Pago con provisión de fondos, o cualquier otro sistema similar a los referidos medios de pago', 'Emisoras y Operadoras de Tarjetas de Pago', 'B', 3331, 3592, 261, 9, 0.75, 0.46769, 0.034483, 20.7557, 'MEDIO', 'FIRMA_EMPIRICA_FUERTE_NO_CAUSAL'),
  ('466200', 'VENTA AL POR MAYOR DE METALES Y MINERALES METALIFEROS', 'Comerciantes de Metales Preciosos', 'Comerciantes de Metales Preciosos', 'B', 2448, 2469, 21, 8, 0.727273, 0.43435, 0.380952, 250.1472, 'ALTO', 'ACTECO_CANDIDATO_RESPALDADO'),
  ('461009', 'OTROS TIPOS DE CORRETAJES O REMATES AL POR MAYOR N.C.P.', 'Casas de remate y martillo', 'Casas de Remate y Martillo', 'B', 1882, 1932, 50, 25, 0.462963, 0.336897, 0.5, 66.8796, 'ALTO', 'ACTECO_CANDIDATO_RESPALDADO'),
  ('663091', 'ADMINISTRADORAS DE FONDOS DE INVERSION', 'Administradoras generales de fondos', 'Administradoras Generales de Fondos', 'B', 1819, 2028, 209, 50, 0.892857, 0.785313, 0.239234, 30.857, 'MEDIO', 'FIRMA_EMPIRICA_FUERTE_NO_CAUSAL'),
  ('649900', 'OTRAS ACTIVIDADES DE SERVICIOS FINANCIEROS, EXCEPTO LAS DE SEGUROS Y FONDOS DE PENSIONES N.C.P.', 'Empresas de factoraje (Factoring)', 'Empresas de Factoraje (Factoring)', 'B', 1747, 1979, 232, 155, 0.798969, 0.737017, 0.668103, 24.8748, 'MEDIO', 'ACTECO_CANDIDATO_RESPALDADO'),
  ('641990', 'OTROS TIPOS DE INTERMEDIACION MONETARIA N.C.P.', 'Cooperativas (instituciones financieras)', 'Cooperativas de Ahorro y Crédito', 'B', 952, 1146, 194, 20, 0.434783, 0.30209, 0.103093, 16.1878, 'MEDIO', 'ACTECO_CANDIDATO_RESPALDADO'),
  ('641990', 'OTROS TIPOS DE INTERMEDIACION MONETARIA N.C.P.', 'Empresas de transferencia de dinero', 'Empresas de Transferencia de Dinero', 'B', 952, 1146, 194, 101, 0.647436, 0.56974, 0.520619, 24.1053, 'MEDIO', 'FIRMA_EMPIRICA_FUERTE_NO_CAUSAL'),
  ('649201', 'FINANCIERAS', 'Institución Financiera', 'Instituciones Financieras', 'B', 516, 560, 44, 15, 0.277778, 0.176167, 0.340909, 45.5997, 'MEDIO', 'ACTECO_CANDIDATO_RESPALDADO'),
  ('649209', 'OTRAS ACTIVIDADES DE CONCESION DE CREDITO N.C.P.', 'Cooperativas (instituciones financieras)', 'Cooperativas de Ahorro y Crédito', 'B', 229, 279, 50, 10, 0.217391, 0.122608, 0.2, 31.4043, 'MEDIO', 'ACTECO_CANDIDATO_RESPALDADO'),
  ('649209', 'OTRAS ACTIVIDADES DE CONCESION DE CREDITO N.C.P.', 'Institución Financiera', 'Instituciones Financieras', 'B', 229, 279, 50, 13, 0.240741, 0.146442, 0.26, 34.7774, 'MEDIO', 'ACTECO_CANDIDATO_RESPALDADO'),
  ('661202', 'CORREDORES DE BOLSA', 'Corredores de bolsas de productos', 'Corredores de Bolsas de Productos', 'B', 60, 92, 32, 7, 1.0, 0.645661, 0.21875, 225.7188, 'BAJO', 'FIRMA_EMPIRICA_FUERTE_NO_CAUSAL');

insert into public.obs_uaf_screening_sector_mode
  (uaf_sector, mode, external_source, note)
values
  ('Usuarios de Zonas Francas', 'REGISTRO_EXTERNO',
   'Aduanas / administración de Zona Franca',
   'Ser usuario de zona franca es una condición territorial y operativa, no una actividad económica: 2.840 inscritos declaran 197 giros distintos y el dominante cubre 26 %. Ningún ACTECO lo caracteriza.'),
  ('Sociedades Administradoras de Zonas Francas', 'REGISTRO_EXTERNO',
   'Administración de Zona Franca',
   'La calidad proviene de la concesión, no del giro declarado.'),
  ('Fintec: Otros Fiscalizados por la CMF', 'REGISTRO_EXTERNO',
   'Comisión para el Mercado Financiero',
   'La obligación depende de la inscripción en el registro de la CMF, que no se deduce del ACTECO.'),
  ('Notarios', 'NO_EVALUABLE_SII_PJ', 'Poder Judicial',
   'Calidad ministerial de persona natural: la nómina SII de personas jurídicas no la observa.'),
  ('Conservadores', 'NO_EVALUABLE_SII_PJ', 'Poder Judicial',
   'Calidad ministerial de persona natural: la nómina SII de personas jurídicas no la observa.'),
  ('Agentes de Aduana', 'NO_EVALUABLE_SII_PJ', 'Servicio Nacional de Aduanas',
   'La licencia de agente de aduana es personal y se otorga por Aduanas; el giro declarado no la identifica.');

------------------------------------------------------------------- indices

create index if not exists obs_uaf_screening_acteco_tier_idx
  on public.obs_uaf_screening_acteco (tier, universe_sii_not_uaf desc);
create index if not exists obs_uaf_screening_acteco_sector_idx
  on public.obs_uaf_screening_acteco (uaf_sector);

--------------------------------------------------------------------- rls

alter table public.obs_uaf_screening_acteco      enable row level security;
alter table public.obs_uaf_screening_sector_mode enable row level security;

do $$
declare t text;
begin
  foreach t in array array['obs_uaf_screening_acteco','obs_uaf_screening_sector_mode'] loop
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

do $$
declare t text;
begin
  foreach t in array array['obs_uaf_screening_acteco','obs_uaf_screening_sector_mode'] loop
    execute format('revoke all on table public.%I from public, anon', t);
    execute format('grant select on table public.%I to authenticated, service_role', t);
  end loop;
end
$$;

---------------------------------------------------------------- contrato

-- Bloque de screening, aislado en su propia funcion para que el Pulso lo
-- incorpore sin reescribir su cuerpo y para poder consultarlo por separado.
create or replace function public.obs_uaf_screening_block()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with padron as (
    select uaf_sector, count(*) inscritos
    from public.obs_uaf_subject group by 1
  ),
  -- Un ACTECO puede caracterizar a dos sectores (451002 sirve a automotoras y
  -- a comercializadoras). Su universo es el mismo conjunto de RUT: se toma una
  -- vez y se declaran los sectores que alcanza.
  acteco_a as (
    select acteco, max(glosa) glosa,
           max(universe_sii_not_uaf) universo,
           max(sii_ruts_with_code) sii_total,
           max(uaf_registered_with_code) inscritos_con_codigo,
           max(coverage_sector) cobertura_max,
           max(code_purity) pureza_max,
           max(lift_vs_uaf) lift_max,
           (array['BAJO','MEDIO','ALTO'])[max(case false_positive_risk
              when 'ALTO' then 3 when 'MEDIO' then 2 else 1 end)] riesgo,
           array_agg(distinct coalesce(uaf_sector, uaf_sector_policy)
                     order by coalesce(uaf_sector, uaf_sector_policy)) sectores
    from public.obs_uaf_screening_acteco
    where tier = 'A'
    group by acteco
  ),
  -- Brecha por sector: dentro de un sector los ACTECO no se repiten, de modo
  -- que la suma es la union bruta de sus universos. Sigue siendo bruta porque
  -- una entidad con dos giros del mismo sector se cuenta dos veces.
  brecha as (
    select coalesce(s.uaf_sector, s.uaf_sector_policy) etiqueta,
           s.uaf_sector,
           p.inscritos,
           sum(s.universe_sii_not_uaf) universo_bruto,
           count(*) gatillantes,
           max(s.coverage_sector) cobertura_max,
           (array['BAJO','MEDIO','ALTO'])[max(case s.false_positive_risk
              when 'ALTO' then 3 when 'MEDIO' then 2 else 1 end)] riesgo,
           array_agg(s.acteco order by s.universe_sii_not_uaf desc) actecos
    from public.obs_uaf_screening_acteco s
    left join padron p on p.uaf_sector = s.uaf_sector
    where s.tier = 'A'
    group by 1, 2, 3
  ),
  modos as (
    select m.uaf_sector, m.mode, m.external_source, m.note,
           coalesce(p.inscritos, 0) inscritos
    from public.obs_uaf_screening_sector_mode m
    left join padron p on p.uaf_sector = m.uaf_sector
  ),
  totales as (
    select
      (select count(*) from acteco_a)                                gatillantes,
      (select count(*) from brecha)                                  sectores,
      (select sum(universo) from acteco_a)                           universo_bruto,
      (select sum(universo) from (
          select universo from acteco_a order by universo desc limit 4) t)
                                                                     universo_top4,
      (select sum(universo) from acteco_a where riesgo = 'ALTO')      universo_riesgo_alto,
      (select coalesce(sum(inscritos), 0) from brecha)               inscritos_cubiertos,
      (select count(*) from modos)                                   sectores_otro_modo,
      (select coalesce(sum(inscritos), 0) from modos)                sujetos_otro_modo,
      (select count(*) from public.obs_uaf_subject)                  padron_total,
      (select count(distinct acteco) from public.obs_uaf_screening_acteco
        where tier = 'B')                                            gatillantes_b
  )
  select jsonb_build_object(
    'disponible', (select count(*) > 0 from public.obs_uaf_screening_acteco),
    'corte', jsonb_build_object(
        'sii_periodo',        '2026-05',
        'sii_dataset',        'PUB_NOM_ACTECOS · nómina de actividades económicas vigentes de personas jurídicas',
        'uaf_corte',          '2026-06-30',
        'universo_declarado', 79449,
        'universo_estado',    'BASELINE_DECLARED',
        'universo_nota',      'RUT distintos del screening consolidado de Radar_SII al corte SII 2026-05. Línea base declarada: no está materializada RUT a RUT en este proyecto, de modo que aquí no se navega ni se filtra.',
        'fuente',             'Radar_SII · homologación empírica UAF–SII (uaf_sii_screening_policy.csv)',
        'fuente_url',         'https://www.sii.cl/sobre_el_sii/nominapersonasjuridicas.html'),
    'totales',  (select to_jsonb(t) from totales t),
    'actecos',  (select coalesce(jsonb_agg(to_jsonb(a) order by a.universo desc), '[]')
                   from acteco_a a),
    'sectores', (select coalesce(jsonb_agg(to_jsonb(b) order by b.universo_bruto desc), '[]')
                   from brecha b),
    'modos',    (select coalesce(jsonb_agg(to_jsonb(m) order by m.inscritos desc), '[]')
                   from modos m),
    'semantics', 'Observación de screening OSINT. Un ACTECO alcanzado por la Ley 19.913 no prueba la calidad jurídica de sujeto obligado, no imputa incumplimiento y no equivale a una omisión de inscripción. Toda suma entre códigos es bruta y puede contar dos veces al RUT con más de un giro alcanzado; dos sectores que comparten un gatillante repiten el mismo universo y no deben sumarse entre sí.'
  );
$$;

comment on function public.obs_uaf_screening_block() is
  'Brecha de screening SII<->UAF: gatillantes ACTECO tier A, universo bruto por codigo y por sector, y sectores cuyo universo exige registro sectorial. El riesgo agregado es el del peor codigo. Ninguna cifra imputa incumplimiento.';

-- Pulso v3: el cuerpo de v2 intacto mas la clave 'screening'.
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
  'Pulso v3 del universo obligado: composicion del padron, reportabilidad sectorial publicada, brecha de screening SII<->UAF, cola de revision con su motivo, territorio e industria. Ninguna cifra imputa incumplimiento.';

do $$
declare sig text;
begin
  foreach sig in array array[
    'public.obs_uaf_pulse()',
    'public.obs_uaf_screening_block()'
  ] loop
    execute format('revoke all on function %s from public, anon', sig);
    execute format('grant execute on function %s to authenticated, service_role', sig);
  end loop;
end
$$;
