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
 set brand_hint=coalesce(nullif(c.brand_hint,''),c.name_raw),
     vertical_hint=coalesce(nullif(c.vertical_hint,''),nullif(c.evidence->>'segment','')),
     last_seen_at=now()
 where c.source_code=p_source_code;
 get diagnostics v_updated=row_count;
 return jsonb_build_object('source_code',p_source_code,'updated',v_updated,'refreshed_at',now());
end;
$$;
revoke all on function public.aml_fintech_apply_sector_candidate_metadata(text) from public,anon,authenticated;
grant execute on function public.aml_fintech_apply_sector_candidate_metadata(text) to service_role;

create or replace function public.aml_fintech_reconcile_sector_directory(p_source_code text)
returns jsonb
language plpgsql
security definer
set search_path=public,extensions,pg_temp
as $$
declare r record; v_linked integer:=0; v_rows integer:=0;
begin
 if p_source_code not in ('LATAMFINTECH_CHILE','FINTECHILE_MEMBERS') then raise exception 'SOURCE_NOT_SECTOR_DIRECTORY'; end if;

 for r in
   with sector as (
     select c.* from public.aml_fintech_candidate c
     where c.source_code=p_source_code and c.matched_fintech_id is null
   ), official_match as (
     select s.candidate_id,
            (array_agg(o.matched_fintech_id order by o.match_score desc nulls last,o.last_seen_at desc))[1] fintech_id,
            count(distinct o.matched_fintech_id) unique_entities
     from sector s
     join public.aml_fintech_candidate o
       on o.matched_fintech_id is not null
      and o.matched_fintech_id is not null
      and (
        o.normalized_name=s.normalized_name
        or (nullif(public.obs_normalize_text(o.brand_hint),'') is not null and public.obs_normalize_text(o.brand_hint)=s.normalized_name)
      )
     group by s.candidate_id
   )
   select s.*,m.fintech_id
   from sector s join official_match m using(candidate_id)
   where m.unique_entities=1 and m.fintech_id is not null
 loop
   update public.aml_fintech_candidate
   set candidate_status='MATCHED_EXISTING',matched_fintech_id=r.fintech_id,
       match_method='EXACT_SECTOR_NAME_CROSS_SOURCE',match_score=0.9700,last_seen_at=now()
   where candidate_id=r.candidate_id;

   insert into public.aml_fintech_entity_source(fintech_id,source_code,source_entity_key,source_label,source_url,status,evidence,first_seen_at,last_seen_at)
   values(r.fintech_id,p_source_code,r.source_entity_key,r.name_raw,r.source_url,'OBSERVED',r.evidence,r.first_seen_at,now())
   on conflict(fintech_id,source_code) do update set
     source_entity_key=excluded.source_entity_key,source_label=excluded.source_label,
     source_url=excluded.source_url,status='OBSERVED',evidence=public.aml_fintech_entity_source.evidence||excluded.evidence,last_seen_at=now();

   update public.aml_fintech_entity e
   set primary_vertical=coalesce(e.primary_vertical,nullif(r.evidence->>'segment','')),
       last_seen_at=now(),refreshed_at=now()
   where e.fintech_id=r.fintech_id;
   v_linked:=v_linked+1;
 end loop;

 perform public.aml_fintech_refresh_ecosystem_master();
 return jsonb_build_object('source_code',p_source_code,'cross_source_linked',v_linked,'refreshed_at',now());
end;
$$;
revoke all on function public.aml_fintech_reconcile_sector_directory(text) from public,anon,authenticated;
grant execute on function public.aml_fintech_reconcile_sector_directory(text) to service_role;