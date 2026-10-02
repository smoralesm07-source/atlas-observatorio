-- Presupuesto Abierto: la promoción de un snapshot histórico completo reemplaza
-- atómicamente varios millones de filas. El timeout interactivo normal no es
-- apropiado para esa operación de mantenimiento y podía dejar el snapshot
-- completamente cargado en staging pero eternamente en estado LOADING.

alter function public.obs_public_funds_finalize(text)
  set statement_timeout to '10min';
