-- Restaura la lectura de Pulso para usuarios autenticados.
--
-- obs_uaf_pulse() consulta la vista materializada de coincidencias de prensa.
-- La vista fue creada/refrescada sin conservar un GRANT SELECT explícito para
-- authenticated, por lo que PostgREST devolvía 42501/403 y Pulso no cargaba.
--
-- Este permiso es sólo de lectura sobre un read model ya utilizado por el
-- contrato obs_uaf_pulse(); no amplía permisos de escritura ni acceso anónimo.

grant select on table public.obs_uaf_press_match_90d_cache to authenticated;
