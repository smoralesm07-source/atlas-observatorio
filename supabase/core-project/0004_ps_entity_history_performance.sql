-- ATLAS core · performance para consulta histórica de Mercado Público
--
-- La búsqueda por RUT tolera puntos, guion y mayúscula/minúscula en K. Sin un
-- índice sobre la misma expresión, supplier_year (cientos de miles de filas)
-- cae en sequential scan. Este índice mantiene el contrato interactivo incluso
-- cuando se complete 2007→actualidad.

create index if not exists supplier_year_rut_norm_year_idx
on provider_analyzer.supplier_year (
  upper(regexp_replace(supplier_id,'[^0-9Kk]','','g')),
  year desc
);

-- El índice equivalente ya fue verificado sobre el core: una consulta histórica
-- de 2020→2026 bajó de ~4,2 s (parallel seq scan) a ~6 ms (index scan) para un
-- proveedor con actividad en seis años.
