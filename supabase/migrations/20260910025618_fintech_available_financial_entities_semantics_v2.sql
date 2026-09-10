update public.aml_fintech_market_metric_catalog
set label='Entidades financieras / de pago disponibles',
    description='Cantidad de bancos, instituciones financieras, wallets o entidades de pago documentadas como disponibles dentro de un producto. No implica contrato bilateral ni conexión API exclusiva.'
where metric_code='FINANCIAL_INSTITUTIONS_AVAILABLE_COUNT';
