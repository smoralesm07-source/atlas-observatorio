-- Huella pública: el agregado comprador-proveedor mensual se reconstruye desde
-- aml_mp_order_fact. En meses voluminosos, el timeout anterior dejaba el hecho
-- cargado pero el agregado en ERROR, generando falsa cobertura parcial.
--
-- La función sigue trabajando por mes; sólo ampliamos su ventana de ejecución
-- para que el refresh determinístico pueda terminar sin recorrer períodos extra.

alter function public.refresh_aml_mp_buyer_supplier_month(date,date)
  set statement_timeout to '60s';
