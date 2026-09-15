create or replace function public.atlas_v2_entity_search_cascade(p_request jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = 'pg_catalog', 'public', 'atlas_v2_private', 'extensions'
as $$
declare
  v_q text := btrim(coalesce(p_request->>'search',''));
  v_norm text;
  v_kind text := lower(btrim(coalesce(p_request->>'kind','results')));
  v_limit integer := least(greatest(coalesce(nullif(p_request->>'limit','')::integer,20),1),50);
  v_offset integer := greatest(coalesce(nullif(p_request->>'offset','')::integer,0),0);
  v_is_rut boolean := false;
  v_meaningful_tokens integer := 0;
begin
  if not (
    auth.role() = 'service_role'
    or (
      auth.uid() is not null
      and exists (
        select 1
        from public.aml_allowed_users u
        where u.user_id = auth.uid()
          and u.enabled
      )
    )
  ) then
    raise exception 'ATLAS_CORE_FORBIDDEN' using errcode='42501';
  end if;

  v_is_rut := regexp_replace(upper(v_q), '[^0-9K]', '', 'g') ~ '^[0-9]{6,}[0-9K]$';
  v_norm := lower(translate(public.obs_normalize_text(v_q), 'áéíóúüñ', 'aeiouun'));

  if not v_is_rut and upper(v_q) not like 'ENT-%' and length(v_q) >= 4 then
    select count(*)
      into v_meaningful_tokens
    from regexp_split_to_table(v_norm, '[[:space:]]+') as x(token)
    where length(token) >= 3
      and token not in (
        'del','las','los','una','uno','unos','unas','para','por','con','sin',
        'sociedad','sociedades','empresa','empresas','servicios','servicio',
        'limitada','limitado','ltda','spa','eirl','sa',
        'inversion','inversiones','comercial','comercializadora','comercializacion',
        'transporte','transportes','constructora','construccion','consultora','consultoria',
        'importadora','importaciones','exportadora','exportaciones',
        'distribuidora','distribucion','inmobiliaria','industrial','industrias',
        'grupo','holding','compania','chile','chilena','chileno'
      );

    if v_meaningful_tokens = 0 then
      return jsonb_build_object(
        'schema','ATLAS_ENTITY_SEARCH_V2',
        'kind',case when v_kind='suggest' then 'suggest' else 'results' end,
        'generated_at',now(),
        'items','[]'::jsonb,
        'page',jsonb_build_object(
          'limit',case when v_kind='suggest' then least(v_limit,7) else v_limit end,
          'offset',case when v_kind='suggest' then 0 else v_offset end,
          'returned',0,
          'total',0
        ),
        'semantics',jsonb_build_object(
          'query_status','TOO_BROAD',
          'query_message','Agrega un nombre distintivo, apellido, razón social más específica o RUT.',
          'cascade_version','2026-09-15.4',
          'broad_query_guard',true
        )
      );
    end if;
  end if;

  return atlas_v2_private.entity_search_cascade_core(coalesce(p_request, '{}'::jsonb));
end;
$$;

alter function public.atlas_v2_entity_search_cascade(jsonb)
  set statement_timeout = '20s';

revoke all on function public.atlas_v2_entity_search_cascade(jsonb) from public;
revoke all on function public.atlas_v2_entity_search_cascade(jsonb) from anon;
grant execute on function public.atlas_v2_entity_search_cascade(jsonb) to authenticated;
grant execute on function public.atlas_v2_entity_search_cascade(jsonb) to service_role;

comment on function public.atlas_v2_entity_search_cascade(jsonb) is
'ATLAS v2 entity search cascade with broad-query guard. Generic corporate terms alone are rejected before fan-out across SII/RES; specific names and RUT continue through the full cascade. Match percentage is query similarity, not probability of identity.';
