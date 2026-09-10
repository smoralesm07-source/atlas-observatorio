-- Conectividad de infraestructura y corrección de evidencia, corte 2026-09-09.

-- Prometeo: invalida alcance geográfico no respaldado y agrega instituciones conectadas.
update public.aml_fintech_market_metric_observation
set value_numeric=null,
    value_text='Registro invalidado: la evidencia vigente no respalda 110+ países como alcance general de Prometeo.',
    evidence_type='NO_OBSERVABLE',confidence=0,
    basis='Invalidado el 2026-09-09. La fuente vigente distingue 1.200+ instituciones en 11 países y validación de cuentas en 50+ países; ninguno respalda 110+ países como alcance general.',
    metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('invalidated',true,'invalidated_at','2026-09-09','reason','unsupported_country_reach'),last_seen_at=now()
where observation_key='COMPANY_OFFICIAL|PROMETEO|COUNTRIES_SERVICE_REACH|2026-09-09';

insert into public.aml_fintech_market_metric_observation(observation_key,subject_type,subject_key,metric_code,value_numeric,value_text,unit,qualifier,geography,evidence_type,confidence,source_code,source_url,observed_at,basis,metadata,first_seen_at,last_seen_at)
values
('COMPANY_OFFICIAL|PROMETEO|FINANCIAL_INSTITUTIONS_CONNECTED|2026-09-09','ENTITY','ACTOR-14A99396232741F7','FINANCIAL_INSTITUTIONS_CONNECTED_COUNT',1200,'Más de 1.200 instituciones financieras conectadas','institutions','AT_LEAST','AMERICAS','DECLARADO',0.999,'COMPANY_OFFICIAL','https://prometeoapi.com/legales/terminos-y-condiciones',now(),'Los términos oficiales vigentes describen una red de más de 1.500 conexiones a más de 1.200 instituciones financieras en 11 países.',jsonb_build_object('lower_bound',true,'network_scope',true),now(),now()),
('COMPANY_OFFICIAL|FLOID|DATA_SOURCES_CONNECTED|2026-09-09','ENTITY','ENT-RUT-59294630-0','DATA_SOURCES_CONNECTED_COUNT',100,'Más de 100 fuentes bancarias y no bancarias','sources','AT_LEAST','LATAM','DECLARADO',0.999,'COMPANY_OFFICIAL','https://www.floid.io/',now(),'La portada oficial de Floid declara acceso en tiempo real a más de 100 fuentes bancarias y no bancarias.',jsonb_build_object('lower_bound',true,'sources_include_banking_and_nonbanking',true),now(),now())
on conflict(observation_key) do update set value_numeric=excluded.value_numeric,value_text=excluded.value_text,unit=excluded.unit,qualifier=excluded.qualifier,geography=excluded.geography,evidence_type=excluded.evidence_type,confidence=excluded.confidence,source_code=excluded.source_code,source_url=excluded.source_url,observed_at=excluded.observed_at,basis=excluded.basis,metadata=excluded.metadata,last_seen_at=now();

select atlas_private.aml_fintech_refresh_market_weight();
