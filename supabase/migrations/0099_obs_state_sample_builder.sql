-- Relación con el Estado · constructor de muestras source-native v3
--
-- Construye muestras por RUT desde los universos de origen (Presupuesto Abierto,
-- Mercado Público y marcas Atlas), sin exigir presencia previa en obs_entity.
-- Mantiene invoker security + RLS y una autorización explícita por aml_allowed_users.

create index if not exists obs_public_funds_payer_year_period_role_rut_idx
  on public.obs_public_funds_payer_year (period_year, role, rut)
  include (entity_id, payer_key, payer_name, amount, transaction_count, first_seen, last_seen);

create or replace function public.obs_state_sample_query(p_request jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security invoker
set search_path to 'public','pg_temp'
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
  if v_relation not in ('ANY','STATE_INTERACTION','STATE_SUPPLIER','PUBLIC_FUNDS','PUBLIC_FUNDS_RECIPIENT','PUBLIC_FUNDS_SUPPLIER') then raise exception 'INVALID_RELATION' using errcode='22023'; end if;
  if v_mark_mode not in ('ALL','ANY') then raise exception 'INVALID_MARK_MODE' using errcode='22023'; end if;
  if exists (select 1 from unnest(v_marks) m where m not in ('OSFL','SO','POTENTIAL_SO','RES_NEW','SII','SII_TG','SII_NO_EMPLOYEES','PRESS','SANCTIONS','FINTECH')) then raise exception 'INVALID_MARK' using errcode='22023'; end if;

  with
  funds_rows as materialized (
    select py.rut,py.entity_id,py.payer_key,py.payer_name,py.period_year,py.role,py.amount,py.transaction_count,py.first_seen,py.last_seen
    from public.obs_public_funds_payer_year py
    where py.period_year between v_from and v_to
      and (v_payer='' or lower(coalesce(py.payer_name,'')) like '%'||lower(v_payer)||'%')
  ),
  funds as materialized (
    select fr.rut,max(fr.entity_id) entity_id,
      sum(fr.amount) amount_total,
      coalesce(sum(fr.amount) filter (where fr.role='RECIPIENT'),0) amount_recipient,
      coalesce(sum(fr.amount) filter (where fr.role='SUPPLIER'),0) amount_supplier,
      sum(fr.transaction_count) transaction_count,
      count(distinct fr.payer_key)::integer payer_count,
      count(distinct fr.payer_key) filter (where fr.role='RECIPIENT')::integer recipient_payer_count,
      count(distinct fr.payer_key) filter (where fr.role='SUPPLIER')::integer supplier_payer_count,
      min(fr.first_seen) first_seen,max(fr.last_seen) last_seen,
      min(fr.period_year)::integer first_year,max(fr.period_year)::integer last_year
    from funds_rows fr group by fr.rut
  ),
  payer_totals as materialized (
    select fr.rut,fr.payer_key,max(fr.payer_name) payer_name,sum(fr.amount) amount,
      row_number() over(partition by fr.rut order by sum(fr.amount) desc nulls last,fr.payer_key) rn
    from funds_rows fr
    where (v_relation<>'PUBLIC_FUNDS_RECIPIENT' or fr.role='RECIPIENT')
      and (v_relation<>'PUBLIC_FUNDS_SUPPLIER' or fr.role='SUPPLIER')
    group by fr.rut,fr.payer_key
  ),
  payer_top as materialized (select rut,payer_key,payer_name,amount from payer_totals where rn=1),
  press as materialized (
    select canonical_rut as rut,max(canonical_entity_id) entity_id
    from public.atlas_press_entity_link
    where canonical_rut is not null and coalesce(requires_review,false)=false and coalesce(ambiguous,false)=false
      and upper(coalesce(link_status,'')) in ('RESOLVED','LINKED','CONFIRMED')
    group by canonical_rut
  ),
  sanction as materialized (
    select e.rut,max(e.entity_id) entity_id
    from public.obs_entity_source s join public.obs_entity e on e.entity_id=s.entity_id
    where s.source_code='RADAR_SANCIONES' and s.status='PRESENT' and e.rut is not null group by e.rut
  ),
  sii_canonical as materialized (
    select e.rut,max(e.entity_id) entity_id
    from public.obs_entity_source s join public.obs_entity e on e.entity_id=s.entity_id
    where s.source_code='RADAR_SII' and s.status='PRESENT' and e.rut is not null group by e.rut
  ),
  fintech as materialized (
    select upper(regexp_replace(rut,'[^0-9Kk]','','g')) rut_norm,max(nullif(atlas_entity_id,'')) entity_id
    from public.aml_fintech_entity where coalesce(rut,'')<>'' group by 1
  ),
  mark_universe as materialized (
    select rut from public.obs_osfl_entity where rut is not null
    union select rut from public.obs_uaf_subject where rut is not null
    union select rut from public.obs_uaf_potential_candidate where rut is not null
    union select rut from public.obs_new_entities_current where rut is not null
    union select rut from press
    union select rut from sanction
  ),
  universe as materialized (
    select rut from funds where v_relation in ('ANY','STATE_INTERACTION','PUBLIC_FUNDS','PUBLIC_FUNDS_RECIPIENT','PUBLIC_FUNDS_SUPPLIER')
    union select rut from public.obs_state_supplier_directory where v_relation in ('ANY','STATE_INTERACTION','STATE_SUPPLIER')
    union select rut from mark_universe where v_relation='ANY'
  ),
  canonical as materialized (
    select e.rut,max(e.entity_id) entity_id,max(e.name) name,max(e.entity_type) entity_type,max(e.region) region,max(e.commune) commune
    from public.obs_entity e where e.rut is not null group by e.rut
  ),
  base as materialized (
    select
      coalesce(f.entity_id,os.entity_id,so.entity_id,pc.entity_id,ne.entity_id,pr.entity_id,sa.entity_id,mp.entity_id,c.entity_id,'ENT-RUT-'||u.rut) entity_id,
      u.rut,
      coalesce(os.name,so.name,pc.name,ne.name,mp.supplier_label,c.name,u.rut) name,
      coalesce(so.entity_type,c.entity_type,case when os.rut is not null then 'OSFL' end) entity_type,
      coalesce(os.region,so.region,pc.region,ne.region,c.region) region,
      coalesce(os.commune,so.commune,pc.commune,ne.commune,c.commune) commune,
      (os.rut is not null) is_osfl,
      os.confirmation_level osfl_confirmation_level,
      (so.rut is not null) is_so,
      (pc.rut is not null) is_potential_so,
      (ne.rut is not null and ne.has_res and ne.event_date between make_date(v_from,1,1) and make_date(v_to,12,31)) is_res_new,
      coalesce(ne.event_date,ne.constitution_date) res_event_date,
      (coalesce(os.has_sii_identity,false) or so.sii_status is not null or pc.sii_status is not null or coalesce(ne.has_sii,false) or sc.rut is not null) has_sii,
      (coalesce(so.sii_termination_date,os.termination_date) is not null or upper(coalesce(so.sii_status,pc.sii_status,os.current_status,ne.sii_status,'')) like '%TERMIN%') sii_tg,
      (coalesce(so.workers,pc.workers,os.workers_numeric)=0) sii_no_employees,
      coalesce(so.workers,pc.workers,os.workers_numeric) sii_workers,
      coalesce(so.sii_status,pc.sii_status,os.current_status,ne.sii_status) sii_status,
      coalesce(so.main_activity,pc.matched_activity,os.main_activity,ne.activity) sii_main_activity,
      (pr.rut is not null) has_press,
      (sa.rut is not null or coalesce(os.has_sanctions,false) or coalesce(so.sanction_count,0)>0) has_sanctions,
      (fi.rut_norm is not null) is_fintech,
      (mp.rut is not null) is_state_supplier,
      mp.amount_12m market_amount_12m,mp.order_count_12m market_order_count_12m,mp.buyer_count market_buyer_count,
      mp.top_buyer_id,mp.top_buyer_label,mp.first_seen market_first_seen,mp.last_seen market_last_seen,
      f.amount_total public_funds_amount,f.amount_recipient public_funds_recipient_amount,f.amount_supplier public_funds_supplier_amount,
      f.transaction_count public_funds_transaction_count,
      case when v_relation='PUBLIC_FUNDS_RECIPIENT' then f.recipient_payer_count when v_relation='PUBLIC_FUNDS_SUPPLIER' then f.supplier_payer_count else f.payer_count end public_funds_payer_count,
      f.first_seen public_funds_first_seen,f.last_seen public_funds_last_seen,f.first_year public_funds_first_year,f.last_year public_funds_last_year,
      pt.payer_key top_payer_key,pt.payer_name top_payer_name,pt.amount top_payer_amount
    from universe u
    left join funds f on f.rut=u.rut
    left join public.obs_state_supplier_directory mp on mp.rut=u.rut
    left join public.obs_osfl_entity os on os.rut=u.rut
    left join public.obs_uaf_subject so on so.rut=u.rut
    left join public.obs_uaf_potential_candidate pc on pc.rut=u.rut
    left join public.obs_new_entities_current ne on ne.rut=u.rut
    left join press pr on pr.rut=u.rut
    left join sanction sa on sa.rut=u.rut
    left join sii_canonical sc on sc.rut=u.rut
    left join canonical c on c.rut=u.rut
    left join fintech fi on fi.rut_norm=upper(regexp_replace(u.rut,'[^0-9Kk]','','g'))
    left join payer_top pt on pt.rut=u.rut
  ),
  filtered as materialized (
    select b.*,array_remove(array[
      case when b.is_osfl then 'OSFL' end,case when b.is_so then 'SO' end,case when b.is_potential_so then 'POTENTIAL_SO' end,
      case when b.is_res_new then 'RES_NEW' end,case when b.has_sii then 'SII' end,case when b.sii_tg then 'SII_TG' end,
      case when b.sii_no_employees then 'SII_NO_EMPLOYEES' end,case when b.has_press then 'PRESS' end,
      case when b.has_sanctions then 'SANCTIONS' end,case when b.is_fintech then 'FINTECH' end
    ],null) marks
    from base b
    where (v_q='' or upper(regexp_replace(coalesce(b.rut,''),'[^0-9Kk]','','g')) like '%'||v_q_rut||'%' or lower(coalesce(b.name,'')) like '%'||lower(v_q)||'%')
      and (v_region='' or b.region=v_region)
      and (v_relation='ANY'
        or (v_relation='STATE_INTERACTION' and (b.is_state_supplier or coalesce(b.public_funds_amount,0)>0))
        or (v_relation='STATE_SUPPLIER' and b.is_state_supplier)
        or (v_relation='PUBLIC_FUNDS' and coalesce(b.public_funds_amount,0)>0)
        or (v_relation='PUBLIC_FUNDS_RECIPIENT' and coalesce(b.public_funds_recipient_amount,0)>0)
        or (v_relation='PUBLIC_FUNDS_SUPPLIER' and coalesce(b.public_funds_supplier_amount,0)>0))
      and (v_min_funds is null or coalesce(b.public_funds_amount,0)>=v_min_funds)
      and (v_min_market is null or coalesce(b.market_amount_12m,0)>=v_min_market)
      and (coalesce(array_length(v_marks,1),0)=0
        or (v_mark_mode='ALL'
          and (not ('OSFL'=any(v_marks)) or b.is_osfl)
          and (not ('SO'=any(v_marks)) or b.is_so)
          and (not ('POTENTIAL_SO'=any(v_marks)) or b.is_potential_so)
          and (not ('RES_NEW'=any(v_marks)) or b.is_res_new)
          and (not ('SII'=any(v_marks)) or b.has_sii)
          and (not ('SII_TG'=any(v_marks)) or b.sii_tg)
          and (not ('SII_NO_EMPLOYEES'=any(v_marks)) or b.sii_no_employees)
          and (not ('PRESS'=any(v_marks)) or b.has_press)
          and (not ('SANCTIONS'=any(v_marks)) or b.has_sanctions)
          and (not ('FINTECH'=any(v_marks)) or b.is_fintech))
        or (v_mark_mode='ANY' and (
          ('OSFL'=any(v_marks) and b.is_osfl) or ('SO'=any(v_marks) and b.is_so) or ('POTENTIAL_SO'=any(v_marks) and b.is_potential_so)
          or ('RES_NEW'=any(v_marks) and b.is_res_new) or ('SII'=any(v_marks) and b.has_sii) or ('SII_TG'=any(v_marks) and b.sii_tg)
          or ('SII_NO_EMPLOYEES'=any(v_marks) and b.sii_no_employees) or ('PRESS'=any(v_marks) and b.has_press)
          or ('SANCTIONS'=any(v_marks) and b.has_sanctions) or ('FINTECH'=any(v_marks) and b.is_fintech))))
  ),
  page as (
    select f.*,count(*) over() total_count from filtered f
    order by case when v_sort='NAME' then lower(f.name) end asc nulls last,
      case when v_sort='PUBLIC_FUNDS' then f.public_funds_amount end desc nulls last,
      case when v_sort='MARKET' then f.market_amount_12m end desc nulls last,
      case when v_sort='STATE_AMOUNT' then greatest(coalesce(f.public_funds_amount,0),coalesce(f.market_amount_12m,0)) end desc nulls last,
      f.name,f.rut limit v_limit offset v_offset
  )
  select coalesce(max(total_count),0),coalesce(jsonb_agg(to_jsonb(page)-'total_count'),'[]'::jsonb)
  into v_total,v_rows from page;

  return jsonb_build_object('ok',true,'schema','OBS_STATE_SAMPLE_V3','period',jsonb_build_object('from_year',v_from,'to_year',v_to),
    'relation',v_relation,'mark_mode',v_mark_mode,'marks',to_jsonb(v_marks),'total',v_total,'limit',v_limit,'offset',v_offset,'rows',v_rows,
    'semantics',jsonb_build_object(
      'universe','Source-native por RUT. No requiere presencia previa en obs_entity.',
      'presupuesto_abierto','Pagos positivos agregados por RUT, pagador y año en el período solicitado.',
      'mercado_publico','La selección masiva usa el directorio vigente resumido de 12 meses; la historia por entidad se consulta a demanda.',
      'amounts_not_additive',true,'res_new_period','El período filtra el evento RES observado.',
      'press','Sólo vínculos con RUT resuelto, no ambiguos y sin revisión pendiente.',
      'sii_no_employees','Sólo workers=0; nulos no se clasifican como sin empleados.',
      'osfl','Marca vigente del Radar OSFL; confirmation_level se devuelve para control de calidad y no equivale por sí solo a personalidad jurídica validada.'
    ));
end
$$;

create or replace function public.obs_state_sample_payers_v1(
  p_rut text,
  p_from_year integer default 2020,
  p_to_year integer default extract(year from current_date)::integer,
  p_role text default 'ANY',
  p_limit integer default 500
)
returns jsonb
language sql
security invoker
set search_path to 'public','pg_temp'
as $$
  with x as (
    select payer_key,payer_name,period_year,role,amount,transaction_count,first_seen,last_seen
    from public.obs_public_funds_payer_year
    where rut=p_rut
      and period_year between greatest(2007,p_from_year) and least(extract(year from current_date)::integer,p_to_year)
      and (upper(coalesce(p_role,'ANY'))='ANY' or role=upper(p_role))
    order by period_year desc,amount desc nulls last
    limit greatest(1,least(coalesce(p_limit,500),2000))
  )
  select jsonb_build_object('ok',true,'rut',p_rut,'rows',coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb)) from x
$$;

revoke all on function public.obs_state_sample_query(jsonb) from public,anon;
revoke all on function public.obs_state_sample_payers_v1(text,integer,integer,text,integer) from public,anon;
grant execute on function public.obs_state_sample_query(jsonb) to authenticated,service_role;
grant execute on function public.obs_state_sample_payers_v1(text,integer,integer,text,integer) to authenticated,service_role;
