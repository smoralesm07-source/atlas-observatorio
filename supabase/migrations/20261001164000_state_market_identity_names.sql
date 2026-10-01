-- Relación con el Estado · identidad de proveedores y compradores Mercado Público
--
-- Corrige la dependencia de supplier_label del snapshot analítico. La identidad
-- nominal se resuelve desde mpx_participant, que conserva RUT + razón social /
-- nombre legal de participantes de Mercado Público. Los montos, órdenes y
-- cobertura histórica no se modifican.

create or replace function public.obs_state_market_identity_search(
  p_query text,
  p_limit integer default 20
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare
  v_uid uuid := (select auth.uid());
  v_q text := trim(coalesce(p_query,''));
  v_rut text := regexp_replace(upper(v_q),'[^0-9K]','','g');
  v_rows jsonb;
begin
  if v_uid is null or not exists (
    select 1 from public.aml_allowed_users au where au.user_id=v_uid and au.enabled
  ) then
    raise exception 'NOT_AUTHORIZED' using errcode='42501';
  end if;

  if length(v_q) < 3 then
    return jsonb_build_object('ok',true,'rows','[]'::jsonb);
  end if;

  with candidates as (
    select distinct on (p.rut_norm)
      p.rut_norm,
      coalesce(nullif(trim(p.legal_name),''), nullif(trim(p.display_name),''), p.rut_norm) as label,
      p.indexed_at
    from public.mpx_participant p
    where p.rut_norm is not null
      and (p.is_supplier is true or 'supplier'=any(coalesce(p.roles,'{}'::text[])))
      and (
        (v_rut <> '' and regexp_replace(upper(p.rut_norm),'[^0-9K]','','g') like '%'||v_rut||'%')
        or lower(coalesce(p.legal_name,'')) % lower(v_q)
        or lower(coalesce(p.display_name,'')) % lower(v_q)
        or lower(coalesce(p.legal_name,'')) like '%'||lower(v_q)||'%'
        or lower(coalesce(p.display_name,'')) like '%'||lower(v_q)||'%'
      )
    order by p.rut_norm,
      case when nullif(trim(p.legal_name),'') is not null then 0 else 1 end,
      p.indexed_at desc nulls last
  )
  select coalesce(jsonb_agg(jsonb_build_object('rut',c.rut_norm,'label',c.label)),'[]'::jsonb)
  into v_rows
  from (
    select * from candidates
    order by
      case when v_rut<>'' and regexp_replace(upper(rut_norm),'[^0-9K]','','g')=v_rut then 0 else 1 end,
      similarity(lower(label),lower(v_q)) desc nulls last,
      label
    limit greatest(1,least(coalesce(p_limit,20),50))
  ) c;

  return jsonb_build_object('ok',true,'rows',v_rows);
end
$$;

create or replace function public.obs_state_market_names(p_ruts text[])
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare
  v_uid uuid := (select auth.uid());
  v_rows jsonb;
begin
  if v_uid is null or not exists (
    select 1 from public.aml_allowed_users au where au.user_id=v_uid and au.enabled
  ) then
    raise exception 'NOT_AUTHORIZED' using errcode='42501';
  end if;

  with wanted as (
    select distinct regexp_replace(upper(x),'[^0-9K]','','g') rut_key
    from unnest(coalesce(p_ruts,'{}'::text[])) x
    where nullif(regexp_replace(upper(x),'[^0-9K]','','g'),'') is not null
    limit 200
  ), names as (
    select distinct on (w.rut_key)
      w.rut_key,
      p.rut_norm,
      coalesce(nullif(trim(p.legal_name),''), nullif(trim(p.display_name),''), p.rut_norm) label,
      p.indexed_at
    from wanted w
    join public.mpx_participant p
      on regexp_replace(upper(p.rut_norm),'[^0-9K]','','g')=w.rut_key
    order by w.rut_key,
      case when nullif(trim(p.legal_name),'') is not null then 0 else 1 end,
      p.indexed_at desc nulls last
  )
  select coalesce(jsonb_agg(jsonb_build_object('rut',n.rut_norm,'label',n.label)),'[]'::jsonb)
  into v_rows from names n;

  return jsonb_build_object('ok',true,'rows',v_rows);
end
$$;

create or replace function public.obs_mpx_best_name(p_rut text)
returns text
language sql
stable
security invoker
set search_path to 'public','pg_temp'
as $$
  select coalesce(nullif(trim(p.legal_name),''), nullif(trim(p.display_name),''))
  from public.mpx_participant p
  where p.rut_norm = regexp_replace(upper(coalesce(p_rut,'')),'[^0-9K]','','g')
  order by
    case when p.is_supplier is true or 'supplier'=any(coalesce(p.roles,'{}'::text[])) then 0 else 1 end,
    case when nullif(trim(p.legal_name),'') is not null then 0 else 1 end,
    p.indexed_at desc nulls last
  limit 1
$$;

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
  v_result jsonb;
  v_rows jsonb;
  v_q text := trim(coalesce(p_query,''));
  v_q_rut text := regexp_replace(upper(trim(coalesce(p_query,''))),'[^0-9K]','','g');
  v_name text;
  v_top_name text;
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

  -- Para búsqueda por nombre, la identidad nominal vive en mpx_participant.
  -- Así la búsqueda no depende de supplier_label, que está ausente en gran parte
  -- del snapshot analítico.
  if p_action='search' and length(v_q)>=3 then
    with candidates as (
      select distinct on (p.rut_norm)
        p.rut_norm as rut,
        coalesce(nullif(trim(p.legal_name),''),nullif(trim(p.display_name),''),p.rut_norm) as label,
        p.indexed_at
      from public.mpx_participant p
      where p.rut_norm is not null
        and (p.is_supplier is true or 'supplier'=any(coalesce(p.roles,'{}'::text[])))
        and (
          (v_q_rut<>'' and p.rut_norm like '%'||v_q_rut||'%')
          or lower(coalesce(p.legal_name,'')) % lower(v_q)
          or lower(coalesce(p.display_name,'')) % lower(v_q)
          or lower(coalesce(p.legal_name,'')) like '%'||lower(v_q)||'%'
          or lower(coalesce(p.display_name,'')) like '%'||lower(v_q)||'%'
        )
      order by p.rut_norm,
        case when nullif(trim(p.legal_name),'') is not null then 0 else 1 end,
        p.indexed_at desc nulls last
    )
    select coalesce(jsonb_agg(jsonb_build_object('rut',c.rut,'label',c.label)),'[]'::jsonb)
    into v_rows
    from (
      select * from candidates
      order by
        case when v_q_rut<>'' and rut=v_q_rut then 0 else 1 end,
        similarity(lower(label),lower(v_q)) desc nulls last,
        label
      limit least(greatest(1,coalesce(p_limit,20)),50)
      offset greatest(0,coalesce(p_offset,0))
    ) c;

    if jsonb_array_length(v_rows)>0 then
      return jsonb_build_object('ok',true,'action','search','identity_source','MPX_PARTICIPANT','rows',v_rows);
    end if;
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

  v_result := v_resp.content::jsonb;

  if p_action='summary' and v_result->'supplier' is not null and v_result->'supplier' <> 'null'::jsonb then
    v_name := public.obs_mpx_best_name(coalesce(v_result->'supplier'->>'rut',p_rut));
    if v_name is not null then
      v_result := jsonb_set(v_result,'{supplier,label}',to_jsonb(v_name),true);
    end if;
    if nullif(v_result->'supplier'->>'top_buyer_id','') is not null then
      v_top_name := public.obs_mpx_best_name(v_result->'supplier'->>'top_buyer_id');
      if v_top_name is not null then
        v_result := jsonb_set(v_result,'{supplier,top_buyer_label}',to_jsonb(v_top_name),true);
      end if;
    end if;
  elsif p_action='buyers' then
    select coalesce(jsonb_agg(
      case when n.label is not null
        then jsonb_set(e.elem,'{buyer_label}',to_jsonb(n.label),true)
        else e.elem end
      order by e.ord
    ),'[]'::jsonb)
    into v_rows
    from jsonb_array_elements(coalesce(v_result->'rows','[]'::jsonb)) with ordinality e(elem,ord)
    left join lateral (
      select public.obs_mpx_best_name(e.elem->>'buyer_id') as label
    ) n on true;
    v_result := jsonb_set(v_result,'{rows}',v_rows,true);
  elsif p_action='search' then
    select coalesce(jsonb_agg(
      case when n.label is not null
        then jsonb_set(e.elem,'{label}',to_jsonb(n.label),true)
        else e.elem end
      order by e.ord
    ),'[]'::jsonb)
    into v_rows
    from jsonb_array_elements(coalesce(v_result->'rows','[]'::jsonb)) with ordinality e(elem,ord)
    left join lateral (
      select public.obs_mpx_best_name(e.elem->>'rut') as label
    ) n on true;
    v_result := jsonb_set(v_result,'{rows}',v_rows,true);
  end if;

  return v_result;
end
$$;

revoke all on function public.obs_state_market_identity_search(text,integer) from public,anon;
revoke all on function public.obs_state_market_names(text[]) from public,anon;
revoke all on function public.obs_mpx_best_name(text) from public,anon;

grant execute on function public.obs_state_market_identity_search(text,integer) to authenticated,service_role;
grant execute on function public.obs_state_market_names(text[]) to authenticated,service_role;
grant execute on function public.obs_mpx_best_name(text) to authenticated,service_role;
