-- Huella pública · optimización de la reconstrucción por organismo.
--
-- Cuando el organismo ya fue resuelto por el directorio compacto, evitamos
-- normalizar buyer_rut fila a fila sobre Mercado Público. La tabla contiene
-- variantes con y sin guion, por lo que se derivan ambas formas desde la clave
-- seleccionada y se comparan directamente contra buyer_rut. Esto permite usar
-- el índice (buyer_rut, month_start, supplier_rut).
--
-- También reemplazamos EXTRACT(year FROM month_start) por un rango de fechas
-- indexable y damos headroom específico a esta RPC sin elevar el timeout global.

do $migration$
declare
  v_def text;
  v_old text;
  v_new text;
begin
  select pg_get_functiondef('public.obs_state_agency_beneficiaries_raw(jsonb)'::regprocedure)
    into v_def;

  v_old := 'v_market_key_norm text;';
  v_new := 'v_market_key_norm text;' || E'\n  ' || 'v_market_key_canonical text;';
  if position(v_old in v_def)=0 then
    raise exception 'Expected market key declaration not found in obs_state_agency_beneficiaries_raw';
  end if;
  v_def := replace(v_def, v_old, v_new);

  v_old := 'v_market_key_norm := case when v_market_key is null then null else regexp_replace(upper(v_market_key),''[^0-9K]'','''',''g'') end;';
  v_new := v_old || E'\n  ' || 'v_market_key_canonical := case when v_market_key_norm is null or length(v_market_key_norm)<2 then null else left(v_market_key_norm,length(v_market_key_norm)-1)||''-''||right(v_market_key_norm,1) end;';
  if position(v_old in v_def)=0 then
    raise exception 'Expected market key normalization not found in obs_state_agency_beneficiaries_raw';
  end if;
  v_def := replace(v_def, v_old, v_new);

  v_old := 'and extract(year from mp.month_start)::integer between v_from and v_to';
  v_new := 'and mp.month_start >= make_date(v_from,1,1)' || E'\n      ' || 'and mp.month_start < make_date(v_to + 1,1,1)';
  if position(v_old in v_def)=0 then
    raise exception 'Expected Mercado Publico year filter not found in obs_state_agency_beneficiaries_raw';
  end if;
  v_def := replace(v_def, v_old, v_new);

  v_old := '(v_market_key_norm is not null and regexp_replace(upper(mp.buyer_rut),''[^0-9K]'','''',''g'')=v_market_key_norm)';
  v_new := '(v_market_key_norm is not null and mp.buyer_rut in (v_market_key, v_market_key_norm, v_market_key_canonical))';
  if position(v_old in v_def)=0 then
    raise exception 'Expected Mercado Publico normalized RUT predicate not found in obs_state_agency_beneficiaries_raw';
  end if;
  v_def := replace(v_def, v_old, v_new);

  execute v_def;
end
$migration$;

alter function public.obs_state_agency_beneficiaries_raw(jsonb)
  set statement_timeout = '60s';
alter function public.obs_state_agency_beneficiaries(jsonb)
  set statement_timeout = '60s';

comment on function public.obs_state_agency_beneficiaries_raw(jsonb) is
  'Huella publica: reconstruccion por organismo. Usa claves exactas/indexadas cuando el organismo ya fue resuelto; evita normalizacion fila-a-fila de buyer_rut en Mercado Publico.';
