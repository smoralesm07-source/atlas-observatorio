-- Cierra superficies RPC del nuevo archivo de prensa.

create or replace function public.atlas_press_status()
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
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
    'last_successful_ingest',(select max(completed_at) from public.atlas_press_ingest_run where status='READY')
  );
$$;

revoke all on function public.atlas_press_status() from public, anon;
grant execute on function public.atlas_press_status() to authenticated;

-- Callback de trigger: no debe ser invocable por la API.
revoke all on function public.atlas_press_on_snapshot_ready() from public, anon, authenticated;
