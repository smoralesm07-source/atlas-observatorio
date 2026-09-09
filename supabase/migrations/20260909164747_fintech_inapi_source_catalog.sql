insert into public.aml_fintech_source_catalog(source_code,label,source_type,authority_level,source_url,cadence,active,notes,refreshed_at)
values('INAPI_PUBLIC','INAPI · marcas y propiedad industrial','PUBLIC_REGISTRY','OFFICIAL_OPEN','https://www.inapi.cl/','EVENT_DRIVEN',true,'Registro público de marcas y propiedad industrial; usar para titularidad de marca y relaciones brand/legal vehicle.',now())
on conflict(source_code) do update set
  label=excluded.label,
  source_type=excluded.source_type,
  authority_level=excluded.authority_level,
  source_url=excluded.source_url,
  cadence=excluded.cadence,
  active=true,
  notes=excluded.notes,
  refreshed_at=now();