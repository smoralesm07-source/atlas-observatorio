create or replace function atlas_private.aml_fintech_refresh_market_cohorts_v1()
returns jsonb
language plpgsql
security definer
set search_path to 'public','atlas_private','pg_temp'
as $$
declare v_rows integer := 0;
begin
  delete from atlas_private.aml_fintech_market_cohort_snapshot_v1;

  insert into atlas_private.aml_fintech_market_cohort_snapshot_v1(
    fintech_id,cohort_code,cohort_label,source_vertical,assignment_basis,assignment_confidence,
    primary_function_code,function_count,metric_count,refreshed_at
  )
  select e.fintech_id,
    case
      when e.primary_vertical in ('Activos Digitales','Activos Digitales / Pagos internacionales') then 'DIGITAL_ASSETS'
      when e.primary_vertical in ('Negociación de activos financieros y digitales','Activos Digitales / WealthTech') and exists (
        select 1 from public.aml_fintech_function_observation o join public.aml_fintech_function_catalog c using(function_code)
        where o.subject_type='ENTITY' and o.subject_key=e.fintech_id and o.evidence_status in ('OBSERVED','PROBABLE') and (c.fatf_vasp or c.function_group='VA_CONTEXT')
      ) then 'DIGITAL_ASSETS'
      when e.primary_vertical in ('Procesamiento de pagos y remesas','Paytech','Neobancos','Pagos / gestión financiera para Pymes','Mercados / FX institucional') then 'PAYMENTS_REMITTANCES'
      when e.primary_vertical in ('Financiamiento alternativo y préstamos','Crédito Digital','Crowdfunding') then 'LENDING_FINANCING'
      when e.primary_vertical in ('WealthTech','WealthTech / Asesoría de inversión','Intermediación de Instrumentos Financieros','Sistemas Alternativos de Transacción','Custodia de Instrumentos Financieros','Negociación de activos financieros y digitales','Activos Digitales / WealthTech') then 'WEALTH_MARKETS'
      when e.primary_vertical='Insurtech' then 'INSURTECH'
      when e.primary_vertical in ('Gestión de finanzas personales y empresariales','BFM','PFM') then 'FINANCE_MANAGEMENT'
      when exists (
        select 1 from public.aml_fintech_function_observation o join public.aml_fintech_function_catalog c using(function_code)
        where o.subject_type='ENTITY' and o.subject_key=e.fintech_id and o.evidence_status='OBSERVED' and (c.fatf_vasp or c.function_group='VA_CONTEXT')
      ) then 'DIGITAL_ASSETS'
      when exists (
        select 1 from public.aml_fintech_function_observation o where o.subject_type='ENTITY' and o.subject_key=e.fintech_id and o.evidence_status='OBSERVED' and o.function_code in ('FIN_PAYMENTS','FIN_REMITTANCE_FX','FIN_CARDS')
      ) then 'PAYMENTS_REMITTANCES'
      when exists (
        select 1 from public.aml_fintech_function_observation o where o.subject_type='ENTITY' and o.subject_key=e.fintech_id and o.evidence_status='OBSERVED' and o.function_code in ('FIN_LENDING','FIN_CROWDFUNDING')
      ) then 'LENDING_FINANCING'
      when exists (
        select 1 from public.aml_fintech_function_observation o where o.subject_type='ENTITY' and o.subject_key=e.fintech_id and o.evidence_status='OBSERVED' and o.function_code in ('FIN_INVESTMENT','FIN_INVESTMENT_ADVISORY','FIN_FINANCIAL_INTERMEDIATION','FIN_ALT_TRADING_SYSTEM','FIN_FINANCIAL_CUSTODY')
      ) then 'WEALTH_MARKETS'
      when exists (
        select 1 from public.aml_fintech_function_observation o where o.subject_type='ENTITY' and o.subject_key=e.fintech_id and o.evidence_status='OBSERVED' and o.function_code='FIN_INSURTECH'
      ) then 'INSURTECH'
      else 'FINANCIAL_INFRASTRUCTURE'
    end as cohort_code,
    case
      when e.primary_vertical in ('Activos Digitales','Activos Digitales / Pagos internacionales') then 'Activos digitales'
      when e.primary_vertical in ('Negociación de activos financieros y digitales','Activos Digitales / WealthTech') and exists (
        select 1 from public.aml_fintech_function_observation o join public.aml_fintech_function_catalog c using(function_code)
        where o.subject_type='ENTITY' and o.subject_key=e.fintech_id and o.evidence_status in ('OBSERVED','PROBABLE') and (c.fatf_vasp or c.function_group='VA_CONTEXT')
      ) then 'Activos digitales'
      when e.primary_vertical in ('Procesamiento de pagos y remesas','Paytech','Neobancos','Pagos / gestión financiera para Pymes','Mercados / FX institucional') then 'Pagos, remesas y banca digital'
      when e.primary_vertical in ('Financiamiento alternativo y préstamos','Crédito Digital','Crowdfunding') then 'Crédito y financiamiento'
      when e.primary_vertical in ('WealthTech','WealthTech / Asesoría de inversión','Intermediación de Instrumentos Financieros','Sistemas Alternativos de Transacción','Custodia de Instrumentos Financieros','Negociación de activos financieros y digitales','Activos Digitales / WealthTech') then 'Wealth, inversión y mercados'
      when e.primary_vertical='Insurtech' then 'Insurtech'
      when e.primary_vertical in ('Gestión de finanzas personales y empresariales','BFM','PFM') then 'Gestión financiera'
      when exists (
        select 1 from public.aml_fintech_function_observation o join public.aml_fintech_function_catalog c using(function_code)
        where o.subject_type='ENTITY' and o.subject_key=e.fintech_id and o.evidence_status='OBSERVED' and (c.fatf_vasp or c.function_group='VA_CONTEXT')
      ) then 'Activos digitales'
      when exists (
        select 1 from public.aml_fintech_function_observation o where o.subject_type='ENTITY' and o.subject_key=e.fintech_id and o.evidence_status='OBSERVED' and o.function_code in ('FIN_PAYMENTS','FIN_REMITTANCE_FX','FIN_CARDS')
      ) then 'Pagos, remesas y banca digital'
      when exists (
        select 1 from public.aml_fintech_function_observation o where o.subject_type='ENTITY' and o.subject_key=e.fintech_id and o.evidence_status='OBSERVED' and o.function_code in ('FIN_LENDING','FIN_CROWDFUNDING')
      ) then 'Crédito y financiamiento'
      when exists (
        select 1 from public.aml_fintech_function_observation o where o.subject_type='ENTITY' and o.subject_key=e.fintech_id and o.evidence_status='OBSERVED' and o.function_code in ('FIN_INVESTMENT','FIN_INVESTMENT_ADVISORY','FIN_FINANCIAL_INTERMEDIATION','FIN_ALT_TRADING_SYSTEM','FIN_FINANCIAL_CUSTODY')
      ) then 'Wealth, inversión y mercados'
      when exists (
        select 1 from public.aml_fintech_function_observation o where o.subject_type='ENTITY' and o.subject_key=e.fintech_id and o.evidence_status='OBSERVED' and o.function_code='FIN_INSURTECH'
      ) then 'Insurtech'
      else 'Infraestructura financiera'
    end as cohort_label,
    e.primary_vertical,
    case
      when e.primary_vertical in ('Activos Digitales','Activos Digitales / Pagos internacionales','Procesamiento de pagos y remesas','Paytech','Neobancos','Pagos / gestión financiera para Pymes','Mercados / FX institucional','Financiamiento alternativo y préstamos','Crédito Digital','Crowdfunding','WealthTech','WealthTech / Asesoría de inversión','Intermediación de Instrumentos Financieros','Sistemas Alternativos de Transacción','Custodia de Instrumentos Financieros','Insurtech','Gestión de finanzas personales y empresariales','BFM','PFM') then 'NORMALIZED_VERTICAL'
      else 'NORMALIZED_VERTICAL_PLUS_OBSERVED_FUNCTIONS'
    end,
    case when e.primary_vertical is null then 0.80 else 0.99 end,
    (
      select o.function_code from public.aml_fintech_function_observation o
      where o.subject_type='ENTITY' and o.subject_key=e.fintech_id and o.evidence_status='OBSERVED'
      order by case o.function_code
        when 'VA_FIAT_EXCHANGE' then 1 when 'VA_TRANSFER' then 2 when 'VA_CUSTODY_ADMIN' then 3 when 'VA_VA_EXCHANGE' then 4
        when 'FIN_PAYMENTS' then 10 when 'FIN_REMITTANCE_FX' then 11 when 'FIN_LENDING' then 20 when 'FIN_CROWDFUNDING' then 21
        when 'FIN_INVESTMENT' then 30 when 'FIN_INVESTMENT_ADVISORY' then 31 when 'FIN_FINANCIAL_INTERMEDIATION' then 32
        when 'FIN_ALT_TRADING_SYSTEM' then 33 when 'FIN_FINANCIAL_CUSTODY' then 34 when 'FIN_INSURTECH' then 40
        when 'FIN_OPEN_FINANCE' then 50 when 'FIN_REGTECH' then 51 when 'FIN_CARDS' then 60 else 99 end,
        o.confidence desc,o.function_code limit 1
    ),
    (select count(distinct o.function_code)::int from public.aml_fintech_function_observation o where o.subject_type='ENTITY' and o.subject_key=e.fintech_id and o.evidence_status='OBSERVED'),
    (select count(distinct o.metric_code)::int from public.aml_fintech_market_metric_observation o where o.subject_type='ENTITY' and o.subject_key=e.fintech_id and o.evidence_type<>'NO_OBSERVABLE'),
    now()
  from public.aml_fintech_entity e;

  get diagnostics v_rows = row_count;
  return jsonb_build_object('cohort_entities',v_rows,'refreshed_at',now());
end
$$;
