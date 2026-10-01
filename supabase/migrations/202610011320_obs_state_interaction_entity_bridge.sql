-- ATLAS Observatorio · puente de consulta entity-first hacia Mercado Público core.
-- Reutiliza URL/token/apikey ya presentes en Vault; no expone credenciales al navegador.

create or replace function public.obs_state_interaction_entity(
  p_action text,
  p_rut text default null,
  p_query text default null,
  p_from_year integer default 2020,
  p_to_year integer default extract(year from current_date)::integer,
  p_limit integer default 100,
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','vault','extensions','pg_temp'
as $$
declare
  v_uid uuid := (select auth.uid());
  v_url text;
  v_entity_url text;
  v_tok text;
  v_key text;
  v_resp extensions.http_response;
begin
  if v_uid is null or not exists (
    select 1 from public.aml_allowed_users au
    where au.user_id=v_uid and au.enabled
  ) then
    raise exception 'NOT_AUTHORIZED' using errcode='42501';
  end if;

  if coalesce(p_action,'') not in ('search','summary','buyers','timeline','orders') then
    raise exception 'INVALID_ACTION' using errcode='22023';
  end if;

  select decrypted_secret into v_url from vault.decrypted_secrets where name='obs_bridge_url';
  select decrypted_secret into v_tok from vault.decrypted_secrets where name='obs_bridge_token';
  select decrypted_secret into v_key from vault.decrypted_secrets where name='obs_bridge_apikey';
  if v_url is null or v_tok is null or v_key is null then
    return jsonb_build_object('ok',false,'error','BRIDGE_NOT_CONFIGURED');
  end if;

  v_entity_url := replace(v_url,'ps_export_for_observatory','ps_entity_query_for_observatory');
  if v_entity_url = v_url then
    return jsonb_build_object('ok',false,'error','BRIDGE_URL_UNEXPECTED');
  end if;

  select * into v_resp from extensions.http((
    'POST',v_entity_url,
    array[
      extensions.http_header('apikey',v_key),
      extensions.http_header('Authorization','Bearer '||v_key)
    ],
    'application/json',
    jsonb_build_object(
      'p_token',v_tok,
      'p_action',p_action,
      'p_rut',p_rut,
      'p_query',p_query,
      'p_from_year',greatest(2007,coalesce(p_from_year,2020)),
      'p_to_year',least(extract(year from current_date)::integer,coalesce(p_to_year,extract(year from current_date)::integer)),
      'p_limit',greatest(1,least(coalesce(p_limit,100),500)),
      'p_offset',greatest(0,coalesce(p_offset,0))
    )::text
  )::extensions.http_request);

  if v_resp.status <> 200 then
    return jsonb_build_object('ok',false,'error','CORE_HTTP_'||v_resp.status);
  end if;
  return v_resp.content::jsonb;
end
$$;

revoke all on function public.obs_state_interaction_entity(text,text,text,integer,integer,integer,integer)
  from public,anon;
grant execute on function public.obs_state_interaction_entity(text,text,text,integer,integer,integer,integer)
  to authenticated;
