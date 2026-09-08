-- ATLAS Observatorio · Reportabilidad del padrón y Pulso v2
--
-- El Pulso caracterizaba quiénes son los sujetos obligados. No decía lo único
-- que el analista de inteligencia financiera pregunta después: si reportan.
-- Un padrón de 10.294 inscritos que produce 21.828 ROS al año no se lee sin
-- saber que 17 bancos aportan 14.103 de esos ROS y que 2.783 usuarios de zonas
-- francas aportan 7.
--
-- Esa cifra no vive en ninguna tabla gobernada: la publica la UAF en su Informe
-- Estadístico anual, en PDF, y Radar_UAF ya la captura y versiona. Esta
-- migración la trae al Observatorio como referencia con procedencia declarada
-- —fuente, método de captura y fecha de corte por cada valor— y la cruza con el
-- padrón vivo dentro del contrato.
--
-- LÍMITES DECLARADOS:
--  * La reportabilidad es SECTORIAL y agregada. No existe ROS por sujeto en
--    ninguna fuente disponible: aml_uaf_entity_reporting_observation_0620 está
--    vacía y su vista de comportamiento devuelve NOT_MATERIALIZED para los
--    10.294. Ninguna pantalla puede atribuir un ROS a una entidad.
--  * Silencio sectorial agregado no prueba incumplimiento. El ROS se emite ante
--    una operación sospechosa y no tiene periodicidad mínima: un sector sin ROS
--    puede no haber tenido nada que reportar.
--  * El padrón del Informe Estadístico corta al 31-12-2025 (9.911 inscritos) y
--    el padrón operativo del Observatorio corta al 30-06-2026 (10.294). Son dos
--    cortes distintos y el contrato los publica por separado en vez de mezclar
--    un numerador de un año con un denominador de otro.
--  * Los sectores sin correspondencia en el padrón no son un error de cruce:
--    son categorías canónicas de la Ley 19.913 sin ningún inscrito en el corte
--    vigente. Se conservan con sector_canonical nulo y la interfaz los cuenta.

------------------------------------------------------------------- referencia

create table if not exists public.obs_uaf_reporting_national (
  metric         text not null,
  period         text not null,
  value          numeric,
  unit           text,
  category       text,
  capture_method text,
  source_url     text,
  as_of_date     date,
  primary key (metric, period)
);
comment on table public.obs_uaf_reporting_national is
  'Serie nacional publicada por la UAF en su Informe Estadistico. Referencia con procedencia: cada valor conserva su fuente, su metodo de captura y su fecha de corte.';

create table if not exists public.obs_uaf_reporting_sector (
  sector_official            text primary key,
  -- Rótulo del padrón vigente. Nulo = categoría canónica sin ningún inscrito.
  sector_canonical           text,
  registered_so_2025         integer,
  ros_2021                   integer,
  ros_2022                   integer,
  ros_2023                   integer,
  ros_2024                   integer,
  ros_2025                   integer,
  ros_total_2021_2025        integer,
  ros_per_100_so_2025        numeric,
  delta_ros_2025_vs_2024_pct numeric,
  -- Nulo = no aplica: el sector no tiene inscritos, de modo que no puede
  -- estar «en silencio». Falso = tiene inscritos y sí registró ROS.
  silence_5y                 boolean,
  indicios_2021              integer,
  indicios_2022              integer,
  indicios_2023              integer,
  indicios_2024              integer,
  indicios_2025              integer,
  indicios_total_2021_2025   integer,
  has_conversion             boolean not null default false,
  source_url                 text not null
    default 'https://www.uaf.cl/media/documentos/Informe_Estadistico_2025.pdf',
  as_of_date                 date not null default date '2025-12-31'
);
comment on table public.obs_uaf_reporting_sector is
  'Reportabilidad sectorial 2021-2025 segun el Informe Estadistico UAF: ROS por ano, intensidad por 100 inscritos, silencio quinquenal y ROS con indicios LA/FT. Agregado sectorial: nunca atribuible a un sujeto.';
comment on column public.obs_uaf_reporting_sector.silence_5y is
  'Verdadero: sector con inscritos y cero ROS agregados 2021-2025. Nulo: el sector no tiene inscritos y la pregunta no aplica. No prueba incumplimiento: el ROS se emite ante operacion sospechosa y no tiene periodicidad minima.';
comment on column public.obs_uaf_reporting_sector.sector_canonical is
  'Rotulo del padron vigente. Nulo cuando la categoria canonica no tiene ningun inscrito en el corte.';

create index if not exists obs_uaf_reporting_sector_canon_idx
  on public.obs_uaf_reporting_sector (sector_canonical);
create index if not exists obs_uaf_reporting_national_metric_idx
  on public.obs_uaf_reporting_national (metric, period);

alter table public.obs_uaf_reporting_national enable row level security;
alter table public.obs_uaf_reporting_sector   enable row level security;

do $$
declare t text;
begin
  foreach t in array array['obs_uaf_reporting_national','obs_uaf_reporting_sector'] loop
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

---------------------------------------------------------------------- corte

insert into public.obs_uaf_reporting_sector (
  sector_official, sector_canonical, registered_so_2025,
  ros_2021, ros_2022, ros_2023, ros_2024, ros_2025, ros_total_2021_2025,
  ros_per_100_so_2025, delta_ros_2025_vs_2024_pct, silence_5y,
  indicios_2021, indicios_2022, indicios_2023, indicios_2024, indicios_2025,
  indicios_total_2021_2025, has_conversion) values
  ('Usuarios de Zonas Francas', 'Usuarios de Zonas Francas', 2783, 7, 3, 6, 1, 7, 24, 0.25, 600.0, false, 0, 1, 0, 0, 0, 1, true),
  ('Empresas Dedicadas a la Gestión Inmobiliaria', 'Empresas Dedicadas a la Gestión Inmobiliaria', 2134, 16, 26, 25, 19, 28, 114, 1.31, 47.4, false, 0, 1, 1, 1, 0, 3, true),
  ('Corredores de Propiedades', 'Corredores de Propiedades', 1413, 1, 4, 0, 2, 11, 18, 0.78, 450.0, false, 0, 0, 2, 0, 0, 2, true),
  ('Instituciones Públicas', 'Organismos públicos', 508, 189, 114, 154, 140, 335, 932, 65.94, 139.3, false, 12, 24, 12, 20, 17, 85, true),
  ('Notarios', 'Notarios', 497, 46, 33, 43, 100, 135, 357, 27.16, 35.0, false, 0, 2, 1, 1, 0, 4, true),
  ('Vehículos: Comercializadoras de Vehículos Nuevos o Usados', 'Vehículos: Comercializadoras de Vehículos Nuevos o Usados', 413, 0, 0, 10, 52, 101, 163, 24.46, 94.2, false, 0, 0, 0, 0, 1, 1, true),
  ('Casas de Cambio', 'Casas de Cambio', 336, 88, 104, 279, 152, 179, 802, 53.27, 17.8, false, 7, 6, 6, 12, 6, 37, true),
  ('Casas de Remate y Martillo', 'Casas de Remate y Martillo', 287, 2, 2, 0, 3, 3, 10, 1.05, 0.0, false, 0, 1, 0, 0, 0, 1, true),
  ('Agentes de Aduana', 'Agentes de Aduana', 274, 1, 0, 0, 0, 1, 2, 0.36, null, false, 0, 0, 0, 0, 0, 0, true),
  ('Empresas de Factoraje (Factoring)', 'Empresas de Factoraje (Factoring)', 188, 18, 30, 75, 71, 155, 349, 82.45, 118.3, false, 0, 1, 11, 15, 0, 27, true),
  ('Empresas de Transferencia de Dinero', 'Empresas de Transferencia de Dinero', 172, 654, 522, 542, 568, 852, 3138, 495.35, 50.0, false, 5, 9, 4, 16, 5, 39, true),
  ('Administradoras de Fondos de Inversión', 'Administradoras de Fondos de Inversión', 168, 2, 1, 1, 1, 10, 15, 5.95, 900.0, false, 0, 0, 0, 1, 0, 1, true),
  ('Conservadores', 'Conservadores', 99, 13, 15, 28, 77, 39, 172, 39.39, -49.4, false, 1, 0, 0, 1, 0, 2, true),
  ('Compañías de Seguros', 'Compañías de Seguros', 65, 125, 143, 67, 63, 40, 438, 61.54, -36.5, false, 5, 5, 1, 6, 0, 17, true),
  ('Empresas de Arrendamiento Financiero (Leasing)', 'Empresas de Arrendamiento Financiero (Leasing)', 63, 20, 11, 27, 26, 29, 113, 46.03, 11.5, false, 3, 2, 3, 8, 0, 16, true),
  ('Administradoras Generales de Fondos', 'Administradoras Generales de Fondos', 57, 74, 147, 224, 465, 404, 1314, 708.77, -13.1, false, 2, 12, 10, 10, 16, 50, true),
  ('Instituciones Financieras', 'Instituciones Financieras', 50, 1, 11, 22, 108, 114, 256, 228.0, 5.6, false, 1, 0, 1, 3, 0, 5, true),
  ('Cooperativas de Ahorro y Crédito', 'Cooperativas de Ahorro y Crédito', 47, 137, 111, 95, 229, 366, 938, 778.72, 59.8, false, 1, 2, 4, 8, 3, 18, true),
  ('Emisoras u Operadoras de Tarjetas de Crédito, Tarjetas de Pago con provisión de fondos, o cualquier otro sistema similar a los referidos medios de pago', 'Emisoras y Operadoras de Tarjetas de Pago', 43, 312, 442, 641, 1320, 1626, 4341, 3781.4, 23.2, false, 8, 37, 13, 80, 74, 212, true),
  ('Vehículos: Empresas de Arriendo de Vehículos', 'Vehículos: Empresas de Arriendo de Vehículos', 41, 0, 0, 1, 0, 8, 9, 19.51, null, false, 0, 0, 0, 0, 0, 0, true),
  ('Organizaciones Deportivas Profesionales regidas por Ley 20.019', 'Organizaciones Deportivas Profesionales regidas por la Ley N° 20.019', 30, 0, 0, 0, 0, 0, 0, 0.0, null, true, 0, 0, 0, 0, 0, 0, true),
  ('Corredores de Bolsas de Valores', 'Corredores de Bolsas de Valores', 27, 456, 589, 775, 1011, 773, 3604, 2862.96, -23.5, false, 18, 18, 15, 43, 30, 124, true),
  ('Casinos de Juego', 'Casinos de Juego', 25, 116, 229, 153, 322, 285, 1105, 1140.0, -11.5, false, 7, 694, 0, 105, 12, 818, true),
  ('Comerciantes de Joyas y Piedras Preciosas', 'Comerciantes de Joyas y Piedras Preciosas', 25, 0, 0, 0, 0, 8, 8, 32.0, null, false, 0, 0, 0, 0, 0, 0, true),
  ('Representaciones de Bancos Extranjeros', 'Representaciones de Bancos Extranjeros', 21, 0, 0, 0, 0, 0, 0, 0.0, null, true, 0, 0, 0, 0, 0, 0, true),
  ('Otras Entidades Facultadas para Recibir Moneda Extranjera', 'Otras Entidades Facultadas para Recibir Moneda Extranjera', 19, 364, 388, 348, 626, 612, 2338, 3221.05, -2.2, false, 10, 27, 5, 104, 327, 473, true),
  ('Vehículos: Automotoras', 'Vehículos: Automotoras', 17, 0, 0, 4, 2, 1, 7, 5.88, -50.0, false, 0, 0, 0, 0, 1, 1, true),
  ('Bancos', 'Bancos', 17, 4811, 5881, 7676, 10630, 14103, 43101, 82958.82, 32.7, false, 416, 265, 211, 832, 615, 2339, true),
  ('Administradoras de Mutuos Hipotecarios', 'Administradoras de Mutuos Hipotecarios', 14, 0, 5, 0, 3, 69, 77, 492.86, 2200.0, false, 0, 0, 0, 0, 0, 0, true),
  ('Empresas de Securitización', 'Empresas de Securitización', 9, 0, 0, 0, 0, 0, 0, 0.0, null, true, 0, 0, 0, 0, 0, 0, true),
  ('Comerciantes de Metales Preciosos', 'Comerciantes de Metales Preciosos', 9, 0, 0, 0, 2, 80, 82, 888.89, 3900.0, false, 0, 0, 0, 0, 0, 0, true),
  ('Agentes de Valores', 'Agentes de Valores', 8, 22, 31, 24, 20, 21, 118, 262.5, 5.0, false, 0, 1, 0, 3, 2, 6, true),
  ('Corredores de Bolsas de Productos', 'Corredores de Bolsas de Productos', 8, 0, 0, 0, 0, 0, 0, 0.0, null, true, 0, 0, 0, 0, 0, 0, true),
  ('Administradoras de Fondos de Pensiones', 'Administradoras de Fondos de Pensiones', 7, 1458, 1551, 1125, 493, 327, 4954, 4671.43, -33.7, false, 16, 23, 21, 9, 8, 77, true),
  ('Hipódromos', 'Hipódromos', 6, 6, 6, 4, 9, 7, 32, 116.67, -22.2, false, 0, 1, 1, 0, 2, 4, true),
  ('Empresas de Transporte de Valores', 'Empresas de Transporte de Valores', 5, 0, 1, 1, 1, 0, 3, 0.0, -100.0, false, 0, 0, 0, 0, 0, 0, true),
  ('Fintec: Otros fiscalizados por CMF', 'Fintec: Otros Fiscalizados por la CMF', 4, 0, 0, 0, 0, 11, 11, 275.0, null, false, 0, 0, 0, 0, 0, 0, true),
  ('Fintec: Intermediación de Instrumentos Financieros', 'Fintec: Intermediación de Instrumentos Financieros', 4, 0, 0, 0, 1, 4, 5, 100.0, 300.0, false, 0, 0, 0, 0, 0, 0, true),
  ('Armas: Personas que se Dediquen a la Venta de Armas', 'Armas: Personas que se Dediquen a la Venta de Armas', 4, 0, 0, 0, 0, 0, 0, 0.0, null, true, 0, 0, 0, 0, 0, 0, true),
  ('Cajas de Compensación', 'Cajas de Compensación', 4, 790, 979, 539, 885, 982, 4175, 24550.0, 11.0, false, 0, 0, 1, 0, 0, 1, true),
  ('Sociedades Administradoras de Zonas Francas', 'Sociedades Administradoras de Zonas Francas', 2, 9, 21, 10, 12, 97, 149, 4850.0, 708.3, false, 2, 0, 0, 0, 13, 15, true),
  ('Bolsas de Valores', 'Bolsas de Valores', 2, 0, 0, 0, 0, 0, 0, 0.0, null, true, 0, 0, 0, 0, 0, 0, true),
  ('Bolsas de Productos', 'Bolsas de Productos', 1, 0, 0, 1, 0, 5, 6, 500.0, null, false, 0, 0, 0, 1, 0, 1, true),
  ('Clubes de Tiro', 'Clubes de Tiro', 1, 0, 0, 0, 0, 0, 0, 0.0, null, true, 0, 0, 0, 0, 0, 0, true),
  ('Personas que se Dediquen a la Compraventa de Equinos de Raza Pura', 'Personas que se Dediquen a la Compraventa de Equinos de Raza Pura', 1, 0, 0, 0, 0, 0, 0, 0.0, null, true, 0, 0, 0, 0, 0, 0, true),
  ('Casinos Flotantes de Juego', 'Casinos Flotantes de Juego', 1, 0, 0, 0, 0, 0, 0, 0.0, null, true, 0, 0, 0, 0, 0, 0, true),
  ('Empresas de Depósito de Valores regidas por la Ley N°18.876', 'Empresas de Depósitos de Valores', 1, 0, 0, 0, 3, 0, 3, 0.0, -100.0, false, 0, 0, 0, 0, 0, 0, true),
  ('Operadores de Mercados de Futuro y de Opciones', 'Operadores de Mercados de Futuro y de Opciones', 1, 0, 0, 0, 0, 0, 0, 0.0, null, true, 0, 0, 0, 0, 0, 0, true),
  ('ADMINISTRADORAS DE FONDOS MUTUOS', null, null, null, null, null, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, true),
  ('ARMAS: PERSONAS QUE SE DEDIQUEN A LA FABRICACIÓN DE ARMAS', null, null, null, null, null, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, true),
  ('CLUBES DE CAZA', null, null, null, null, null, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, true),
  ('CLUBES DE PESCA', null, null, null, null, null, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, true),
  ('FINTEC: PRESTADORES DEL SERVICIO DE CUSTODIA DE INSTRUMENTOS FINANCIEROS', 'Fintec: Custodia de Instrumentos Financieros', null, null, null, null, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, true),
  ('FINTEC: PRESTADORES DEL SERVICIO DE PLATAFORMA DE FINANCIAMIENTO COLECTIVO', null, null, null, null, null, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, true),
  ('FINTEC: PRESTADORES DEL SERVICIO DE SISTEMAS ALTERNATIVOS DE TRANSACCIÓN', 'Fintec: Sistemas Alternativos de Transacción', null, null, null, null, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, true),
  ('FINTEC: PROVEEDORES DEL SERVICIO DE INICIACIÓN DE PAGOS', null, null, null, null, null, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, true)
on conflict (sector_official) do update set
  sector_canonical = excluded.sector_canonical,
  registered_so_2025 = excluded.registered_so_2025,
  ros_2021 = excluded.ros_2021, ros_2022 = excluded.ros_2022,
  ros_2023 = excluded.ros_2023, ros_2024 = excluded.ros_2024,
  ros_2025 = excluded.ros_2025, ros_total_2021_2025 = excluded.ros_total_2021_2025,
  ros_per_100_so_2025 = excluded.ros_per_100_so_2025,
  delta_ros_2025_vs_2024_pct = excluded.delta_ros_2025_vs_2024_pct,
  silence_5y = excluded.silence_5y,
  indicios_2021 = excluded.indicios_2021, indicios_2022 = excluded.indicios_2022,
  indicios_2023 = excluded.indicios_2023, indicios_2024 = excluded.indicios_2024,
  indicios_2025 = excluded.indicios_2025,
  indicios_total_2021_2025 = excluded.indicios_total_2021_2025,
  has_conversion = excluded.has_conversion;

insert into public.obs_uaf_reporting_national (
  metric, period, value, unit, category, capture_method, source_url, as_of_date) values
  ('acciones_supervision', '2021', 233.0, 'acciones', 'SUPERVISION', 'OFFICIAL_UAF_REPORT', 'https://www.uaf.cl/media/documentos/Informe_Estadistico_2025.pdf', '2021-12-31'),
  ('acciones_supervision', '2022', 157.0, 'acciones', 'SUPERVISION', 'OFFICIAL_UAF_REPORT', 'https://www.uaf.cl/media/documentos/Informe_Estadistico_2025.pdf', '2022-12-31'),
  ('acciones_supervision', '2023', 159.0, 'acciones', 'SUPERVISION', 'OFFICIAL_UAF_REPORT', 'https://www.uaf.cl/media/documentos/Informe_Estadistico_2025.pdf', '2023-12-31'),
  ('acciones_supervision', '2024', 163.0, 'acciones', 'SUPERVISION', 'OFFICIAL_UAF_REPORT', 'https://www.uaf.cl/media/documentos/Informe_Estadistico_2025.pdf', '2024-12-31'),
  ('acciones_supervision', '2025', 172.0, 'acciones', 'SUPERVISION', 'LIVE_OFFICIAL_UAF_REPORT', 'https://www.uaf.cl/media/documentos/Informe_Estadistico_2025.pdf', '2025-12-31'),
  ('entidades_publicas_registradas', '2025', 508.0, 'registros vigentes', 'PADRON', 'LIVE_OFFICIAL_UAF_REPORT', 'https://www.uaf.cl/media/documentos/Informe_Estadistico_2025.pdf', '2025-12-31'),
  ('entidades_publicas_registradas', '2026-06-30', 512.0, 'registros vigentes', 'PADRON', 'UAF_REGISTRY_XLSX', 'https://www.uaf.cl/media/documentos/Instituciones_p%C3%BAblicas_inscritas_al_30-06-2026_1.xlsx', '2026-06-30'),
  ('entidades_reportantes_total', '2021', 8137.0, 'personas y entidades', 'PADRON', 'OFFICIAL_UAF_REPORT', 'https://www.uaf.cl/media/documentos/Informe_Estadistico_2025.pdf', '2021-12-31'),
  ('entidades_reportantes_total', '2022', 8379.0, 'personas y entidades', 'PADRON', 'OFFICIAL_UAF_REPORT', 'https://www.uaf.cl/media/documentos/Informe_Estadistico_2025.pdf', '2022-12-31'),
  ('entidades_reportantes_total', '2023', 8729.0, 'personas y entidades', 'PADRON', 'OFFICIAL_UAF_REPORT', 'https://www.uaf.cl/media/documentos/Informe_Estadistico_2025.pdf', '2023-12-31'),
  ('entidades_reportantes_total', '2024', 9136.0, 'personas y entidades', 'PADRON', 'OFFICIAL_UAF_REPORT', 'https://www.uaf.cl/media/documentos/Informe_Estadistico_2025.pdf', '2024-12-31'),
  ('entidades_reportantes_total', '2025', 9911.0, 'personas y entidades', 'PADRON', 'LIVE_OFFICIAL_UAF_REPORT', 'https://www.uaf.cl/media/documentos/Informe_Estadistico_2025.pdf', '2025-12-31'),
  ('multas_sancionatorias_uf', '2025', 1925.0, 'UF', 'SUPERVISION', 'LIVE_OFFICIAL_UAF_REPORT', 'https://www.uaf.cl/media/documentos/Informe_Estadistico_2025.pdf', '2025-12-31'),
  ('personas_capacitadas', '2025', 2517.0, 'personas', 'CAPACITACION', 'OFFICIAL_UAF_REPORT', 'https://www.uaf.cl/media/documentos/Informe_Estadistico_2025.pdf', '2025-12-31'),
  ('personas_informadas_en_ros', '2025', 22348.0, 'personas', 'INTELIGENCIA_FINANCIERA', 'LIVE_OFFICIAL_UAF_REPORT', 'https://www.uaf.cl/media/documentos/Informe_Estadistico_2025.pdf', '2025-12-31'),
  ('procesos_sancionatorios_finalizados', '2025', 59.0, 'procesos', 'SUPERVISION', 'LIVE_OFFICIAL_UAF_REPORT', 'https://www.uaf.cl/media/documentos/Informe_Estadistico_2025.pdf', '2025-12-31'),
  ('roe_recibidos', '2025', 1620219.0, 'reportes', 'INTELIGENCIA_FINANCIERA', 'LIVE_OFFICIAL_UAF_REPORT', 'https://www.uaf.cl/media/documentos/Informe_Estadistico_2025.pdf', '2025-12-31'),
  ('roe_recibidos_miles', '2021', 2966.0, 'miles de reportes', 'INTELIGENCIA_FINANCIERA', 'OFFICIAL_UAF_REPORT', 'https://www.uaf.cl/media/documentos/Informe_Estadistico_2025.pdf', '2021-12-31'),
  ('roe_recibidos_miles', '2022', 2848.0, 'miles de reportes', 'INTELIGENCIA_FINANCIERA', 'OFFICIAL_UAF_REPORT', 'https://www.uaf.cl/media/documentos/Informe_Estadistico_2025.pdf', '2022-12-31'),
  ('roe_recibidos_miles', '2023', 2458.0, 'miles de reportes', 'INTELIGENCIA_FINANCIERA', 'OFFICIAL_UAF_REPORT', 'https://www.uaf.cl/media/documentos/Informe_Estadistico_2025.pdf', '2023-12-31'),
  ('roe_recibidos_miles', '2024', 1817.0, 'miles de reportes', 'INTELIGENCIA_FINANCIERA', 'OFFICIAL_UAF_REPORT', 'https://www.uaf.cl/media/documentos/Informe_Estadistico_2025.pdf', '2024-12-31'),
  ('roe_recibidos_miles', '2025', 1620.0, 'miles de reportes', 'INTELIGENCIA_FINANCIERA', 'OFFICIAL_UAF_REPORT', 'https://www.uaf.cl/media/documentos/Informe_Estadistico_2025.pdf', '2025-12-31'),
  ('ros_con_indicios_laft', '2025', 1132.0, 'reportes', 'INTELIGENCIA_FINANCIERA', 'LIVE_OFFICIAL_UAF_REPORT', 'https://www.uaf.cl/media/documentos/Informe_Estadistico_2025.pdf', '2025-12-31'),
  ('ros_recibidos', '2021', 9738.0, 'reportes', 'INTELIGENCIA_FINANCIERA', 'OFFICIAL_UAF_REPORT', 'https://www.uaf.cl/media/documentos/Informe_Estadistico_2025.pdf', '2021-12-31'),
  ('ros_recibidos', '2022', 11400.0, 'reportes', 'INTELIGENCIA_FINANCIERA', 'OFFICIAL_UAF_REPORT', 'https://www.uaf.cl/media/documentos/Informe_Estadistico_2025.pdf', '2022-12-31'),
  ('ros_recibidos', '2023', 12900.0, 'reportes', 'INTELIGENCIA_FINANCIERA', 'OFFICIAL_UAF_REPORT', 'https://www.uaf.cl/media/documentos/Informe_Estadistico_2025.pdf', '2023-12-31'),
  ('ros_recibidos', '2024', 17417.0, 'reportes', 'INTELIGENCIA_FINANCIERA', 'OFFICIAL_UAF_REPORT', 'https://www.uaf.cl/media/documentos/Informe_Estadistico_2025.pdf', '2024-12-31'),
  ('ros_recibidos', '2025', 21828.0, 'reportes', 'INTELIGENCIA_FINANCIERA', 'LIVE_OFFICIAL_UAF_REPORT', 'https://www.uaf.cl/media/documentos/Informe_Estadistico_2025.pdf', '2025-12-31'),
  ('sujetos_obligados_sector_privado', '2025', 9403.0, 'registros vigentes', 'PADRON', 'LIVE_OFFICIAL_UAF_REPORT', 'https://www.uaf.cl/media/documentos/Informe_Estadistico_2025.pdf', '2025-12-31'),
  ('sujetos_obligados_sector_privado', '2025-06-30', 8970.0, 'registros vigentes', 'PADRON', 'SEED_OSINT_SUMMARY', 'https://www.uaf.cl/es-cl/sujetos-obligados/sector-privado/inscritos-en-la-uaf', '2025-06-30'),
  ('sujetos_obligados_sector_privado', '2026-06-30', 9782.0, 'registros vigentes', 'PADRON', 'UAF_REGISTRY_XLSX', 'https://www.uaf.cl/media/documentos/Sujetos_Obligados_inscritos_en_la_UAF_al_31.07.2026.xlsx', '2026-06-30')
on conflict (metric, period) do update set
  value = excluded.value, unit = excluded.unit, category = excluded.category,
  capture_method = excluded.capture_method, source_url = excluded.source_url,
  as_of_date = excluded.as_of_date;

------------------------------------------------- caracterización adicional

-- Señales que el padrón ya calcula aguas arriba y que el read model no traía:
-- atipicidad del giro dentro del sector, cambios declarados ante el SII y
-- complejidad societaria. Son las que separan «inscrito» de «revisable».
alter table public.obs_uaf_subject add column if not exists activity_atypicality  numeric;
alter table public.obs_uaf_subject add column if not exists activity_peer_share   numeric;
alter table public.obs_uaf_subject add column if not exists sii_activity_changed  boolean;
alter table public.obs_uaf_subject add column if not exists sii_region_changed    boolean;
alter table public.obs_uaf_subject add column if not exists sii_signal_count      integer;
alter table public.obs_uaf_subject add column if not exists ownership_edge_count  integer;
alter table public.obs_uaf_subject add column if not exists ipf_percentile        numeric;
alter table public.obs_uaf_subject add column if not exists ipf_credibility_pct   numeric;

-- Motivo de atención: una sola razón por sujeto, la de mayor precedencia, para
-- que la cola de trabajo sea legible. El rango ordena; el motivo explica.
alter table public.obs_uaf_subject add column if not exists attention_motive text;
alter table public.obs_uaf_subject add column if not exists attention_rank   smallint;

comment on column public.obs_uaf_subject.activity_atypicality is
  'Cuan poco frecuente es el giro principal del sujeto dentro de su propio sector UAF. Describe la distancia al giro modal del sector, no una irregularidad.';
comment on column public.obs_uaf_subject.attention_motive is
  'Motivo de revision de mayor precedencia. Ordena trabajo de fiscalizacion; no imputa incumplimiento ni riesgo LA/FT.';

create index if not exists obs_uaf_subject_attention_idx
  on public.obs_uaf_subject (attention_rank, ipf_score desc nulls last);
create index if not exists obs_uaf_subject_atypical_idx
  on public.obs_uaf_subject (activity_atypicality desc nulls last);

-------------------------------------------------------- materialización v2

-- Rellena las columnas nuevas y el motivo de atencion sobre el corte vigente.
-- Se ejecuta aqui y, en adelante, dentro de obs_refresh_uaf.
create or replace function public.obs_refresh_uaf_attention()
returns integer
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare v_n integer;
begin
  update public.obs_uaf_subject u set
    activity_atypicality = s.activity_atypicality,
    activity_peer_share  = s.activity_peer_share,
    sii_activity_changed = s.sii_activity_changed,
    sii_region_changed   = s.sii_region_changed,
    sii_signal_count     = s.sii_signal_count,
    ownership_edge_count = s.ownership_edge_count,
    ipf_percentile       = s.ipf_percentile,
    ipf_credibility_pct  = s.ipf_credibility_pct
  from public.aml_uaf_obligated_subject_snapshot s
  where s.rut = u.rut;

  -- Precedencia explicita. Un sujeto puede cumplir varias condiciones; se
  -- publica la mas concluyente para que la cola no repita al mismo nombre.
  update public.obs_uaf_subject u set
    attention_rank = m.rank,
    attention_motive = m.motive
  from (
    select s.rut,
      case
        when s.sanction_evidence_count > 0 and s.sanction_last_date
             >= (current_date - interval '5 years')            then 1
        when s.sanction_evidence_count > 0 or s.sanction_count > 0 then 2
        when s.sii_status = 'TERMINATED_AS_PUBLISHED'          then 3
        when s.ipf_band in ('MUY_ALTA','ALTA')                 then 4
        when sil.sector_canonical is not null
             and s.sii_status <> 'SIN_PERFIL_SII'              then 5
        when s.activity_atypicality >= 0.90                    then 6
        -- Una persona natural inscrita no tiene comuna observable y eso no es
        -- una brecha: sin este resguardo el motivo se llenaria con los 2.110
        -- sujetos sin perfil de persona juridica y dejaria de ser accionable.
        when s.region is null
             and s.sii_status <> 'SIN_PERFIL_SII'              then 7
      end rank,
      case
        when s.sanction_evidence_count > 0 and s.sanction_last_date
             >= (current_date - interval '5 years')            then 'SANCION_RECIENTE'
        when s.sanction_evidence_count > 0 or s.sanction_count > 0 then 'SANCION_HISTORICA'
        when s.sii_status = 'TERMINATED_AS_PUBLISHED'          then 'TERMINO_GIRO'
        when s.ipf_band in ('MUY_ALTA','ALTA')                 then 'IPF_ALTA'
        when sil.sector_canonical is not null
             and s.sii_status <> 'SIN_PERFIL_SII'              then 'SECTOR_SIN_ROS'
        when s.activity_atypicality >= 0.90                    then 'GIRO_ATIPICO'
        when s.region is null
             and s.sii_status <> 'SIN_PERFIL_SII'              then 'SIN_TERRITORIO'
      end motive
    from public.obs_uaf_subject s
    left join public.obs_uaf_reporting_sector sil
      on sil.sector_canonical = s.uaf_sector and sil.silence_5y
  ) m
  where m.rut = u.rut
    and (u.attention_rank is distinct from m.rank
      or u.attention_motive is distinct from m.motive);

  select count(*) into v_n from public.obs_uaf_subject where attention_rank is not null;
  return v_n;
end
$$;
comment on function public.obs_refresh_uaf_attention() is
  'Completa la caracterizacion adicional del padron y publica el motivo de atencion de mayor precedencia por sujeto.';

revoke all on function public.obs_refresh_uaf_attention() from public, anon, authenticated;
grant execute on function public.obs_refresh_uaf_attention() to service_role;

select public.obs_refresh_uaf_attention();

-- La agenda vuelve a ser un solo punto de entrada: el paso de atencion cuelga
-- de obs_refresh_full, despues de que el universo exista.
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
  v_attention integer;
begin
  v_row := public.obs_refresh_all(p_snapshot_id);

  v_territory := public.obs_refresh_territory(v_row.snapshot_id);
  v_sector    := public.obs_refresh_sector(v_row.snapshot_id);
  v_spend     := public.obs_refresh_spend(v_row.snapshot_id);
  -- Despues de territorio y de compras: el universo lee el IGR comunal y la
  -- marca de proveedor, y con el orden invertido los leeria del corte anterior.
  v_uaf       := public.obs_refresh_uaf(v_row.snapshot_id);
  -- Y despues del universo: el motivo de atencion se calcula sobre el padron
  -- ya materializado y sobre la reportabilidad sectorial de referencia.
  v_attention := public.obs_refresh_uaf_attention();

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
           'obs_uaf_evidence', (select count(*) from public.obs_uaf_evidence),
           'obs_uaf_atencion', v_attention)
   where snapshot_id = v_row.snapshot_id
  returning * into v_row;

  return v_row;
end
$$;

-------------------------------------------------------------- obs_uaf_cohort

-- Misma firma, mismo contrato de salida: sólo se amplían las cohortes que la
-- pantalla puede pedir. Las nuevas nacen de la caracterización adicional y de
-- la reportabilidad sectorial.
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
  with silenciosos as (
    select sector_canonical from public.obs_uaf_reporting_sector
    where silence_5y and sector_canonical is not null
  ),
  filtrado as (
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
      -- Nuevas: la cola de revisión y sus motivos.
      when 'ATENCION'         then s.attention_rank is not null
      when 'MOTIVO'           then s.attention_motive = p_value
      when 'IPF_ALTO'         then s.ipf_band in ('MUY_ALTA','ALTA')
      when 'GIRO_ATIPICO'     then s.activity_atypicality >= 0.90
      when 'CAMBIO_ACTIVIDAD' then s.sii_activity_changed
      when 'SIN_TERRITORIO'   then s.region is null
      when 'SECTOR_SIN_ROS'   then s.uaf_sector in (select sector_canonical from silenciosos)
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
    -- Lo accionable primero: el motivo de mayor precedencia, y dentro de él
    -- quien tiene antecedente y prioridad más alta.
    c.attention_rank asc nulls last,
    (c.sanction_evidence_count > 0 or c.sanction_count > 0) desc,
    c.ipf_score desc nulls last,
    c.alert_count desc,
    c.name
  limit greatest(1, least(coalesce(p_limit,50), 200))
  offset greatest(0, coalesce(p_offset,0));
$$;

---------------------------------------------------------- obs_uaf_pulse (v2)

-- Cuatro preguntas, en el orden en que las hace un analista UAF:
--   1. De qué está hecho el padrón y en qué estado registral está.
--   2. Cuánto reporta el universo obligado y quién sostiene ese volumen.
--   3. Qué sujetos concretos piden revisión hoy y por qué.
--   4. Dónde operan y con qué otras fuentes cruzan.
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
    'contract', 'ATLAS_OBS_UAF_PULSE_V2',
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
  'Pulso v2 del universo obligado: composicion del padron, reportabilidad sectorial publicada, cola de revision con su motivo, territorio e industria. Ninguna cifra imputa incumplimiento.';

------------------------------------------------------------------- permisos

do $$
declare sig text;
begin
  foreach sig in array array[
    'public.obs_uaf_pulse()',
    'public.obs_uaf_cohort(text,text,integer,integer)'
  ] loop
    execute format('revoke all on function %s from public, anon', sig);
    execute format('grant execute on function %s to authenticated, service_role', sig);
  end loop;
end
$$;

do $$
declare t text;
begin
  foreach t in array array['obs_uaf_reporting_national','obs_uaf_reporting_sector'] loop
    execute format('revoke all on table public.%I from public, anon', t);
    execute format('grant select on table public.%I to authenticated, service_role', t);
  end loop;
end
$$;
