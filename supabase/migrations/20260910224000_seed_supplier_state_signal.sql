-- Reconstituye la señal mínima de proveedor del Estado a partir del corte ya
-- disponible en el Observatorio. No publica montos, recuentos ni métricas del
-- antiguo módulo de Gasto público.

insert into public.obs_entity_source (
  entity_id, source_code, status, record_count, last_event_at, detail
)
select
  a.entity_id,
  'MERCADO_PUBLICO',
  'PRESENT',
  null,
  max(a.last_seen)::timestamptz,
  jsonb_build_object(
    'basis', 'PRESENCIA_DECLARADA',
    'role', 'Proveedor',
    'source', 'ChileCompra',
    'semantics', 'Señal binaria de presencia como proveedor del Estado; Atlas no publica aquí el modelo analítico de gasto.'
  )
from public.obs_spend_actor a
where a.actor_role = 'SUPPLIER'
  and a.entity_id is not null
group by a.entity_id
on conflict (entity_id, source_code) do update
set status = excluded.status,
    record_count = null,
    last_event_at = excluded.last_event_at,
    detail = excluded.detail;

update public.obs_source_health
set notes = 'ChileCompra se utiliza en Atlas sólo como señal de presencia de proveedor del Estado. El modelo completo de gasto público fue desacoplado del producto piloto.',
    scope_partial = true
where source_code = 'MERCADO_PUBLICO';
