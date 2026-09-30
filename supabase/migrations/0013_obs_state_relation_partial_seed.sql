-- Conserva valor inmediato aun si el puente core→Observatorio no está fresco.
-- Una coincidencia materializada sí permite afirmar presencia; una ausencia en
-- una fuente PARTIAL permanece UNKNOWN. Nunca se convierte el top analítico de
-- 3.000 proveedores en un falso universo completo.

insert into public.obs_state_supplier_directory(
  rut, entity_id, supplier_label, amount_12m, order_count_12m, buyer_count,
  top_buyer_id, top_buyer_share, hhi, active_months, first_seen, last_seen,
  source_snapshot_id, refreshed_at)
select a.actor_id, coalesce(a.entity_id,e.entity_id), a.label, a.amount_12m,
       a.order_count_12m, a.counterpart_count, a.top_counterpart_id,
       a.top_counterpart_share, a.hhi, a.active_months, a.first_seen, a.last_seen,
       a.snapshot_id, a.refreshed_at
from public.obs_spend_actor a
left join public.obs_entity e on e.rut=a.actor_id
where a.actor_role='SUPPLIER'
on conflict(rut) do update set
  entity_id=excluded.entity_id,
  supplier_label=excluded.supplier_label,
  amount_12m=excluded.amount_12m,
  order_count_12m=excluded.order_count_12m,
  buyer_count=excluded.buyer_count,
  top_buyer_id=excluded.top_buyer_id,
  top_buyer_share=excluded.top_buyer_share,
  hhi=excluded.hhi,
  active_months=excluded.active_months,
  first_seen=excluded.first_seen,
  last_seen=excluded.last_seen,
  source_snapshot_id=excluded.source_snapshot_id,
  refreshed_at=excluded.refreshed_at;

insert into public.obs_state_relation_refresh(source_code,source_snapshot_id,status,row_count,refreshed_at,error_detail)
select 'MERCADO_PUBLICO', max(snapshot_id), 'PARTIAL', count(*), max(refreshed_at),
       'Directorio universal pendiente de refresco del puente; positivos conservados desde obs_spend_actor.'
from public.obs_spend_actor where actor_role='SUPPLIER'
on conflict(source_code) do update set source_snapshot_id=excluded.source_snapshot_id,status=excluded.status,row_count=excluded.row_count,refreshed_at=excluded.refreshed_at,error_detail=excluded.error_detail;

create or replace function public.obs_state_relation_detail(p_entity_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public','pg_temp'
as $$
declare
  v_rut text;
  v_supplier jsonb;
  v_funds jsonb;
  v_years jsonb;
  v_payers jsonb;
  v_mp_status jsonb;
  v_pa_status jsonb;
begin
  if not (
    auth.role() = 'service_role' or (
      auth.uid() is not null and exists (
        select 1 from public.aml_allowed_users u where u.user_id=auth.uid() and u.enabled
      )
    )
  ) then
    raise exception 'ATLAS_CORE_FORBIDDEN' using errcode='42501';
  end if;

  select rut into v_rut from public.obs_entity where entity_id=p_entity_id;
  if v_rut is null then
    return jsonb_build_object('entity_id',p_entity_id,'rut',null,'marks','[]'::jsonb);
  end if;

  select to_jsonb(s) into v_supplier from public.obs_state_supplier_directory s where s.rut=v_rut;
  select to_jsonb(f) into v_funds from public.obs_public_funds_entity f where f.rut=v_rut;
  select coalesce(jsonb_agg(to_jsonb(y) order by y.period_year desc),'[]'::jsonb) into v_years from public.obs_public_funds_year y where y.rut=v_rut;
  select coalesce(jsonb_agg(to_jsonb(p) order by p.period_year desc,p.amount desc nulls last),'[]'::jsonb) into v_payers from public.obs_public_funds_payer_year p where p.rut=v_rut;
  select to_jsonb(r) into v_mp_status from public.obs_state_relation_refresh r where source_code='MERCADO_PUBLICO';
  select to_jsonb(r) into v_pa_status from public.obs_state_relation_refresh r where source_code='PRESUPUESTO_ABIERTO';

  return jsonb_build_object(
    'entity_id',p_entity_id,'rut',v_rut,
    'marks', jsonb_build_array(
      jsonb_build_object(
        'code','STATE_SUPPLIER','label','Proveedor del Estado','active',v_supplier is not null,
        'status',case when v_supplier is not null then 'PRESENT' when v_mp_status->>'status'='READY' then 'ABSENT' else 'UNKNOWN' end,
        'source','MERCADO_PUBLICO','included_in_score',false),
      jsonb_build_object(
        'code','PUBLIC_FUNDS_RECIPIENT','label','Fondos públicos','active',v_funds is not null,
        'status',case when v_funds is not null then 'PRESENT' when v_pa_status->>'status'='READY' then 'ABSENT' else 'UNKNOWN' end,
        'source','PRESUPUESTO_ABIERTO','included_in_score',false)
    ),
    'supplier',v_supplier,'public_funds',v_funds,
    'public_funds_years',v_years,'public_funds_payers',v_payers,
    'source_status',jsonb_build_object('mercado_publico',v_mp_status,'presupuesto_abierto',v_pa_status)
  );
end
$$;
