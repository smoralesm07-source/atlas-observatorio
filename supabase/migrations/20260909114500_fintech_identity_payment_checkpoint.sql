-- ATLAS Observatorio · Fintech identity / payments checkpoint
-- Idempotent post-0020 checkpoint. Mirrors the production layer used by the
-- Fintech radar for actor→legal-vehicle resolution and public payment sources.

alter table public.aml_fintech_entity add column if not exists origin_country text;
alter table public.aml_fintech_entity add column if not exists presence_chile text not null default 'CONFIRMED';
alter table public.aml_fintech_entity add column if not exists identification_status text not null default 'CONFIRMED';

insert into public.aml_fintech_source_catalog(source_code,label,source_type,authority_level,source_url,cadence,active,notes)
values
('SII_PAYMENT_OPERATORS','SII · Administradores u Operadores de Medios de Pagos Electrónicos','PUBLIC_REGISTRY','OFFICIAL_OPEN','https://www.sii.cl/servicios_online/3532-administradores_operadores.html','PERIODICA',true,'Nómina pública con RUT, razón social y nombre de fantasía; útil para resolver identidad de actores de pagos.'),
('CMF_PAYMENT_OPERATORS','CMF · Operadores de Tarjetas de Pago','REGULATORY_REGISTRY','OFFICIAL_OPEN','https://www.cmfchile.cl/institucional/mercados/consulta.php?Estado=VI&entidad=TPOPE&mercado=B','WEEKLY',true,'Listado nominal vigente con RUT de operadores de tarjetas de pago.'),
('CMF_PREPAID_ISSUERS','CMF · Emisores de Tarjetas de Pago con Provisión de Fondos','REGULATORY_REGISTRY','OFFICIAL_OPEN','https://www.cmfchile.cl/portal/principal/623/w4-article-47006.html','WEEKLY',true,'Listado público de emisores no bancarios de prepago; conservar cambios de razón social por RUT.'),
('CMF_CREDIT_ISSUERS','CMF · Emisores de Tarjetas de Crédito no Bancarias','REGULATORY_REGISTRY','OFFICIAL_OPEN','https://www.cmfchile.cl/institucional/mercados/consulta.php?Estado=VI&entidad=TCEEM&mercado=B','WEEKLY',true,'Listado nominal vigente con RUT de emisores de tarjetas de crédito no bancarias.'),
('CMF_PSP_XBORDER','CMF · PSP habilitados para adquirencia transfronteriza','REGULATORY_LIST','OFFICIAL_OPEN','https://www.cmfchile.cl/portal/prensa/625/w4-article-91655.html','EVENT_DRIVEN',true,'Listado público nominal de PSP habilitados para adquirencia transfronteriza conforme Cap. III.J.2 CNF BCCh.'),
('CMF_RPSF_SERVICES','CMF · RPSF por servicio autorizado','REGULATORY_MATRIX','OFFICIAL_OPEN','https://www.cmfchile.cl/institucional/estadisticas/seg_rgpsf.php','WEEKLY',true,'Matriz pública de prestadores RPSF y servicios Ley Fintec autorizados; inscripción y autorización se modelan por separado.'),
('CMF_BEST_PLUS','CMF · BEST+ estadísticas y API','PUBLIC_API','OFFICIAL_OPEN','https://best.cmfchile.cl/','DAILY',true,'Fuente de series temporales y magnitudes de mercado. No usar por sí sola como padrón jurídico.'),
('CMF_OPERATOR_PAYMENT_STATS','CMF · Montos de pagos de Operadores a entidades afiliadas','OPEN_DATASET','OFFICIAL_OPEN','https://www.cmfchile.cl/portal/estadisticas/626/w4-propertyvalue-46103.html','MONTHLY',true,'Fuente para peso de mercado de operadores: montos de pagos a entidades afiliadas y series asociadas.'),
('CMF_FRAUD_STATS','CMF · Fraudes asociados a medios de pago','OPEN_DATASET','OFFICIAL_OPEN','https://www.cmfchile.cl/portal/estadisticas/626/w4-propertyvalue-48099.html','QUARTERLY',true,'Archivos XLSX públicos; usar para contexto y métricas, no para identidad jurídica.')
on conflict(source_code) do update set label=excluded.label,source_type=excluded.source_type,authority_level=excluded.authority_level,source_url=excluded.source_url,cadence=excluded.cadence,active=true,notes=excluded.notes,refreshed_at=now();

create table if not exists public.aml_fintech_legal_vehicle (
  fintech_id text not null references public.aml_fintech_entity(fintech_id) on delete cascade,
  rut text not null,
  atlas_entity_id text,
  legal_name text not null,
  role_code text not null default 'RELATED_ENTITY',
  is_primary boolean not null default false,
  regulator text,
  registry text,
  source_code text references public.aml_fintech_source_catalog(source_code),
  source_url text,
  evidence_basis text not null,
  confidence numeric not null default 1.0,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  primary key(fintech_id,rut,role_code)
);
create index if not exists aml_fintech_legal_vehicle_rut_idx on public.aml_fintech_legal_vehicle(rut);
create index if not exists aml_fintech_legal_vehicle_source_idx on public.aml_fintech_legal_vehicle(source_code);
alter table public.aml_fintech_legal_vehicle enable row level security;
revoke all on public.aml_fintech_legal_vehicle from anon,authenticated;

create table if not exists public.aml_fintech_actor_alias (
  alias_id bigint generated always as identity primary key,
  fintech_id text not null references public.aml_fintech_entity(fintech_id) on delete cascade,
  alias_text text not null,
  alias_type text not null default 'BRAND',
  domain text,
  source_code text references public.aml_fintech_source_catalog(source_code),
  source_url text,
  evidence_basis text not null,
  confidence numeric not null default 1.0,
  active boolean not null default true,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);
create unique index if not exists ux_fintech_actor_alias_identity on public.aml_fintech_actor_alias(fintech_id,lower(alias_text),coalesce(lower(domain),''));
create index if not exists ix_fintech_actor_alias_text on public.aml_fintech_actor_alias(lower(alias_text));
create index if not exists ix_fintech_actor_alias_domain on public.aml_fintech_actor_alias(lower(domain)) where domain is not null;
create index if not exists ix_fintech_actor_alias_source_code on public.aml_fintech_actor_alias(source_code);
alter table public.aml_fintech_actor_alias enable row level security;
revoke all on public.aml_fintech_actor_alias from anon,authenticated;

create or replace function public.aml_fintech_link_legal_vehicle(p_fintech_id text,p_rut text,p_role_code text default 'RELATED_ENTITY',p_is_primary boolean default false,p_source_code text default 'SII_PUBLIC',p_source_url text default null,p_basis text default 'OPEN_SOURCE_IDENTITY',p_confidence numeric default 1.0,p_legal_name text default null,p_metadata jsonb default '{}'::jsonb)
returns boolean language plpgsql set search_path=public,pg_temp as $$
declare v_rut text:=public.aml_fintech_norm_rut(p_rut); v_name text; v_entity text;
begin
 if not exists(select 1 from public.aml_fintech_entity where fintech_id=p_fintech_id) then return false; end if;
 select s.legal_name,s.entity_id into v_name,v_entity from public.aml_sii_registry_company s where s.rut=p_rut order by s.refreshed_at desc nulls last,s.last_seen_at desc nulls last limit 1;
 v_name:=coalesce(p_legal_name,v_name,p_rut);
 if p_is_primary then update public.aml_fintech_legal_vehicle set is_primary=false where fintech_id=p_fintech_id; end if;
 insert into public.aml_fintech_legal_vehicle(fintech_id,rut,atlas_entity_id,legal_name,role_code,is_primary,source_code,source_url,evidence_basis,confidence,last_seen_at,metadata)
 values(p_fintech_id,v_rut,v_entity,v_name,coalesce(nullif(p_role_code,''),'RELATED_ENTITY'),p_is_primary,p_source_code,p_source_url,p_basis,least(1,greatest(0,p_confidence)),now(),coalesce(p_metadata,'{}'::jsonb))
 on conflict(fintech_id,rut,role_code) do update set atlas_entity_id=coalesce(excluded.atlas_entity_id,public.aml_fintech_legal_vehicle.atlas_entity_id),legal_name=excluded.legal_name,is_primary=excluded.is_primary,source_code=coalesce(excluded.source_code,public.aml_fintech_legal_vehicle.source_code),source_url=coalesce(excluded.source_url,public.aml_fintech_legal_vehicle.source_url),evidence_basis=excluded.evidence_basis,confidence=greatest(public.aml_fintech_legal_vehicle.confidence,excluded.confidence),last_seen_at=now(),metadata=public.aml_fintech_legal_vehicle.metadata||excluded.metadata;
 return true;
end;$$;

create or replace function public.aml_fintech_reconcile_payment_candidates()
returns jsonb language plpgsql set search_path=public,pg_temp as $$
declare v_vehicle_matched integer:=0;
begin
 with matches as (
  select distinct on(c.candidate_id) c.candidate_id,v.fintech_id
  from public.aml_fintech_candidate c join public.aml_fintech_legal_vehicle v on public.aml_fintech_norm_rut(v.rut)=public.aml_fintech_norm_rut(c.rut_raw)
  where c.matched_fintech_id is null and c.rut_raw is not null and c.source_code in ('CMF_PAYMENTS','CMF_PAYMENT_OPERATORS','CMF_PREPAID_ISSUERS','CMF_CREDIT_ISSUERS','CMF_PSP_XBORDER','SII_PAYMENT_OPERATORS')
  order by c.candidate_id,v.is_primary desc,v.confidence desc
 ) update public.aml_fintech_candidate c set candidate_status='MATCHED_LEGAL_VEHICLE',matched_fintech_id=m.fintech_id,match_method='EXACT_RUT_LEGAL_VEHICLE',match_score=1,last_seen_at=now() from matches m where c.candidate_id=m.candidate_id;
 get diagnostics v_vehicle_matched=row_count;
 return jsonb_build_object('vehicle_candidates_matched',v_vehicle_matched,'refreshed_at',now());
end;$$;

create or replace function public.aml_fintech_payment_member_batch(p_limit integer default 6)
returns jsonb language plpgsql set search_path=public,pg_temp as $$
declare r record; v_promoted integer:=0; v_result jsonb;
begin
 for r in
  with member_keys as (
   select c.candidate_id,c.source_entity_key,c.brand_hint,c.name_raw,split_part(public.obs_normalize_text(coalesce(c.brand_hint,c.name_raw)),' ',1) brand_key
   from public.aml_fintech_candidate c where c.source_code='FINTECHILE_MEMBERS' and c.matched_fintech_id is null
  ), matches as (
   select m.candidate_id,m.source_entity_key,m.brand_hint,m.name_raw,m.brand_key,p.rut_raw,p.source_code,p.source_url,
          row_number() over(partition by m.candidate_id order by case p.source_code when 'SII_PAYMENT_OPERATORS' then 0 when 'CMF_PAYMENT_OPERATORS' then 1 when 'CMF_PREPAID_ISSUERS' then 2 else 3 end,p.last_seen_at desc) rn,
          count(*) over(partition by m.candidate_id) nmatch
   from member_keys m join public.aml_fintech_candidate p on p.source_code in ('SII_PAYMENT_OPERATORS','CMF_PAYMENT_OPERATORS','CMF_PREPAID_ISSUERS','CMF_PSP_XBORDER') and p.rut_raw is not null and length(m.brand_key)>=4
   and (public.obs_normalize_text(coalesce(p.evidence->>'fantasy_name',''))=m.brand_key or public.obs_normalize_text(coalesce(p.evidence->>'fantasy_name','')) like m.brand_key||' %' or public.obs_normalize_text(p.name_raw)=m.brand_key or public.obs_normalize_text(p.name_raw) like m.brand_key||' spa%' or public.obs_normalize_text(p.name_raw) like m.brand_key||' s a%')
  ) select * from matches where rn=1 and nmatch=1 order by candidate_id limit greatest(1,least(coalesce(p_limit,6),12))
 loop
  select public.aml_fintech_promote_identity_override(r.source_entity_key,r.rut_raw,'FINTECHILE+'||r.source_code||'+SII_PUBLIC',case when r.source_code in ('SII_PAYMENT_OPERATORS','CMF_PAYMENT_OPERATORS','CMF_PREPAID_ISSUERS') then 1.0 else 0.995 end,initcap(r.brand_key),r.source_url,r.source_code,case when r.source_code='CMF_PREPAID_ISSUERS' then 'PREPAID_ISSUER' when r.source_code='CMF_PSP_XBORDER' then 'PAYMENT_PROCESSOR' else 'PAYMENT_OPERATOR' end) into v_result;
  if coalesce((v_result->>'ok')::boolean,false) then v_promoted:=v_promoted+1; end if;
 end loop;
 return jsonb_build_object('promoted',v_promoted,'limit',p_limit,'refreshed_at',now());
end;$$;

create or replace function public.aml_fintech_trigger_payment_sources()
returns bigint language plpgsql security definer set search_path=public,vault,net,pg_temp as $$
declare v_token text; v_request bigint;
begin
 select decrypted_secret into v_token from vault.decrypted_secrets where name='atlas_fintech_cron_token' limit 1;
 if v_token is null then raise exception 'FINTECH_CRON_TOKEN_MISSING'; end if;
 select net.http_post(url:='https://ldmtlwzqaqmegedktlxr.supabase.co/functions/v1/atlas-fintech-payment-sources',body:='{}'::jsonb,headers:=jsonb_build_object('content-type','application/json','x-atlas-cron-token',v_token),timeout_milliseconds:=120000) into v_request;
 return v_request;
end;$$;
revoke all on function public.aml_fintech_trigger_payment_sources() from public,anon,authenticated;
grant execute on function public.aml_fintech_trigger_payment_sources() to service_role;
