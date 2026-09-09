update public.aml_fintech_entity
set operating_status_confidence=least(0.999,greatest(0.90,coalesce(confidence,0.95))),
    operating_status_method='MANUAL_OPEN_SOURCE_LEGACY',
    operating_status_version='OPERATING-LEGACY-NORMALIZED-1.0',
    operating_status_validated_at=coalesce(lifecycle_validated_at,refreshed_at,now())
where operating_status<>'UNKNOWN' and operating_status_method is null;

update public.aml_fintech_entity
set operating_status_basis=
  case operating_status_method
    when 'AUTO_MULTI_SOURCE' then 'Validación automática multifuente ('||round(operating_status_confidence*100,0)||'%): '
    when 'AUTO_SECTOR_CHILE_WEB' then 'Validación sectorial Chile + web ('||round(operating_status_confidence*100,0)||'%): '
    when 'AUTO_REGULATORY_CURRENT' then 'Validación regulatoria SII + CMF ('||round(operating_status_confidence*100,0)||'%): '
    when 'MANUAL_OFFICIAL_CURRENT' then 'Validación manual con fuente oficial ('||round(operating_status_confidence*100,1)||'%): '
    when 'MANUAL_CURRENT_OPEN_SOURCE' then 'Validación manual con fuentes abiertas ('||round(operating_status_confidence*100,1)||'%): '
    when 'MANUAL_OPEN_SOURCE_LEGACY' then 'Validación abierta histórica normalizada ('||round(operating_status_confidence*100,1)||'%): '
    else 'Validación de vigencia ('||round(coalesce(operating_status_confidence,0)*100,1)||'%): '
  end || coalesce(operating_status_basis,'Sin fundamento descriptivo adicional.')
where operating_status<>'UNKNOWN'
  and operating_status_confidence is not null
  and coalesce(operating_status_basis,'') not like 'Validación %';