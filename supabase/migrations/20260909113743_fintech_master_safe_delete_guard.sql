do $$
declare v_ddl text;
begin
 select pg_get_functiondef(p.oid) into v_ddl
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname='aml_fintech_refresh_ecosystem_master'
 limit 1;
 if v_ddl is null then raise exception 'MASTER_REFRESH_FUNCTION_NOT_FOUND'; end if;
 v_ddl := replace(v_ddl,'delete from public.aml_fintech_ecosystem_master;','delete from public.aml_fintech_ecosystem_master where master_key is not null;');
 execute v_ddl;
end $$;