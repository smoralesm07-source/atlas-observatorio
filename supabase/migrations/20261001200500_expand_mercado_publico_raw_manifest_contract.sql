-- Mercado Público · ampliar el contrato del manifiesto histórico.
-- La Edge Function conserva un guard dinámico adicional sobre el año solicitado.

alter table public.aml_mp_raw_manifest
  drop constraint if exists aml_mp_raw_manifest_status_check;

alter table public.aml_mp_raw_manifest
  add constraint aml_mp_raw_manifest_status_check
  check (status = any (array[
    'PENDING'::text,'DISCOVERED'::text,'DOWNLOADED'::text,
    'NORMALIZED'::text,'ERROR'::text,'NOT_AVAILABLE'::text
  ]));

alter table public.aml_mp_raw_manifest
  drop constraint if exists aml_mp_raw_manifest_year_check;

alter table public.aml_mp_raw_manifest
  add constraint aml_mp_raw_manifest_year_check
  check (year between 2000 and 2100);
