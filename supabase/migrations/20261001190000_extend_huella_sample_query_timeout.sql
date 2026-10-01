-- Huella publica · ampliar ventana de consulta para muestras pesadas.
-- El rol authenticated mantiene su timeout general conservador; solo este
-- contrato, que se ejecuta tras una accion explicita del analista, puede usar
-- hasta 45 segundos antes de ser cancelado.

alter function public.obs_state_sample_query(jsonb)
  set statement_timeout = '45s';

comment on function public.obs_state_sample_query(jsonb) is
  'Constructor de muestras de Huella publica. Ventana ampliada a 45s para cohortes pesadas solicitadas explicitamente por el analista.';
