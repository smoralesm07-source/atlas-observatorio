-- Corrige la búsqueda textual del constructor de muestras.
-- Sin este guard, una consulta sólo alfabética producía v_q_rut='' y
-- el predicado LIKE '%%' hacía coincidir todos los RUT.

do $$
declare
  v_def text;
  v_old text := 'or upper(regexp_replace(coalesce(b.rut,''''),''[^0-9Kk]'','''',''g'')) like ''%''||v_q_rut||''%''';
  v_new text := 'or (v_q_rut<>'''' and upper(regexp_replace(coalesce(b.rut,''''),''[^0-9Kk]'','''',''g'')) like ''%''||v_q_rut||''%'')';
begin
  v_def := pg_get_functiondef('public.obs_state_sample_query(jsonb)'::regprocedure);
  if position(v_old in v_def) = 0 then
    raise exception 'Expected RUT search predicate not found; refusing blind function rewrite';
  end if;
  v_def := replace(v_def, v_old, v_new);
  execute v_def;
end
$$;
