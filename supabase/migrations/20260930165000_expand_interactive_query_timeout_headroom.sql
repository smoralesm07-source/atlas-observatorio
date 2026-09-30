-- Amplía el margen de espera de las consultas interactivas de Atlas.
--
-- El límite global previo para usuarios autenticados era de 8s, suficiente para
-- cortes calientes pero demasiado agresivo ante caché fría, concurrencia o
-- contratos que agregan varias fuentes. Eso hacía visible con demasiada
-- frecuencia el error 57014 aun cuando la consulta podía terminar pocos
-- segundos después.
--
-- 30s mantiene un límite explícito para proteger el servicio, pero evita cortar
-- prematuramente cálculos y lecturas legítimas en Territorio, Monitores,
-- Informes, Fuentes y las demás vistas que consumen contratos RPC.

alter role authenticated
  set statement_timeout = '30s';

-- La búsqueda federada de entidades ya tenía un override propio de 20s. Si no
-- se actualiza explícitamente, ese valor seguiría prevaleciendo sobre el nuevo
-- margen global. El guard de búsquedas demasiado amplias permanece intacto.
alter function public.atlas_v2_entity_search_cascade(jsonb)
  set statement_timeout = '30s';

comment on function public.atlas_v2_entity_search_cascade(jsonb) is
'ATLAS v2 entity search cascade with broad-query guard and 30s interactive timeout headroom. Generic corporate terms alone are rejected before fan-out across SII/RES; specific names and RUT continue through the full cascade. Match percentage is query similarity, not probability of identity.';
