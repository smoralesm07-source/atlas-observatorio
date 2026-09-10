-- Perfil y piso público de escala de Informax, 2026-09-09.
update public.aml_fintech_entity
set business_model='B2B',target_customer='EMPRESAS',business_model_basis='Plataforma de evaluación crediticia, proveedores y BI para empresas.',business_model_confidence=0.999,target_customer_basis='La web oficial orienta la solución a bancos, factoring, retail y empresas.',target_customer_confidence=0.999,profile_classifier_version='MANUAL_OFFICIAL_PROFILE_INFORMAX_2026_09_09',profile_refreshed_at=now(),refreshed_at=now()
where fintech_id='ENT-RUT-77378155-9';

insert into public.aml_fintech_market_metric_observation(observation_key,subject_type,subject_key,metric_code,value_numeric,value_text,unit,qualifier,geography,evidence_type,confidence,source_code,source_url,observed_at,basis,metadata,first_seen_at,last_seen_at)
values('COMPANY_WEB|INFORMAX|BUSINESS_CLIENTS|2026-09-09','ENTITY','ENT-RUT-77378155-9','BUSINESS_CLIENTS',500,'Más de 500 empresas chilenas utilizan Informax','companies','AT_LEAST','CHILE','DECLARADO',0.95,'COMPANY_WEB','https://cl.linkedin.com/company/informax-inteligencia-de-datos',now(),'Cifra declarada en el perfil corporativo administrado por Informax en LinkedIn. Se conserva con confianza menor que una cifra publicada en el dominio oficial.',jsonb_build_object('lower_bound',true,'company_controlled_social_profile',true,'not_official_domain',true),now(),now())
on conflict(observation_key) do update set value_numeric=excluded.value_numeric,value_text=excluded.value_text,observed_at=excluded.observed_at,basis=excluded.basis,metadata=excluded.metadata,last_seen_at=now();
select atlas_private.aml_fintech_refresh_market_weight();
