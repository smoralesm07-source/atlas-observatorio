-- ATLAS core · restaura el acceso del puente servidor-a-servidor.
--
-- Estos RPC son SECURITY DEFINER y validan obs_bridge_token antes de leer datos.
-- El rol anon sólo permite que PostgREST invoque la función con la clave pública;
-- sin el token privado del puente ambas funciones responden UNAUTHORIZED.

grant execute on function public.ps_export_for_observatory(text,text,integer,integer)
  to anon;

grant execute on function public.ps_entity_query_for_observatory(text,text,text,text,integer,integer,integer,integer)
  to anon;
