with vals(fintech_id,confidence,website,source_code,source_url,basis) as (
  values
  ('ENT-RUT-76001742-6',0.98::numeric,'https://clai.com/','COMPANY_OFFICIAL','https://clai.com/es/noticias/','CLAI mantiene actividad corporativa y publicaciones vigentes durante 2026; el RUT chileno permanece activo en SII.'),
  ('ENT-RUT-78008316-6',0.99::numeric,'https://hpay.cl/','COMPANY_OFFICIAL','https://hpay.cl/tarifas','Hpay mantiene aplicación, tarifas, contacto comercial y condiciones de servicio vigentes; sus términos identifican a Halley Fintech SpA RUT 78.008.316-6.'),
  ('ENT-RUT-77070361-1',0.98::numeric,'https://secure.ibitt.co/','COMPANY_OFFICIAL','https://secure.ibitt.co/','El portal operativo de iBitt publica oficina y teléfonos en Santiago de Chile y copyright 2026; IBBA Chile S.A. permanece activa en SII.'),
  ('ENT-RUT-77066914-6',0.999::numeric,'https://www2.prontopaga.com/','COMPANY_OFFICIAL','https://www2.prontopaga.com/terminos-y-condiciones-es/','Términos oficiales actualizados el 07-07-2026 identifican a Inversiones y Asesorías Integral Solutions S.A. como entidad chilena de ProntoPaga; documentación y API mantienen operación Chile vigente.'),
  ('ENT-RUT-76772379-2',0.999::numeric,'https://www.ppro.com/countries/chile/','COMPANY_OFFICIAL','https://www.ppro.com/legal/latam-general-terms-and-conditions/','Términos LATAM vigentes identifican a PPRO Chile SpA como afiliada que presta servicios en Chile; la página Chile mantiene métodos de pago soportados actualmente.'),
  ('ENT-RUT-77285658-K',0.999::numeric,'https://regcheq.com/es-cl/','COMPANY_OFFICIAL','https://regcheq.com/es-cl','Sitio oficial publica operación, clientes y contenidos fechados en agosto de 2026 en Chile; Regcheq SpA permanece activa en SII.'),
  ('ENT-RUT-76945003-3',0.99::numeric,'https://www.upago.cl/es/','COMPANY_OFFICIAL','https://www.upago.cl/es/','Sitio vigente ofrece plataforma de pagos y cobranzas; políticas oficiales identifican a Janus SpA como UPAGO y confirman presencia en Chile.'),
  ('ENT-RUT-59305270-2',0.99::numeric,'https://wherex.com/','COMPANY_OFFICIAL','https://register.wherex.com/','Portal de registro vigente permite a empresas chilenas operar productos Wherex con RUT y datos comerciales; Wherex Ltd permanece activa en SII.'),
  ('ENT-RUT-59294680-7',0.999::numeric,'https://xepelin.com/','COMPANY_OFFICIAL','https://xepelin.com/credito-chile','Xepelin mantiene productos de crédito/factoring para Chile, newsroom y actividad corporativa 2026; Xepelin Holdings Inc. permanece activa en SII.'),
  ('ENT-RUT-76416659-0',0.999::numeric,'https://www.payretailers.com/','COMPANY_OFFICIAL','https://status.payretailers.com/','Estado operacional oficial del 09-09-2026 muestra Chile operativo y servicios PayIn/PayOut activos; PayRetailers Chile SpA permanece activa en SII.'),
  ('ENT-RUT-77298816-8',0.96::numeric,'https://pmi-americas.com/','COMPANY_WEB','https://www.linkedin.com/company/pmiamericas','Presencia corporativa vigente de PMI declara oficina en Santiago de Chile y servicios de pagos LATAM; PMI Americas Chile SpA permanece activa en SII.'),
  ('ENT-RUT-76832409-3',0.98::numeric,'https://ahoraconectados.com/','SII_PAYMENT_OPERATORS','https://www.sii.cl/servicios_online/3532-administradores_operadores.html','SII publica actualmente a Conectados SpA, RUT 76.832.409-3, como administrador/operador de medios de pago electrónicos vigente; el RUT permanece activo en SII.')
), eligible as (
  select v.*,e.operating_status previous_status
  from vals v join public.aml_fintech_entity e using(fintech_id)
  where e.operating_status='UNKNOWN'
), logged as (
  insert into public.aml_fintech_operating_status_audit(fintech_id,previous_status,new_status,confidence,method,basis,source_codes,source_urls,status_as_of,validator_version)
  select fintech_id,previous_status,'ACTIVE',confidence,'MANUAL_CURRENT_OPEN_SOURCE',basis,array[source_code],array[source_url],'2026-09-09','OPERATING-MANUAL-B2-2026-09-09'
  from eligible returning fintech_id
)
update public.aml_fintech_entity e
set operating_status='ACTIVE',operating_status_basis=v.basis,operating_status_source_code=v.source_code,
    operating_status_source_url=v.source_url,operating_status_as_of='2026-09-09',operating_status_confidence=v.confidence,
    operating_status_method='MANUAL_CURRENT_OPEN_SOURCE',operating_status_version='OPERATING-MANUAL-B2-2026-09-09',
    operating_status_validated_at=now(),lifecycle_validated_at=now(),website=v.website,refreshed_at=now()
from vals v
where e.fintech_id=v.fintech_id and exists(select 1 from logged l where l.fintech_id=e.fintech_id);