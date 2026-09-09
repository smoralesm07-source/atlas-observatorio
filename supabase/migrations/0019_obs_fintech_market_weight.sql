-- ATLAS Fintech & Activos Virtuales · Motor de Peso de Mercado
-- Open-source market intelligence only. This is NOT an AML/CFT risk score.
-- Comparisons are metric-specific; heterogeneous measures are never added together.

insert into public.aml_fintech_source_catalog(source_code,label,source_type,authority_level,source_url,cadence,notes)
values
('ENDEAVOR_OPEN','Endeavor · información pública de compañías','ECOSYSTEM_PROFILE','SECTORIAL_OPEN','https://www.endeavor.org/','EVENT_DRIVEN','Cifras públicas de escala, capital y alcance atribuidas a compañías del ecosistema.'),
('BUDA_PUBLIC_API','Buda.com · API pública de mercados','PUBLIC_API','DECLARED_OPEN','https://api.buda.com/','DAILY','Volúmenes y mercados publicados por la API corporativa abierta de Buda.com; estimaciones derivadas se identifican explícitamente.')
on conflict(source_code) do update set
  label=excluded.label,source_type=excluded.source_type,authority_level=excluded.authority_level,
  source_url=excluded.source_url,cadence=excluded.cadence,notes=excluded.notes;

create table if not exists public.aml_fintech_market_metric_catalog (
  metric_code text primary key,
  label text not null,
  dimension text not null check (dimension in ('ECONOMIC_SCALE','BUSINESS_ACTIVITY','REACH','CAPITAL')),
  unit_kind text not null check (unit_kind in ('CURRENCY','COUNT','ORDINAL','PERCENT','TEXT')),
  default_unit text,
  default_currency text,
  comparable_scope text not null default 'SAME_METRIC',
  higher_means_more_weight boolean not null default true,
  description text not null,
  sort_order integer not null default 100
);
alter table public.aml_fintech_market_metric_catalog enable row level security;
revoke all on public.aml_fintech_market_metric_catalog from anon,authenticated;

insert into public.aml_fintech_market_metric_catalog(metric_code,label,dimension,unit_kind,default_unit,default_currency,comparable_scope,description,sort_order) values
('SII_SALES_BAND_RANK','Tramo de ventas SII · rango ordinal','ECONOMIC_SCALE','ORDINAL','rank',null,'ALL_CONFIRMED','Proxy de escala económica abierto; no equivale a ingresos exactos.',10),
('WORKERS','Trabajadores observados','ECONOMIC_SCALE','COUNT','workers',null,'ALL_CONFIRMED','Número de trabajadores disponible en fuente abierta integrada.',20),
('ANNUAL_TRANSACTION_VOLUME_USD','Volumen transaccional anual','BUSINESS_ACTIVITY','CURRENCY','USD','USD','SAME_METRIC','Volumen anual procesado o transado declarado/observado.',30),
('TRANSACTION_VOLUME_7D_USD_EST','Volumen transaccional 7 días · estimado USD','BUSINESS_ACTIVITY','CURRENCY','USD','USD','SAME_METRIC','Estimación de volumen de siete días desde una API pública y conversión documentada.',31),
('ANNUALIZED_TRANSACTION_VOLUME_USD_EST','Volumen transaccional anualizado · estimado USD','BUSINESS_ACTIVITY','CURRENCY','USD','USD','SAME_METRIC','Anualización de una ventana pública reciente; no es volumen anual realizado.',32),
('CUMULATIVE_TRANSACTION_VOLUME_USD','Volumen transaccional acumulado','BUSINESS_ACTIVITY','CURRENCY','USD','USD','SAME_METRIC','Volumen histórico acumulado publicado por la entidad o fuente abierta.',33),
('TPV_USD','TPV / volumen de pagos','BUSINESS_ACTIVITY','CURRENCY','USD','USD','SAME_METRIC','Total payment volume en un período definido.',40),
('ORIGINATED_VOLUME_USD','Originación / colocación','BUSINESS_ACTIVITY','CURRENCY','USD','USD','SAME_METRIC','Monto originado en crédito, factoring o financiamiento.',50),
('AUM_AUC_USD','AUM / AUC','BUSINESS_ACTIVITY','CURRENCY','USD','USD','SAME_METRIC','Activos bajo gestión o custodia.',60),
('USERS','Usuarios / personas','REACH','COUNT','users',null,'SAME_METRIC','Usuarios o personas que confían/usan el servicio, según fuente.',70),
('CLIENTS','Clientes','REACH','COUNT','clients',null,'SAME_METRIC','Clientes declarados u observados.',80),
('MERCHANTS','Comercios','REACH','COUNT','merchants',null,'SAME_METRIC','Comercios conectados o activos.',90),
('COUNTRIES_OPERATING','Países con operación/presencia','REACH','COUNT','countries',null,'SAME_METRIC','Países donde la entidad declara operación o presencia activa.',100),
('ACTIVE_MARKETS','Mercados/pares activos','REACH','COUNT','markets',null,'SAME_METRIC','Mercados o pares de negociación activos en una plataforma.',110),
('FUNDING_RAISED_USD','Capital levantado acumulado','CAPITAL','CURRENCY','USD','USD','SAME_METRIC','Capital total levantado públicamente informado.',120),
('LATEST_ROUND_USD','Última ronda de capital','CAPITAL','CURRENCY','USD','USD','SAME_METRIC','Monto de la ronda de capital más reciente públicamente informada.',130)
on conflict(metric_code) do update set
  label=excluded.label,dimension=excluded.dimension,unit_kind=excluded.unit_kind,
  default_unit=excluded.default_unit,default_currency=excluded.default_currency,
  comparable_scope=excluded.comparable_scope,description=excluded.description,sort_order=excluded.sort_order;

create table if not exists public.aml_fintech_market_metric_observation (
  observation_id bigint generated always as identity primary key,
  observation_key text not null unique,
  subject_type text not null check(subject_type in ('ENTITY','CANDIDATE')),
  subject_key text not null,
  metric_code text not null references public.aml_fintech_market_metric_catalog(metric_code),
  value_numeric numeric,
  value_text text,
  unit text,
  currency text,
  qualifier text not null default 'EXACT' check(qualifier in ('EXACT','AT_LEAST','AT_MOST','APPROX','RANGE','TEXT_ONLY')),
  period_start date,
  period_end date,
  geography text,
  evidence_type text not null check(evidence_type in ('OBSERVADO_OFICIAL','DECLARADO','ESTIMADO','NO_OBSERVABLE')),
  confidence numeric check(confidence between 0 and 1),
  source_code text references public.aml_fintech_source_catalog(source_code),
  source_url text,
  published_at timestamptz,
  observed_at timestamptz not null default now(),
  basis text,
  evidence_excerpt text,
  metadata jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  check(value_numeric is not null or value_text is not null or evidence_type='NO_OBSERVABLE')
);
create index if not exists aml_fintech_market_obs_subject_idx on public.aml_fintech_market_metric_observation(subject_type,subject_key,metric_code);
create index if not exists aml_fintech_market_obs_metric_idx on public.aml_fintech_market_metric_observation(metric_code,period_end desc nulls last,observed_at desc);
create index if not exists aml_fintech_market_obs_source_idx on public.aml_fintech_market_metric_observation(source_code);
alter table public.aml_fintech_market_metric_observation enable row level security;
revoke all on public.aml_fintech_market_metric_observation from anon,authenticated;

create table if not exists public.aml_fintech_market_peer_position (
  subject_type text not null,
  subject_key text not null,
  metric_code text not null references public.aml_fintech_market_metric_catalog(metric_code),
  peer_group text not null,
  peer_count integer not null,
  peer_rank integer,
  percentile numeric,
  tier text not null check(tier in ('VERY_HIGH','HIGH','MEDIUM','LOW','INSUFFICIENT_PEERS','NO_NUMERIC_DATA')),
  anchor_value numeric,
  calculated_at timestamptz not null default now(),
  primary key(subject_type,subject_key,metric_code,peer_group)
);
create index if not exists aml_fintech_market_peer_metric_idx on public.aml_fintech_market_peer_position(metric_code,peer_group,peer_rank);
alter table public.aml_fintech_market_peer_position enable row level security;
revoke all on public.aml_fintech_market_peer_position from anon,authenticated;

create table if not exists public.aml_fintech_market_dimension_snapshot (
  subject_type text not null,
  subject_key text not null,
  dimension text not null check(dimension in ('ECONOMIC_SCALE','BUSINESS_ACTIVITY','REACH','CAPITAL')),
  numeric_metric_count integer not null default 0,
  total_metric_count integer not null default 0,
  strongest_metric_code text,
  strongest_percentile numeric,
  evidence_coverage text not null check(evidence_coverage in ('HIGH','MEDIUM','LOW','NONE')),
  refreshed_at timestamptz not null default now(),
  primary key(subject_type,subject_key,dimension)
);
alter table public.aml_fintech_market_dimension_snapshot enable row level security;
revoke all on public.aml_fintech_market_dimension_snapshot from anon,authenticated;

create or replace function atlas_private.aml_fintech_refresh_market_weight()
returns jsonb
language plpgsql
security definer
set search_path='public','atlas_private','extensions','pg_temp'
as $fn$
declare v_obs int; v_pos int; v_dim int;
begin
  insert into public.aml_fintech_market_metric_observation(
    observation_key,subject_type,subject_key,metric_code,value_numeric,value_text,unit,qualifier,
    evidence_type,confidence,source_code,source_url,observed_at,basis,metadata,last_seen_at)
  select 'SII_SALES_BAND|'||e.fintech_id,'ENTITY',e.fintech_id,'SII_SALES_BAND_RANK',e.sii_sales_band_rank,
         case when e.sii_sales_band is null then null else 'Tramo '||e.sii_sales_band end,'rank','EXACT',
         'OBSERVADO_OFICIAL',1,'SII_PUBLIC','https://www.sii.cl/',now(),
         'Tramo de ventas disponible en la capa SII abierta integrada por ATLAS.',jsonb_build_object('sales_band',e.sii_sales_band),now()
  from public.aml_v_fintech_entity_current e where e.sii_sales_band_rank is not null
  on conflict(observation_key) do update set value_numeric=excluded.value_numeric,value_text=excluded.value_text,observed_at=excluded.observed_at,last_seen_at=now(),metadata=excluded.metadata;

  insert into public.aml_fintech_market_metric_observation(
    observation_key,subject_type,subject_key,metric_code,value_numeric,unit,qualifier,evidence_type,confidence,source_code,source_url,observed_at,basis,last_seen_at)
  select 'SII_WORKERS|'||e.fintech_id,'ENTITY',e.fintech_id,'WORKERS',e.sii_workers,'workers','EXACT',
         'OBSERVADO_OFICIAL',1,'SII_PUBLIC','https://www.sii.cl/',now(),
         'Trabajadores disponibles en la capa SII abierta integrada por ATLAS.',now()
  from public.aml_v_fintech_entity_current e where e.sii_workers is not null
  on conflict(observation_key) do update set value_numeric=excluded.value_numeric,observed_at=excluded.observed_at,last_seen_at=now();

  insert into public.aml_fintech_market_metric_observation(
    observation_key,subject_type,subject_key,metric_code,value_numeric,value_text,unit,currency,qualifier,
    period_start,period_end,evidence_type,confidence,source_code,source_url,published_at,observed_at,basis,last_seen_at)
  select 'LEGACY|'||m.metric_id::text,'ENTITY',m.fintech_id,m.metric_code,m.value_numeric,m.value_text,m.unit,m.currency,'EXACT',
         m.period_start,m.period_end,m.evidence_type,m.confidence,m.source_code,m.source_url,m.published_at,m.observed_at,
         'Métrica estructurada previamente en aml_fintech_market_metric.',now()
  from public.aml_fintech_market_metric m join public.aml_fintech_market_metric_catalog c on c.metric_code=m.metric_code
  on conflict(observation_key) do update set value_numeric=excluded.value_numeric,value_text=excluded.value_text,last_seen_at=now();

  delete from public.aml_fintech_market_peer_position where subject_type in ('ENTITY','CANDIDATE');
  with latest as (
    select distinct on(subject_type,subject_key,metric_code) subject_type,subject_key,metric_code,value_numeric
    from public.aml_fintech_market_metric_observation
    where value_numeric is not null and evidence_type <> 'NO_OBSERVABLE'
    order by subject_type,subject_key,metric_code,coalesce(period_end,period_start) desc nulls last,observed_at desc
  ), ranked as (
    select l.*,count(*) over(partition by metric_code) peer_count,
      rank() over(partition by metric_code order by value_numeric desc) peer_rank,
      percent_rank() over(partition by metric_code order by value_numeric)::numeric percentile_low_to_high
    from latest l
  )
  insert into public.aml_fintech_market_peer_position(subject_type,subject_key,metric_code,peer_group,peer_count,peer_rank,percentile,tier,anchor_value,calculated_at)
  select subject_type,subject_key,metric_code,metric_code,peer_count,peer_rank,
    case when peer_count>=3 then round(percentile_low_to_high,4) else null end,
    case when peer_count<3 then 'INSUFFICIENT_PEERS'
         when percentile_low_to_high>=0.9 then 'VERY_HIGH'
         when percentile_low_to_high>=0.67 then 'HIGH'
         when percentile_low_to_high>=0.33 then 'MEDIUM'
         else 'LOW' end,
    value_numeric,now() from ranked;
  get diagnostics v_pos = row_count;

  delete from public.aml_fintech_market_dimension_snapshot where subject_type in ('ENTITY','CANDIDATE');
  with latest as (
    select distinct on(o.subject_type,o.subject_key,o.metric_code)
      o.subject_type,o.subject_key,o.metric_code,o.value_numeric,o.evidence_type,c.dimension
    from public.aml_fintech_market_metric_observation o join public.aml_fintech_market_metric_catalog c using(metric_code)
    order by o.subject_type,o.subject_key,o.metric_code,coalesce(o.period_end,o.period_start) desc nulls last,o.observed_at desc
  ), agg as (
    select subject_type,subject_key,dimension,
      count(*) filter(where evidence_type<>'NO_OBSERVABLE')::int total_metric_count,
      count(*) filter(where value_numeric is not null and evidence_type<>'NO_OBSERVABLE')::int numeric_metric_count
    from latest group by subject_type,subject_key,dimension
  ), strongest as (
    select distinct on(p.subject_type,p.subject_key,c.dimension)
      p.subject_type,p.subject_key,c.dimension,p.metric_code,p.percentile
    from public.aml_fintech_market_peer_position p join public.aml_fintech_market_metric_catalog c using(metric_code)
    where p.percentile is not null
    order by p.subject_type,p.subject_key,c.dimension,p.percentile desc nulls last,p.metric_code
  )
  insert into public.aml_fintech_market_dimension_snapshot(subject_type,subject_key,dimension,numeric_metric_count,total_metric_count,strongest_metric_code,strongest_percentile,evidence_coverage,refreshed_at)
  select a.subject_type,a.subject_key,a.dimension,a.numeric_metric_count,a.total_metric_count,s.metric_code,s.percentile,
    case when a.total_metric_count>=3 and a.numeric_metric_count>=2 then 'HIGH'
         when a.total_metric_count>=2 then 'MEDIUM'
         when a.total_metric_count>=1 then 'LOW' else 'NONE' end,now()
  from agg a left join strongest s using(subject_type,subject_key,dimension);
  get diagnostics v_dim = row_count;
  select count(*) into v_obs from public.aml_fintech_market_metric_observation;
  return jsonb_build_object('observations',v_obs,'peer_positions',v_pos,'dimension_snapshots',v_dim,'refreshed_at',now());
end
$fn$;
revoke all on function atlas_private.aml_fintech_refresh_market_weight() from public,anon,authenticated;

-- High-confidence open-source seed facts.
insert into public.aml_fintech_market_metric_observation(
 observation_key,subject_type,subject_key,metric_code,value_numeric,value_text,unit,currency,qualifier,geography,evidence_type,confidence,source_code,source_url,published_at,observed_at,basis,evidence_excerpt,metadata,last_seen_at)
values
('KOYWE|ANNUAL_VOLUME|2026','ENTITY','ENT-RUT-77638982-K','ANNUAL_TRANSACTION_VOLUME_USD',2000000000,'Más de US$2.000 millones de volumen transaccional anual','USD','USD','AT_LEAST','LATAM','DECLARADO',0.95,'ENDEAVOR_OPEN','https://endeavormiami.org/2026/08/05/from-childhood-friends-to-building-latin-americas-financial-infrastructure/','2026-08-05',now(),'Endeavor informa que la plataforma procesa más de US$2B de volumen anual.','The platform processes more than $2B in annual transaction volume.',jsonb_build_object('lower_bound',true),now()),
('KOYWE|FUNDING|2026','ENTITY','ENT-RUT-77638982-K','FUNDING_RAISED_USD',12500000,'US$12,5 millones de financiamiento','USD','USD','APPROX','GLOBAL','DECLARADO',0.92,'ENDEAVOR_OPEN','https://endeavormiami.org/2026/08/05/from-childhood-friends-to-building-latin-americas-financial-infrastructure/','2026-08-05',now(),'Endeavor describe a Koywe como respaldada por US$12,5M de financiamiento.','Backed by $12.5 million in funding.',jsonb_build_object('interpretation','publicly_reported_funding'),now()),
('KOYWE|COUNTRIES|2026','ENTITY','ENT-RUT-77638982-K','COUNTRIES_OPERATING',8,'Chile, Argentina, Colombia, Brasil, Bolivia, Estados Unidos, México y Perú','countries',null,'EXACT','REGIONAL','DECLARADO',0.95,'COMPANY_WEB','https://www.koywe.com/es/about-us',null,now(),'Sitio corporativo declara operación/presencia en ocho países.','Chile, Argentina, Colombia, Brasil, Bolivia, Estados Unidos, México y Perú.',jsonb_build_object('countries',jsonb_build_array('Chile','Argentina','Colombia','Brasil','Bolivia','Estados Unidos','México','Perú')),now()),
('BUDA|CUMULATIVE_VOLUME|2026','CANDIDATE','1287','CUMULATIVE_TRANSACTION_VOLUME_USD',3000000000,'Más de US$3.000 millones transados','USD','USD','AT_LEAST','SOUTH_AMERICA','DECLARADO',0.98,'COMPANY_WEB','https://www.buda.com/chile',null,now(),'Cifra acumulada publicada en la portada de Buda.com.','+$3.000 Millones de dólares transados',jsonb_build_object('lower_bound',true),now()),
('BUDA|USERS|2026','CANDIDATE','1287','USERS',600000,'Más de 600.000 personas','users',null,'AT_LEAST','SOUTH_AMERICA','DECLARADO',0.98,'COMPANY_WEB','https://www.buda.com/chile',null,now(),'Cifra de personas publicada por Buda.com.','+600.000 Personas confían en nosotros',jsonb_build_object('lower_bound',true),now()),
('BUDA|COUNTRIES|2026','CANDIDATE','1287','COUNTRIES_OPERATING',4,'Chile, Colombia, Perú y Argentina','countries',null,'EXACT','SOUTH_AMERICA','DECLARADO',0.98,'COMPANY_WEB','https://www.buda.com/nosotros',null,now(),'Sitio corporativo declara operación en cuatro países.','Chile, Colombia, Perú y Argentina',jsonb_build_object('countries',jsonb_build_array('Chile','Colombia','Perú','Argentina')),now()),
('SKIPO|CLIENTS_TEXT|2026','ENTITY','ENT-RUT-77554238-1','CLIENTS',null,'Miles de clientes','clients',null,'TEXT_ONLY','CHILE','DECLARADO',0.75,'COMPANY_WEB','https://blog.skipo.com/post/como-comprar-criptomonedas-en-chile',null,now(),'La compañía declara miles de clientes sin cifra exacta; se conserva como texto y no participa en percentiles.','Skipo ... cuenta con miles de clientes.',jsonb_build_object('numeric_excluded',true),now())
on conflict(observation_key) do update set
  value_numeric=excluded.value_numeric,value_text=excluded.value_text,unit=excluded.unit,currency=excluded.currency,
  qualifier=excluded.qualifier,evidence_type=excluded.evidence_type,confidence=excluded.confidence,
  source_code=excluded.source_code,source_url=excluded.source_url,published_at=excluded.published_at,
  observed_at=now(),basis=excluded.basis,evidence_excerpt=excluded.evidence_excerpt,metadata=excluded.metadata,last_seen_at=now();

select atlas_private.aml_fintech_refresh_market_weight();