with vals(fintech_id,new_status,confidence,website,source_url,basis) as (
  values
  ('ENT-RUT-76550081-8','ACTIVE',0.99::numeric,'https://www.chipax.com/','https://www.chipax.com/','Sitio oficial y centro de ayuda publican actividad y funcionalidades vigentes durante 2026.'),
  ('ENT-RUT-77023321-6','ACTIVE',0.99::numeric,'https://www.kredito.cl/','https://www.kredito.cl/nosotros','Sitio oficial vigente identifica a Kredito como fintech para pymes y publica productos y operación actual.'),
  ('ENT-RUT-76969638-5','ACTIVE',0.99::numeric,'https://racional.cl/','https://ayuda.racional.cl/es/articles/4365302-estan-reguladas-y-seguras-mis-inversiones','Centro de ayuda oficial mantiene contenidos operativos 2026 y declara inscripción/autorización CMF de Racional SpA.'),
  ('ENT-RUT-78172761-K','ACTIVE',0.99::numeric,'https://wipay.cl/','https://wipay.cl/','Sitio oficial vigente ofrece soluciones de pagos y publica métricas actuales de transacciones, comercios y terminales.'),
  ('ENT-RUT-76801011-0','LIMITED',0.999::numeric,'https://www.orionx.com/','https://www.orionx.com/','Sitio oficial informa proceso de cierre definitivo, retiros temporalmente suspendidos y plan de restitución de activos en implementación.')
), logged as (
  insert into public.aml_fintech_operating_status_audit(fintech_id,previous_status,new_status,confidence,method,basis,source_codes,source_urls,status_as_of,validator_version)
  select e.fintech_id,e.operating_status,v.new_status,v.confidence,'MANUAL_OFFICIAL_CURRENT',v.basis,
         array['COMPANY_OFFICIAL'],array[v.source_url],'2026-09-09'::date,'OPERATING-MANUAL-2026-09-09'
  from vals v join public.aml_fintech_entity e using(fintech_id)
  where e.operating_status='UNKNOWN'
  returning fintech_id
)
update public.aml_fintech_entity e
set operating_status=v.new_status,
    operating_status_basis=v.basis,
    operating_status_source_code='COMPANY_OFFICIAL',
    operating_status_source_url=v.source_url,
    operating_status_as_of='2026-09-09',
    operating_status_confidence=v.confidence,
    operating_status_method='MANUAL_OFFICIAL_CURRENT',
    operating_status_version='OPERATING-MANUAL-2026-09-09',
    operating_status_validated_at=now(),
    lifecycle_validated_at=now(),
    website=v.website,
    refreshed_at=now()
from vals v
where e.fintech_id=v.fintech_id
  and exists(select 1 from logged l where l.fintech_id=e.fintech_id);

insert into public.aml_fintech_event(fintech_id,event_type,event_date,title,summary,source_code,source_url,observed_at)
select 'ENT-RUT-76801011-0','OPERATING_STATUS_CHANGE','2026-09-09','Orionx inicia proceso de cierre definitivo',
       'El sitio oficial informa cierre definitivo, retiros temporalmente suspendidos y ejecución de un plan de restitución de activos.',
       'COMPANY_OFFICIAL','https://www.orionx.com/',now()
where not exists (
  select 1 from public.aml_fintech_event
  where fintech_id='ENT-RUT-76801011-0'
    and event_type='OPERATING_STATUS_CHANGE'
    and title='Orionx inicia proceso de cierre definitivo'
);