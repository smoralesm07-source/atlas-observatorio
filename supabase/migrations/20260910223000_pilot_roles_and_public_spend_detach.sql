-- ATLAS Observatorio · piloto multiusuario
-- 1) viewer = solo lectura; analyst/admin = superficies de escritura operativa.
-- 2) Gasto público deja de ser un módulo del producto. Se conserva únicamente
--    una señal de presencia de proveedor del Estado en obs_entity_source.

create or replace function public.atlas_can_write()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.aml_allowed_users u
    where u.user_id = auth.uid()
      and u.enabled = true
      and u.role in ('analyst', 'admin')
  );
$$;

create or replace function public.atlas_is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.aml_allowed_users u
    where u.user_id = auth.uid()
      and u.enabled = true
      and u.role = 'admin'
  );
$$;

revoke all on function public.atlas_can_write() from public, anon;
revoke all on function public.atlas_is_admin() from public, anon;
grant execute on function public.atlas_can_write() to authenticated, service_role;
grant execute on function public.atlas_is_admin() to authenticated, service_role;

-- Gestión SO: viewers pueden leer la mesa, pero no tomar/modificar casos.
drop policy if exists aml_uaf_case_management_insert on public.aml_uaf_case_management;
create policy aml_uaf_case_management_insert
on public.aml_uaf_case_management for insert to authenticated
with check (
  public.atlas_can_write()
  and assigned_to = (select auth.uid())
  and updated_by = (select auth.uid())
);

drop policy if exists aml_uaf_case_management_update on public.aml_uaf_case_management;
create policy aml_uaf_case_management_update
on public.aml_uaf_case_management for update to authenticated
using (
  public.atlas_is_admin()
  or (public.atlas_can_write() and assigned_to = (select auth.uid()))
)
with check (
  updated_by = (select auth.uid())
  and (
    public.atlas_is_admin()
    or (public.atlas_can_write() and assigned_to = (select auth.uid()))
  )
);

drop policy if exists aml_uaf_case_management_event_insert on public.aml_uaf_case_management_event;
create policy aml_uaf_case_management_event_insert
on public.aml_uaf_case_management_event for insert to authenticated
with check (
  public.atlas_can_write()
  and actor_id = (select auth.uid())
);

-- Otras escrituras operativas del piloto: revisión, contacto y enriquecimiento.
drop policy if exists aml_disposition_self_insert on public.aml_disposition;
create policy aml_disposition_self_insert
on public.aml_disposition for insert to authenticated
with check (
  public.atlas_can_write()
  and user_id = (select auth.uid())
);

drop policy if exists aml_uaf_potential_review_self_insert on public.aml_uaf_potential_review;
create policy aml_uaf_potential_review_self_insert
on public.aml_uaf_potential_review for insert to authenticated
with check (
  public.atlas_can_write()
  and user_id = (select auth.uid())
);

drop policy if exists candidate_contact_insert_allowed on public.aml_uaf_candidate_contact_osint;
create policy candidate_contact_insert_allowed
on public.aml_uaf_candidate_contact_osint for insert to authenticated
with check (
  public.atlas_can_write()
  and captured_by = (select auth.uid())
);

drop policy if exists candidate_contact_update_allowed on public.aml_uaf_candidate_contact_osint;
create policy candidate_contact_update_allowed
on public.aml_uaf_candidate_contact_osint for update to authenticated
using (public.atlas_can_write())
with check (public.atlas_can_write());

drop policy if exists candidate_enrichment_job_insert_self on public.aml_uaf_candidate_enrichment_job;
create policy candidate_enrichment_job_insert_self
on public.aml_uaf_candidate_enrichment_job for insert to authenticated
with check (
  public.atlas_can_write()
  and requested_by = (select auth.uid())
);

drop policy if exists candidate_enrichment_job_update_self on public.aml_uaf_candidate_enrichment_job;
create policy candidate_enrichment_job_update_self
on public.aml_uaf_candidate_enrichment_job for update to authenticated
using (
  public.atlas_can_write()
  and requested_by = (select auth.uid())
)
with check (
  public.atlas_can_write()
  and requested_by = (select auth.uid())
);

-- El modelo analítico completo de gasto deja de ser una superficie cliente de Atlas.
-- Se conserva físicamente para desacoplarlo en un proyecto separado y para que el
-- proceso servidor pueda derivar la señal mínima de proveedor del Estado.
revoke select on table public.obs_spend_snapshot from authenticated;
revoke select on table public.obs_spend_finding from authenticated;
revoke select on table public.obs_spend_actor from authenticated;
revoke select on table public.obs_spend_pair from authenticated;
revoke select on table public.obs_budget_signal from authenticated;

revoke execute on function public.obs_spend_overview() from authenticated;
revoke execute on function public.obs_spend_finding_feed(text,text,integer,integer) from authenticated;
revoke execute on function public.obs_spend_actor_detail(text,text) from authenticated;

-- MERCADO_PUBLICO pasa a significar exclusivamente "es proveedor del Estado".
-- El trigger elimina compradores puros y despoja montos, recuentos, concentración
-- u otras métricas del módulo de gasto antes de exponer la señal en Entidad 360.
create or replace function public.atlas_keep_supplier_signal_only()
returns trigger
language plpgsql
set search_path = 'public', 'pg_temp'
as $$
declare
  v_detail jsonb := coalesce(new.detail, '{}'::jsonb);
  v_is_supplier boolean;
begin
  if new.source_code <> 'MERCADO_PUBLICO' then
    return new;
  end if;

  v_is_supplier := coalesce((v_detail->'roles') ? 'Proveedor', false)
    or upper(coalesce(v_detail->>'role', '')) = 'PROVEEDOR';

  if not v_is_supplier then
    return null;
  end if;

  new.record_count := null;
  new.detail := jsonb_build_object(
    'basis', 'PRESENCIA_DECLARADA',
    'role', 'Proveedor',
    'source', 'ChileCompra',
    'semantics', 'Señal binaria de presencia como proveedor del Estado; Atlas no publica aquí el modelo analítico de gasto.'
  );
  return new;
end;
$$;

revoke all on function public.atlas_keep_supplier_signal_only() from public, anon, authenticated;
grant execute on function public.atlas_keep_supplier_signal_only() to service_role;

drop trigger if exists trg_atlas_supplier_signal_only on public.obs_entity_source;
create trigger trg_atlas_supplier_signal_only
before insert or update on public.obs_entity_source
for each row
when (new.source_code = 'MERCADO_PUBLICO')
execute function public.atlas_keep_supplier_signal_only();

-- Normaliza el corte ya materializado sin esperar al próximo refresco.
delete from public.obs_entity_source
where source_code = 'MERCADO_PUBLICO'
  and not (
    coalesce((coalesce(detail, '{}'::jsonb)->'roles') ? 'Proveedor', false)
    or upper(coalesce(detail->>'role', '')) = 'PROVEEDOR'
  );

update public.obs_entity_source
set record_count = null,
    detail = jsonb_build_object(
      'basis', 'PRESENCIA_DECLARADA',
      'role', 'Proveedor',
      'source', 'ChileCompra',
      'semantics', 'Señal binaria de presencia como proveedor del Estado; Atlas no publica aquí el modelo analítico de gasto.'
    )
where source_code = 'MERCADO_PUBLICO';

comment on function public.atlas_can_write() is
  'Permiso operativo del piloto Atlas: sólo analyst/admin habilitados pueden escribir datos de gestión.';
comment on function public.atlas_keep_supplier_signal_only() is
  'Reduce MERCADO_PUBLICO a señal binaria de proveedor del Estado y evita exponer métricas del módulo Gasto público.';
