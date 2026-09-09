update public.aml_fintech_entity set
  business_model='B2B', business_model_basis='COMPANY_OFFICIAL_WEB_VALIDATED', business_model_confidence=0.99,
  target_customer='EMPRESAS', target_customer_basis='COMPANY_OFFICIAL_WEB_VALIDATED', target_customer_confidence=0.99,
  profile_refreshed_at=now(), refreshed_at=now()
where fintech_id in ('ENT-RUT-76027202-7','ENT-RUT-77337828-2');

update public.aml_fintech_entity set
  business_model='B2B', business_model_basis='COMPANY_OFFICIAL_WEB_VALIDATED', business_model_confidence=0.995,
  target_customer='EMPRESAS', target_customer_basis='COMPANY_OFFICIAL_WEB_VALIDATED', target_customer_confidence=0.995,
  revenue_model='COMISION_TRANSACCIONAL', revenue_model_basis='COMPANY_OFFICIAL_WEB_VALIDATED', revenue_model_confidence=0.999,
  profile_refreshed_at=now(), refreshed_at=now()
where fintech_id='ENT-RUT-76804564-K';

update public.aml_fintech_entity set
  business_model='B2B', business_model_basis='COMPANY_OFFICIAL_WEB_VALIDATED', business_model_confidence=0.999,
  target_customer='EMPRESAS', target_customer_basis='COMPANY_OFFICIAL_WEB_VALIDATED', target_customer_confidence=0.999,
  profile_refreshed_at=now(), refreshed_at=now()
where fintech_id in ('ENT-RUT-76349529-9','ENT-RUT-59250540-1');

update public.aml_fintech_entity set
  revenue_model='COMISION_TRANSACCIONAL', revenue_model_basis='COMPANY_OFFICIAL_WEB_VALIDATED', revenue_model_confidence=0.999,
  profile_refreshed_at=now(), refreshed_at=now()
where fintech_id='ENT-RUT-77005598-9';

insert into public.aml_fintech_profile_audit(fintech_id,classifier_version,business_model,business_model_confidence,target_customer,target_customer_confidence,revenue_model,revenue_model_confidence,pages_scanned,observed_at,evidence)
values
('ENT-RUT-76027202-7','MANUAL_OPEN_SOURCE_2026','B2B',0.99,'EMPRESAS',0.99,null,null,null,now(),jsonb_build_object('basis','Sitio corporativo vigente orienta la plataforma a instituciones financieras y grandes empresas.','source_url','https://www.modyo.com/')),
('ENT-RUT-77337828-2','MANUAL_OPEN_SOURCE_2026','B2B',0.99,'EMPRESAS',0.99,null,null,null,now(),jsonb_build_object('basis','Oferta y contenidos vigentes se dirigen a pymes y financiamiento empresarial.','source_url','https://www.maxxa.cl/')),
('ENT-RUT-76804564-K','MANUAL_OPEN_SOURCE_2026','B2B',0.995,'EMPRESAS',0.995,'COMISION_TRANSACCIONAL',0.999,null,now(),jsonb_build_object('basis','Pago Fácil vende infraestructura de cobros a comercios y empresas; sus planes cobran porcentaje por transacción.','source_url','https://www.pagofacil.cl/')),
('ENT-RUT-76349529-9','MANUAL_OPEN_SOURCE_2026','B2B',0.999,'EMPRESAS',0.999,null,null,null,now(),jsonb_build_object('basis','OneKey Payments declara soluciones empresariales de pagos locales y cross-border.','source_url','https://www.onekeypayments.com/')),
('ENT-RUT-59250540-1','MANUAL_OPEN_SOURCE_2026','B2B',0.999,'EMPRESAS',0.999,null,null,null,now(),jsonb_build_object('basis','NICO declara software y asesoría para gestión de seguros de empresas.','source_url','https://www.nicoseguros.com/')),
('ENT-RUT-77005598-9','MANUAL_OPEN_SOURCE_2026',null,null,null,null,'COMISION_TRANSACCIONAL',0.999,null,now(),jsonb_build_object('basis','Neat cobra una comisión por cada transacción; los intereses de cuotas corresponden al banco emisor y no a Neat.','source_url','https://www.neatpagos.com/terminos-y-condiciones'));