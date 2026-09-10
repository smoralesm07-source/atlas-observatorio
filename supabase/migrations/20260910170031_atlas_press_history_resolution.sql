-- ATLAS Observatorio · archivo histórico y resolución propia de prensa
-- El Monitor de Prensa conserva su lógica de frescura. ATLAS sólo consume su
-- puente y mantiene, de forma separada, un archivo acumulativo de lo observado.

create table if not exists public.atlas_press_article_history (
  article_id text primary key,
  article_date date,
  title text not null,
  media text,
  url text,
  summary text,
  region text,
  commune text,
  search_terms text[] not null default '{}'::text[],
  raw jsonb not null default '{}'::jsonb,
  bridge_generated_at timestamptz,
  first_ingested_at timestamptz not null default now(),
  last_seen_in_feed_at timestamptz not null default now()
);

create table if not exists public.atlas_press_entity_history (
  press_entity_id text primary key,
  name text not null,
  normalized_name text,
  entity_type text,
  nature text,
  ruts text[] not null default '{}'::text[],
  aliases text[] not null default '{}'::text[],
  source_first_seen date,
  source_last_seen date,
  article_count integer not null default 0,
  mention_count integer not null default 0,
  media text[] not null default '{}'::text[],
  roles text[] not null default '{}'::text[],
  source_identity_confidence numeric,
  requires_validation boolean not null default true,
  resolution_status text,
  source text,
  raw jsonb not null default '{}'::jsonb,
  bridge_generated_at timestamptz,
  first_ingested_at timestamptz not null default now(),
  last_seen_in_feed_at timestamptz not null default now()
);

create table if not exists public.atlas_press_mention_history (
  mention_id text primary key,
  press_entity_id text not null,
  article_id text not null,
  role text,
  roles text[] not null default '{}'::text[],
  mentions integer not null default 1,
  confidence numeric,
  requires_validation boolean not null default true,
  raw jsonb not null default '{}'::jsonb,
  bridge_generated_at timestamptz,
  first_ingested_at timestamptz not null default now(),
  last_seen_in_feed_at timestamptz not null default now()
);

create table if not exists public.atlas_press_entity_alias (
  alias_normalized text not null,
  canonical_entity_id text not null,
  canonical_rut text,
  relationship_type text not null default 'DIRECT',
  note text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (alias_normalized, canonical_entity_id, relationship_type),
  constraint atlas_press_entity_alias_relationship_ck
    check (relationship_type in ('DIRECT','GROUP_CONTEXT'))
);

create table if not exists public.atlas_press_entity_link (
  press_entity_id text not null,
  canonical_entity_id text not null,
  canonical_rut text,
  link_status text not null,
  match_method text not null,
  score numeric,
  confidence_band text,
  resolution_state text,
  requires_review boolean not null default true,
  ambiguous boolean not null default false,
  evidence jsonb not null default '{}'::jsonb,
  is_manual boolean not null default false,
  first_linked_at timestamptz not null default now(),
  refreshed_at timestamptz not null default now(),
  primary key (press_entity_id, canonical_entity_id),
  constraint atlas_press_entity_link_status_ck
    check (link_status in ('RESOLVED','PROBABLE','CONTEXT','REJECTED'))
);

create table if not exists public.atlas_press_ingest_run (
  run_id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null,
  bridge_generated_at timestamptz,
  article_count integer not null default 0,
  entity_count integer not null default 0,
  mention_count integer not null default 0,
  resolved_link_count integer,
  applied_evidence_count integer,
  error_detail text,
  constraint atlas_press_ingest_run_status_ck check (status in ('RUNNING','READY','FAILED'))
);

create index if not exists atlas_press_article_history_date_idx
  on public.atlas_press_article_history (article_date desc nulls last);
create index if not exists atlas_press_entity_history_name_idx
  on public.atlas_press_entity_history (normalized_name);
create index if not exists atlas_press_mention_entity_idx
  on public.atlas_press_mention_history (press_entity_id);
create index if not exists atlas_press_mention_article_idx
  on public.atlas_press_mention_history (article_id);
create index if not exists atlas_press_link_canonical_idx
  on public.atlas_press_entity_link (canonical_entity_id, link_status);
create index if not exists atlas_press_link_status_idx
  on public.atlas_press_entity_link (link_status, score desc nulls last);

create or replace function public.atlas_press_preserve_first_ingested()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.first_ingested_at := old.first_ingested_at;
  return new;
end;
$$;

drop trigger if exists atlas_press_article_keep_first on public.atlas_press_article_history;
create trigger atlas_press_article_keep_first before update on public.atlas_press_article_history
for each row execute function public.atlas_press_preserve_first_ingested();
drop trigger if exists atlas_press_entity_keep_first on public.atlas_press_entity_history;
create trigger atlas_press_entity_keep_first before update on public.atlas_press_entity_history
for each row execute function public.atlas_press_preserve_first_ingested();
drop trigger if exists atlas_press_mention_keep_first on public.atlas_press_mention_history;
create trigger atlas_press_mention_keep_first before update on public.atlas_press_mention_history
for each row execute function public.atlas_press_preserve_first_ingested();

-- Semilla del material de prensa que ATLAS ya tenía antes del archivo persistente.
insert into public.atlas_press_entity_history (
  press_entity_id, name, normalized_name, entity_type, nature, ruts, aliases,
  source_first_seen, source_last_seen, article_count, mention_count, media, roles,
  source_identity_confidence, requires_validation, resolution_status, source,
  raw, bridge_generated_at, last_seen_in_feed_at
)
select
  e.entity_id,
  coalesce(nullif(btrim(e.name),''), e.entity_id),
  public.obs_normalize_text(coalesce(nullif(btrim(e.name),''), e.entity_id)),
  nullif(e.profile->>'tipo_entidad',''), null,
  case when nullif(btrim(e.rut),'') is null then '{}'::text[] else array[e.rut] end,
  '{}'::text[],
  (select min(case when coalesce(ev->>'fecha','') ~ '^\d{4}-\d{2}-\d{2}' then left(ev->>'fecha',10)::date end)
     from jsonb_array_elements(coalesce(e.profile->'eventos','[]'::jsonb)) ev where ev->>'productor'='RADAR_PRENSA'),
  (select max(case when coalesce(ev->>'fecha','') ~ '^\d{4}-\d{2}-\d{2}' then left(ev->>'fecha',10)::date end)
     from jsonb_array_elements(coalesce(e.profile->'eventos','[]'::jsonb)) ev where ev->>'productor'='RADAR_PRENSA'),
  coalesce(case when coalesce(e.profile->>'event_count','') ~ '^\d+$' then (e.profile->>'event_count')::integer end,
           jsonb_array_length(coalesce(e.profile->'eventos','[]'::jsonb))),
  jsonb_array_length(coalesce(e.profile->'eventos','[]'::jsonb)),
  '{}'::text[],
  coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(e.profile->'roles','[]'::jsonb)) x), '{}'::text[]),
  case when coalesce(e.profile->>'identity_confidence','') ~ '^\d+(\.\d+)?$' then (e.profile->>'identity_confidence')::numeric end,
  coalesce((e.profile->>'identity_confidence')::numeric,0) < 0.95,
  'LEGACY_ATLAS','RADAR_PRENSA',e.profile,null,now()
from public.aml_entities e
where e.entity_id like 'entity:press:%' or coalesce(e.profile->'fuentes','[]'::jsonb) ? 'RADAR_PRENSA'
on conflict (press_entity_id) do update set
  name=excluded.name, normalized_name=excluded.normalized_name, entity_type=excluded.entity_type,
  ruts=excluded.ruts, roles=excluded.roles, source_identity_confidence=excluded.source_identity_confidence,
  raw=excluded.raw, last_seen_in_feed_at=excluded.last_seen_in_feed_at;

with legacy_events as (
  select e.entity_id as press_entity_id, ev,
    case when coalesce(ev->>'titulo','') like 'document:press:%' then ev->>'titulo'
         else coalesce(nullif(ev->>'document_id',''),nullif(ev->>'titulo',''),nullif(ev->>'event_id','')) end as article_id,
    case when coalesce(ev->>'fecha','') ~ '^\d{4}-\d{2}-\d{2}' then left(ev->>'fecha',10)::date end as article_date
  from public.aml_entities e
  cross join lateral jsonb_array_elements(coalesce(e.profile->'eventos','[]'::jsonb)) ev
  where (e.entity_id like 'entity:press:%' or coalesce(e.profile->'fuentes','[]'::jsonb) ? 'RADAR_PRENSA')
    and ev->>'productor'='RADAR_PRENSA'
)
insert into public.atlas_press_article_history (article_id,article_date,title,media,summary,raw,last_seen_in_feed_at)
select distinct on (article_id) article_id,article_date,
  case when article_id like 'document:press:%' then 'Registro histórico de prensa'
       else coalesce(nullif(btrim(ev->>'titulo'),''),'Registro histórico de prensa') end,
  'Prensa · legado ATLAS',
  'Registro preservado desde la materialización previa de ATLAS; el puente del Monitor puede completar sus metadatos.',
  ev,now()
from legacy_events where article_id is not null
order by article_id,article_date desc nulls last
on conflict (article_id) do nothing;

with legacy_events as (
  select e.entity_id as press_entity_id, ev,
    case when coalesce(ev->>'titulo','') like 'document:press:%' then ev->>'titulo'
         else coalesce(nullif(ev->>'document_id',''),nullif(ev->>'titulo',''),nullif(ev->>'event_id','')) end as article_id
  from public.aml_entities e
  cross join lateral jsonb_array_elements(coalesce(e.profile->'eventos','[]'::jsonb)) ev
  where (e.entity_id like 'entity:press:%' or coalesce(e.profile->'fuentes','[]'::jsonb) ? 'RADAR_PRENSA')
    and ev->>'productor'='RADAR_PRENSA'
)
insert into public.atlas_press_mention_history (
  mention_id,press_entity_id,article_id,role,mentions,confidence,requires_validation,raw,last_seen_in_feed_at
)
select 'legacy:'||md5(press_entity_id||'|'||article_id),press_entity_id,article_id,null,1,null,true,ev,now()
from legacy_events where article_id is not null
on conflict (mention_id) do nothing;

create or replace function public.atlas_press_reconcile()
returns integer
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare v_resolved integer;
begin
  insert into public.atlas_press_entity_link (
    press_entity_id,canonical_entity_id,canonical_rut,link_status,match_method,score,confidence_band,resolution_state,
    requires_review,ambiguous,evidence,is_manual,refreshed_at
  )
  select distinct pe.press_entity_id,u.entity_id,u.rut,'RESOLVED','RUT_EXACT',100,'AUTORITATIVA','RUT_EXACT',false,false,
    jsonb_build_object('rut_fuente',r.rut,'regla','RUT explícito del índice de prensa'),false,now()
  from public.atlas_press_entity_history pe
  cross join lateral unnest(pe.ruts) r(rut)
  join public.obs_uaf_subject u on u.rut_search=nullif(regexp_replace(upper(coalesce(r.rut,'')),'[^0-9K]','','g'),'')
  where nullif(btrim(r.rut),'') is not null
  on conflict (press_entity_id,canonical_entity_id) do update set
    canonical_rut=excluded.canonical_rut,link_status='RESOLVED',match_method='RUT_EXACT',score=100,
    confidence_band=excluded.confidence_band,resolution_state=excluded.resolution_state,
    requires_review=false,ambiguous=false,evidence=excluded.evidence,refreshed_at=now();

  insert into public.atlas_press_entity_link (
    press_entity_id,canonical_entity_id,canonical_rut,link_status,match_method,score,confidence_band,resolution_state,
    requires_review,ambiguous,evidence,is_manual,refreshed_at
  )
  select distinct pe.press_entity_id,a.canonical_entity_id,a.canonical_rut,
    case when a.relationship_type='DIRECT' then 'RESOLVED' else 'CONTEXT' end,
    case when a.relationship_type='DIRECT' then 'CURATED_ALIAS' else 'GROUP_ALIAS' end,
    case when a.relationship_type='DIRECT' then 100 else 70 end,'CURADA',a.relationship_type,
    a.relationship_type<>'DIRECT',false,jsonb_build_object('alias',a.alias_normalized,'nota',a.note),true,now()
  from public.atlas_press_entity_history pe
  join public.atlas_press_entity_alias a on a.active and (
    a.alias_normalized=coalesce(pe.normalized_name,public.obs_normalize_text(pe.name))
    or exists (select 1 from unnest(pe.aliases) pa(alias_name) where public.obs_normalize_text(pa.alias_name)=a.alias_normalized)
  )
  join public.obs_uaf_subject u on u.entity_id=a.canonical_entity_id
  on conflict (press_entity_id,canonical_entity_id) do update set
    canonical_rut=excluded.canonical_rut,link_status=excluded.link_status,match_method=excluded.match_method,
    score=excluded.score,confidence_band=excluded.confidence_band,resolution_state=excluded.resolution_state,
    requires_review=excluded.requires_review,ambiguous=false,evidence=excluded.evidence,is_manual=true,refreshed_at=now();

  insert into public.atlas_press_entity_link (
    press_entity_id,canonical_entity_id,canonical_rut,link_status,match_method,score,confidence_band,resolution_state,
    requires_review,ambiguous,evidence,is_manual,refreshed_at
  )
  select v.observed_entity_id,v.canonical_entity_id,v.canonical_rut,'RESOLVED','IDENTITY_RESOLUTION_STRICT',v.score,
    v.confidence_band,v.resolution_state,coalesce(v.requires_review,true),coalesce(v.ambiguous,false),
    v.evidence||jsonb_build_object('regla_atlas','exact_resolution_key + score>=95 + no_ambiguous + multi_token'),false,now()
  from public.aml_v_entity_resolution_top_v1 v
  join public.atlas_press_entity_history pe on pe.press_entity_id=v.observed_entity_id
  join public.obs_uaf_subject u on u.entity_id=v.canonical_entity_id
  where v.score>=95 and v.confidence_band='MUY_ALTA' and v.resolution_state='PROBABLE_MISMA_ENTIDAD'
    and coalesce(v.ambiguous,false)=false
    and coalesce((v.evidence->>'exact_resolution_key')::boolean,false)=true
    and array_length(regexp_split_to_array(public.obs_normalize_text(v.observed_name),'\s+'),1)>=2
  on conflict (press_entity_id,canonical_entity_id) do update set
    canonical_rut=excluded.canonical_rut,
    link_status=case when public.atlas_press_entity_link.match_method='RUT_EXACT' or public.atlas_press_entity_link.is_manual then public.atlas_press_entity_link.link_status else excluded.link_status end,
    match_method=case when public.atlas_press_entity_link.match_method='RUT_EXACT' or public.atlas_press_entity_link.is_manual then public.atlas_press_entity_link.match_method else excluded.match_method end,
    score=greatest(coalesce(public.atlas_press_entity_link.score,0),coalesce(excluded.score,0)),
    confidence_band=case when public.atlas_press_entity_link.match_method='RUT_EXACT' then public.atlas_press_entity_link.confidence_band else excluded.confidence_band end,
    resolution_state=case when public.atlas_press_entity_link.match_method='RUT_EXACT' then public.atlas_press_entity_link.resolution_state else excluded.resolution_state end,
    requires_review=case when public.atlas_press_entity_link.match_method='RUT_EXACT' then false else excluded.requires_review end,
    ambiguous=case when public.atlas_press_entity_link.match_method='RUT_EXACT' then false else excluded.ambiguous end,
    evidence=case when public.atlas_press_entity_link.match_method='RUT_EXACT' then public.atlas_press_entity_link.evidence else excluded.evidence end,
    refreshed_at=now();

  insert into public.atlas_press_entity_link (
    press_entity_id,canonical_entity_id,canonical_rut,link_status,match_method,score,confidence_band,resolution_state,
    requires_review,ambiguous,evidence,is_manual,refreshed_at
  )
  select v.observed_entity_id,v.canonical_entity_id,v.canonical_rut,'PROBABLE','IDENTITY_RESOLUTION_REVIEW',v.score,
    v.confidence_band,v.resolution_state,true,coalesce(v.ambiguous,false),
    v.evidence||jsonb_build_object('regla_atlas','candidato no promovido; requiere revisión'),false,now()
  from public.aml_v_entity_resolution_top_v1 v
  join public.atlas_press_entity_history pe on pe.press_entity_id=v.observed_entity_id
  join public.obs_uaf_subject u on u.entity_id=v.canonical_entity_id
  where v.score>=55
  on conflict (press_entity_id,canonical_entity_id) do nothing;

  select count(*) into v_resolved from public.atlas_press_entity_link where link_status='RESOLVED';
  return v_resolved;
end;
$$;

create or replace function public.atlas_press_apply_obs(p_snapshot_id text default null)
returns integer
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare v_snapshot text; v_n integer;
begin
  v_snapshot:=coalesce(p_snapshot_id,
    (select snapshot_id from public.obs_snapshot where status='READY' order by generated_at desc limit 1),
    (select snapshot_id from public.obs_snapshot order by generated_at desc limit 1));
  if v_snapshot is null then return 0; end if;

  delete from public.obs_uaf_evidence where kind='PRENSA';
  update public.obs_uaf_subject set press_evidence_count=0,has_press=false;

  insert into public.obs_uaf_evidence (
    evidence_id,rut,kind,event_date,source_label,headline,summary,document_url,has_link,identity_status,snapshot_id,refreshed_at
  )
  select distinct on (u.rut,a.article_id)
    'prensa:'||md5(u.rut||'|'||a.article_id),u.rut,'PRENSA',a.article_date,
    coalesce(nullif(btrim(a.media),''),'Prensa'),nullif(btrim(a.title),''),nullif(btrim(a.summary),''),
    nullif(btrim(a.url),''),nullif(btrim(a.url),'') is not null,
    concat('RESOLVED:',l.match_method,case when l.requires_review then ':TRACE_REVIEW' else '' end),v_snapshot,now()
  from public.atlas_press_entity_link l
  join public.obs_uaf_subject u on u.entity_id=l.canonical_entity_id
  join public.atlas_press_mention_history m on m.press_entity_id=l.press_entity_id
  join public.atlas_press_article_history a on a.article_id=m.article_id
  where l.link_status='RESOLVED'
  order by u.rut,a.article_id,coalesce(l.score,0) desc,l.match_method;
  get diagnostics v_n=row_count;

  update public.obs_uaf_subject u set press_evidence_count=x.cnt,has_press=x.cnt>0
  from (select rut,count(*)::integer cnt from public.obs_uaf_evidence where kind='PRENSA' group by rut) x
  where x.rut=u.rut;
  return v_n;
end;
$$;

create or replace function public.atlas_press_on_snapshot_ready()
returns trigger language plpgsql security definer
set search_path=public,extensions,pg_temp
as $$
begin
  if new.status='READY' then
    if tg_op='INSERT' then perform public.atlas_press_apply_obs(new.snapshot_id);
    elsif old.status is distinct from new.status then perform public.atlas_press_apply_obs(new.snapshot_id);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists atlas_press_snapshot_ready on public.obs_snapshot;
create trigger atlas_press_snapshot_ready after insert or update of status on public.obs_snapshot
for each row execute function public.atlas_press_on_snapshot_ready();

create or replace view public.atlas_v_press_review_queue with (security_invoker=true) as
select l.press_entity_id,pe.name as observed_name,l.canonical_entity_id,u.rut as canonical_rut,u.name as canonical_name,u.uaf_sector,
  l.link_status,l.match_method,l.score,l.confidence_band,l.resolution_state,l.ambiguous,l.requires_review,
  pe.article_count as source_article_count,
  (select count(*) from public.atlas_press_mention_history m where m.press_entity_id=l.press_entity_id) as archived_mentions,
  l.evidence,l.refreshed_at
from public.atlas_press_entity_link l
join public.atlas_press_entity_history pe using(press_entity_id)
left join public.obs_uaf_subject u on u.entity_id=l.canonical_entity_id
where l.link_status in ('PROBABLE','CONTEXT');

create or replace function public.atlas_press_status()
returns jsonb language sql stable security definer
set search_path=public,pg_temp
as $$
select jsonb_build_object(
  'contract','ATLAS_PRESS_ARCHIVE_V1',
  'articles',(select count(*) from public.atlas_press_article_history),
  'press_entities',(select count(*) from public.atlas_press_entity_history),
  'mentions',(select count(*) from public.atlas_press_mention_history),
  'resolved_links',(select count(*) from public.atlas_press_entity_link where link_status='RESOLVED'),
  'probable_links',(select count(*) from public.atlas_press_entity_link where link_status='PROBABLE'),
  'context_links',(select count(*) from public.atlas_press_entity_link where link_status='CONTEXT'),
  'uaf_subjects_with_press',(select count(*) from public.obs_uaf_subject where press_evidence_count>0),
  'press_evidence',(select count(*) from public.obs_uaf_evidence where kind='PRENSA'),
  'latest_bridge_generated_at',(select max(bridge_generated_at) from public.atlas_press_article_history),
  'last_successful_ingest',(select max(completed_at) from public.atlas_press_ingest_run where status='READY'));
$$;

alter table public.atlas_press_article_history enable row level security;
alter table public.atlas_press_entity_history enable row level security;
alter table public.atlas_press_mention_history enable row level security;
alter table public.atlas_press_entity_alias enable row level security;
alter table public.atlas_press_entity_link enable row level security;
alter table public.atlas_press_ingest_run enable row level security;

drop policy if exists atlas_press_article_allowed_read on public.atlas_press_article_history;
create policy atlas_press_article_allowed_read on public.atlas_press_article_history for select to authenticated
using (exists(select 1 from public.aml_allowed_users au where au.user_id=(select auth.uid()) and au.enabled));
drop policy if exists atlas_press_entity_allowed_read on public.atlas_press_entity_history;
create policy atlas_press_entity_allowed_read on public.atlas_press_entity_history for select to authenticated
using (exists(select 1 from public.aml_allowed_users au where au.user_id=(select auth.uid()) and au.enabled));
drop policy if exists atlas_press_mention_allowed_read on public.atlas_press_mention_history;
create policy atlas_press_mention_allowed_read on public.atlas_press_mention_history for select to authenticated
using (exists(select 1 from public.aml_allowed_users au where au.user_id=(select auth.uid()) and au.enabled));
drop policy if exists atlas_press_alias_allowed_read on public.atlas_press_entity_alias;
create policy atlas_press_alias_allowed_read on public.atlas_press_entity_alias for select to authenticated
using (exists(select 1 from public.aml_allowed_users au where au.user_id=(select auth.uid()) and au.enabled));
drop policy if exists atlas_press_link_allowed_read on public.atlas_press_entity_link;
create policy atlas_press_link_allowed_read on public.atlas_press_entity_link for select to authenticated
using (exists(select 1 from public.aml_allowed_users au where au.user_id=(select auth.uid()) and au.enabled));
drop policy if exists atlas_press_run_allowed_read on public.atlas_press_ingest_run;
create policy atlas_press_run_allowed_read on public.atlas_press_ingest_run for select to authenticated
using (exists(select 1 from public.aml_allowed_users au where au.user_id=(select auth.uid()) and au.enabled));

grant select on public.atlas_press_article_history,public.atlas_press_entity_history,public.atlas_press_mention_history,
  public.atlas_press_entity_alias,public.atlas_press_entity_link,public.atlas_press_ingest_run,public.atlas_v_press_review_queue to authenticated;
grant execute on function public.atlas_press_status() to authenticated;
revoke all on function public.atlas_press_reconcile() from public,anon,authenticated;
revoke all on function public.atlas_press_apply_obs(text) from public,anon,authenticated;
grant execute on function public.atlas_press_reconcile() to service_role;
grant execute on function public.atlas_press_apply_obs(text) to service_role;

select public.atlas_press_reconcile();
select public.atlas_press_apply_obs(null);
