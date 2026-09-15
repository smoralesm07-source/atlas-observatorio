revoke execute on function public.atlas_v2_sanctions_query(jsonb) from public;
revoke execute on function public.atlas_v2_sanctions_query(jsonb) from anon;
grant execute on function public.atlas_v2_sanctions_query(jsonb) to authenticated, service_role;
