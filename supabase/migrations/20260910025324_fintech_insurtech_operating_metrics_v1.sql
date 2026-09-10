insert into public.aml_fintech_market_metric_catalog(metric_code,label,dimension,unit_kind,default_unit,default_currency,comparable_scope,higher_means_more_weight,description,sort_order)
values
('CLAIMS_PROCESSED_COUNT','Siniestros procesados','BUSINESS_ACTIVITY','COUNT','claims',null,'SAME_METRIC',true,'Cantidad de siniestros o claims procesados por la plataforma. No equivale a pólizas ni asegurados.',28),
('IMPLEMENTATIONS_COUNT','Implementaciones activas / realizadas','REACH','COUNT','implementations',null,'SAME_METRIC',true,'Cantidad de implementaciones de la solución en aseguradoras u organizaciones. No equivale necesariamente a clientes jurídicos únicos.',51),
('POLICIES_ACTIVE_COUNT','Pólizas vigentes','BUSINESS_ACTIVITY','COUNT','policies',null,'SAME_METRIC',true,'Pólizas vigentes o activas administradas/operadas por la entidad según fuente pública.',25),
('DIRECT_PREMIUM_USD','Prima directa observable','ECONOMIC_SCALE','CURRENCY','USD','USD','SAME_METRIC',true,'Monto de prima directa declarada por la entidad. Se mantiene separado de ventas de plataforma o ingresos de la compañía.',14),
('CONNECTED_VEHICLES_COUNT','Vehículos conectados','REACH','COUNT','vehicles',null,'SAME_METRIC',true,'Cantidad de vehículos conectados o cubiertos por tecnología telemática de la plataforma.',52)
on conflict(metric_code) do update set
 label=excluded.label,dimension=excluded.dimension,unit_kind=excluded.unit_kind,default_unit=excluded.default_unit,default_currency=excluded.default_currency,comparable_scope=excluded.comparable_scope,higher_means_more_weight=excluded.higher_means_more_weight,description=excluded.description,sort_order=excluded.sort_order;
