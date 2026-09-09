do $$
declare ddl text;
begin
  select pg_get_functiondef(p.oid) into ddl
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='aml_fintech_ingest_enrichment';
  ddl:=replace(ddl,'INFERRED_COMPANY_WEB_V221','INFERRED_COMPANY_WEB_VERSIONED');
  execute ddl;

  select pg_get_functiondef(p.oid) into ddl
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='aml_fintech_enrichment_batch';
  ddl:=replace(ddl,'''2.2.1''','''2.2.2''');
  execute ddl;
end $$;