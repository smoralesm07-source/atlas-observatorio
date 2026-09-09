-- ATLAS Observatorio · GAFI/FATF characterization checkpoint
-- Open-source characterization only. This layer does NOT score AML/CFT risk,
-- determine legal obligations, or infer non-compliance.

insert into public.aml_fintech_source_catalog(source_code,label,source_type,authority_level,source_url,cadence,active,notes)
values
('FATF_RECOMMENDATIONS','GAFI/FATF · Recomendaciones','STANDARD_GUIDANCE','INTERNATIONAL_STANDARD','https://www.fatf-gafi.org/en/publications/Fatfrecommendations/Fatf-recommendations.html','EVENT_DRIVEN',true,'Marco internacional usado sólo como contexto de caracterización; no constituye evaluación de cumplimiento ni riesgo de una entidad.'),
('FATF_R16','GAFI/FATF · Recomendación 16 · transparencia de pagos','STANDARD_GUIDANCE','INTERNATIONAL_STANDARD','https://www.fatf-gafi.org/en/publications/Fatfrecommendations/recommendation-16-payment-transparency.html','EVENT_DRIVEN',true,'Referencia específica para transparencia de pagos/transferencias y su aplicación a transferencias de activos virtuales a través de INR.15.'),
('FATF_VA_GUIDANCE','GAFI/FATF · Guía activos virtuales y VASP','STANDARD_GUIDANCE','INTERNATIONAL_STANDARD','https://www.fatf-gafi.org/en/publications/Fatfrecommendations/Guidance-rba-virtual-assets-2021.html','EVENT_DRIVEN',true,'Guía de enfoque basado en riesgo para activos virtuales y VASP; utilizada para interpretación funcional de R.15/INR.15.'),
('FATF_VA_UPDATE_2026','GAFI/FATF · 7th Targeted Update VA/VASP 2026','STANDARD_GUIDANCE','INTERNATIONAL_STANDARD','https://www.fatf-gafi.org/en/publications/Fatfrecommendations/targeted-updated-virtualassets-vasps-2026.html','ANNUAL',true,'Actualización de 16 julio 2026 sobre implementación R.15; usada para temas de caracterización del mercado VA/VASP, no scoring.'),
('FATF_DEFI_2026','GAFI/FATF · Targeted Report DeFi 2026','STANDARD_GUIDANCE','INTERNATIONAL_STANDARD','https://www.fatf-gafi.org/en/publications/Virtualassets/targeted-report-decentralised-finance-2026.html','EVENT_DRIVEN',true,'Informe 21 julio 2026 sobre desafíos regulatorios DeFi; usado para caracterizar rol/control/facilitación.')
on conflict(source_code) do update set label=excluded.label,source_type=excluded.source_type,authority_level=excluded.authority_level,source_url=excluded.source_url,cadence=excluded.cadence,active=true,notes=excluded.notes,refreshed_at=now();

create table if not exists public.aml_fintech_fatf_recommendation(
 rec_code text primary key,
 recommendation_no integer not null,
 title_es text not null,
 scope_code text not null,
 summary_es text not null,
 characterization_note text not null,
 primary_source_url text not null,
 secondary_source_url text,
 version_label text not null,
 reviewed_at timestamptz not null default now(),
 active boolean not null default true,
 metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.aml_fintech_fatf_function_map(
 function_code text not null references public.aml_fintech_function_catalog(function_code) on delete cascade,
 rec_code text not null references public.aml_fintech_fatf_recommendation(rec_code) on delete cascade,
 relevance_level text not null check(relevance_level in ('PRIMARY','SUPPORTING','CONDITIONAL','CONTEXTUAL')),
 rationale_es text not null,
 applicability_note text,
 primary key(function_code,rec_code)
);

create table if not exists public.aml_fintech_fatf_characterization_theme(
 theme_code text primary key,
 title_es text not null,
 description_es text not null,
 source_code text not null references public.aml_fintech_source_catalog(source_code),
 source_url text not null,
 source_date date,
 relevance_note text not null,
 active boolean not null default true,
 metadata jsonb not null default '{}'::jsonb,
 reviewed_at timestamptz not null default now()
);

create table if not exists public.aml_fintech_fatf_theme_function_map(
 theme_code text not null references public.aml_fintech_fatf_characterization_theme(theme_code) on delete cascade,
 function_code text not null references public.aml_fintech_function_catalog(function_code) on delete cascade,
 relevance_level text not null check(relevance_level in ('PRIMARY','CONDITIONAL','CONTEXTUAL')),
 rationale_es text not null,
 primary key(theme_code,function_code)
);

alter table public.aml_fintech_fatf_recommendation enable row level security;
alter table public.aml_fintech_fatf_function_map enable row level security;
alter table public.aml_fintech_fatf_characterization_theme enable row level security;
alter table public.aml_fintech_fatf_theme_function_map enable row level security;
revoke all on public.aml_fintech_fatf_recommendation from anon,authenticated;
revoke all on public.aml_fintech_fatf_function_map from anon,authenticated;
revoke all on public.aml_fintech_fatf_characterization_theme from anon,authenticated;
revoke all on public.aml_fintech_fatf_theme_function_map from anon,authenticated;
create index if not exists ix_fintech_fatf_function_map_rec on public.aml_fintech_fatf_function_map(rec_code);
create index if not exists ix_fintech_fatf_theme_source_code on public.aml_fintech_fatf_characterization_theme(source_code);
create index if not exists ix_fintech_fatf_theme_function_code on public.aml_fintech_fatf_theme_function_map(function_code);

insert into public.aml_fintech_fatf_recommendation(rec_code,recommendation_no,title_es,scope_code,summary_es,characterization_note,primary_source_url,secondary_source_url,version_label,active,metadata)
values
('R01',1,'Evaluación de riesgos y enfoque basado en riesgo','SECTOR_CONTEXT','Identificar, evaluar y comprender los riesgos LA/FT y aplicar medidas proporcionales.','En ATLAS se usa sólo como contexto sectorial para indicar que el modelo de negocio, geografía, productos y tecnología son elementos que posteriormente pueden alimentar una evaluación basada en riesgo; no genera un score de riesgo.','https://www.fatf-gafi.org/en/publications/Fatfrecommendations/Fatf-recommendations.html',null,'Recomendaciones GAFI actualizadas a junio de 2026; revisión ATLAS 2026-09',true,'{}'),
('R10',10,'Debida diligencia del cliente','FINANCIAL_INSTITUTION','Establece medidas de identificación y verificación del cliente y del beneficiario final, comprensión del propósito de la relación y monitoreo según corresponda.','Pertinente cuando la función observada corresponde a una actividad financiera o VASP cubierta por los estándares GAFI. La pertinencia no implica que ATLAS determine por sí solo la obligación jurídica local.','https://www.fatf-gafi.org/en/publications/Fatfrecommendations/Fatf-recommendations.html',null,'Recomendaciones GAFI actualizadas a junio de 2026; revisión ATLAS 2026-09',true,'{}'),
('R11',11,'Conservación de registros','FINANCIAL_INSTITUTION','Requiere conservar información suficiente de operaciones y debida diligencia para permitir reconstrucción y disponibilidad ante autoridad competente.','Se asocia a funciones financieras/VASP cuando la actividad cae dentro del perímetro relevante.','https://www.fatf-gafi.org/en/publications/Fatfrecommendations/Fatf-recommendations.html',null,'Recomendaciones GAFI actualizadas a junio de 2026; revisión ATLAS 2026-09',true,'{}'),
('R14',14,'Servicios de transferencia de dinero o valores','MVTS','Exige que los proveedores de servicios de transferencia de dinero o valores estén sujetos a licencia/registro y monitoreo, incluyendo controles sobre agentes cuando corresponda.','Referencia principal para remesas, money transfer y modelos equivalentes; sirve para caracterizar la naturaleza funcional del actor, no para concluir incumplimiento.','https://www.fatf-gafi.org/en/publications/Fatfrecommendations/Fatf-recommendations.html',null,'Recomendaciones GAFI actualizadas a junio de 2026; revisión ATLAS 2026-09',true,'{}'),
('R15',15,'Nuevas tecnologías','NEW_TECH_VA','Aborda riesgos de nuevos productos, prácticas comerciales, mecanismos de distribución y tecnologías; la Nota Interpretativa extiende el marco a activos virtuales y VASP, incluyendo licencia/registro y supervisión según corresponda.','Es el eje principal de caracterización para actividades de activos virtuales y un contexto relevante para modelos financieros digitales novedosos.','https://www.fatf-gafi.org/en/publications/Fatfrecommendations/Fatf-recommendations.html','https://www.fatf-gafi.org/en/publications/Fatfrecommendations/targeted-updated-virtualassets-vasps-2026.html','R.15/INR.15 + guía VA/VASP + 7th Targeted Update julio 2026; revisión ATLAS 2026-09',true,'{"virtual_assets":true}'),
('R16',16,'Transparencia de pagos y transferencias','PAYMENT_TRANSPARENCY','Busca que la información necesaria sobre ordenante y beneficiario acompañe las transferencias y que existan responsabilidades claras a lo largo de la cadena de pago. INR.15 aplica los principios pertinentes a transferencias de activos virtuales (Travel Rule).','Referencia principal para pagos, remesas y transferencias VA. Se muestra como contexto funcional y no como evaluación de cumplimiento individual.','https://www.fatf-gafi.org/en/publications/Fatfrecommendations/recommendation-16-payment-transparency.html','https://www.fatf-gafi.org/en/publications/Fatfrecommendations/Guidance-rba-virtual-assets-2021.html','R.16 revisada junio 2025; estándares GAFI actualizados junio 2026; transición esperada a fin de 2030',true,'{"travel_rule_relevance":true}'),
('R18',18,'Controles internos y sucursales/filiales','INTERNAL_CONTROLS','Requiere programas internos AML/CFT adecuados y aplicación coherente en grupos financieros, sucursales y filiales cuando corresponda.','Útil para caracterizar actores con operación multinacional, grupos o múltiples vehículos jurídicos.','https://www.fatf-gafi.org/en/publications/Fatfrecommendations/Fatf-recommendations.html',null,'Recomendaciones GAFI actualizadas a junio de 2026; revisión ATLAS 2026-09',true,'{}'),
('R20',20,'Reporte de operaciones sospechosas','STR','Establece el deber de reportar prontamente sospechas de fondos vinculados a actividad delictiva o financiamiento del terrorismo para las entidades alcanzadas.','ATLAS la presenta sólo como referencia funcional para categorías financieras/VASP; la obligación concreta se determina por la legislación aplicable y no por este radar.','https://www.fatf-gafi.org/en/publications/Fatfrecommendations/Fatf-recommendations.html',null,'Recomendaciones GAFI actualizadas a junio de 2026; revisión ATLAS 2026-09',true,'{}'),
('R24',24,'Transparencia y beneficiario final de personas jurídicas','LEGAL_PERSON_BO','Busca disponibilidad de información adecuada, exacta y actualizada sobre beneficiarios finales y control de personas jurídicas.','Se incorpora como contexto de actor→vehículos jurídicos y estructura societaria, especialmente útil cuando una marca opera mediante múltiples sociedades.','https://www.fatf-gafi.org/en/publications/Fatfrecommendations/Fatf-recommendations.html',null,'Recomendaciones GAFI actualizadas a junio de 2026; revisión ATLAS 2026-09',true,'{}'),
('R26',26,'Regulación y supervisión de instituciones financieras','SUPERVISION','Establece que las instituciones financieras estén sujetas a regulación y supervisión AML/CFT acorde al riesgo.','Se utiliza para contextualizar la huella regulatoria pública CMF/UAF/otros supervisores de funciones financieras; no convierte una ausencia observada en incumplimiento.','https://www.fatf-gafi.org/en/publications/Fatfrecommendations/Fatf-recommendations.html',null,'Recomendaciones GAFI actualizadas a junio de 2026; revisión ATLAS 2026-09',true,'{}'),
('R27',27,'Facultades de los supervisores','SUPERVISION_CONTEXT','Requiere que los supervisores dispongan de facultades adecuadas para supervisar y exigir cumplimiento.','Contexto institucional del perímetro supervisor; no es una obligación que ATLAS atribuya directamente a la entidad caracterizada.','https://www.fatf-gafi.org/en/publications/Fatfrecommendations/Fatf-recommendations.html',null,'Recomendaciones GAFI actualizadas a junio de 2026; revisión ATLAS 2026-09',true,'{}')
on conflict(rec_code) do update set recommendation_no=excluded.recommendation_no,title_es=excluded.title_es,scope_code=excluded.scope_code,summary_es=excluded.summary_es,characterization_note=excluded.characterization_note,primary_source_url=excluded.primary_source_url,secondary_source_url=excluded.secondary_source_url,version_label=excluded.version_label,active=true,metadata=excluded.metadata,reviewed_at=now();

-- Core function→recommendation mappings. Rationale is intentionally descriptive,
-- not a determination that a local legal obligation applies to the actor.
insert into public.aml_fintech_fatf_function_map(function_code,rec_code,relevance_level,rationale_es,applicability_note)
select f,'R15',case when f in ('VA_FIAT_EXCHANGE','VA_VA_EXCHANGE','VA_TRANSFER','VA_CUSTODY_ADMIN','VA_ISSUER_FIN_SERVICES','VA_ON_OFF_RAMP','FIN_CROWDFUNDING','FIN_OPEN_FINANCE','FIN_INSURTECH') then 'PRIMARY' when f in ('VA_CRYPTO_PAYMENTS','VA_HOSTED_WALLET','VA_P2P','VA_STABLECOIN_SERVICES','VA_DEFI_ACCESS') then 'CONDITIONAL' else 'CONTEXTUAL' end,
       'R.15 se muestra por pertinencia funcional con nuevas tecnologías o activos virtuales; confirmar el rol efectivo del proveedor.',
       case when f='VA_ON_OFF_RAMP' then 'Confirmar si actúa como principal/intermediario o sólo infraestructura técnica.' else null end
from unnest(array['FIN_ALT_TRADING_SYSTEM','FIN_CARDS','FIN_CREDIT_ADVISORY','FIN_CROWDFUNDING','FIN_INSURTECH','FIN_INVESTMENT','FIN_INVESTMENT_ADVISORY','FIN_LENDING','FIN_OPEN_FINANCE','FIN_PAYMENTS','FIN_REGTECH','VA_CRYPTO_PAYMENTS','VA_CUSTODY_ADMIN','VA_DEFI_ACCESS','VA_FIAT_EXCHANGE','VA_HOSTED_WALLET','VA_ISSUER_FIN_SERVICES','VA_ON_OFF_RAMP','VA_P2P','VA_STABLECOIN_SERVICES','VA_TRANSFER','VA_UNHOSTED_WALLET_SUPPORT','VA_VA_EXCHANGE']) f
on conflict(function_code,rec_code) do update set relevance_level=excluded.relevance_level,rationale_es=excluded.rationale_es,applicability_note=excluded.applicability_note;

insert into public.aml_fintech_fatf_function_map(function_code,rec_code,relevance_level,rationale_es)
select f,'R16',case when f in ('FIN_CARDS','FIN_PAYMENTS','FIN_REMITTANCE_FX','VA_CRYPTO_PAYMENTS','VA_TRANSFER') then 'PRIMARY' when f in ('FIN_OPEN_FINANCE','VA_CUSTODY_ADMIN','VA_HOSTED_WALLET','VA_ON_OFF_RAMP','VA_P2P','VA_STABLECOIN_SERVICES') then 'CONDITIONAL' else 'CONTEXTUAL' end,'R.16 se muestra para caracterizar transparencia de pagos/transferencias y, mediante INR.15, transferencias VA.'
from unnest(array['FIN_CARDS','FIN_OPEN_FINANCE','FIN_PAYMENTS','FIN_REMITTANCE_FX','VA_CRYPTO_PAYMENTS','VA_CUSTODY_ADMIN','VA_HOSTED_WALLET','VA_ON_OFF_RAMP','VA_P2P','VA_STABLECOIN_SERVICES','VA_TRANSFER','VA_UNHOSTED_WALLET_SUPPORT']) f
on conflict(function_code,rec_code) do update set relevance_level=excluded.relevance_level,rationale_es=excluded.rationale_es;

insert into public.aml_fintech_fatf_function_map(function_code,rec_code,relevance_level,rationale_es,applicability_note)
values('FIN_REMITTANCE_FX','R14','PRIMARY','La función observada corresponde a remesas/FX/transferencia de valor.','Confirmar alcance jurídico local y si el actor presta directamente el servicio o sólo infraestructura.')
on conflict(function_code,rec_code) do update set relevance_level=excluded.relevance_level,rationale_es=excluded.rationale_es,applicability_note=excluded.applicability_note;

-- Supporting financial/VASP context for CDD, records, controls, reporting and supervision.
with funcs(f) as (values
 ('FIN_ALT_TRADING_SYSTEM'),('FIN_CARDS'),('FIN_CROWDFUNDING'),('FIN_FINANCIAL_CUSTODY'),('FIN_FINANCIAL_INTERMEDIATION'),('FIN_INVESTMENT'),('FIN_LENDING'),('FIN_PAYMENTS'),('FIN_REMITTANCE_FX'),('VA_CUSTODY_ADMIN'),('VA_FIAT_EXCHANGE'),('VA_ISSUER_FIN_SERVICES'),('VA_TRANSFER'),('VA_VA_EXCHANGE')),
recs(r) as (values('R10'),('R11'),('R18'),('R20'),('R26'))
insert into public.aml_fintech_fatf_function_map(function_code,rec_code,relevance_level,rationale_es)
select f,r,
 case when r='R10' and f in ('FIN_FINANCIAL_CUSTODY','FIN_FINANCIAL_INTERMEDIATION','FIN_INVESTMENT','FIN_LENDING') then 'PRIMARY'
      when r in ('R10','R11','R18','R20') and left(f,3)='VA_' then 'SUPPORTING'
      when r='R26' then 'CONTEXTUAL'
      when f in ('FIN_PAYMENTS','FIN_CARDS','FIN_CROWDFUNDING') then 'CONDITIONAL'
      else 'SUPPORTING' end,
 case r when 'R10' then 'Contexto de debida diligencia cuando la actividad está jurídicamente alcanzada.' when 'R11' then 'Contexto de conservación de registros y trazabilidad.' when 'R18' then 'Contexto de controles internos y grupos.' when 'R20' then 'Contexto de reporte cuando corresponda bajo la legislación aplicable.' else 'Contexto de regulación y supervisión pública.' end
from funcs cross join recs
on conflict(function_code,rec_code) do update set relevance_level=excluded.relevance_level,rationale_es=excluded.rationale_es;

insert into public.aml_fintech_fatf_characterization_theme(theme_code,title_es,description_es,source_code,source_url,source_date,relevance_note,active,metadata)
values
('LEGAL_VEHICLE_BO','Vehículos jurídicos y beneficiario final','Caracterizar la relación actor/marca→vehículos jurídicos, jurisdicciones, roles y disponibilidad de información de control/beneficiario final en fuentes abiertas.','FATF_RECOMMENDATIONS','https://www.fatf-gafi.org/en/publications/Fatfrecommendations/Fatf-recommendations.html',null,'Contexto de R.24 para comprender estructuras multi-vehículo; no implica opacidad ni riesgo por sí mismo.',true,'{}'),
('PAYMENT_R16_TRANSITION','Transparencia de pagos R.16','Caracterizar roles en la cadena de pago, información de ordenante/beneficiario, pagos transfronterizos y herramientas declaradas contra fraude/error.','FATF_R16','https://www.fatf-gafi.org/en/publications/Fatfrecommendations/recommendation-16-payment-transparency.html','2025-06-18','R.16 fue reforzada en junio de 2025; GAFI espera implementación de los cambios hacia fines de 2030.',true,'{"transition_end":"2030-12-31"}'),
('VA_DEFI_CONTROL','DeFi: control, influencia y facilitación','Para servicios DeFi, caracterizar si existe una persona o entidad que mantenga control o influencia suficiente, opere interfaz, administre claves, cobre comisiones o facilite servicios.','FATF_DEFI_2026','https://www.fatf-gafi.org/en/publications/Virtualassets/targeted-report-decentralised-finance-2026.html','2026-07-21','La etiqueta DeFi no determina exclusión del estándar: el análisis debe centrarse en personas que controlan o facilitan funciones.',true,'{}'),
('VA_LICENSE_REGISTRATION','Licenciamiento o registro VASP','Caracterizar si el actor y sus vehículos jurídicos muestran licencia/registro VASP o equivalente, en qué jurisdicción y para qué funciones.','FATF_VA_UPDATE_2026','https://www.fatf-gafi.org/en/publications/Fatfrecommendations/targeted-updated-virtualassets-vasps-2026.html','2026-07-16','GAFI identifica como brecha persistente la implementación práctica de marcos de licencia/registro. Ausencia pública observada no equivale a incumplimiento.',true,'{}'),
('VA_OFFSHORE_CROSSBORDER','Operación offshore y transfronteriza','Identificar jurisdicción de origen, licencias, países atendidos, vehículos locales y prestación remota/transfronteriza.','FATF_VA_UPDATE_2026','https://www.fatf-gafi.org/en/publications/Fatfrecommendations/targeted-updated-virtualassets-vasps-2026.html','2026-07-16','GAFI destaca VASP offshore fuera de supervisión efectiva como desafío global; ATLAS sólo caracteriza presencia y huella regulatoria abierta.',true,'{}'),
('VA_P2P_UNHOSTED','P2P y wallets no alojadas','Caracterizar soporte a P2P, autocustodia y wallets no alojadas, diferenciando software/infraestructura de intermediación efectiva.','FATF_VA_UPDATE_2026','https://www.fatf-gafi.org/en/publications/Fatfrecommendations/targeted-updated-virtualassets-vasps-2026.html','2026-07-16','GAFI destaca P2P vía unhosted wallets como área que requiere comprensión y mitigación basada en riesgo.',true,'{}'),
('VA_STABLECOINS','Exposición funcional a stablecoins','Distinguir uso de stablecoins como activo de negociación, rampa, transferencia, pagos, liquidación o infraestructura.','FATF_VA_UPDATE_2026','https://www.fatf-gafi.org/en/publications/Fatfrecommendations/targeted-updated-virtualassets-vasps-2026.html','2026-07-16','GAFI destaca el uso creciente y riesgos emergentes de stablecoins; en ATLAS se usa para descripción funcional, no como señal negativa.',true,'{}'),
('VA_TRAVEL_RULE','Travel Rule / transparencia de transferencias VA','Caracterizar si el actor ejecuta transferencias VA, qué contrapartes/wallets admite y qué información de originador/beneficiario declara recopilar o transmitir.','FATF_VA_UPDATE_2026','https://www.fatf-gafi.org/en/publications/Fatfrecommendations/targeted-updated-virtualassets-vasps-2026.html','2026-07-16','La actualización 2026 destaca la implementación de Travel Rule como componente central de R.15.',true,'{}')
on conflict(theme_code) do update set title_es=excluded.title_es,description_es=excluded.description_es,source_code=excluded.source_code,source_url=excluded.source_url,source_date=excluded.source_date,relevance_note=excluded.relevance_note,active=true,metadata=excluded.metadata,reviewed_at=now();

insert into public.aml_fintech_fatf_theme_function_map(theme_code,function_code,relevance_level,rationale_es)
values
('PAYMENT_R16_TRANSITION','FIN_CARDS','PRIMARY','Emisión/operación de medios de pago.'),('PAYMENT_R16_TRANSITION','FIN_OPEN_FINANCE','CONDITIONAL','Pertinente si existe iniciación de pagos.'),('PAYMENT_R16_TRANSITION','FIN_PAYMENTS','PRIMARY','Procesamiento/adquirencia en cadena de pagos.'),('PAYMENT_R16_TRANSITION','FIN_REMITTANCE_FX','PRIMARY','Transferencia transfronteriza de valor.'),('PAYMENT_R16_TRANSITION','VA_TRANSFER','PRIMARY','Aplicación a VA a través de INR.15.'),
('VA_DEFI_CONTROL','VA_DEFI_ACCESS','PRIMARY','Función DeFi observada.'),
('VA_LICENSE_REGISTRATION','VA_CUSTODY_ADMIN','PRIMARY','Función VASP nuclear.'),('VA_LICENSE_REGISTRATION','VA_FIAT_EXCHANGE','PRIMARY','Función VASP nuclear.'),('VA_LICENSE_REGISTRATION','VA_ISSUER_FIN_SERVICES','PRIMARY','Función VASP nuclear.'),('VA_LICENSE_REGISTRATION','VA_TRANSFER','PRIMARY','Función VASP nuclear.'),('VA_LICENSE_REGISTRATION','VA_VA_EXCHANGE','PRIMARY','Función VASP nuclear.'),
('VA_OFFSHORE_CROSSBORDER','FIN_REMITTANCE_FX','PRIMARY','Remesas/FX son inherentemente relevantes para presencia transfronteriza.'),('VA_OFFSHORE_CROSSBORDER','VA_FIAT_EXCHANGE','CONTEXTUAL','Intercambio VA puede prestarse transfronterizamente.'),('VA_OFFSHORE_CROSSBORDER','VA_TRANSFER','CONTEXTUAL','Transferencias VA suelen involucrar contrapartes/jurisdicciones múltiples.'),
('VA_P2P_UNHOSTED','VA_P2P','PRIMARY','Servicio P2P observado.'),('VA_P2P_UNHOSTED','VA_TRANSFER','CONTEXTUAL','Transferencias pueden involucrar wallets no alojadas.'),('VA_P2P_UNHOSTED','VA_UNHOSTED_WALLET_SUPPORT','PRIMARY','Soporte a autocustodia/wallet externa.'),
('VA_STABLECOINS','VA_FIAT_EXCHANGE','CONTEXTUAL','Puede incluir ramps con stablecoins.'),('VA_STABLECOINS','VA_STABLECOIN_SERVICES','PRIMARY','La función declara o infiere servicios con stablecoins.'),('VA_STABLECOINS','VA_TRANSFER','CONTEXTUAL','Puede incluir transferencias de stablecoins.'),
('VA_TRAVEL_RULE','VA_CRYPTO_PAYMENTS','CONDITIONAL','Pertinente si el proveedor transmite VA entre partes.'),('VA_TRAVEL_RULE','VA_CUSTODY_ADMIN','CONDITIONAL','Pertinente si el custodio ejecuta transferencias.'),('VA_TRAVEL_RULE','VA_TRANSFER','PRIMARY','Transferencia VA es el caso principal de Travel Rule.')
on conflict(theme_code,function_code) do update set relevance_level=excluded.relevance_level,rationale_es=excluded.rationale_es;

create or replace function public.aml_fintech_fatf_profile_internal(p_fintech_id text)
returns jsonb language sql stable set search_path=public,pg_temp as $$
with obs as (
 select o.function_code,max(o.confidence) confidence,bool_or(o.evidence_status='OBSERVED') observed,
        jsonb_agg(distinct jsonb_build_object('status',o.evidence_status,'class',o.evidence_class,'source_code',o.source_code,'source_url',o.source_url,'confidence',o.confidence)) evidence
 from public.aml_fintech_function_observation o
 where o.subject_type='ENTITY' and o.subject_key=p_fintech_id and ((left(o.function_code,3)='VA_' and o.confidence>=0.85) or (left(o.function_code,3)<>'VA_' and (o.evidence_class='OFFICIAL_OPEN' or o.confidence>=0.95)))
 group by o.function_code
), mapped as (
 select m.rec_code,m.relevance_level,m.rationale_es,m.applicability_note,jsonb_agg(jsonb_build_object('function_code',o.function_code,'confidence',o.confidence,'observed',o.observed,'evidence',o.evidence) order by o.function_code) functions
 from obs o join public.aml_fintech_fatf_function_map m using(function_code) group by m.rec_code,m.relevance_level,m.rationale_es,m.applicability_note
), ranked as (
 select rec_code,case max(case relevance_level when 'PRIMARY' then 4 when 'SUPPORTING' then 3 when 'CONDITIONAL' then 2 else 1 end) when 4 then 'PRIMARY' when 3 then 'SUPPORTING' when 2 then 'CONDITIONAL' else 'CONTEXTUAL' end relevance_level,
        jsonb_agg(jsonb_build_object('relevance_level',relevance_level,'rationale',rationale_es,'applicability_note',applicability_note,'functions',functions)) mappings
 from mapped group by rec_code
), legal_context as (select count(*)::int vehicles from public.aml_fintech_legal_vehicle where fintech_id=p_fintech_id), recs as (
 select r.rec_code,r.recommendation_no,r.title_es,r.scope_code,r.summary_es,r.characterization_note,r.primary_source_url,r.secondary_source_url,r.version_label,x.relevance_level,x.mappings from ranked x join public.aml_fintech_fatf_recommendation r using(rec_code)
 union all
 select r.rec_code,r.recommendation_no,r.title_es,r.scope_code,r.summary_es,r.characterization_note,r.primary_source_url,r.secondary_source_url,r.version_label,'CONTEXTUAL',jsonb_build_array(jsonb_build_object('rationale','La entidad posee uno o más vehículos jurídicos identificados en ATLAS; R.24 se utiliza como contexto de transparencia societaria.','vehicles',(select vehicles from legal_context))) from public.aml_fintech_fatf_recommendation r where r.rec_code='R24' and (select vehicles from legal_context)>0
)
select jsonb_build_object('framework','GAFI/FATF','purpose','Caracterización funcional. No constituye evaluación de riesgo, cumplimiento ni conclusión jurídica.','method_note','Funciones VA: umbral mínimo 0,85. Funciones financieras convencionales: sólo evidencia oficial abierta o confianza >=0,95. Las recomendaciones se muestran por pertinencia funcional, no como obligación jurídica determinada por ATLAS.','recommendations',coalesce(jsonb_agg(jsonb_build_object('rec_code',rec_code,'recommendation_no',recommendation_no,'title',title_es,'scope',scope_code,'relevance_level',relevance_level,'summary',summary_es,'characterization_note',characterization_note,'mappings',mappings,'primary_source_url',primary_source_url,'secondary_source_url',secondary_source_url,'version_label',version_label) order by recommendation_no),'[]'::jsonb)) from recs;
$$;

create or replace function public.aml_fintech_fatf_theme_profile_internal(p_fintech_id text)
returns jsonb language sql stable set search_path=public,pg_temp as $$
with obs as (
 select o.function_code,max(o.confidence) confidence,jsonb_agg(distinct jsonb_build_object('status',o.evidence_status,'class',o.evidence_class,'source_code',o.source_code,'source_url',o.source_url,'confidence',o.confidence)) evidence
 from public.aml_fintech_function_observation o where o.subject_type='ENTITY' and o.subject_key=p_fintech_id and ((left(o.function_code,3)='VA_' and o.confidence>=0.85) or (left(o.function_code,3)<>'VA_' and (o.evidence_class='OFFICIAL_OPEN' or o.confidence>=0.95))) group by o.function_code
), tm as (
 select t.theme_code,t.title_es,t.description_es,t.source_code,t.source_url,t.source_date,t.relevance_note,case max(case m.relevance_level when 'PRIMARY' then 3 when 'CONDITIONAL' then 2 else 1 end) when 3 then 'PRIMARY' when 2 then 'CONDITIONAL' else 'CONTEXTUAL' end relevance_level,jsonb_agg(jsonb_build_object('function_code',o.function_code,'confidence',o.confidence,'evidence',o.evidence,'rationale',m.rationale_es) order by o.function_code) functions
 from obs o join public.aml_fintech_fatf_theme_function_map m using(function_code) join public.aml_fintech_fatf_characterization_theme t using(theme_code) where t.active group by t.theme_code,t.title_es,t.description_es,t.source_code,t.source_url,t.source_date,t.relevance_note
), legal_theme as (
 select t.theme_code,t.title_es,t.description_es,t.source_code,t.source_url,t.source_date,t.relevance_note,'CONTEXTUAL' relevance_level,jsonb_build_array(jsonb_build_object('legal_vehicle_count',count(*)::int,'rationale','ATLAS identificó uno o más vehículos jurídicos; el tema se usa para ordenar marca, vehículos y transparencia societaria.')) functions
 from public.aml_fintech_fatf_characterization_theme t join public.aml_fintech_legal_vehicle v on v.fintech_id=p_fintech_id where t.theme_code='LEGAL_VEHICLE_BO' group by t.theme_code,t.title_es,t.description_es,t.source_code,t.source_url,t.source_date,t.relevance_note
)
select coalesce(jsonb_agg(jsonb_build_object('theme_code',theme_code,'title',title_es,'description',description_es,'relevance_level',relevance_level,'relevance_note',relevance_note,'functions',functions,'source_code',source_code,'source_url',source_url,'source_date',source_date) order by case relevance_level when 'PRIMARY' then 1 when 'CONDITIONAL' then 2 else 3 end,title_es),'[]'::jsonb) from (select * from tm union all select * from legal_theme) x;
$$;

create or replace function public.obs_fintech_fatf_profile(p_fintech_id text)
returns jsonb language plpgsql stable security definer set search_path=public,extensions,pg_temp as $$
declare ok boolean; result jsonb;
begin
 select exists(select 1 from public.aml_allowed_users au where au.user_id=auth.uid() and au.enabled) into ok;
 if not ok then return jsonb_build_object('error','NOT_AUTHORIZED'); end if;
 select public.aml_fintech_fatf_profile_internal(p_fintech_id)||jsonb_build_object('characterization_themes',public.aml_fintech_fatf_theme_profile_internal(p_fintech_id)) into result;
 return result;
end;$$;
revoke all on function public.obs_fintech_fatf_profile(text) from public,anon;
grant execute on function public.obs_fintech_fatf_profile(text) to authenticated,service_role;

create or replace function public.obs_fintech_entity_detail(p_fintech_id text)
returns jsonb language plpgsql stable security definer set search_path=public,extensions,pg_temp as $$
declare ok boolean; result jsonb;
begin
 select exists(select 1 from public.aml_allowed_users au where au.user_id=auth.uid() and au.enabled) into ok;
 if not ok then return jsonb_build_object('error','NOT_AUTHORIZED'); end if;
 select jsonb_build_object(
  'entity',to_jsonb(e),
  'aliases',coalesce((select jsonb_agg(to_jsonb(al) order by al.active desc,al.alias_type,al.alias_text) from public.aml_fintech_actor_alias al where al.fintech_id=e.fintech_id),'[]'::jsonb),
  'legal_vehicles',coalesce((select jsonb_agg(to_jsonb(v) order by v.is_primary desc,v.role_code,v.legal_name) from public.aml_fintech_legal_vehicle v where v.fintech_id=e.fintech_id),'[]'::jsonb),
  'activities',coalesce((select jsonb_agg(to_jsonb(a) order by a.is_primary desc,a.activity_label) from public.aml_fintech_activity a where a.fintech_id=e.fintech_id),'[]'::jsonb),
  'regulation',coalesce((select jsonb_agg(to_jsonb(r) order by r.regulator,r.registry,r.service) from public.aml_fintech_regulatory_status r where r.fintech_id=e.fintech_id),'[]'::jsonb),
  'market_metrics',coalesce((select jsonb_agg(jsonb_build_object('metric_id',o.observation_id,'metric_code',o.metric_code,'value_numeric',o.value_numeric,'value_text',o.value_text,'unit',o.unit,'currency',o.currency,'period_start',o.period_start,'period_end',o.period_end,'evidence_type',o.evidence_type,'confidence',o.confidence,'source_code',o.source_code,'source_url',o.source_url,'observed_at',o.observed_at) order by coalesce(o.period_end,o.period_start) desc nulls last,o.observed_at desc) from public.aml_fintech_market_metric_observation o where o.subject_type='ENTITY' and o.subject_key=e.fintech_id),'[]'::jsonb),
  'events',coalesce((select jsonb_agg(to_jsonb(ev) order by ev.event_date desc nulls last,ev.observed_at desc) from public.aml_fintech_event ev where ev.fintech_id=e.fintech_id),'[]'::jsonb),
  'sources',coalesce((select jsonb_agg(jsonb_build_object('source_code',es.source_code,'source_label',es.source_label,'source_url',es.source_url,'status',es.status,'evidence',es.evidence,'first_seen_at',es.first_seen_at,'last_seen_at',es.last_seen_at,'catalog_label',sc.label,'authority_level',sc.authority_level) order by sc.authority_level,sc.label) from public.aml_fintech_entity_source es join public.aml_fintech_source_catalog sc using(source_code) where es.fintech_id=e.fintech_id),'[]'::jsonb),
  'market_weight',jsonb_build_object('sales_band',e.sii_sales_band,'sales_band_rank',e.sii_sales_band_rank,'workers',e.sii_workers,'metric_count',(select count(*) from public.aml_fintech_market_metric_observation o where o.subject_type='ENTITY' and o.subject_key=e.fintech_id and o.evidence_type<>'NO_OBSERVABLE'),'dimensions',coalesce((select jsonb_agg(to_jsonb(d) order by d.dimension) from public.aml_fintech_market_dimension_snapshot d where d.subject_type='ENTITY' and d.subject_key=e.fintech_id),'[]'::jsonb),'note','Escala observable: combina dimensiones separadas y métricas comparables sólo dentro de la misma métrica. No constituye un score de riesgo ni un ranking universal.'),
  'fatf_context',public.aml_fintech_fatf_profile_internal(e.fintech_id)||jsonb_build_object('characterization_themes',public.aml_fintech_fatf_theme_profile_internal(e.fintech_id)),
  'boundary_note','Ficha construida sólo con fuentes abiertas. El contexto GAFI indica pertinencia funcional y no constituye evaluación de riesgo, cumplimiento ni conclusión jurídica. Los datos reservados UAF deben incorporarse únicamente en el estudio posterior y fuera de ATLAS.'
 ) into result from public.aml_v_fintech_entity_current e where e.fintech_id=p_fintech_id;
 return result;
end;$$;
