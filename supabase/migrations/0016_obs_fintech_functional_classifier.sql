-- ATLAS Fintech functional classifier / PSAV open-source perimeter
-- Reproduces the production model introduced after 0015.
-- Core principle: observed function != legal/regulatory conclusion.

alter table public.aml_fintech_entity
  add column if not exists psav_basis text,
  add column if not exists psav_confidence numeric,
  add column if not exists psav_refreshed_at timestamptz,
  add column if not exists functional_profile_refreshed_at timestamptz;

alter table public.aml_fintech_candidate
  add column if not exists functional_profile_refreshed_at timestamptz;

create table if not exists public.aml_fintech_function_catalog (
  function_code text primary key,
  label text not null,
  function_group text not null,
  fatf_vasp boolean not null default false,
  description text not null,
  sort_order integer not null default 100
);

insert into public.aml_fintech_function_catalog(function_code,label,function_group,fatf_vasp,description,sort_order) values
('VA_FIAT_EXCHANGE','Intercambio activo virtual ↔ moneda fiduciaria','FATF_VASP',true,'Intercambio entre activos virtuales y monedas fiduciarias.',10),
('VA_VA_EXCHANGE','Intercambio activo virtual ↔ activo virtual','FATF_VASP',true,'Intercambio entre una o más formas de activos virtuales.',20),
('VA_TRANSFER','Transferencia de activos virtuales','FATF_VASP',true,'Transferencia de activos virtuales por cuenta o en nombre de terceros.',30),
('VA_CUSTODY_ADMIN','Custodia / administración de activos virtuales','FATF_VASP',true,'Custodia o administración de activos virtuales o instrumentos que permiten controlarlos.',40),
('VA_ISSUER_FIN_SERVICES','Servicios financieros vinculados a oferta/venta de activos virtuales','FATF_VASP',true,'Participación o provisión de servicios financieros relacionados con oferta o venta de activos virtuales por un emisor.',50),
('VA_STABLECOIN_SERVICES','Servicios con stablecoins','VA_CONTEXT',false,'Oferta o uso comercial de stablecoins como parte del servicio.',60),
('VA_CRYPTO_PAYMENTS','Pagos con activos virtuales','VA_CONTEXT',false,'Aceptación, procesamiento o habilitación de pagos con activos virtuales.',70),
('VA_HOSTED_WALLET','Wallet custodiada / hosted','VA_CONTEXT',false,'Servicio de wallet en que el proveedor mantiene control o custodia relevante.',80),
('VA_UNHOSTED_WALLET_SUPPORT','Soporte a wallet externa / autocustodia','VA_CONTEXT',false,'Retiros, depósitos o interacción con direcciones externas o wallets no custodiadas por el proveedor.',90),
('VA_ON_OFF_RAMP','On-ramp / off-ramp','VA_CONTEXT',false,'Entrada o salida entre moneda fiduciaria y activos virtuales mediante transferencias, depósitos o retiros.',100),
('VA_P2P','Servicio P2P de activos virtuales','VA_CONTEXT',false,'Mercado o funcionalidad peer-to-peer de activos virtuales.',110),
('VA_DEFI_ACCESS','Acceso a DeFi / staking / liquidez','VA_CONTEXT',false,'Acceso comercial a protocolos DeFi, staking, pools u otros servicios descentralizados.',120),
('FIN_PAYMENTS','Pagos / adquirencia / checkout','FINTECH_CORE',false,'Procesamiento de pagos, adquirencia, checkout o infraestructura de pagos.',200),
('FIN_REMITTANCE_FX','Remesas / FX / transferencias internacionales','FINTECH_CORE',false,'Remesas, cambio de divisas o transferencias internacionales.',210),
('FIN_LENDING','Crédito / lending / factoring','FINTECH_CORE',false,'Originación, intermediación o facilitación de crédito, préstamos o factoring.',220),
('FIN_INVESTMENT','Inversión / wealth / portafolio','FINTECH_CORE',false,'Servicios de inversión, wealth management o gestión de portafolios.',230),
('FIN_FINANCIAL_CUSTODY','Custodia de instrumentos financieros','FINTECH_CORE',false,'Custodia de instrumentos financieros no clasificados como activos virtuales.',240),
('FIN_CARDS','Tarjetas / prepago','FINTECH_CORE',false,'Emisión, operación o infraestructura de tarjetas de pago o prepago.',250),
('FIN_OPEN_FINANCE','Open finance / iniciación de pagos','FINTECH_CORE',false,'Open finance, open banking o iniciación de pagos.',260),
('FIN_INSURTECH','Insurtech / seguros','FINTECH_CORE',false,'Distribución, intermediación o tecnología aplicada a seguros.',270),
('FIN_REGTECH','Regtech / KYC / compliance','FINTECH_CORE',false,'Tecnología de cumplimiento, KYC, identidad o regtech.',280),
('FIN_CROWDFUNDING','Financiamiento colectivo','FINTECH_CORE',false,'Plataforma de financiamiento colectivo.',290),
('FIN_ALT_TRADING_SYSTEM','Sistema alternativo de transacción','FINTECH_CORE',false,'Sistema alternativo de transacción de instrumentos financieros.',300),
('FIN_FINANCIAL_INTERMEDIATION','Intermediación de instrumentos financieros','FINTECH_CORE',false,'Intermediación de instrumentos financieros.',310),
('FIN_INVESTMENT_ADVISORY','Asesoría de inversión','FINTECH_CORE',false,'Asesoría profesional de inversión.',320),
('FIN_CREDIT_ADVISORY','Asesoría crediticia','FINTECH_CORE',false,'Asesoría crediticia.',330)
on conflict(function_code) do update set
  label=excluded.label,function_group=excluded.function_group,fatf_vasp=excluded.fatf_vasp,
  description=excluded.description,sort_order=excluded.sort_order;

create table if not exists public.aml_fintech_function_observation (
  observation_id bigint generated always as identity primary key,
  observation_key text not null unique,
  subject_type text not null check(subject_type in ('ENTITY','CANDIDATE')),
  subject_key text not null,
  function_code text not null references public.aml_fintech_function_catalog(function_code),
  evidence_status text not null check(evidence_status in ('OBSERVED','PROBABLE','SIGNAL')),
  evidence_class text not null default 'INFERRED_FROM_DECLARED',
  confidence numeric not null check(confidence between 0 and 1),
  basis text,
  source_code text,
  source_url text,
  evidence_excerpt text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  observed_at timestamptz not null default now()
);
create index if not exists aml_fintech_function_subject_idx on public.aml_fintech_function_observation(subject_type,subject_key,function_code);
create index if not exists aml_fintech_function_code_idx on public.aml_fintech_function_observation(function_code,evidence_status,confidence desc);
alter table public.aml_fintech_function_observation enable row level security;
revoke all on public.aml_fintech_function_observation from anon,authenticated;

create table if not exists public.aml_fintech_public_footprint_assessment (
  fintech_id text not null references public.aml_fintech_entity(fintech_id) on delete cascade,
  function_code text not null references public.aml_fintech_function_catalog(function_code),
  footprint_status text not null check(footprint_status in ('DIRECT_EQUIVALENT_OBSERVED','RELATED_PUBLIC_FOOTPRINT','NO_PUBLIC_EQUIVALENT_OBSERVED','NOT_ASSESSED')),
  explanation text not null,
  regulatory_evidence jsonb not null default '[]'::jsonb,
  confidence numeric not null default 1,
  observed_at timestamptz not null default now(),
  primary key(fintech_id,function_code)
);
create index if not exists aml_fintech_footprint_status_idx on public.aml_fintech_public_footprint_assessment(footprint_status,function_code);
alter table public.aml_fintech_public_footprint_assessment enable row level security;
revoke all on public.aml_fintech_public_footprint_assessment from anon,authenticated;

create table if not exists public.aml_fintech_function_run (
  run_id bigint generated always as identity primary key,
  status text not null default 'STARTED',
  rows_requested integer not null default 0,
  rows_processed integer not null default 0,
  rows_failed integer not null default 0,
  observations_upserted integer not null default 0,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  detail jsonb not null default '{}'::jsonb
);
alter table public.aml_fintech_function_run enable row level security;
revoke all on public.aml_fintech_function_run from anon,authenticated;

create or replace function public.aml_fintech_ingest_function_observations(p_rows jsonb)
returns jsonb language plpgsql security definer set search_path='public','pg_temp' as $$
declare r jsonb; h jsonb; v_count int:=0; v_conf numeric; v_status text; v_code text; v_key text;
begin
  if p_rows is null or jsonb_typeof(p_rows)<>'array' then raise exception 'p_rows must be an array'; end if;
  for r in select value from jsonb_array_elements(p_rows) loop
    for h in select value from jsonb_array_elements(coalesce(r->'function_hints','[]'::jsonb)) loop
      v_code:=h->>'function_code';
      if not exists(select 1 from public.aml_fintech_function_catalog c where c.function_code=v_code) then continue; end if;
      v_conf:=greatest(0,least(1,coalesce(nullif(h->>'confidence','')::numeric,0)));
      v_status:=case when v_conf>=0.90 then 'OBSERVED' when v_conf>=0.75 then 'PROBABLE' else 'SIGNAL' end;
      v_key:=md5(concat_ws('|',r->>'subject_type',r->>'subject_key',v_code,coalesce(h->>'source_url',r->>'website',''),coalesce(h->>'basis','')));
      insert into public.aml_fintech_function_observation(observation_key,subject_type,subject_key,function_code,evidence_status,evidence_class,confidence,basis,source_code,source_url,evidence_excerpt,first_seen_at,last_seen_at,observed_at)
      values(v_key,r->>'subject_type',r->>'subject_key',v_code,v_status,'INFERRED_FROM_DECLARED',v_conf,h->>'basis',coalesce(h->>'source_code','COMPANY_WEB'),coalesce(h->>'source_url',r->>'website'),left(h->>'evidence_excerpt',1000),now(),now(),coalesce(nullif(h->>'observed_at','')::timestamptz,now()))
      on conflict(observation_key) do update set evidence_status=excluded.evidence_status,confidence=excluded.confidence,basis=excluded.basis,source_code=excluded.source_code,source_url=excluded.source_url,evidence_excerpt=excluded.evidence_excerpt,last_seen_at=now(),observed_at=excluded.observed_at;
      v_count:=v_count+1;
    end loop;
  end loop;
  return jsonb_build_object('function_observations_upserted',v_count);
end; $$;
revoke all on function public.aml_fintech_ingest_function_observations(jsonb) from public,anon,authenticated;
grant execute on function public.aml_fintech_ingest_function_observations(jsonb) to service_role;

create or replace function public.aml_fintech_refresh_functional_profile()
returns jsonb language plpgsql security definer set search_path='public','pg_temp' as $$
declare v_entities int:=0; v_assess int:=0;
begin
  update public.aml_fintech_entity e set
    psav_status=case
      when exists(select 1 from public.aml_fintech_function_observation o join public.aml_fintech_function_catalog c using(function_code) where o.subject_type='ENTITY' and o.subject_key=e.fintech_id and c.fatf_vasp and o.evidence_status='OBSERVED') then 'CONFIRMED'
      when exists(select 1 from public.aml_fintech_function_observation o join public.aml_fintech_function_catalog c using(function_code) where o.subject_type='ENTITY' and o.subject_key=e.fintech_id and c.fatf_vasp and o.evidence_status='PROBABLE') then 'PROBABLE'
      when exists(select 1 from public.aml_fintech_function_observation o join public.aml_fintech_function_catalog c using(function_code) where o.subject_type='ENTITY' and o.subject_key=e.fintech_id and c.function_group='VA_CONTEXT' and o.evidence_status in ('OBSERVED','PROBABLE')) then 'EXPOSURE'
      else 'NO_EVIDENCE' end,
    psav_basis=case
      when exists(select 1 from public.aml_fintech_function_observation o join public.aml_fintech_function_catalog c using(function_code) where o.subject_type='ENTITY' and o.subject_key=e.fintech_id and c.fatf_vasp and o.evidence_status in ('OBSERVED','PROBABLE')) then 'FATF_FUNCTIONAL_OPEN_SOURCE'
      when exists(select 1 from public.aml_fintech_function_observation o join public.aml_fintech_function_catalog c using(function_code) where o.subject_type='ENTITY' and o.subject_key=e.fintech_id and c.function_group='VA_CONTEXT' and o.evidence_status in ('OBSERVED','PROBABLE')) then 'VA_CONTEXT_OPEN_SOURCE'
      else null end,
    psav_confidence=(select max(o.confidence) from public.aml_fintech_function_observation o join public.aml_fintech_function_catalog c using(function_code) where o.subject_type='ENTITY' and o.subject_key=e.fintech_id and (c.fatf_vasp or c.function_group='VA_CONTEXT')),
    psav_refreshed_at=now(),refreshed_at=now()
  where e.fintech_id is not null;
  get diagnostics v_entities=row_count;

  insert into public.aml_fintech_public_footprint_assessment(fintech_id,function_code,footprint_status,explanation,regulatory_evidence,confidence,observed_at)
  select e.fintech_id,o.function_code,
    case when not c.fatf_vasp then 'NOT_ASSESSED'
      when exists(select 1 from public.aml_fintech_regulatory_status r where r.fintech_id=e.fintech_id and (lower(r.registry) ~ '(psav|vasp|activo.?virtual|cripto)' or lower(r.service) ~ '(psav|vasp|activo.?virtual|cripto)')) then 'DIRECT_EQUIVALENT_OBSERVED'
      when exists(select 1 from public.aml_fintech_regulatory_status r where r.fintech_id=e.fintech_id and r.regulator in ('CMF','UAF')) then 'RELATED_PUBLIC_FOOTPRINT'
      else 'NO_PUBLIC_EQUIVALENT_OBSERVED' end,
    case when not c.fatf_vasp then 'La comparación regulatoria automática se reserva para funciones FATF VASP; esta función se conserva como caracterización de mercado.'
      when exists(select 1 from public.aml_fintech_regulatory_status r where r.fintech_id=e.fintech_id and (lower(r.registry) ~ '(psav|vasp|activo.?virtual|cripto)' or lower(r.service) ~ '(psav|vasp|activo.?virtual|cripto)')) then 'Existe una huella pública que menciona directamente activos virtuales/PSAV/VASP.'
      when exists(select 1 from public.aml_fintech_regulatory_status r where r.fintech_id=e.fintech_id and r.regulator in ('CMF','UAF')) then 'Existe huella pública CMF/UAF, pero no se observó una categoría equivalente específica para la función VASP. No constituye conclusión de cumplimiento.'
      else 'No se observó una huella pública CMF/UAF equivalente en las fuentes integradas. No constituye conclusión de incumplimiento ni de obligación regulatoria.' end,
    coalesce((select jsonb_agg(to_jsonb(r) order by r.regulator,r.registry,r.service) from public.aml_fintech_regulatory_status r where r.fintech_id=e.fintech_id),'[]'::jsonb),max(o.confidence),now()
  from public.aml_fintech_entity e
  join public.aml_fintech_function_observation o on o.subject_type='ENTITY' and o.subject_key=e.fintech_id and o.evidence_status in ('OBSERVED','PROBABLE')
  join public.aml_fintech_function_catalog c using(function_code)
  group by e.fintech_id,o.function_code,c.fatf_vasp
  on conflict(fintech_id,function_code) do update set footprint_status=excluded.footprint_status,explanation=excluded.explanation,regulatory_evidence=excluded.regulatory_evidence,confidence=excluded.confidence,observed_at=excluded.observed_at;
  get diagnostics v_assess=row_count;
  return jsonb_build_object('entities_refreshed',v_entities,'footprint_assessments_upserted',v_assess);
end; $$;
revoke all on function public.aml_fintech_refresh_functional_profile() from public,anon,authenticated;
grant execute on function public.aml_fintech_refresh_functional_profile() to service_role;

create or replace function public.aml_fintech_function_batch(p_limit integer default 12)
returns jsonb language sql stable security definer set search_path='public','pg_temp' as $$
with cand as (
  select 'CANDIDATE'::text subject_type,c.candidate_id::text subject_key,c.name_raw display_name,c.website,c.functional_profile_refreshed_at refreshed_at,1 priority
  from public.aml_fintech_candidate c where c.matched_fintech_id is null and c.website is not null and btrim(c.website)<>''
  order by c.functional_profile_refreshed_at asc nulls first,c.name_raw
  limit greatest(1,ceil(greatest(1,least(coalesce(p_limit,12),30))*0.6)::int)
), ent as (
  select 'ENTITY'::text,e.fintech_id,coalesce(e.brand,e.legal_name),e.website,e.functional_profile_refreshed_at,2
  from public.aml_fintech_entity e where e.website is not null and btrim(e.website)<>''
  order by e.functional_profile_refreshed_at asc nulls first,coalesce(e.brand,e.legal_name)
  limit greatest(1,floor(greatest(1,least(coalesce(p_limit,12),30))*0.4)::int)
), q as (select * from cand union all select * from ent)
select coalesce(jsonb_agg(jsonb_build_object('subject_type',subject_type,'subject_key',subject_key,'display_name',display_name,'website',website,'refreshed_at',refreshed_at) order by priority,refreshed_at asc nulls first,display_name),'[]'::jsonb) from q; $$;
revoke all on function public.aml_fintech_function_batch(integer) from public,anon,authenticated;
grant execute on function public.aml_fintech_function_batch(integer) to service_role;

create or replace function public.aml_fintech_function_run_start(p_requested integer)
returns bigint language plpgsql security definer set search_path='public','pg_temp' as $$
declare v_id bigint; begin insert into public.aml_fintech_function_run(rows_requested) values(coalesce(p_requested,0)) returning run_id into v_id; return v_id; end; $$;
revoke all on function public.aml_fintech_function_run_start(integer) from public,anon,authenticated;
grant execute on function public.aml_fintech_function_run_start(integer) to service_role;

create or replace function public.aml_fintech_function_run_finish(p_run_id bigint,p_processed integer,p_failed integer,p_observations integer,p_status text,p_detail jsonb)
returns void language plpgsql security definer set search_path='public','pg_temp' as $$
begin update public.aml_fintech_function_run set rows_processed=coalesce(p_processed,0),rows_failed=coalesce(p_failed,0),observations_upserted=coalesce(p_observations,0),status=coalesce(p_status,'COMPLETED'),detail=coalesce(p_detail,'{}'::jsonb),completed_at=now() where run_id=p_run_id; end; $$;
revoke all on function public.aml_fintech_function_run_finish(bigint,integer,integer,integer,text,jsonb) from public,anon,authenticated;
grant execute on function public.aml_fintech_function_run_finish(bigint,integer,integer,integer,text,jsonb) to service_role;

create or replace function public.aml_fintech_mark_function_refreshed(p_rows jsonb)
returns void language plpgsql security definer set search_path='public','pg_temp' as $$
declare r jsonb; begin for r in select value from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) loop
  if r->>'subject_type'='ENTITY' then update public.aml_fintech_entity set functional_profile_refreshed_at=now() where fintech_id=r->>'subject_key';
  elsif r->>'subject_type'='CANDIDATE' then update public.aml_fintech_candidate set functional_profile_refreshed_at=now() where candidate_id::text=r->>'subject_key'; end if;
end loop; end; $$;
revoke all on function public.aml_fintech_mark_function_refreshed(jsonb) from public,anon,authenticated;
grant execute on function public.aml_fintech_mark_function_refreshed(jsonb) to service_role;

create or replace function public.aml_fintech_seed_regulatory_functions()
returns jsonb language plpgsql security definer set search_path='public','pg_temp' as $$
declare v_count int:=0;
begin
  insert into public.aml_fintech_function_observation(observation_key,subject_type,subject_key,function_code,evidence_status,evidence_class,confidence,basis,source_code,source_url,evidence_excerpt,first_seen_at,last_seen_at,observed_at)
  select md5(concat_ws('|','ENTITY',r.fintech_id,m.function_code,r.regulator,r.registry,r.service)),'ENTITY',r.fintech_id,m.function_code,'OBSERVED','OFFICIAL_OPEN',1.0,
    'Función explícita en registro público UAF/CMF.','UAF_PUBLIC',r.source_url,left(concat(r.regulator,' · ',r.registry,' · ',r.service),1000),now(),now(),r.observed_at
  from public.aml_fintech_regulatory_status r
  cross join lateral (select case
    when lower(r.service) like '%sistemas alternativos de transacci%' then 'FIN_ALT_TRADING_SYSTEM'
    when lower(r.service) like '%custodia de instrumentos financieros%' then 'FIN_FINANCIAL_CUSTODY'
    when lower(r.service) like '%intermediaci%n de instrumentos financieros%' then 'FIN_FINANCIAL_INTERMEDIATION'
    when lower(r.service) like '%asesor%a de inversi%n%' then 'FIN_INVESTMENT_ADVISORY'
    when lower(r.service) like '%asesor%a crediticia%' then 'FIN_CREDIT_ADVISORY'
    when lower(r.service) like '%financiamiento colectivo%' then 'FIN_CROWDFUNDING' else null end function_code) m
  where m.function_code is not null
  on conflict(observation_key) do update set evidence_status='OBSERVED',evidence_class='OFFICIAL_OPEN',confidence=1.0,basis=excluded.basis,source_code=excluded.source_code,source_url=excluded.source_url,evidence_excerpt=excluded.evidence_excerpt,last_seen_at=now(),observed_at=excluded.observed_at;
  get diagnostics v_count=row_count;
  perform public.aml_fintech_refresh_functional_profile();
  return jsonb_build_object('official_functions_upserted',v_count);
end; $$;
revoke all on function public.aml_fintech_seed_regulatory_functions() from public,anon,authenticated;
grant execute on function public.aml_fintech_seed_regulatory_functions() to service_role;

create or replace function public.obs_fintech_functional_status()
returns jsonb language plpgsql stable security definer set search_path='public','pg_temp' as $$
declare ok boolean; result jsonb;
begin
  select exists(select 1 from public.aml_allowed_users au where au.user_id=auth.uid() and au.enabled) into ok;
  if not ok then return jsonb_build_object('error','NOT_AUTHORIZED'); end if;
  select jsonb_build_object(
    'observations',(select count(*) from public.aml_fintech_function_observation),
    'subjects_profiled',(select count(distinct subject_type||':'||subject_key) from public.aml_fintech_function_observation),
    'entities_profiled',(select count(distinct subject_key) from public.aml_fintech_function_observation where subject_type='ENTITY'),
    'candidates_profiled',(select count(distinct subject_key) from public.aml_fintech_function_observation where subject_type='CANDIDATE'),
    'fatf_vasp_subjects',(select count(distinct o.subject_type||':'||o.subject_key) from public.aml_fintech_function_observation o join public.aml_fintech_function_catalog c using(function_code) where c.fatf_vasp and o.evidence_status in ('OBSERVED','PROBABLE')),
    'confirmed_psav',(select count(*) from public.aml_fintech_entity where psav_status='CONFIRMED'),
    'probable_psav',(select count(*) from public.aml_fintech_entity where psav_status='PROBABLE'),
    'exposure_only',(select count(*) from public.aml_fintech_entity where psav_status='EXPOSURE'),
    'last_run',(select to_jsonb(r) from public.aml_fintech_function_run r order by r.started_at desc limit 1),
    'function_distribution',coalesce((select jsonb_agg(x order by (x->>'count')::int desc) from (select jsonb_build_object('function_code',c.function_code,'label',c.label,'group',c.function_group,'fatf_vasp',c.fatf_vasp,'count',count(distinct o.subject_type||':'||o.subject_key)) x from public.aml_fintech_function_catalog c join public.aml_fintech_function_observation o using(function_code) where o.evidence_status in ('OBSERVED','PROBABLE') group by c.function_code,c.label,c.function_group,c.fatf_vasp) s),'[]'::jsonb),
    'method_note','Clasificación funcional basada exclusivamente en fuentes abiertas. PSAV confirmado/probable corresponde a evidencia funcional respecto de definiciones FATF; no equivale a una conclusión jurídica, registral o de cumplimiento.') into result;
  return result;
end; $$;
revoke all on function public.obs_fintech_functional_status() from public,anon;
grant execute on function public.obs_fintech_functional_status() to authenticated;

create or replace function public.obs_fintech_function_detail(p_fintech_id text)
returns jsonb language plpgsql stable security definer set search_path='public','pg_temp' as $$
declare ok boolean; result jsonb;
begin
  select exists(select 1 from public.aml_allowed_users au where au.user_id=auth.uid() and au.enabled) into ok;
  if not ok then return jsonb_build_object('error','NOT_AUTHORIZED'); end if;
  select jsonb_build_object(
    'psav_status',e.psav_status,'psav_basis',e.psav_basis,'psav_confidence',e.psav_confidence,'psav_refreshed_at',e.psav_refreshed_at,
    'functions',coalesce((select jsonb_agg(jsonb_build_object('function_code',c.function_code,'label',c.label,'group',c.function_group,'fatf_vasp',c.fatf_vasp,'evidence_status',o.evidence_status,'confidence',o.confidence,'basis',o.basis,'source_code',o.source_code,'source_url',o.source_url,'evidence_excerpt',o.evidence_excerpt,'observed_at',o.observed_at) order by c.sort_order,o.confidence desc) from public.aml_fintech_function_observation o join public.aml_fintech_function_catalog c using(function_code) where o.subject_type='ENTITY' and o.subject_key=e.fintech_id and o.evidence_status in ('OBSERVED','PROBABLE')),'[]'::jsonb),
    'public_footprint',coalesce((select jsonb_agg(jsonb_build_object('function_code',a.function_code,'label',c.label,'fatf_vasp',c.fatf_vasp,'status',a.footprint_status,'explanation',a.explanation,'regulatory_evidence',a.regulatory_evidence,'confidence',a.confidence,'observed_at',a.observed_at) order by c.sort_order) from public.aml_fintech_public_footprint_assessment a join public.aml_fintech_function_catalog c using(function_code) where a.fintech_id=e.fintech_id),'[]'::jsonb),
    'method_note','La comparación muestra cobertura de huella pública, no cumplimiento ni incumplimiento regulatorio. RPSF y registros UAF no son equivalentes a un padrón PSAV.') into result
  from public.aml_fintech_entity e where e.fintech_id=p_fintech_id;
  return coalesce(result,jsonb_build_object('error','NOT_FOUND'));
end; $$;
revoke all on function public.obs_fintech_function_detail(text) from public,anon;
grant execute on function public.obs_fintech_function_detail(text) to authenticated;

create or replace function public.aml_fintech_trigger_functional_classifier()
returns bigint language plpgsql security definer set search_path='public','vault','net','pg_temp' as $$
declare v_token text; v_request bigint;
begin
  select decrypted_secret into v_token from vault.decrypted_secrets where name='atlas_fintech_cron_token' limit 1;
  if v_token is null then raise exception 'FINTECH_CRON_TOKEN_MISSING'; end if;
  select net.http_post(url:='https://ldmtlwzqaqmegedktlxr.supabase.co/functions/v1/atlas-fintech-functional-classifier',body:='{"limit":12}'::jsonb,headers:=jsonb_build_object('content-type','application/json','x-atlas-cron-token',v_token),timeout_milliseconds:=120000) into v_request;
  return v_request;
end; $$;
revoke all on function public.aml_fintech_trigger_functional_classifier() from public,anon,authenticated;
grant execute on function public.aml_fintech_trigger_functional_classifier() to service_role;

create or replace function public.aml_fintech_trigger_functional_subjects(p_subjects jsonb)
returns bigint language plpgsql security definer set search_path='public','vault','net','pg_temp' as $$
declare v_token text; v_request bigint;
begin
  if p_subjects is null or jsonb_typeof(p_subjects)<>'array' then raise exception 'p_subjects must be an array'; end if;
  select decrypted_secret into v_token from vault.decrypted_secrets where name='atlas_fintech_cron_token' limit 1;
  if v_token is null then raise exception 'FINTECH_CRON_TOKEN_MISSING'; end if;
  select net.http_post(url:='https://ldmtlwzqaqmegedktlxr.supabase.co/functions/v1/atlas-fintech-functional-classifier',body:=jsonb_build_object('subjects',p_subjects),headers:=jsonb_build_object('content-type','application/json','x-atlas-cron-token',v_token),timeout_milliseconds:=120000) into v_request;
  return v_request;
end; $$;
revoke all on function public.aml_fintech_trigger_functional_subjects(jsonb) from public,anon,authenticated;
grant execute on function public.aml_fintech_trigger_functional_subjects(jsonb) to service_role;

-- Keep the functional monitor fresh without blocking the general enrichment/discovery jobs.
do $$ declare j bigint; begin
  for j in select jobid from cron.job where jobname='atlas-fintech-functional-classifier' loop perform cron.unschedule(j); end loop;
end $$;
select cron.schedule('atlas-fintech-functional-classifier','12 */3 * * *','select public.aml_fintech_trigger_functional_classifier();');

-- Export contract: functional_observations/function_catalog/public_footprint are added by the production obs_fintech_export contract.
