delete from public.aml_fintech_function_observation
where subject_type='ENTITY'
  and evidence_class='INFERRED_FROM_DECLARED'
  and (
    (subject_key='ENT-RUT-76415528-9' and function_code in ('FIN_LENDING','FIN_REGTECH','FIN_INVESTMENT'))
    or (subject_key='ENT-RUT-76594721-9' and function_code in ('FIN_CARDS','FIN_INVESTMENT'))
    or (subject_key='ENT-RUT-77638982-K' and function_code='FIN_REGTECH')
  );

insert into public.aml_fintech_function_observation(observation_key,subject_type,subject_key,function_code,evidence_status,evidence_class,confidence,basis,source_code,source_url,evidence_excerpt,first_seen_at,last_seen_at,observed_at) values
('OFFICIAL|KLAP|FIN_PAYMENTS|2026-09-09','ENTITY','ENT-RUT-99546900-6','FIN_PAYMENTS','OBSERVED','OFFICIAL_OPEN',1.0,'Klap ofrece adquirencia, POS, e-commerce, link de pago y procesamiento de tarjetas para comercios.','COMPANY_OFFICIAL','https://www.klap.cl/home-comercios/tiendas-locales-comerciales','Soluciones de pago para comercios y comisiones por transacción.',now(),now(),now()),
('OFFICIAL|CREDITU|FIN_LENDING|2026-09-09','ENTITY','ENT-RUT-76594721-9','FIN_LENDING','OBSERVED','OFFICIAL_OPEN',1.0,'Creditú ofrece crédito hipotecario, pie hipotecario y financiamiento inmobiliario.','COMPANY_OFFICIAL','https://creditu.com/cl/','Crédito Hipotecario y Pie Hipotecario; financiamiento digital.',now(),now(),now()),
('OFFICIAL|KOYWE|FIN_PAYMENTS|2026-09-09','ENTITY','ENT-RUT-77638982-K','FIN_PAYMENTS','OBSERVED','OFFICIAL_OPEN',1.0,'Koywe ofrece pagos/cobros globales, links de pago y QR para empresas.','COMPANY_OFFICIAL','https://www.koywe.com/es/countries/cl','Pagos internacionales, cobros y tesorería para empresas.',now(),now(),now()),
('OFFICIAL|KOYWE|FIN_REMITTANCE_FX|2026-09-09','ENTITY','ENT-RUT-77638982-K','FIN_REMITTANCE_FX','OBSERVED','OFFICIAL_OPEN',1.0,'Koywe permite cobrar en dólares, pagar proveedores internacionales y convertir CLP/stablecoins.','COMPANY_OFFICIAL','https://www.koywe.com/es/countries/cl','Cobra en dólares y opera al exterior desde Chile.',now(),now(),now()),
('OFFICIAL|KOYWE|VA_FIAT_EXCHANGE|2026-09-09','ENTITY','ENT-RUT-77638982-K','VA_FIAT_EXCHANGE','OBSERVED','OFFICIAL_OPEN',1.0,'La oferta Chile permite convertir CLP a USDC/USDT y viceversa.','COMPANY_OFFICIAL','https://www.koywe.com/es/countries/cl','Compra USDC/USDT con pesos chilenos y convierte stablecoins a CLP.',now(),now(),now()),
('OFFICIAL|KOYWE|VA_ON_OFF_RAMP|2026-09-09','ENTITY','ENT-RUT-77638982-K','VA_ON_OFF_RAMP','OBSERVED','OFFICIAL_OPEN',1.0,'Koywe publica servicios de rampa y retiro/abono entre moneda local y activos virtuales.','COMPANY_OFFICIAL','https://www.koywe.com/en/legal/info','Rampa y OTC con remuneración porcentual por operación.',now(),now(),now()),
('OFFICIAL|KOYWE|VA_STABLECOIN_SERVICES|2026-09-09','ENTITY','ENT-RUT-77638982-K','VA_STABLECOIN_SERVICES','OBSERVED','OFFICIAL_OPEN',1.0,'Koywe ofrece USDC y USDT para tesorería, pagos y cobros internacionales.','COMPANY_OFFICIAL','https://www.koywe.com/es/countries/cl','Opera con USDC y USDT desde Chile.',now(),now(),now()),
('OFFICIAL|BUDA|VA_FIAT_EXCHANGE|2026-09-09','ENTITY','ENT-RUT-76415528-9','VA_FIAT_EXCHANGE','OBSERVED','OFFICIAL_OPEN',1.0,'Buda.com permite abonar/retirar moneda local y comprar/vender criptoactivos.','COMPANY_OFFICIAL','https://www.buda.com/productos/cuenta-empresa','Compra y vende criptomonedas desde cuenta personal o empresa.',now(),now(),now()),
('OFFICIAL|BUDA|VA_TRANSFER|2026-09-09','ENTITY','ENT-RUT-76415528-9','VA_TRANSFER','OBSERVED','OFFICIAL_OPEN',1.0,'Buda.com permite enviar y recibir criptomonedas y stablecoins.','COMPANY_OFFICIAL','https://www.buda.com/productos/cuenta-empresa','Envía y recibe activos digitales dentro y fuera del país.',now(),now(),now()),
('OFFICIAL|BUDA|VA_STABLECOIN_SERVICES|2026-09-09','ENTITY','ENT-RUT-76415528-9','VA_STABLECOIN_SERVICES','OBSERVED','OFFICIAL_OPEN',1.0,'Cuenta Empresa ofrece USDT y USDC para cobrar, pagar y administrar liquidez.','COMPANY_OFFICIAL','https://www.buda.com/productos/cuenta-empresa','Stablecoins para cobrar, pagar y administrar liquidez.',now(),now(),now()),
('OFFICIAL|BUDA|VA_CRYPTO_PAYMENTS|2026-09-09','ENTITY','ENT-RUT-76415528-9','VA_CRYPTO_PAYMENTS','OBSERVED','OFFICIAL_OPEN',1.0,'Buda.com publica pagos internacionales y recepción de pagos/donaciones en activos virtuales.','COMPANY_OFFICIAL','https://www.buda.com/productos/cuenta-empresa','Pagos internacionales y recepción de pagos en stablecoins/cripto.',now(),now(),now()),
('OFFICIAL|BUDA|VA_ON_OFF_RAMP|2026-09-09','ENTITY','ENT-RUT-76415528-9','VA_ON_OFF_RAMP','OBSERVED','OFFICIAL_OPEN',1.0,'Cuenta Empresa permite abonar y retirar moneda local y operar activos virtuales.','COMPANY_OFFICIAL','https://www.buda.com/productos/cuenta-empresa','Abonos/retiros CLP, PEN o COP y compra/venta de criptomonedas.',now(),now(),now()),
('OFFICIAL|BUDA|FIN_PAYMENTS|2026-09-09','ENTITY','ENT-RUT-76415528-9','FIN_PAYMENTS','OBSERVED','OFFICIAL_OPEN',0.99,'Cuenta Empresa ofrece pagos internacionales y cobros en stablecoins como función de pagos corporativos.','COMPANY_OFFICIAL','https://www.buda.com/productos/cuenta-empresa','Mueve el dinero de tu empresa dentro y fuera del país.',now(),now(),now())
on conflict(observation_key) do update set evidence_status=excluded.evidence_status,evidence_class=excluded.evidence_class,confidence=excluded.confidence,basis=excluded.basis,source_code=excluded.source_code,source_url=excluded.source_url,evidence_excerpt=excluded.evidence_excerpt,last_seen_at=now(),observed_at=excluded.observed_at;

select public.aml_fintech_refresh_functional_profile();

create or replace function public.obs_fintech_function_detail(p_fintech_id text)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public','pg_temp'
as $function$
declare ok boolean; result jsonb;
begin
  select exists(select 1 from public.aml_allowed_users au where au.user_id=auth.uid() and au.enabled) into ok;
  if not ok then return jsonb_build_object('error','NOT_AUTHORIZED'); end if;
  select jsonb_build_object(
    'psav_status',e.psav_status,'psav_basis',e.psav_basis,'psav_confidence',e.psav_confidence,'psav_refreshed_at',e.psav_refreshed_at,
    'functions',coalesce((select jsonb_agg(jsonb_build_object('function_code',x.function_code,'label',x.label,'group',x.function_group,'fatf_vasp',x.fatf_vasp,'evidence_status',x.evidence_status,'confidence',x.confidence,'basis',x.basis,'source_code',x.source_code,'source_url',x.source_url,'evidence_excerpt',x.evidence_excerpt,'observed_at',x.observed_at) order by x.sort_order,x.confidence desc) from (select distinct on(o.function_code) o.function_code,c.label,c.function_group,c.fatf_vasp,c.sort_order,o.evidence_status,o.confidence,o.basis,o.source_code,o.source_url,o.evidence_excerpt,o.observed_at from public.aml_fintech_function_observation o join public.aml_fintech_function_catalog c using(function_code) where o.subject_type='ENTITY' and o.subject_key=e.fintech_id and o.evidence_status in ('OBSERVED','PROBABLE') order by o.function_code,case o.evidence_class when 'OFFICIAL_OPEN' then 0 when 'DECLARED' then 1 else 2 end,case o.evidence_status when 'OBSERVED' then 0 else 1 end,o.confidence desc,o.observed_at desc) x),'[]'::jsonb),
    'public_footprint',coalesce((select jsonb_agg(jsonb_build_object('function_code',a.function_code,'label',c.label,'fatf_vasp',c.fatf_vasp,'status',a.footprint_status,'explanation',a.explanation,'regulatory_evidence',a.regulatory_evidence,'confidence',a.confidence,'observed_at',a.observed_at) order by c.sort_order) from public.aml_fintech_public_footprint_assessment a join public.aml_fintech_function_catalog c using(function_code) where a.fintech_id=e.fintech_id),'[]'::jsonb),
    'method_note','La ficha muestra una sola evidencia prioritaria por función: primero evidencia oficial abierta, luego declarada y finalmente inferida. La comparación de huella pública no constituye evaluación de cumplimiento ni riesgo.'
  ) into result from public.aml_fintech_entity e where e.fintech_id=p_fintech_id;
  return coalesce(result,jsonb_build_object('error','NOT_FOUND'));
end;
$function$;

revoke all on function public.obs_fintech_function_detail(text) from public,anon;
grant execute on function public.obs_fintech_function_detail(text) to authenticated,service_role;