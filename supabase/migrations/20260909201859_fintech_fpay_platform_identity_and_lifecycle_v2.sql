insert into public.aml_fintech_operating_status_audit(fintech_id,previous_status,new_status,confidence,method,basis,source_codes,source_urls,status_as_of,validator_version)
select 'ENT-RUT-76788282-3',operating_status,'ACTIVE',0.999,'MANUAL_OFFICIAL_CURRENT',
       'La plataforma Fpay continúa operativa bajo Digital Payments SpA, RUT 76.788.282-3. La venta a Haulmer correspondió al negocio/vehículo prepago, no a la totalidad de la plataforma Fpay.',
       array['COMPANY_OFFICIAL','SII_PAYMENT_OPERATORS'],
       array['https://fpay.cl/','https://www.sii.cl/servicios_online/3532-administradores_operadores.html'],
       '2026-09-09','OPERATING-FPAY-2026-09-09'
from public.aml_fintech_entity
where fintech_id='ENT-RUT-76788282-3' and operating_status='UNKNOWN';

update public.aml_fintech_entity
set brand='Fpay',
    legal_name='DIGITAL PAYMENTS SPA',
    website='https://fpay.cl/',
    actor_kind='LEGAL_ENTITY',
    identification_status='CONFIRMED',
    identification_basis='COMPANY_OFFICIAL+SII_PAYMENT_OPERATORS · Digital Payments SpA RUT 76.788.282-3 opera la Plataforma Fpay; el negocio prepago vendido a Haulmer se modela como evento/vehículo separado.',
    confidence=greatest(confidence,0.999),
    operating_status='ACTIVE',
    operating_status_basis='La plataforma Fpay y sus servicios para comercios/sellers continúan operativos en 2026 bajo Digital Payments SpA. El negocio prepago fue vendido a Haulmer y posteriormente renombrado Haulmer Prepago S.A.',
    operating_status_source_code='COMPANY_OFFICIAL+SII_PAYMENT_OPERATORS',
    operating_status_source_url='https://fpay.cl/',
    operating_status_as_of='2026-09-09',
    operating_status_confidence=0.999,
    operating_status_method='MANUAL_OFFICIAL_CURRENT',
    operating_status_version='OPERATING-FPAY-2026-09-09',
    operating_status_validated_at=now(),
    lifecycle_basis='Plataforma Fpay vigente; separación del negocio prepago vendido a Haulmer en 2025.',
    lifecycle_validated_at=now(),
    refreshed_at=now()
where fintech_id='ENT-RUT-76788282-3';

update public.aml_fintech_legal_vehicle
set legal_name='DIGITAL PAYMENTS SPA',
    source_code='SII_PAYMENT_OPERATORS',
    source_url='https://www.sii.cl/servicios_online/3532-administradores_operadores.html',
    evidence_basis='SII publica RUT 76.788.282-3 como DIGITAL PAYMENTS SPA (FPAY), operador vigente; políticas oficiales Fpay identifican el mismo RUT y razón social.',
    confidence=1.0,
    last_seen_at=now()
where fintech_id='ENT-RUT-76788282-3' and regexp_replace(upper(rut),'[^0-9K]','','g')='767882823';

insert into public.aml_fintech_entity_source(fintech_id,source_code,source_entity_key,source_label,source_url,status,evidence,first_seen_at,last_seen_at)
values
('ENT-RUT-76788282-3','COMPANY_OFFICIAL','76788282-3','Fpay · política y términos oficiales','https://fpay.cl/comercios/politicas-de-privacidad-comercios/','OBSERVED',jsonb_build_object('legal_name','DIGITAL PAYMENTS SPA','rut','76.788.282-3','platform_active_2026',true),now(),now()),
('ENT-RUT-76788282-3','SII_PAYMENT_OPERATORS','76788282-3','SII · Administradores u Operadores de Medios de Pago Electrónicos','https://www.sii.cl/servicios_online/3532-administradores_operadores.html','OBSERVED',jsonb_build_object('legal_name','DIGITAL PAYMENTS SPA','fantasy_name','FPAY','status','VIGENTE'),now(),now())
on conflict(fintech_id,source_code) do update set source_entity_key=excluded.source_entity_key,source_label=excluded.source_label,source_url=excluded.source_url,status='OBSERVED',evidence=excluded.evidence,last_seen_at=now();

insert into public.aml_fintech_event(fintech_id,event_type,event_date,title,summary,source_code,source_url,observed_at)
select 'ENT-RUT-76788282-3','CORPORATE_TRANSACTION','2025-03-01','Haulmer completa adquisición del negocio prepago de Fpay',
       'Haulmer completó la adquisición de Digital Payments Prepago S.A., vehículo que operaba el negocio prepago asociado a Fpay. La Plataforma Fpay de Digital Payments SpA continúa observándose como servicio de pagos y gestión de sellers.',
       'PRESS_OPEN','https://www.df.cl/df-lab/innovacion-y-startups/fintech-curicana-haulmer-compra-apanio-plataforma-de-digitalizacion-para',now()
where not exists(select 1 from public.aml_fintech_event where fintech_id='ENT-RUT-76788282-3' and event_type='CORPORATE_TRANSACTION' and title='Haulmer completa adquisición del negocio prepago de Fpay');

insert into public.aml_fintech_event(fintech_id,event_type,event_date,title,summary,source_code,source_url,observed_at)
select 'ENT-RUT-77977667-0','LEGAL_VEHICLE_CHANGE','2025-09-03','Digital Payments Prepago pasa a denominarse Haulmer Prepago',
       'La CMF aprobó la reforma de estatutos de Digital Payments Prepago S.A. para cambiar su nombre a Haulmer Prepago S.A.',
       'CMF_PREPAID_ISSUERS','https://www.bcn.cl/leychile/navegar?idNorma=1216559',now()
where not exists(select 1 from public.aml_fintech_event where fintech_id='ENT-RUT-77977667-0' and event_type='LEGAL_VEHICLE_CHANGE' and title='Digital Payments Prepago pasa a denominarse Haulmer Prepago');