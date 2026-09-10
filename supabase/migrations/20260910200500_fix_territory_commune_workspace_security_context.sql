-- Fix authenticated reads for the territorial commune workspace.
-- These RPCs aggregate protected observatory sources. Running as invoker made
-- authenticated sessions either fail on protected fintech sources or see zero
-- rows through RLS. Keep the RPC surface restricted to authenticated users and
-- execute with the postgres owner under an explicit safe search_path.

alter function public.obs_territory_commune_context_v2(text) security definer;
alter function public.obs_territory_entity_directory_v2(text,text,text,text,text,integer,integer) security definer;
alter function public.obs_territory_potential_directory_v2(text,text,text,text,integer,integer) security definer;

revoke all on function public.obs_territory_commune_context_v2(text) from public, anon;
revoke all on function public.obs_territory_entity_directory_v2(text,text,text,text,text,integer,integer) from public, anon;
revoke all on function public.obs_territory_potential_directory_v2(text,text,text,text,integer,integer) from public, anon;

grant execute on function public.obs_territory_commune_context_v2(text) to authenticated, service_role;
grant execute on function public.obs_territory_entity_directory_v2(text,text,text,text,text,integer,integer) to authenticated, service_role;
grant execute on function public.obs_territory_potential_directory_v2(text,text,text,text,integer,integer) to authenticated, service_role;
