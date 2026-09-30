-- The cross-project bridge reaches PostgREST with the project's public API key,
-- but the export RPC still requires the separate private p_token and validates
-- it before touching ps_* data. This grants only RPC entry, never table access.

grant execute on function public.ps_export_for_observatory(text,text,integer,integer)
  to anon, service_role;
