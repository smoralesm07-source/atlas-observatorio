alter table public.aml_fintech_entity
  add column if not exists operating_status text not null default 'UNKNOWN',
  add column if not exists operating_status_basis text,
  add column if not exists operating_status_source_code text,
  add column if not exists operating_status_source_url text,
  add column if not exists operating_status_as_of date;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.aml_fintech_entity'::regclass
      and conname='aml_fintech_entity_operating_status_chk'
  ) then
    alter table public.aml_fintech_entity
      add constraint aml_fintech_entity_operating_status_chk
      check (operating_status in ('ACTIVE','LIMITED','NO_NEW_BUSINESS','CEASED','UNKNOWN'));
  end if;
end $$;

update public.aml_fintech_entity
set operating_status='NO_NEW_BUSINESS',
    operating_status_basis='Sitio oficial informa que desde el 01-08-2025 Mento dejó de otorgar nuevos créditos; mantiene servicio de créditos existentes. CMF alertó el 25-08-2026 que Mento SpA no está registrada ni autorizada para prestar servicios regulados.',
    operating_status_source_code='COMPANY_OFFICIAL',
    operating_status_source_url='https://www.mento.cl/',
    operating_status_as_of='2026-08-25',
    lifecycle_basis='Cese de originación de nuevos créditos desde 01-08-2025; continuidad limitada a atención y pago de obligaciones existentes. Alerta CMF 25-08-2026.',
    lifecycle_validated_at=now(),
    refreshed_at=now()
where fintech_id='ENT-RUT-77287948-2';

update public.aml_fintech_entity
set operating_status='ACTIVE',
    operating_status_basis='Sitio y cuenta oficial vigentes en 2026; ComparaOnline continúa ofreciendo comparación y contratación de productos, con roles jurídicos separados para sitio y corretaje de seguros.',
    operating_status_source_code='COMPANY_OFFICIAL',
    operating_status_source_url='https://www.comparaonline.com/',
    operating_status_as_of=current_date,
    lifecycle_basis='Operación comercial pública vigente; marca ComparaOnline y corredor de seguros relacionados estructurados separadamente.',
    lifecycle_validated_at=now(),
    refreshed_at=now()
where fintech_id='ENT-RUT-76052998-2';

update public.aml_fintech_entity
set operating_status='ACTIVE',
    operating_status_basis='Sitio corporativo público vigente ofrece soluciones de portfolio, risk management y reporting para gestores de activos.',
    operating_status_source_code='COMPANY_OFFICIAL',
    operating_status_source_url='https://abaqus.cl/',
    operating_status_as_of=current_date,
    lifecycle_basis='Operación corporativa pública vigente.',
    lifecycle_validated_at=now(),
    refreshed_at=now()
where fintech_id='ENT-RUT-76517731-6';

update public.aml_fintech_entity
set operating_status='ACTIVE',
    operating_status_basis='Política de privacidad actualizada en julio de 2026 y sitio corporativo vigente identifican a Glou SpA como operador de Relif.',
    operating_status_source_code='COMPANY_OFFICIAL',
    operating_status_source_url='https://www.relif.com/privacy-policy',
    operating_status_as_of=current_date,
    lifecycle_basis='Operación pública vigente en 2026 como plataforma Relif.',
    lifecycle_validated_at=now(),
    refreshed_at=now()
where fintech_id='ENT-RUT-77507236-9';

update public.aml_fintech_entity
set operating_status='ACTIVE',
    operating_status_basis='Presencia corporativa pública vigente identifica a U-Payments Company S.A. como Fintech de medios de pago y enlaza el dominio oficial.',
    operating_status_source_code='COMPANY_WEB',
    operating_status_source_url='https://www.u-payments.com/',
    operating_status_as_of=current_date,
    lifecycle_basis='Operación pública vigente como proveedor tecnológico de medios de pago.',
    lifecycle_validated_at=now(),
    refreshed_at=now()
where fintech_id='ENT-RUT-77190729-6';