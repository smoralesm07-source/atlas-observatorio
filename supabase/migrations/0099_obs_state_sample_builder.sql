-- Relación con el Estado · constructor de muestras v1
--
-- Cruza la identidad canónica de Atlas con marcas ya materializadas y con la
-- interacción estatal disponible en Presupuesto Abierto / Mercado Público.
-- No copia los universos fuente: los consulta por sus contratos/tablas de lectura.

create index if not exists obs_public_funds_payer_year_period_role_rut_idx
  on public.obs_public_funds_payer_year (period_year, role, rut)
  include (payer_key, payer_name, amount, transaction_count, first_seen, last_seen);

create or replace function public.obs_state_sample_query(p_request jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','pg_temp'
as $$
declare
  v_uid uuid := (select auth.uid());
  v_from integer := greatest(2016, least(coalesce((p_request->>'from_year')::integer, 2020), extract(year from current_date)::integer));
  v_to integer;
  v_relation text := upper(coalesce(nullif(trim(p_request->>'relation'),''),'STATE_INTERACTION'));
  v_mark_mode text := upper(coalesce(nullif(trim(p_request->>'mark_mode'),''),'ALL'));
  v_marks text[] := array(select upper(value) from jsonb_array_elements_text(coalesce(p_request->'marks','[]'::jsonb)));
  v_q text := trim(coalesce(p_request->>'q',''));
  v_q_rut text := upper(regexp_replace(trim(coalesce(p_request->>'q','')),'[^0-9Kk]','','g'));
  v_region text := trim(coalesce(p_request->>'region',''));
  v_payer text := trim(coalesce(p_request->>'payer',''));
  v_min_funds numeric := nullif(p_request->>'min_public_funds_amount','')::numeric;
  v_min_market numeric := nullif(p_request->>'min_market_amount','')::numeric;
  v_limit integer := greatest(1,least(coalesce((p_request->>'limit')::integer,100),1000));
  v_offset integer := greatest(0,coalesce((p_request->>'offset')::integer,0));
  v_sort text := upper(coalesce(nullif(trim(p_request->>'sort'),''),'STATE_AMOUNT'));
  v_rows jsonb;
  v_total bigint := 0;
begin
  if v_uid is null or not exists (
    select 1 from public.aml_allowed_users u where u.user_id=v_uid and u.enabled
  ) then
    raise exception 'NOT_AUTHORIZED' using errcode='42501';
  end if;

  v_to := greatest(v_from,least(coalesce((p_request->>'to_year')::integer,extract(year from current_date)::integer),extract(year from current_date)::integer));

  if v_relation not in ('ANY','STATE_INTERACTION','STATE_SUPPLIER','PUBLIC_FUNDS','PUBLIC_FUNDS_RECIPIENT','PUBLIC_FUNDS_SUPPLIER') then
    raise exception 'INVALID_RELATION' using errcode='22023';
  end if;
  if v_mark_mode not in ('ALL','ANY') then
    raise exception 'INVALID_MARK_MODE' using errcode='22023';
  end if;
  if exists (
    select 1 from unnest(v_marks) m
    where m not in ('OSFL','SO','POTENTIAL_SO','RES_NEW','SII','SII_TG','SII_NO_EMPLOYEES','PRESS','SANCTIONS','FINTECH')
  ) then
    raise exception 'INVALID_MARK' using errcode='22023';
  end if;

  with source_flags as materialized (
    select s.entity_id,
      bool_or(s.source_code='RADAR_OSFL' and s.status='PRESENT') is_osfl,
      bool_or(s.source_code='RADAR_UAF' and s.status='PRESENT') is_so,
      bool_or(s.source_code='RADAR_SII' and s.status='PRESENT') has_sii,
      bool_or(s.source_code='RADAR_PRENSA' and s.status='PRESENT') has_press,
      bool_or(s.source_code='RADAR_SANCIONES' and s.status='PRESENT') has_sanctions
    from public.obs_entity_source s
    where s.status='PRESENT'
      and s.source_code in ('RADAR_OSFL','RADAR_UAF','RADAR_SII','RADAR_PRENSA','RADAR_SANCIONES')
    group by s.entity_id
  ),
  funds_rows as materialized (
    select py.rut,py.payer_key,py.payer_name,py.period_year,py.role,
           py.amount,py.transaction_count,py.first_seen,py.last_seen
    from public.obs_public_funds_payer_year py
    where py.period_year between v_from and v_to
      and (v_payer='' or lower(coalesce(py.payer_name,'')) like '%'||lower(v_payer)||'%')
  ),
  funds as materialized (
    select fr.rut,
      sum(fr.amount) amount_total,
      coalesce(sum(fr.amount) filter (where fr.role='RECIPIENT'),0) amount_recipient,
      coalesce(sum(fr.amount) filter (where fr.role='SUPPLIER'),0) amount_supplier,
      sum(fr.transaction_count) transaction_count,
      count(distinct fr.payer_key)::integer payer_count,
      min(fr.first_seen) first_seen,
      max(fr.last_seen) last_seen,
      min(fr.period_year)::integer first_year,
      max(fr.period_year)::integer last_year
    from funds_rows fr
    group by fr.rut
  ),
  payer_totals as materialized (
    select fr.rut,fr.payer_key,max(fr.payer_name) payer_name,sum(fr.amount) amount,
      row_number() over(partition by fr.rut order by sum(fr.amount) desc nulls last,fr.payer_key) rn
    from funds_rows fr
    where (v_relation<>'PUBLIC_FUNDS_RECIPIENT' or fr.role='RECIPIENT')
      and (v_relation<>'PUBLIC_FUNDS_SUPPLIER' or fr.role='SUPPLIER')
    group by fr.rut,fr.payer_key
  ),
  payer_top as materialized (
    select rut,payer_key,payer_name,amount from payer_totals where rn=1
  ),
  fintech as materialized (
    select distinct coalesce(nullif(atlas_entity_id,''),'') entity_id,
      upper(regexp_replace(coalesce(rut,''),'[^0-9Kk]','','g')) rut_norm
    from public.aml_fintech_entity
    where coalesce(rut,'')<>'' or coalesce(atlas_entity_id,'')<>''
  ),
  potential as materialized (
    select distinct coalesce(nullif(entity_id,''),'') entity_id,
      upper(regexp_replace(coalesce(rut,''),'[^0-9Kk]','','g')) rut_norm
    from public.aml_uaf_potential_subject_snapshot
    where coalesce(rut,'')<>'' or coalesce(entity_id,'')<>''
  ),
  base as materialized (
    select e.entity_id,e.rut,e.name,e.entity_type,e.region,e.commune,
      coalesce(sf.is_osfl,false) is_osfl,
      coalesce(sf.is_so,false) is_so,
      coalesce(sf.has_sii,false) has_sii,
      (tp.termination_date is not null or upper(coalesce(tp.current_status,'')) like '%TERMIN%') sii_tg,
      (tp.workers_numeric=0) sii_no_employees,
      tp.workers_numeric sii_workers,
      tp.current_status sii_status,
      tp.main_activity sii_main_activity,
      coalesce(sf.has_press,false) has_press,
      coalesce(sf.has_sanctions,false) has_sanctions,
      (ne.rut is not null and ne.has_res
        and ne.event_date between make_date(v_from,1,1) and make_date(v_to,12,31)) is_res_new,
      coalesce(ne.event_date,ne.constitution_date) res_event_date,
      coalesce((pot.entity_id<>'' or pot.rut_norm=upper(regexp_replace(coalesce(e.rut,''),'[^0-9Kk]','','g'))),false) is_potential_so,
      coalesce((fi.entity_id<>'' or fi.rut_norm=upper(regexp_replace(coalesce(e.rut,''),'[^0-9Kk]','','g'))),false) is_fintech,
      ss.rut is not null is_state_supplier,
      ss.amount_12m market_amount_12m,
      ss.order_count_12m market_order_count_12m,
      ss.buyer_count market_buyer_count,
      ss.top_buyer_id,
      ss.top_buyer_label,
      ss.first_seen market_first_seen,
      ss.last_seen market_last_seen,
      f.amount_total public_funds_amount,
      coalesce(f.amount_recipient,0) public_funds_recipient_amount,
      coalesce(f.amount_supplier,0) public_funds_supplier_amount,
      case
        when v_relation='PUBLIC_FUNDS_RECIPIENT' then coalesce(f.amount_recipient,0)
        when v_relation='PUBLIC_FUNDS_SUPPLIER' then coalesce(f.amount_supplier,0)
        else coalesce(f.amount_total,0)
      end public_funds_selected_amount,
      f.transaction_count public_funds_transaction_count,
      f.payer_count public_funds_payer_count,
      f.first_seen public_funds_first_seen,
      f.last_seen public_funds_last_seen,
      f.first_year public_funds_first_year,
      f.last_year public_funds_last_year,
      pt.payer_key top_payer_key,
      pt.payer_name top_payer_name,
      pt.amount top_payer_amount
    from public.obs_entity e
    left join source_flags sf on sf.entity_id=e.entity_id
    left join public.aml_entity_tax_profile tp on tp.entity_id=e.entity_id
    left join public.obs_new_entities_current ne on ne.rut=e.rut
    left join potential pot
      on pot.entity_id=e.entity_id
      or (pot.entity_id='' and pot.rut_norm=upper(regexp_replace(coalesce(e.rut,''),'[^0-9Kk]','','g')))
    left join fintech fi
      on fi.entity_id=e.entity_id
      or (fi.entity_id='' and fi.rut_norm=upper(regexp_replace(coalesce(e.rut,''),'[^0-9Kk]','','g')))
    left join public.obs_state_supplier_directory ss on ss.rut=e.rut
    left join funds f on f.rut=e.rut
    left join payer_top pt on pt.rut=e.rut
    where e.rut is not null
  ),
  filtered as materialized (
    select b.*,
      array_remove(array[
        case when b.is_osfl then 'OSFL' end,
        case when b.is_so then 'SO' end,
        case when b.is_potential_so then 'POTENTIAL_SO' end,
        case when b.is_res_new then 'RES_NEW' end,
        case when b.has_sii then 'SII' end,
        case when b.sii_tg then 'SII_TG' end,
        case when b.sii_no_employees then 'SII_NO_EMPLOYEES' end,
        case when b.has_press then 'PRESS' end,
        case when b.has_sanctions then 'SANCTIONS' end,
        case when b.is_fintech then 'FINTECH' end
      ],null) marks
    from base b
    where
      (v_q='' or upper(regexp_replace(coalesce(b.rut,''),'[^0-9Kk]','','g')) like '%'||v_q_rut||'%'
        or lower(coalesce(b.name,'')) like '%'||lower(v_q)||'%')
      and (v_region='' or b.region=v_region)
      and (
        v_relation='ANY'
        or (v_relation='STATE_INTERACTION' and (b.is_state_supplier or coalesce(b.public_funds_amount,0)>0))
        or (v_relation='STATE_SUPPLIER' and b.is_state_supplier)
        or (v_relation='PUBLIC_FUNDS' and coalesce(b.public_funds_amount,0)>0)
        or (v_relation='PUBLIC_FUNDS_RECIPIENT' and b.public_funds_recipient_amount>0)
        or (v_relation='PUBLIC_FUNDS_SUPPLIER' and b.public_funds_supplier_amount>0)
      )
      and (v_min_funds is null or b.public_funds_selected_amount>=v_min_funds)
      and (v_min_market is null or coalesce(b.market_amount_12m,0)>=v_min_market)
      and (
        coalesce(array_length(v_marks,1),0)=0
        or (
          v_mark_mode='ALL'
          and (not ('OSFL'=any(v_marks)) or b.is_osfl)
          and (not ('SO'=any(v_marks)) or b.is_so)
          and (not ('POTENTIAL_SO'=any(v_marks)) or b.is_potential_so)
          and (not ('RES_NEW'=any(v_marks)) or b.is_res_new)
          and (not ('SII'=any(v_marks)) or b.has_sii)
          and (not ('SII_TG'=any(v_marks)) or b.sii_tg)
          and (not ('SII_NO_EMPLOYEES'=any(v_marks)) or b.sii_no_employees)
          and (not ('PRESS'=any(v_marks)) or b.has_press)
          and (not ('SANCTIONS'=any(v_marks)) or b.has_sanctions)
          and (not ('FINTECH'=any(v_marks)) or b.is_fintech)
        )
        or (
          v_mark_mode='ANY' and (
            ('OSFL'=any(v_marks) and b.is_osfl)
            or ('SO'=any(v_marks) and b.is_so)
            or ('POTENTIAL_SO'=any(v_marks) and b.is_potential_so)
            or ('RES_NEW'=any(v_marks) and b.is_res_new)
            or ('SII'=any(v_marks) and b.has_sii)
            or ('SII_TG'=any(v_marks) and b.sii_tg)
            or ('SII_NO_EMPLOYEES'=any(v_marks) and b.sii_no_employees)
            or ('PRESS'=any(v_marks) and b.has_press)
            or ('SANCTIONS'=any(v_marks) and b.has_sanctions)
            or ('FINTECH'=any(v_marks) and b.is_fintech)
          )
        )
      )
  ),
  page as (
    select f.*,count(*) over() total_count
    from filtered f
    order by
      case when v_sort='NAME' then lower(f.name) end asc nulls last,
      case when v_sort='PUBLIC_FUNDS' then f.public_funds_selected_amount end desc nulls last,
      case when v_sort='MARKET' then f.market_amount_12m end desc nulls last,
      case when v_sort='STATE_AMOUNT'
        then greatest(coalesce(f.public_funds_selected_amount,0),coalesce(f.market_amount_12m,0)) end desc nulls last,
      f.name,f.rut
    limit v_limit offset v_offset
  )
  select coalesce(max(total_count),0),coalesce(jsonb_agg(to_jsonb(page)-'total_count'),'[]'::jsonb)
  into v_total,v_rows
  from page;

  return jsonb_build_object(
    'ok',true,
    'schema','OBS_STATE_SAMPLE_V1',
    'period',jsonb_build_object('from_year',v_from,'to_year',v_to),
    'relation',v_relation,
    'mark_mode',v_mark_mode,
    'marks',to_jsonb(v_marks),
    'total',v_total,
    'limit',v_limit,
    'offset',v_offset,
    'rows',v_rows,
    'semantics',jsonb_build_object(
      'presupuesto_abierto','Montos de pago positivos agregados por RUT, pagador y año en el período solicitado.',
      'mercado_publico','La selección masiva usa el directorio vigente resumido de 12 meses; la historia por entidad se consulta a demanda en el perfil.',
      'amounts_not_additive',true,
      'res_new_period','El período filtra el evento RES observado.',
      'sii_no_employees','workers_numeric=0; valores nulos no se clasifican como sin empleados.'
    )
  );
end
$$;

revoke all on function public.obs_state_sample_query(jsonb) from public,anon;
grant execute on function public.obs_state_sample_query(jsonb) to authenticated,service_role;
