create or replace function public.aml_fintech_apply_sector_candidate_metadata(p_source_code text)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare v_updated integer:=0;
begin
 if p_source_code not in ('LATAMFINTECH_CHILE','FINTECHILE_MEMBERS') then raise exception 'SOURCE_NOT_SECTOR_DIRECTORY'; end if;
 update public.aml_fintech_candidate c
 set website=coalesce(c.website,nullif(c.evidence->>'external_website','')),
     domain=coalesce(c.domain,public.aml_fintech_domain(nullif(c.evidence->>'external_website',''))),
     brand_hint=coalesce(nullif(c.brand_hint,''),c.name_raw),
     vertical_hint=coalesce(nullif(c.vertical_hint,''),nullif(c.evidence->>'segment','')),
     last_seen_at=now()
 where c.source_code=p_source_code;
 get diagnostics v_updated=row_count;
 return jsonb_build_object('source_code',p_source_code,'updated',v_updated,'refreshed_at',now());
end;
$$;

create or replace function public.aml_fintech_reconcile_sector_directory(p_source_code text)
returns jsonb
language plpgsql
security definer
set search_path=public,extensions,pg_temp
as $$
declare r record; v_domain integer:=0; v_name integer:=0;
begin
 if p_source_code not in ('LATAMFINTECH_CHILE','FINTECHILE_MEMBERS') then raise exception 'SOURCE_NOT_SECTOR_DIRECTORY'; end if;

 -- 1) Exact domain resolution against already-confirmed actor surfaces.
 for r in
   with sector as (
     select c.* from public.aml_fintech_candidate c
     where c.source_code=p_source_code and c.matched_fintech_id is null and c.domain is not null
   ), known as (
     select e.fintech_id,public.aml_fintech_domain(e.website) domain from public.aml_fintech_entity e where e.website is not null
     union all
     select c.matched_fintech_id,c.domain from public.aml_fintech_candidate c where c.matched_fintech_id is not null and c.domain is not null
     union all
     select a.fintech_id,a.domain from public.aml_fintech_actor_alias a where a.active and a.domain is not null
   ), matches as (
     select s.candidate_id,
       (array_agg(k.fintech_id order by k.fintech_id))[1] fintech_id,
       count(distinct k.fintech_id) nmatch
     from sector s join known k on lower(k.domain)=lower(s.domain)
     group by s.candidate_id
   )
   select s.*,m.fintech_id from sector s join matches m using(candidate_id) where m.nmatch=1
 loop
   update public.aml_fintech_candidate
   set candidate_status='MATCHED_EXISTING',matched_fintech_id=r.fintech_id,
       match_method='EXACT_DOMAIN_CROSS_SOURCE',match_score=0.9950,last_seen_at=now()
   where candidate_id=r.candidate_id;
   insert into public.aml_fintech_entity_source(fintech_id,source_code,source_entity_key,source_label,source_url,status,evidence,first_seen_at,last_seen_at)
   values(r.fintech_id,p_source_code,r.source_entity_key,r.name_raw,r.source_url,'OBSERVED',r.evidence,r.first_seen_at,now())
   on conflict(fintech_id,source_code) do update set source_entity_key=excluded.source_entity_key,source_label=excluded.source_label,
     source_url=excluded.source_url,status='OBSERVED',evidence=public.aml_fintech_entity_source.evidence||excluded.evidence,last_seen_at=now();
   update public.aml_fintech_entity e set primary_vertical=coalesce(e.primary_vertical,nullif(r.evidence->>'segment','')),last_seen_at=now(),refreshed_at=now() where e.fintech_id=r.fintech_id;
   v_domain:=v_domain+1;
 end loop;

 -- 2) Exact brand/name resolution against already-matched candidates.
 for r in
   with sector as (
     select c.* from public.aml_fintech_candidate c where c.source_code=p_source_code and c.matched_fintech_id is null
   ), matches as (
     select s.candidate_id,
       (array_agg(o.matched_fintech_id order by o.match_score desc nulls last,o.last_seen_at desc))[1] fintech_id,
       count(distinct o.matched_fintech_id) nmatch
     from sector s join public.aml_fintech_candidate o
       on o.matched_fintech_id is not null
      and (o.normalized_name=s.normalized_name or (nullif(public.obs_normalize_text(o.brand_hint),'') is not null and public.obs_normalize_text(o.brand_hint)=s.normalized_name))
     group by s.candidate_id
   )
   select s.*,m.fintech_id from sector s join matches m using(candidate_id) where m.nmatch=1 and m.fintech_id is not null
 loop
   update public.aml_fintech_candidate
   set candidate_status='MATCHED_EXISTING',matched_fintech_id=r.fintech_id,
       match_method='EXACT_SECTOR_NAME_CROSS_SOURCE',match_score=0.9700,last_seen_at=now()
   where candidate_id=r.candidate_id;
   insert into public.aml_fintech_entity_source(fintech_id,source_code,source_entity_key,source_label,source_url,status,evidence,first_seen_at,last_seen_at)
   values(r.fintech_id,p_source_code,r.source_entity_key,r.name_raw,r.source_url,'OBSERVED',r.evidence,r.first_seen_at,now())
   on conflict(fintech_id,source_code) do update set source_entity_key=excluded.source_entity_key,source_label=excluded.source_label,
     source_url=excluded.source_url,status='OBSERVED',evidence=public.aml_fintech_entity_source.evidence||excluded.evidence,last_seen_at=now();
   update public.aml_fintech_entity e set primary_vertical=coalesce(e.primary_vertical,nullif(r.evidence->>'segment','')),last_seen_at=now(),refreshed_at=now() where e.fintech_id=r.fintech_id;
   v_name:=v_name+1;
 end loop;

 perform public.aml_fintech_refresh_ecosystem_master();
 return jsonb_build_object('source_code',p_source_code,'domain_linked',v_domain,'name_linked',v_name,'total_linked',v_domain+v_name,'refreshed_at',now());
end;
$$;
revoke all on function public.aml_fintech_reconcile_sector_directory(text) from public,anon,authenticated;
grant execute on function public.aml_fintech_reconcile_sector_directory(text) to service_role;