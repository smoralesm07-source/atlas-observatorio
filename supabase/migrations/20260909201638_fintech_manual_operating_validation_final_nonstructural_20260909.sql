with vals(fintech_id,new_status,confidence,website,source_code,source_url,basis) as (
  values
  ('ENT-RUT-77418382-5','CEASED',0.999::numeric,'https://www.plusspay.com/','COMPANY_OFFICIAL','https://www.plusspay.com/','Plusspay informa expresamente el cese de sus operaciones y la deshabilitación de funciones comerciales y accesos de usuario. La CMF canceló la inscripción de Inversiones Plusservice SpA en el RPSF el 26-06-2026.'),
  ('ENT-RUT-77576082-6','ACTIVE',0.999::numeric,'https://somospawer.com/','COMPANY_OFFICIAL','https://ayuda.somospawer.com/es/collections/19145053-chile','Pawer mantiene planes y contratación 2026 en Chile; su aplicación fue actualizada el 25-08-2026 y mantiene operación comercial vigente.'),
  ('ENT-RUT-59153640-0','ACTIVE',0.99::numeric,'https://www.worldsys.io/','COMPANY_OFFICIAL','https://www.worldsys.io/','Worldsys mantiene plataforma de compliance vigente, oferta comercial activa y más de 300 compañías usuarias en LATAM.'),
  ('ENT-RUT-59307840-K','ACTIVE',0.99::numeric,'https://home.xcala.com/','COMPANY_OFFICIAL','https://home.xcala.com/','Xcala mantiene registro, onboarding e inversión digital en activos alternativos en su plataforma vigente.')
), eligible as (
  select v.*,e.operating_status previous_status
  from vals v join public.aml_fintech_entity e using(fintech_id)
  where e.operating_status='UNKNOWN'
), logged as (
  insert into public.aml_fintech_operating_status_audit(fintech_id,previous_status,new_status,confidence,method,basis,source_codes,source_urls,status_as_of,validator_version)
  select fintech_id,previous_status,new_status,confidence,'MANUAL_CURRENT_OPEN_SOURCE',basis,array[source_code],array[source_url],'2026-09-09','OPERATING-MANUAL-FINAL-2026-09-09'
  from eligible returning fintech_id
)
update public.aml_fintech_entity e
set operating_status=v.new_status,operating_status_basis=v.basis,operating_status_source_code=v.source_code,
    operating_status_source_url=v.source_url,operating_status_as_of='2026-09-09',operating_status_confidence=v.confidence,
    operating_status_method='MANUAL_CURRENT_OPEN_SOURCE',operating_status_version='OPERATING-MANUAL-FINAL-2026-09-09',
    operating_status_validated_at=now(),lifecycle_validated_at=now(),website=v.website,refreshed_at=now()
from vals v
where e.fintech_id=v.fintech_id and exists(select 1 from logged l where l.fintech_id=e.fintech_id);

insert into public.aml_fintech_event(fintech_id,event_type,event_date,title,summary,source_code,source_url,observed_at)
select 'ENT-RUT-77418382-5','OPERATING_STATUS_CHANGE','2026-06-26','Plusspay / Inversiones Plusservice cesa operaciones',
       'La plataforma informa cese de operaciones y deshabilitación de funciones comerciales; la CMF canceló su inscripción en el Registro de Prestadores de Servicios Financieros.',
       'CMF_RPSF','https://www.cmfchile.cl/institucional/mercados/entidad.php?control=svs&grupo=&mercado=O&pestania=1&rut=77418382&tipoentidad=RGPSF&vig=VI',now()
where not exists(select 1 from public.aml_fintech_event where fintech_id='ENT-RUT-77418382-5' and event_type='OPERATING_STATUS_CHANGE' and event_date='2026-06-26');