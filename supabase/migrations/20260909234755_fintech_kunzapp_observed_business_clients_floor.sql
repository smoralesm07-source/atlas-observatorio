insert into public.aml_fintech_market_metric_observation(
  observation_key,subject_type,subject_key,metric_code,value_numeric,value_text,unit,currency,qualifier,geography,
  evidence_type,confidence,source_code,source_url,observed_at,basis,evidence_excerpt,metadata,first_seen_at,last_seen_at
)
values(
  'COMPANY_OFFICIAL|KUNZAPP|BUSINESS_CLIENTS_NAMED_FLOOR|2026-09-09','ENTITY','ENT-RUT-77741443-7','BUSINESS_CLIENTS',20,
  'Al menos 20 clientes corporativos identificables publicados en la página oficial','companies',null,'AT_LEAST','LATAM',
  'OBSERVADO_OFICIAL',0.999,'COMPANY_OFFICIAL','https://www.kunzapp.com/que-es-kunzapp',now(),
  'Piso observado a partir de 20 logos/nombres de clientes corporativos identificables en una misma página oficial. No representa el total de clientes de Kunzapp ni clientes Chile-only.',
  'Kushki, Falabella, Kavak, SQM, Colbun, Caja Los Andes, Fintual, Simetrik, Addi, Toku, Fintoc, Cobre, Colektia, BYMA, AssetPlan, Talisis, Continuum, iConstruye, Health Atom y Examedi.',
  jsonb_build_object('lower_bound',true,'named_clients_floor',true,'not_total_clients',true,'not_chile_only',true),now(),now()
)
on conflict(observation_key) do update set value_numeric=excluded.value_numeric,value_text=excluded.value_text,qualifier=excluded.qualifier,geography=excluded.geography,evidence_type=excluded.evidence_type,confidence=excluded.confidence,source_url=excluded.source_url,observed_at=excluded.observed_at,basis=excluded.basis,evidence_excerpt=excluded.evidence_excerpt,metadata=excluded.metadata,last_seen_at=now();

select atlas_private.aml_fintech_refresh_market_weight();
