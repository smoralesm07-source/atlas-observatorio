-- Completa el universo source-native para FINTECH y evita abrir Entidad 360
-- cuando el RUT todavía no existe en obs_entity.

do $$
declare
  v_def text;
  v_before text;
begin
  v_def := pg_get_functiondef('public.obs_state_sample_query(jsonb)'::regprocedure);

  v_before := v_def;
  v_def := replace(v_def,
    'select upper(regexp_replace(rut,''[^0-9Kk]'','''',''g'')) rut_norm,max(nullif(atlas_entity_id,'''')) entity_id',
    'select upper(regexp_replace(rut,''[^0-9Kk]'','''',''g'')) rut_norm,max(rut) rut,max(nullif(atlas_entity_id,'''')) entity_id,max(coalesce(nullif(legal_name,''''),nullif(brand,''''))) name'
  );
  if v_def = v_before then raise exception 'Expected fintech CTE not found'; end if;

  v_before := v_def;
  v_def := replace(v_def,'union select rut from sanction','union select rut from sanction' || chr(10) || '    union select rut from fintech where rut is not null');
  if v_def = v_before then raise exception 'Expected mark universe anchor not found'; end if;

  v_before := v_def;
  v_def := replace(v_def,'sa.entity_id,mp.entity_id,c.entity_id','sa.entity_id,mp.entity_id,fi.entity_id,c.entity_id');
  if v_def = v_before then raise exception 'Expected entity coalesce anchor not found'; end if;

  v_before := v_def;
  v_def := replace(v_def,'coalesce(os.name,so.name,pc.name,ne.name,mp.supplier_label,c.name,u.rut) name','coalesce(os.name,so.name,pc.name,ne.name,mp.supplier_label,fi.name,c.name,u.rut) name');
  if v_def = v_before then raise exception 'Expected name coalesce anchor not found'; end if;

  v_before := v_def;
  v_def := regexp_replace(v_def,'([[:space:]]+)u\.rut,([[:space:]]+)coalesce\(os\.name','\1u.rut,\2(c.rut is not null) can_open_entity360,\2coalesce(os.name',1,1,'n');
  if v_def = v_before then raise exception 'Expected canonical guard anchor not found'; end if;

  execute v_def;
end
$$;
