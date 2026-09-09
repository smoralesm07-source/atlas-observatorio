select public.aml_fintech_rekey_confirmed_actor(
  'ENT-RUT-78378229-4',
  '99546900-6',
  'ISWITCH S.A.',
  'Klap',
  'La CMF identifica actualmente a ISWITCH S.A., RUT 99.546.900-6, con nombre de fantasía OPERADORA KLAP y sitio klap.cl; SII también publica ISWITCH S.A. como operador de medios de pago vigente con nombre de fantasía KLAP. KLAP CARE SpA no se mantiene como identidad principal del actor.',
  'CMF_PAYMENT_OPERATORS',
  'https://www.cmfchile.cl/institucional/mercados/entidad.php?control=svs&mercado=B&pestania=1&rut=99546900&tipoentidad=TPOPE&vig=VI',
  'ACTIVE'
);

insert into public.aml_fintech_regulatory_status(fintech_id,regulator,registry,service,status,registration_no,effective_date,source_url,observed_at)
values('ENT-RUT-99546900-6','CMF','CMF_PAYMENT_OPERATORS','OPERADOR_TARJETAS_PAGO','VIGENTE','682',null,'https://www.cmfchile.cl/institucional/mercados/entidad.php?control=svs&mercado=B&pestania=1&rut=99546900&tipoentidad=TPOPE&vig=VI',now())
on conflict(fintech_id,regulator,registry,service) do update set status='VIGENTE',registration_no='682',source_url=excluded.source_url,observed_at=now();

insert into public.aml_fintech_entity_source(fintech_id,source_code,source_entity_key,source_label,source_url,status,evidence,first_seen_at,last_seen_at)
values('ENT-RUT-99546900-6','CMF_PAYMENT_OPERATORS','99546900-6','CMF · Operadores de tarjetas de pago','https://www.cmfchile.cl/institucional/mercados/entidad.php?control=svs&mercado=B&pestania=1&rut=99546900&tipoentidad=TPOPE&vig=VI','OBSERVED',jsonb_build_object('fantasy_name','OPERADORA KLAP','status','VIGENTE','registration_no','682'),now(),now())
on conflict(fintech_id,source_code) do update set source_entity_key=excluded.source_entity_key,source_url=excluded.source_url,status='OBSERVED',evidence=excluded.evidence,last_seen_at=now();