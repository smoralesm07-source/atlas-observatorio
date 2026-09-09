insert into public.aml_fintech_source_catalog(source_code,label,source_type,authority_level,source_url,cadence,active,notes)
values
('FINTECHILE_MAP_JSON','FinteChile/EY · Mapa Fintech Chile 2026 · datos públicos','INDUSTRY_MAP_DATA','SECTORIAL_OPEN','https://fintechile-web.vercel.app/data/mapa.json','MONTHLY',true,'JSON público de agregados del Mapa Fintech Chile 2026. Contiene universo, segmentos y estadísticas agregadas; no expone el padrón individual de 557 empresas.'),
('LATAMFINTECH_CHILE','Latam Fintech Hub · Directorio Chile','ECOSYSTEM_DIRECTORY','SECTORIAL_OPEN','https://www.latamfintech.co/countries/chile','WEEKLY',true,'Directorio sectorial público para descubrimiento de actores y segmentos. No constituye prueba regulatoria ni jurídica; la identidad se valida con fuentes oficiales abiertas cuando sea posible.')
on conflict(source_code) do update set
 label=excluded.label,source_type=excluded.source_type,authority_level=excluded.authority_level,
 source_url=excluded.source_url,cadence=excluded.cadence,active=true,notes=excluded.notes,refreshed_at=now();

create table if not exists public.aml_fintech_reference_segment_snapshot(
 snapshot_key text not null,
 source_code text not null references public.aml_fintech_source_catalog(source_code),
 source_date date not null,
 segment_label text not null,
 count_2024 integer,
 count_2026 integer,
 source_url text,
 methodology_note text,
 metadata jsonb not null default '{}'::jsonb,
 ingested_at timestamptz not null default now(),
 primary key(snapshot_key,segment_label)
);
alter table public.aml_fintech_reference_segment_snapshot enable row level security;
revoke all on public.aml_fintech_reference_segment_snapshot from public,anon,authenticated;
create index if not exists aml_fintech_ref_segment_source_idx on public.aml_fintech_reference_segment_snapshot(source_code,source_date desc);

insert into public.aml_fintech_reference_segment_snapshot(snapshot_key,source_code,source_date,segment_label,count_2024,count_2026,source_url,methodology_note,metadata)
values
('FINNOVISTA_SEGMENTS_2026','FINTECHILE_MAP_JSON','2026-09-09','Enterprise Financial Management',62,69,'https://fintechile-web.vercel.app/data/mapa.json','Conteos publicados en la sección Finnovista del Mapa Fintech Chile 2026. Referencia agregada, no padrón individual.','{}'),
('FINNOVISTA_SEGMENTS_2026','FINTECHILE_MAP_JSON','2026-09-09','Payments & Remittances',55,66,'https://fintechile-web.vercel.app/data/mapa.json','Conteos publicados en la sección Finnovista del Mapa Fintech Chile 2026. Referencia agregada, no padrón individual.','{}'),
('FINNOVISTA_SEGMENTS_2026','FINTECHILE_MAP_JSON','2026-09-09','Technological Infrastructure for Banks & Fintechs',44,65,'https://fintechile-web.vercel.app/data/mapa.json','Conteos publicados en la sección Finnovista del Mapa Fintech Chile 2026. Referencia agregada, no padrón individual.','{}'),
('FINNOVISTA_SEGMENTS_2026','FINTECHILE_MAP_JSON','2026-09-09','Lending',44,50,'https://fintechile-web.vercel.app/data/mapa.json','Conteos publicados en la sección Finnovista del Mapa Fintech Chile 2026. Referencia agregada, no padrón individual.','{}'),
('FINNOVISTA_SEGMENTS_2026','FINTECHILE_MAP_JSON','2026-09-09','Proptech',37,35,'https://fintechile-web.vercel.app/data/mapa.json','Conteos publicados en la sección Finnovista del Mapa Fintech Chile 2026. Referencia agregada, no padrón individual.','{}'),
('FINNOVISTA_SEGMENTS_2026','FINTECHILE_MAP_JSON','2026-09-09','Insurtech',31,32,'https://fintechile-web.vercel.app/data/mapa.json','Conteos publicados en la sección Finnovista del Mapa Fintech Chile 2026. Referencia agregada, no padrón individual.','{}'),
('FINNOVISTA_SEGMENTS_2026','FINTECHILE_MAP_JSON','2026-09-09','Wealth Management',33,30,'https://fintechile-web.vercel.app/data/mapa.json','Conteos publicados en la sección Finnovista del Mapa Fintech Chile 2026. Referencia agregada, no padrón individual.','{}'),
('FINNOVISTA_SEGMENTS_2026','FINTECHILE_MAP_JSON','2026-09-09','Personal Financial Management',13,13,'https://fintechile-web.vercel.app/data/mapa.json','Conteos publicados en la sección Finnovista del Mapa Fintech Chile 2026. Referencia agregada, no padrón individual.','{}'),
('FINNOVISTA_SEGMENTS_2026','FINTECHILE_MAP_JSON','2026-09-09','Crypto',5,10,'https://fintechile-web.vercel.app/data/mapa.json','Conteos publicados en la sección Finnovista del Mapa Fintech Chile 2026. Referencia agregada, no padrón individual.','{}'),
('FINNOVISTA_SEGMENTS_2026','FINTECHILE_MAP_JSON','2026-09-09','Crowdfunding',13,10,'https://fintechile-web.vercel.app/data/mapa.json','Conteos publicados en la sección Finnovista del Mapa Fintech Chile 2026. Referencia agregada, no padrón individual.','{}'),
('FINNOVISTA_SEGMENTS_2026','FINTECHILE_MAP_JSON','2026-09-09','Open Finance',5,5,'https://fintechile-web.vercel.app/data/mapa.json','Conteos publicados en la sección Finnovista del Mapa Fintech Chile 2026. Referencia agregada, no padrón individual.','{}'),
('FINNOVISTA_SEGMENTS_2026','FINTECHILE_MAP_JSON','2026-09-09','Digital Banking',5,3,'https://fintechile-web.vercel.app/data/mapa.json','Conteos publicados en la sección Finnovista del Mapa Fintech Chile 2026. Referencia agregada, no padrón individual.','{}')
on conflict(snapshot_key,segment_label) do update set
 count_2024=excluded.count_2024,count_2026=excluded.count_2026,source_url=excluded.source_url,
 methodology_note=excluded.methodology_note,metadata=excluded.metadata,ingested_at=now();

create table if not exists public.aml_fintech_ecosystem_master(
 master_key text primary key,
 fintech_id text references public.aml_fintech_entity(fintech_id) on delete set null,
 candidate_cluster_key text,
 rut text,
 display_name text not null,
 legal_name text,
 website text,
 actor_class text not null check(actor_class in ('SECTOR_CONFIRMED','SECTOR_CANDIDATE','REGULATED_FINANCIAL_TECH','REGULATORY_CANDIDATE','ACTOR_CONFIRMED')),
 identity_status text not null,
 segment text,
 source_codes text[] not null default '{}'::text[],
 source_count integer not null default 0,
 sector_source_count integer not null default 0,
 regulatory_source_count integer not null default 0,
 evidence_confidence numeric(5,4),
 evidence_basis text,
 first_seen_at timestamptz not null default now(),
 last_seen_at timestamptz not null default now(),
 refreshed_at timestamptz not null default now()
);
alter table public.aml_fintech_ecosystem_master enable row level security;
revoke all on public.aml_fintech_ecosystem_master from public,anon,authenticated;
create index if not exists aml_fintech_master_class_idx on public.aml_fintech_ecosystem_master(actor_class,identity_status);
create index if not exists aml_fintech_master_rut_idx on public.aml_fintech_ecosystem_master(rut) where rut is not null;
create index if not exists aml_fintech_master_segment_idx on public.aml_fintech_ecosystem_master(segment) where segment is not null;
create index if not exists aml_fintech_master_fintech_idx on public.aml_fintech_ecosystem_master(fintech_id) where fintech_id is not null;

create or replace function public.aml_fintech_refresh_ecosystem_master()
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare v_entities integer:=0; v_candidates integer:=0;
begin
 delete from public.aml_fintech_ecosystem_master;

 insert into public.aml_fintech_ecosystem_master(
   master_key,fintech_id,rut,display_name,legal_name,website,actor_class,identity_status,segment,
   source_codes,source_count,sector_source_count,regulatory_source_count,evidence_confidence,evidence_basis,
   first_seen_at,last_seen_at,refreshed_at)
 select
   'ENTITY:'||e.fintech_id,e.fintech_id,e.rut,coalesce(nullif(e.brand,''),e.legal_name),e.legal_name,e.website,
   case
     when count(*) filter(where es.source_code in ('FINTECHILE_MEMBERS','LATAMFINTECH_CHILE'))>0 then 'SECTOR_CONFIRMED'
     when count(*) filter(where es.source_code like 'CMF_%' or es.source_code in ('UAF_PUBLIC','SII_PAYMENT_OPERATORS'))>0 then 'REGULATED_FINANCIAL_TECH'
     else 'ACTOR_CONFIRMED'
   end,
   e.identification_status,
   coalesce(e.primary_vertical,
     (array_agg(nullif(es.evidence->>'segment','') order by case when es.source_code='LATAMFINTECH_CHILE' then 0 else 1 end)
       filter(where nullif(es.evidence->>'segment','') is not null))[1]),
   coalesce(array_agg(distinct es.source_code) filter(where es.source_code is not null),'{}'::text[]),
   count(es.source_code)::int,
   count(*) filter(where es.source_code in ('FINTECHILE_MEMBERS','LATAMFINTECH_CHILE'))::int,
   count(*) filter(where es.source_code like 'CMF_%' or es.source_code in ('UAF_PUBLIC','SII_PAYMENT_OPERATORS'))::int,
   e.confidence,e.identification_basis,e.first_seen_at,e.last_seen_at,now()
 from public.aml_fintech_entity e
 left join public.aml_fintech_entity_source es on es.fintech_id=e.fintech_id
 group by e.fintech_id,e.rut,e.brand,e.legal_name,e.website,e.identification_status,e.primary_vertical,e.confidence,e.identification_basis,e.first_seen_at,e.last_seen_at;
 get diagnostics v_entities=row_count;

 with unresolved as (
   select c.*,
     case when c.normalized_rut is not null then 'RUT:'||c.normalized_rut else 'NAME:'||md5(c.normalized_name) end cluster_key,
     case when c.source_code in ('FINTECHILE_MEMBERS','LATAMFINTECH_CHILE') then 1 else 0 end is_sector,
     case when c.source_code like 'CMF_%' or c.source_code='SII_PAYMENT_OPERATORS' then 1 else 0 end is_regulatory
   from public.aml_fintech_candidate c
   where c.matched_fintech_id is null
 ), grouped as (
   select cluster_key,
     (array_agg(candidate_id order by is_sector desc,last_seen_at desc))[1] representative_candidate_id,
     max(rut_raw) filter(where rut_raw is not null) rut,
     (array_agg(name_raw order by is_sector desc,last_seen_at desc))[1] display_name,
     (array_agg(legal_name_source order by (legal_name_source is not null) desc,is_regulatory desc,last_seen_at desc)
       filter(where legal_name_source is not null))[1] legal_name,
     (array_agg(website order by (website is not null) desc,is_sector desc,last_seen_at desc)
       filter(where website is not null))[1] website,
     (array_agg(coalesce(nullif(vertical_hint,''),nullif(evidence->>'segment','')) order by is_sector desc,last_seen_at desc)
       filter(where coalesce(nullif(vertical_hint,''),nullif(evidence->>'segment','')) is not null))[1] segment,
     array_agg(distinct source_code) source_codes,
     count(distinct source_code)::int source_count,
     sum(is_sector)::int sector_source_count,
     sum(is_regulatory)::int regulatory_source_count,
     min(first_seen_at) first_seen_at,max(last_seen_at) last_seen_at
   from unresolved group by cluster_key
 )
 insert into public.aml_fintech_ecosystem_master(
   master_key,candidate_cluster_key,rut,display_name,legal_name,website,actor_class,identity_status,segment,
   source_codes,source_count,sector_source_count,regulatory_source_count,evidence_confidence,evidence_basis,
   first_seen_at,last_seen_at,refreshed_at)
 select
   'CANDIDATE:'||cluster_key,cluster_key,rut,display_name,legal_name,website,
   case when sector_source_count>0 then 'SECTOR_CANDIDATE' else 'REGULATORY_CANDIDATE' end,
   case when rut is not null then 'RUT_OBSERVED_UNRESOLVED' else 'BRAND_ONLY' end,
   segment,source_codes,source_count,sector_source_count,regulatory_source_count,
   case when sector_source_count>0 then 0.8500 else 0.6500 end,
   case when sector_source_count>0 then 'SECTOR_DIRECTORY_OPEN_IDENTITY_PENDING' else 'REGULATORY_SOURCE_ONLY_NOT_AUTOMATICALLY_FINTECH' end,
   first_seen_at,last_seen_at,now()
 from grouped;
 get diagnostics v_candidates=row_count;

 return jsonb_build_object('entities',v_entities,'candidate_clusters',v_candidates,'master_total',v_entities+v_candidates,'refreshed_at',now());
end;
$$;
revoke all on function public.aml_fintech_refresh_ecosystem_master() from public,anon,authenticated;
grant execute on function public.aml_fintech_refresh_ecosystem_master() to service_role;

create or replace function public.obs_fintech_master_status()
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare ok boolean; result jsonb; v_ref integer:=557;
begin
 select exists(select 1 from public.aml_allowed_users au where au.user_id=auth.uid() and au.enabled) into ok;
 if not ok then return jsonb_build_object('error','NOT_AUTHORIZED'); end if;
 select jsonb_build_object(
   'reference_universes',coalesce((select jsonb_agg(to_jsonb(u) order by u.source_date desc) from public.aml_fintech_universe_snapshot u),'[]'::jsonb),
   'reference_total',v_ref,
   'master_total',(select count(*) from public.aml_fintech_ecosystem_master),
   'sector_confirmed',(select count(*) from public.aml_fintech_ecosystem_master where actor_class='SECTOR_CONFIRMED'),
   'sector_candidates',(select count(*) from public.aml_fintech_ecosystem_master where actor_class='SECTOR_CANDIDATE'),
   'regulated_financial_tech',(select count(*) from public.aml_fintech_ecosystem_master where actor_class='REGULATED_FINANCIAL_TECH'),
   'regulatory_candidates',(select count(*) from public.aml_fintech_ecosystem_master where actor_class='REGULATORY_CANDIDATE'),
   'rut_resolved_sector',(select count(*) from public.aml_fintech_ecosystem_master where actor_class='SECTOR_CONFIRMED' and rut is not null),
   'sector_evidence_total',(select count(*) from public.aml_fintech_ecosystem_master where actor_class in ('SECTOR_CONFIRMED','SECTOR_CANDIDATE')),
   'confirmed_coverage_pct',round(100.0*(select count(*) from public.aml_fintech_ecosystem_master where actor_class='SECTOR_CONFIRMED')/v_ref,1),
   'indicative_sector_coverage_pct',round(100.0*least(v_ref,(select count(*) from public.aml_fintech_ecosystem_master where actor_class in ('SECTOR_CONFIRMED','SECTOR_CANDIDATE')))/v_ref,1),
   'unindividualized_gap',greatest(0,v_ref-(select count(*) from public.aml_fintech_ecosystem_master where actor_class in ('SECTOR_CONFIRMED','SECTOR_CANDIDATE'))),
   'segments_reference',coalesce((select jsonb_agg(to_jsonb(s) order by s.count_2026 desc,s.segment_label) from public.aml_fintech_reference_segment_snapshot s where s.snapshot_key='FINNOVISTA_SEGMENTS_2026'),'[]'::jsonb),
   'segments_observed',coalesce((select jsonb_agg(jsonb_build_object('segment',x.segment,'actors',x.actors) order by x.actors desc,x.segment) from (select coalesce(segment,'Sin clasificar') segment,count(*) actors from public.aml_fintech_ecosystem_master where actor_class in ('SECTOR_CONFIRMED','SECTOR_CANDIDATE') group by coalesce(segment,'Sin clasificar')) x),'[]'::jsonb),
   'method_note','Cobertura confirmada usa sólo actores sectoriales individualizados. La cobertura indicativa suma candidatos de directorios sectoriales abiertos. Registros CMF/SII sin evidencia sectorial se muestran aparte y no reducen la brecha de 557.',
   'refreshed_at',(select max(refreshed_at) from public.aml_fintech_ecosystem_master)
 ) into result;
 return result;
end;
$$;
revoke all on function public.obs_fintech_master_status() from public,anon;
grant execute on function public.obs_fintech_master_status() to authenticated,service_role;

create or replace function public.obs_fintech_master_search(p_q text default null,p_class text default null,p_segment text default null,p_limit integer default 100,p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,extensions,pg_temp
as $$
declare ok boolean; result jsonb;
begin
 select exists(select 1 from public.aml_allowed_users au where au.user_id=auth.uid() and au.enabled) into ok;
 if not ok then return jsonb_build_object('error','NOT_AUTHORIZED'); end if;
 select jsonb_build_object(
   'rows',coalesce(jsonb_agg(to_jsonb(x) order by x.actor_class,x.display_name),'[]'::jsonb),
   'limit',least(greatest(coalesce(p_limit,100),1),500),'offset',greatest(coalesce(p_offset,0),0)
 ) into result
 from (
   select * from public.aml_fintech_ecosystem_master m
   where (p_class is null or p_class='' or m.actor_class=p_class)
     and (p_segment is null or p_segment='' or m.segment=p_segment)
     and (p_q is null or btrim(p_q)='' or public.obs_normalize_text(m.display_name) like '%'||public.obs_normalize_text(p_q)||'%' or public.obs_normalize_text(coalesce(m.legal_name,'')) like '%'||public.obs_normalize_text(p_q)||'%' or public.aml_fintech_norm_rut(m.rut)=public.aml_fintech_norm_rut(p_q))
   order by m.actor_class,m.display_name
   limit least(greatest(coalesce(p_limit,100),1),500) offset greatest(coalesce(p_offset,0),0)
 ) x;
 return result;
end;
$$;
revoke all on function public.obs_fintech_master_search(text,text,text,integer,integer) from public,anon;
grant execute on function public.obs_fintech_master_search(text,text,text,integer,integer) to authenticated,service_role;

select public.aml_fintech_refresh_ecosystem_master();