-- ATLAS Observatorio · Fintech discovery and cross-source identity resolution
-- Open-source only. This migration extends the Fintech radar base schema.

create table if not exists public.aml_fintech_discovery_run (
  run_id bigint generated always as identity primary key,
  source_code text not null references public.aml_fintech_source_catalog(source_code),
  source_url text,
  source_checksum text,
  status text not null default 'STARTED',
  rows_seen integer not null default 0,
  candidates_new integer not null default 0,
  matched_existing integer not null default 0,
  unresolved integer not null default 0,
  detail jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.aml_fintech_candidate (
  candidate_id bigint generated always as identity primary key,
  source_code text not null references public.aml_fintech_source_catalog(source_code),
  source_entity_key text not null,
  name_raw text not null,
  rut_raw text,
  normalized_name text not null,
  normalized_rut text,
  source_url text,
  candidate_status text not null default 'DISCOVERED',
  matched_fintech_id text references public.aml_fintech_entity(fintech_id),
  match_method text,
  match_score numeric(5,4),
  evidence jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  website text,
  domain text,
  legal_name_source text,
  brand_hint text,
  vertical_hint text,
  registration_no text,
  registration_date date,
  unique(source_code, source_entity_key)
);

alter table public.aml_fintech_discovery_run enable row level security;
alter table public.aml_fintech_candidate enable row level security;
revoke all on public.aml_fintech_discovery_run from anon, authenticated;
revoke all on public.aml_fintech_candidate from anon, authenticated;

create index if not exists aml_fintech_candidate_status_idx on public.aml_fintech_candidate(candidate_status, source_code);
create index if not exists aml_fintech_candidate_rut_idx on public.aml_fintech_candidate(normalized_rut);
create index if not exists aml_fintech_candidate_name_idx on public.aml_fintech_candidate(normalized_name);
create index if not exists aml_fintech_candidate_domain_idx on public.aml_fintech_candidate(domain) where domain is not null;
create index if not exists aml_fintech_candidate_matched_idx on public.aml_fintech_candidate(matched_fintech_id) where matched_fintech_id is not null;
create index if not exists aml_fintech_discovery_run_source_idx on public.aml_fintech_discovery_run(source_code,started_at desc);
create index if not exists aml_fintech_entity_source_source_idx on public.aml_fintech_entity_source(source_code,fintech_id);
create index if not exists aml_fintech_event_entity_idx on public.aml_fintech_event(fintech_id,event_date desc);
create index if not exists aml_fintech_event_source_idx on public.aml_fintech_event(source_code) where source_code is not null;
create index if not exists aml_fintech_market_metric_source_idx on public.aml_fintech_market_metric(source_code) where source_code is not null;
create index if not exists aml_fintech_universe_source_idx on public.aml_fintech_universe_snapshot(source_code,source_date desc);
create index if not exists aml_fintech_activity_source_idx on public.aml_fintech_activity(source_code) where source_code is not null;
create index if not exists aml_sii_registry_company_rut_norm_fintech_idx on public.aml_sii_registry_company ((regexp_replace(upper(coalesce(rut,'')), '[^0-9K]', '', 'g')));

insert into public.aml_fintech_source_catalog(source_code,label,source_type,authority_level,source_url,cadence,active,notes)
values
  ('FINTECHILE_MEMBERS','FinteChile · Miembros públicos','INDUSTRY_MEMBERSHIP','SECTORIAL_OPEN','https://www.fintechile.org/miembros','SEMANAL',true,'La membresía confirma pertenencia al ecosistema, pero no resuelve por sí sola la persona jurídica o RUT asociado a la marca.')
on conflict(source_code) do update set
  label=excluded.label, source_type=excluded.source_type, authority_level=excluded.authority_level,
  source_url=excluded.source_url, cadence=excluded.cadence, active=true, notes=excluded.notes, refreshed_at=now();

create or replace function public.aml_fintech_norm_rut(p text)
returns text language sql immutable set search_path=public,pg_temp as $$
  select nullif(regexp_replace(upper(coalesce(p,'')), '[^0-9K]', '', 'g'), '');
$$;

create or replace function public.aml_fintech_domain(p_url text)
returns text language sql immutable set search_path=public,pg_temp as $$
  select nullif(regexp_replace(split_part(regexp_replace(lower(btrim(coalesce(p_url,''))), '^https?://', '', 'i'), '/', 1), '^www\.', '', 'i'), '');
$$;

create or replace function public.aml_fintech_brand_key(p_text text)
returns text language sql immutable set search_path=public,pg_temp as $$
  select nullif(btrim(regexp_replace(regexp_replace(regexp_replace(public.obs_normalize_text(coalesce(p_text,'')), '\m(sociedad anonima|sociedad por acciones|responsabilidad limitada|limitada|ltda|spa|s a|sa)\M', ' ', 'g'), '\m(chile)\M', ' ', 'g'), '\s+', ' ', 'g')), '');
$$;

create or replace function public.aml_fintech_ingest_discovery_rows(
  p_source_code text, p_source_url text, p_source_checksum text, p_rows jsonb
) returns jsonb
language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare
  r record; v_run_id bigint; v_match text; v_method text; v_name text; v_rut text; v_key text;
  v_new integer:=0; v_matched integer:=0; v_unresolved integer:=0; v_seen integer:=0; v_existing bigint;
  v_matches jsonb:='[]'::jsonb;
begin
  if p_source_code is null or not exists(select 1 from public.aml_fintech_source_catalog where source_code=p_source_code and active) then raise exception 'UNKNOWN_OR_INACTIVE_SOURCE'; end if;
  if p_rows is null or jsonb_typeof(p_rows)<>'array' then raise exception 'ROWS_MUST_BE_ARRAY'; end if;
  insert into public.aml_fintech_discovery_run(source_code,source_url,source_checksum,status)
  values(p_source_code,p_source_url,p_source_checksum,'RUNNING') returning run_id into v_run_id;
  for r in select * from jsonb_to_recordset(p_rows) as x(source_entity_key text,name text,rut text,status text,source_url text,evidence jsonb) loop
    if coalesce(btrim(r.name),'')='' then continue; end if;
    v_seen:=v_seen+1; v_name:=public.obs_normalize_text(r.name); v_rut:=public.aml_fintech_norm_rut(r.rut);
    v_key:=coalesce(nullif(btrim(r.source_entity_key),''),v_rut,v_name); v_match:=null; v_method:=null;
    if v_rut is not null then
      select fintech_id into v_match from public.aml_fintech_entity where public.aml_fintech_norm_rut(rut)=v_rut order by identification_status='CONFIRMED' desc,confidence desc limit 1;
      if v_match is not null then v_method:='EXACT_RUT'; end if;
    end if;
    if v_match is null and v_name is not null then
      select fintech_id into v_match from public.aml_fintech_entity where public.obs_normalize_text(legal_name)=v_name or public.obs_normalize_text(coalesce(brand,''))=v_name limit 1;
      if v_match is not null then v_method:='EXACT_NAME'; end if;
    end if;
    select candidate_id into v_existing from public.aml_fintech_candidate where source_code=p_source_code and source_entity_key=v_key;
    insert into public.aml_fintech_candidate(source_code,source_entity_key,name_raw,rut_raw,normalized_name,normalized_rut,source_url,candidate_status,matched_fintech_id,match_method,match_score,evidence)
    values(p_source_code,v_key,btrim(r.name),nullif(btrim(r.rut),''),v_name,v_rut,coalesce(r.source_url,p_source_url),case when v_match is null then 'DISCOVERED' else 'MATCHED_EXISTING' end,v_match,v_method,case when v_method='EXACT_RUT' then 1.0 when v_method='EXACT_NAME' then 0.92 end,coalesce(r.evidence,'{}'::jsonb)||jsonb_build_object('source_status',r.status))
    on conflict(source_code,source_entity_key) do update set name_raw=excluded.name_raw,rut_raw=excluded.rut_raw,normalized_name=excluded.normalized_name,normalized_rut=excluded.normalized_rut,source_url=excluded.source_url,candidate_status=excluded.candidate_status,matched_fintech_id=excluded.matched_fintech_id,match_method=excluded.match_method,match_score=excluded.match_score,evidence=public.aml_fintech_candidate.evidence||excluded.evidence,last_seen_at=now();
    if v_existing is null then v_new:=v_new+1; end if;
    if v_match is null then v_unresolved:=v_unresolved+1; else
      v_matched:=v_matched+1; v_matches:=v_matches||jsonb_build_array(jsonb_build_object('fintech_id',v_match,'rut',r.rut,'source_url',coalesce(r.source_url,p_source_url)));
      insert into public.aml_fintech_entity_source(fintech_id,source_code,source_entity_key,source_label,source_url,status,evidence)
      values(v_match,p_source_code,v_key,btrim(r.name),coalesce(r.source_url,p_source_url),'OBSERVED',coalesce(r.evidence,'{}'::jsonb))
      on conflict(fintech_id,source_code) do update set source_entity_key=excluded.source_entity_key,source_label=excluded.source_label,source_url=excluded.source_url,status='OBSERVED',evidence=public.aml_fintech_entity_source.evidence||excluded.evidence,last_seen_at=now();
      if p_source_code='CMF_RPSF' then
        insert into public.aml_fintech_regulatory_status(fintech_id,regulator,registry,service,status,source_url,observed_at)
        values(v_match,'CMF','RPSF','',coalesce(nullif(upper(btrim(r.status)),''),'OBSERVADO'),coalesce(r.source_url,p_source_url),now())
        on conflict(fintech_id,regulator,registry,service) do update set status=excluded.status,source_url=excluded.source_url,observed_at=now();
      end if;
    end if;
  end loop;
  update public.aml_fintech_discovery_run set status='COMPLETED',rows_seen=v_seen,candidates_new=v_new,matched_existing=v_matched,unresolved=v_unresolved,detail=jsonb_build_object('matches',v_matches),completed_at=now() where run_id=v_run_id;
  return jsonb_build_object('run_id',v_run_id,'source_code',p_source_code,'rows_seen',v_seen,'candidates_new',v_new,'matched_existing',v_matched,'unresolved',v_unresolved,'matches',v_matches);
exception when others then
  if v_run_id is not null then update public.aml_fintech_discovery_run set status='FAILED',detail=jsonb_build_object('error',sqlerrm),completed_at=now() where run_id=v_run_id; end if;
  raise;
end $$;

create or replace function public.aml_fintech_ingest_cmf_candidate_details(p_rows jsonb)
returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare r record; v_count integer:=0;
begin
  if p_rows is null or jsonb_typeof(p_rows)<>'array' then raise exception 'ROWS_MUST_BE_ARRAY'; end if;
  for r in select * from jsonb_to_recordset(p_rows) as x(rut text,legal_name text,fantasy_name text,registration_no text,registration_date date,website text,status text,source_url text,institution_code text) loop
    update public.aml_fintech_candidate c set legal_name_source=coalesce(nullif(btrim(r.legal_name),''),c.legal_name_source),brand_hint=coalesce(nullif(btrim(r.fantasy_name),''),c.brand_hint),website=coalesce(nullif(btrim(r.website),''),c.website),domain=coalesce(public.aml_fintech_domain(r.website),c.domain),registration_no=coalesce(nullif(btrim(r.registration_no),''),c.registration_no),registration_date=coalesce(r.registration_date,c.registration_date),source_url=coalesce(nullif(btrim(r.source_url),''),c.source_url),evidence=c.evidence||jsonb_strip_nulls(jsonb_build_object('cmf_legal_name',r.legal_name,'cmf_fantasy_name',r.fantasy_name,'cmf_website',r.website,'cmf_registration_no',r.registration_no,'cmf_registration_date',r.registration_date,'cmf_institution_code',r.institution_code,'cmf_status',r.status)),last_seen_at=now()
    where c.source_code='CMF_RPSF' and c.normalized_rut=public.aml_fintech_norm_rut(r.rut);
    if found then v_count:=v_count+1; end if;
  end loop;
  return jsonb_build_object('updated',v_count);
end $$;

create or replace function public.aml_fintech_ingest_sector_members(p_source_code text,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare
  r record; v_key text; v_brand_key text; v_domain text; v_entity_id text; v_cmf_id bigint; v_rut text; v_atlas_entity_id text; v_legal_name text;
  v_promoted integer:=0; v_matched integer:=0; v_discovered integer:=0; v_seen integer:=0;
begin
  if p_source_code is null or not exists(select 1 from public.aml_fintech_source_catalog where source_code=p_source_code and active) then raise exception 'UNKNOWN_OR_INACTIVE_SOURCE'; end if;
  if p_rows is null or jsonb_typeof(p_rows)<>'array' then raise exception 'ROWS_MUST_BE_ARRAY'; end if;
  for r in select * from jsonb_to_recordset(p_rows) as x(brand text,website text,domain text,vertical text,source_url text,evidence jsonb) loop
    if coalesce(btrim(r.brand),'')='' and coalesce(btrim(r.domain),'')='' then continue; end if;
    v_seen:=v_seen+1; v_domain:=coalesce(nullif(lower(btrim(r.domain)),''),public.aml_fintech_domain(r.website)); v_brand_key:=public.aml_fintech_brand_key(r.brand); v_key:=coalesce(v_domain,v_brand_key);
    v_entity_id:=null; v_cmf_id:=null; v_rut:=null; v_atlas_entity_id:=null; v_legal_name:=null;
    select e.fintech_id into v_entity_id from public.aml_fintech_entity e where (v_domain is not null and public.aml_fintech_domain(e.website)=v_domain) or (v_brand_key is not null and (public.aml_fintech_brand_key(e.brand)=v_brand_key or public.aml_fintech_brand_key(e.legal_name)=v_brand_key)) order by case when v_domain is not null and public.aml_fintech_domain(e.website)=v_domain then 0 else 1 end,e.confidence desc limit 1;
    if v_entity_id is null then
      select c.candidate_id,c.rut_raw,sc.entity_id,coalesce(sc.legal_name,c.legal_name_source,c.name_raw) into v_cmf_id,v_rut,v_atlas_entity_id,v_legal_name
      from public.aml_fintech_candidate c left join public.aml_sii_registry_company sc on public.aml_fintech_norm_rut(sc.rut)=c.normalized_rut
      where c.source_code='CMF_RPSF' and c.matched_fintech_id is null and sc.entity_id is not null and ((v_domain is not null and c.domain=v_domain) or (v_brand_key is not null and (public.aml_fintech_brand_key(c.brand_hint)=v_brand_key or public.aml_fintech_brand_key(c.legal_name_source)=v_brand_key or public.aml_fintech_brand_key(c.name_raw)=v_brand_key)))
      order by case when v_domain is not null and c.domain=v_domain then 0 else 1 end,c.last_seen_at desc limit 1;
      if v_cmf_id is not null then
        v_entity_id:=v_atlas_entity_id;
        insert into public.aml_fintech_entity(fintech_id,atlas_entity_id,rut,brand,legal_name,website,presence_chile,entity_status,identification_status,identification_basis,primary_vertical,psav_status,confidence)
        values(v_entity_id,v_atlas_entity_id,v_rut,coalesce(nullif(btrim(r.brand),''),v_legal_name),v_legal_name,r.website,'CONFIRMED','ACTIVE_OBSERVED','CONFIRMED','CMF_RPSF+SII_PUBLIC+'||p_source_code,r.vertical,'NO_EVIDENCE',0.98)
        on conflict(fintech_id) do update set website=coalesce(public.aml_fintech_entity.website,excluded.website),primary_vertical=coalesce(excluded.primary_vertical,public.aml_fintech_entity.primary_vertical),identification_basis=case when public.aml_fintech_entity.identification_basis like '%'||p_source_code||'%' then public.aml_fintech_entity.identification_basis else public.aml_fintech_entity.identification_basis||'+'||p_source_code end,confidence=greatest(public.aml_fintech_entity.confidence,excluded.confidence),last_seen_at=now(),refreshed_at=now();
        v_promoted:=v_promoted+1;
      end if;
    end if;
    insert into public.aml_fintech_candidate(source_code,source_entity_key,name_raw,normalized_name,source_url,website,domain,brand_hint,vertical_hint,candidate_status,matched_fintech_id,match_method,match_score,evidence)
    values(p_source_code,v_key,coalesce(nullif(btrim(r.brand),''),v_domain),public.obs_normalize_text(coalesce(r.brand,v_domain)),coalesce(r.source_url,r.website),r.website,v_domain,r.brand,r.vertical,case when v_entity_id is null then 'DISCOVERED' else 'MATCHED_EXISTING' end,v_entity_id,case when v_entity_id is null then null when v_cmf_id is not null then 'CROSS_SOURCE_IDENTITY' else 'DOMAIN_OR_BRAND' end,case when v_entity_id is null then null when v_cmf_id is not null then 0.98 else 0.95 end,coalesce(r.evidence,'{}'::jsonb)||jsonb_strip_nulls(jsonb_build_object('vertical',r.vertical,'website',r.website,'domain',v_domain)))
    on conflict(source_code,source_entity_key) do update set name_raw=excluded.name_raw,normalized_name=excluded.normalized_name,source_url=excluded.source_url,website=excluded.website,domain=excluded.domain,brand_hint=excluded.brand_hint,vertical_hint=excluded.vertical_hint,candidate_status=excluded.candidate_status,matched_fintech_id=excluded.matched_fintech_id,match_method=excluded.match_method,match_score=excluded.match_score,evidence=public.aml_fintech_candidate.evidence||excluded.evidence,last_seen_at=now();
    if v_entity_id is null then v_discovered:=v_discovered+1; else
      v_matched:=v_matched+1;
      update public.aml_fintech_entity set primary_vertical=coalesce(r.vertical,primary_vertical),website=coalesce(website,r.website),identification_basis=case when identification_basis like '%'||p_source_code||'%' then identification_basis else identification_basis||'+'||p_source_code end,last_seen_at=now(),refreshed_at=now() where fintech_id=v_entity_id;
      insert into public.aml_fintech_entity_source(fintech_id,source_code,source_entity_key,source_label,source_url,status,evidence)
      values(v_entity_id,p_source_code,v_key,coalesce(r.brand,v_domain),coalesce(r.source_url,r.website),'OBSERVED',coalesce(r.evidence,'{}'::jsonb))
      on conflict(fintech_id,source_code) do update set source_entity_key=excluded.source_entity_key,source_label=excluded.source_label,source_url=excluded.source_url,status='OBSERVED',evidence=public.aml_fintech_entity_source.evidence||excluded.evidence,last_seen_at=now();
      if v_cmf_id is not null then
        update public.aml_fintech_candidate set candidate_status='MATCHED_EXISTING',matched_fintech_id=v_entity_id,match_method='CROSS_SOURCE_IDENTITY',match_score=0.98,last_seen_at=now() where candidate_id=v_cmf_id;
        insert into public.aml_fintech_entity_source(fintech_id,source_code,source_entity_key,source_label,source_url,status,evidence,first_seen_at,last_seen_at)
        select v_entity_id,'CMF_RPSF',c.source_entity_key,c.name_raw,c.source_url,'OBSERVED',c.evidence,c.first_seen_at,now() from public.aml_fintech_candidate c where c.candidate_id=v_cmf_id
        on conflict(fintech_id,source_code) do update set source_entity_key=excluded.source_entity_key,source_label=excluded.source_label,source_url=excluded.source_url,status='OBSERVED',evidence=public.aml_fintech_entity_source.evidence||excluded.evidence,last_seen_at=now();
        insert into public.aml_fintech_regulatory_status(fintech_id,regulator,registry,service,status,registration_no,effective_date,source_url,observed_at)
        select v_entity_id,'CMF','RPSF','',upper(coalesce(c.evidence->>'source_status','VIGENTE')),c.registration_no,c.registration_date,c.source_url,now() from public.aml_fintech_candidate c where c.candidate_id=v_cmf_id
        on conflict(fintech_id,regulator,registry,service) do update set status=excluded.status,registration_no=coalesce(excluded.registration_no,public.aml_fintech_regulatory_status.registration_no),effective_date=coalesce(excluded.effective_date,public.aml_fintech_regulatory_status.effective_date),source_url=excluded.source_url,observed_at=now();
      end if;
    end if;
  end loop;
  return jsonb_build_object('source_code',p_source_code,'rows_seen',v_seen,'matched',v_matched,'promoted_from_cmf_sii',v_promoted,'unresolved',v_discovered);
end $$;

create or replace function public.obs_fintech_candidate_queue(p_source text default null,p_q text default null,p_limit integer default 25,p_offset integer default 0)
returns jsonb language sql stable security definer set search_path=public,extensions,pg_temp as $$
with allowed as (select exists(select 1 from public.aml_allowed_users where user_id=(select auth.uid()) and enabled) ok),
base as (
  select c.*,sc.entity_id sii_entity_id,sc.legal_name sii_legal_name,sc.current_status sii_status,sc.activity_start_date sii_activity_start_date,sc.termination_date sii_termination_date,u.uaf_sector_canonical,u.sii_commercial_year,u.sii_main_activity,u.sii_economic_sector,u.sii_sales_band,u.sii_sales_band_rank,u.sii_workers,
  case when c.matched_fintech_id is not null then 'MATCHED' when sc.entity_id is not null and u.rut is not null then 'IDENTITY_PLUS_UAF_PUBLIC' when sc.entity_id is not null then 'IDENTITY_RESOLVED' else 'IDENTITY_PENDING' end resolution_stage
  from public.aml_fintech_candidate c left join public.aml_sii_registry_company sc on sc.rut=c.rut_raw left join public.aml_uaf_obligated_subject_snapshot u on public.aml_fintech_norm_rut(u.rut)=c.normalized_rut
  where (p_source is null or p_source='' or c.source_code=p_source) and (p_q is null or btrim(p_q)='' or c.normalized_name like '%'||public.obs_normalize_text(p_q)||'%' or coalesce(c.normalized_rut,'') like '%'||public.aml_fintech_norm_rut(p_q)||'%')
), paged as (select * from base order by (matched_fintech_id is not null) desc,(sii_entity_id is not null) desc,coalesce(sii_sales_band_rank,0) desc,name_raw limit greatest(1,least(coalesce(p_limit,25),100)) offset greatest(coalesce(p_offset,0),0))
select case when a.ok then jsonb_build_object('total',(select count(*) from base),'unresolved',(select count(*) from base where matched_fintech_id is null),'identity_resolved',(select count(*) from base where sii_entity_id is not null),'rows',coalesce((select jsonb_agg(to_jsonb(p) order by (matched_fintech_id is not null) desc,(sii_entity_id is not null) desc,coalesce(sii_sales_band_rank,0) desc,name_raw) from paged p),'[]'::jsonb)) else jsonb_build_object('error','NOT_AUTHORIZED') end from allowed a;
$$;

create or replace function public.obs_fintech_discovery_status()
returns jsonb language sql stable security definer set search_path=public,extensions,pg_temp as $$
with allowed as (select exists(select 1 from public.aml_allowed_users where user_id=(select auth.uid()) and enabled) ok),counts as (select count(*)::bigint total,count(*) filter(where candidate_status='MATCHED_EXISTING')::bigint matched,count(*) filter(where candidate_status='DISCOVERED')::bigint unresolved from public.aml_fintech_candidate),runs as (select source_code,status,rows_seen,candidates_new,matched_existing,unresolved,started_at,completed_at from public.aml_fintech_discovery_run order by started_at desc limit 12)
select case when a.ok then jsonb_build_object('candidates',jsonb_build_object('total',c.total,'matched',c.matched,'unresolved',c.unresolved),'recent_runs',(select coalesce(jsonb_agg(to_jsonb(r) order by r.started_at desc),'[]'::jsonb) from runs r)) else jsonb_build_object('error','NOT_AUTHORIZED') end from allowed a cross join counts c;
$$;

-- Internal connector authentication: random token is created in Vault, never in source control.
do $$ begin
  if not exists(select 1 from vault.secrets where name='atlas_fintech_cron_token') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'atlas_fintech_cron_token','Internal token for ATLAS Fintech discovery connector.');
  end if;
end $$;

create or replace function public.aml_fintech_validate_internal_token(p_token text)
returns boolean language sql stable security definer set search_path=public,vault,pg_temp as $$
  select exists(select 1 from vault.decrypted_secrets where name='atlas_fintech_cron_token' and decrypted_secret is not null and decrypted_secret=p_token);
$$;

create or replace function public.aml_fintech_trigger_discovery()
returns bigint language plpgsql security definer set search_path=public,vault,net,pg_temp as $$
declare v_token text; v_request bigint;
begin
  select decrypted_secret into v_token from vault.decrypted_secrets where name='atlas_fintech_cron_token' limit 1;
  if v_token is null then raise exception 'FINTECH_CRON_TOKEN_MISSING'; end if;
  select net.http_post(url:='https://ldmtlwzqaqmegedktlxr.supabase.co/functions/v1/atlas-fintech-discovery',body:='{}'::jsonb,headers:=jsonb_build_object('content-type','application/json','x-atlas-cron-token',v_token),timeout_milliseconds:=120000) into v_request;
  return v_request;
end $$;

revoke all on function public.aml_fintech_ingest_discovery_rows(text,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.aml_fintech_ingest_cmf_candidate_details(jsonb) from public,anon,authenticated;
revoke all on function public.aml_fintech_ingest_sector_members(text,jsonb) from public,anon,authenticated;
revoke all on function public.aml_fintech_validate_internal_token(text) from public,anon,authenticated;
revoke all on function public.aml_fintech_trigger_discovery() from public,anon,authenticated;
grant execute on function public.aml_fintech_ingest_discovery_rows(text,text,text,jsonb) to service_role;
grant execute on function public.aml_fintech_ingest_cmf_candidate_details(jsonb) to service_role;
grant execute on function public.aml_fintech_ingest_sector_members(text,jsonb) to service_role;
grant execute on function public.aml_fintech_validate_internal_token(text) to service_role;
grant execute on function public.aml_fintech_trigger_discovery() to service_role;
revoke all on function public.obs_fintech_candidate_queue(text,text,integer,integer) from public,anon;
revoke all on function public.obs_fintech_discovery_status() from public,anon;
grant execute on function public.obs_fintech_candidate_queue(text,text,integer,integer) to authenticated,service_role;
grant execute on function public.obs_fintech_discovery_status() to authenticated,service_role;

-- The current view is only consumed through allow-listed RPCs.
alter view public.aml_v_fintech_entity_current set (security_invoker=true);
revoke select on public.aml_v_fintech_entity_current from authenticated;

-- Daily refresh; Edge Function itself batches the sectorial reconciliation.
do $$ declare jid bigint; begin
  select jobid into jid from cron.job where jobname='atlas-fintech-discovery';
  if jid is not null then perform cron.unschedule(jid); end if;
  perform cron.schedule('atlas-fintech-discovery','17 10 * * *','select public.aml_fintech_trigger_discovery();');
end $$;
