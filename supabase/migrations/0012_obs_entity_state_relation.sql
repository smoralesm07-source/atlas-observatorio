-- ATLAS Observatorio · relación transversal de entidades con el Estado
--
-- Dos marcas descriptivas, independientes y fuera del IPA:
--   STATE_SUPPLIER         -> proveedor observado en ChileCompra.
--   PUBLIC_FUNDS_RECIPIENT -> receptor observado en Presupuesto Abierto.
--
-- Rendimiento: Entidad 360 nunca consulta el libro mayor. Consume una fila por
-- RUT y el detalle anual/pagador sólo se solicita mediante RPC. El directorio
-- de proveedores es deliberadamente distinto de obs_spend_actor: este último
-- conserva el tope analítico de 3.000 actores; el directorio cubre el universo.

create table if not exists public.obs_state_supplier_directory (
  rut text primary key,
  entity_id text,
  supplier_label text,
  amount_12m numeric,
  order_count_12m bigint,
  buyer_count integer,
  top_buyer_id text,
  top_buyer_label text,
  top_buyer_share numeric,
  hhi numeric,
  active_months integer,
  first_seen date,
  last_seen date,
  source_snapshot_id text not null,
  refreshed_at timestamptz not null default now()
);
create index if not exists obs_state_supplier_entity_idx on public.obs_state_supplier_directory(entity_id) where entity_id is not null;
create index if not exists obs_state_supplier_last_seen_idx on public.obs_state_supplier_directory(last_seen desc);

create table if not exists public.obs_public_funds_entity (
  rut text primary key,
  entity_id text,
  amount_total numeric,
  amount_12m numeric,
  amount_36m numeric,
  transaction_count bigint,
  payer_count integer,
  first_seen date,
  last_seen date,
  top_payer_key text,
  top_payer_name text,
  top_payer_amount numeric,
  source_snapshot_id text not null,
  source_status text not null default 'CURRENT',
  refreshed_at timestamptz not null default now()
);
create index if not exists obs_public_funds_entity_id_idx on public.obs_public_funds_entity(entity_id) where entity_id is not null;

create table if not exists public.obs_public_funds_year (
  rut text not null,
  entity_id text,
  period_year integer not null,
  amount_total numeric,
  amount_transfer numeric,
  amount_supplier numeric,
  payer_count integer,
  transaction_count bigint,
  top_payer_key text,
  top_payer_name text,
  top_payer_amount numeric,
  source_snapshot_id text not null,
  refreshed_at timestamptz not null default now(),
  primary key (rut, period_year)
);
create index if not exists obs_public_funds_year_entity_idx on public.obs_public_funds_year(entity_id, period_year desc) where entity_id is not null;

create table if not exists public.obs_public_funds_payer_year (
  rut text not null,
  entity_id text,
  payer_key text not null,
  payer_name text,
  period_year integer not null,
  role text,
  amount numeric,
  transaction_count bigint,
  first_seen date,
  last_seen date,
  source_snapshot_id text not null,
  refreshed_at timestamptz not null default now(),
  primary key (rut, payer_key, period_year, role)
);
create index if not exists obs_public_funds_payer_entity_idx on public.obs_public_funds_payer_year(entity_id, period_year desc) where entity_id is not null;

create table if not exists public.obs_state_relation_refresh (
  source_code text primary key,
  source_snapshot_id text,
  status text not null,
  row_count bigint not null default 0,
  refreshed_at timestamptz not null default now(),
  error_detail text
);

create or replace function public.obs_refresh_state_supplier_directory()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  v_page jsonb;
  v_off integer := 0;
  v_got integer;
  v_total integer := 0;
  v_snapshot text;
  v_error text;
begin
  loop
    v_page := public.obs_bridge_fetch('supplier_directory', 2000, v_off);
    if not coalesce((v_page->>'ok')::boolean, false) then
      v_error := coalesce(v_page->>'error','UNKNOWN');
      insert into public.obs_state_relation_refresh(source_code,status,row_count,refreshed_at,error_detail)
      values ('MERCADO_PUBLICO','FAILED',v_total,now(),v_error)
      on conflict(source_code) do update set status=excluded.status,row_count=excluded.row_count,refreshed_at=excluded.refreshed_at,error_detail=excluded.error_detail;
      return jsonb_build_object('ok',false,'error',v_error,'rows',v_total);
    end if;

    v_snapshot := coalesce(v_snapshot, v_page->>'snapshot_id');
    v_got := coalesce((v_page->>'count')::int,0);
    exit when v_got = 0;

    insert into public.obs_state_supplier_directory(
      rut, entity_id, supplier_label, amount_12m, order_count_12m, buyer_count,
      top_buyer_id, top_buyer_label, top_buyer_share, hhi, active_months,
      first_seen, last_seen, source_snapshot_id, refreshed_at)
    select r->>'supplier_id', e.entity_id, r->>'supplier_label',
           nullif(r->>'amount_12m','')::numeric,
           nullif(r->>'order_count_12m','')::bigint,
           nullif(r->>'buyer_count','')::integer,
           r->>'top_buyer_id', r->>'top_buyer_label',
           nullif(r->>'top_buyer_share','')::numeric,
           nullif(r->>'hhi','')::numeric,
           nullif(r->>'active_months','')::integer,
           nullif(r->>'first_seen','')::date,
           nullif(r->>'last_seen','')::date,
           v_snapshot, now()
    from jsonb_array_elements(v_page->'rows') r
    left join public.obs_entity e on e.rut = r->>'supplier_id'
    on conflict(rut) do update set
      entity_id=excluded.entity_id,
      supplier_label=excluded.supplier_label,
      amount_12m=excluded.amount_12m,
      order_count_12m=excluded.order_count_12m,
      buyer_count=excluded.buyer_count,
      top_buyer_id=excluded.top_buyer_id,
      top_buyer_label=excluded.top_buyer_label,
      top_buyer_share=excluded.top_buyer_share,
      hhi=excluded.hhi,
      active_months=excluded.active_months,
      first_seen=excluded.first_seen,
      last_seen=excluded.last_seen,
      source_snapshot_id=excluded.source_snapshot_id,
      refreshed_at=excluded.refreshed_at;

    v_total := v_total + v_got;
    exit when v_got < 2000;
    v_off := v_off + v_got;
  end loop;

  delete from public.obs_state_supplier_directory where source_snapshot_id <> v_snapshot;

  insert into public.obs_state_relation_refresh(source_code,source_snapshot_id,status,row_count,refreshed_at,error_detail)
  values ('MERCADO_PUBLICO',v_snapshot,'READY',v_total,now(),null)
  on conflict(source_code) do update set source_snapshot_id=excluded.source_snapshot_id,status=excluded.status,row_count=excluded.row_count,refreshed_at=excluded.refreshed_at,error_detail=null;

  return jsonb_build_object('ok',true,'snapshot_id',v_snapshot,'rows',v_total);
end
$$;

create or replace function public.obs_state_relation_detail(p_entity_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public','pg_temp'
as $$
declare
  v_rut text;
  v_supplier jsonb;
  v_funds jsonb;
  v_years jsonb;
  v_payers jsonb;
  v_mp_status jsonb;
  v_pa_status jsonb;
begin
  if not (
    auth.role() = 'service_role' or (
      auth.uid() is not null and exists (
        select 1 from public.aml_allowed_users u where u.user_id=auth.uid() and u.enabled
      )
    )
  ) then
    raise exception 'ATLAS_CORE_FORBIDDEN' using errcode='42501';
  end if;

  select rut into v_rut from public.obs_entity where entity_id=p_entity_id;
  if v_rut is null then
    return jsonb_build_object('entity_id',p_entity_id,'rut',null,'marks','[]'::jsonb);
  end if;

  select to_jsonb(s) into v_supplier from public.obs_state_supplier_directory s where s.rut=v_rut;
  select to_jsonb(f) into v_funds from public.obs_public_funds_entity f where f.rut=v_rut;
  select coalesce(jsonb_agg(to_jsonb(y) order by y.period_year desc),'[]'::jsonb) into v_years from public.obs_public_funds_year y where y.rut=v_rut;
  select coalesce(jsonb_agg(to_jsonb(p) order by p.period_year desc,p.amount desc nulls last),'[]'::jsonb) into v_payers from public.obs_public_funds_payer_year p where p.rut=v_rut;
  select to_jsonb(r) into v_mp_status from public.obs_state_relation_refresh r where source_code='MERCADO_PUBLICO';
  select to_jsonb(r) into v_pa_status from public.obs_state_relation_refresh r where source_code='PRESUPUESTO_ABIERTO';

  return jsonb_build_object(
    'entity_id',p_entity_id,'rut',v_rut,
    'marks', jsonb_build_array(
      jsonb_build_object('code','STATE_SUPPLIER','label','Proveedor del Estado','active',v_supplier is not null,'status',case when v_mp_status->>'status'='READY' then case when v_supplier is null then 'ABSENT' else 'PRESENT' end else 'UNKNOWN' end,'source','MERCADO_PUBLICO','included_in_score',false),
      jsonb_build_object('code','PUBLIC_FUNDS_RECIPIENT','label','Fondos públicos','active',v_funds is not null,'status',case when v_pa_status->>'status'='READY' then case when v_funds is null then 'ABSENT' else 'PRESENT' end else 'UNKNOWN' end,'source','PRESUPUESTO_ABIERTO','included_in_score',false)
    ),
    'supplier',v_supplier,'public_funds',v_funds,
    'public_funds_years',v_years,'public_funds_payers',v_payers,
    'source_status',jsonb_build_object('mercado_publico',v_mp_status,'presupuesto_abierto',v_pa_status)
  );
end
$$;

alter table public.obs_state_supplier_directory enable row level security;
alter table public.obs_public_funds_entity enable row level security;
alter table public.obs_public_funds_year enable row level security;
alter table public.obs_public_funds_payer_year enable row level security;
alter table public.obs_state_relation_refresh enable row level security;

do $$
declare t text;
begin
  foreach t in array array['obs_state_supplier_directory','obs_public_funds_entity','obs_public_funds_year','obs_public_funds_payer_year','obs_state_relation_refresh'] loop
    execute format('drop policy if exists %I on public.%I',t||'_allowed_read',t);
    execute format('create policy %I on public.%I for select to authenticated using (exists (select 1 from public.aml_allowed_users au where au.user_id=(select auth.uid()) and au.enabled))',t||'_allowed_read',t);
    execute format('revoke all on public.%I from anon',t);
    execute format('grant select on public.%I to authenticated, service_role',t);
  end loop;
end $$;

revoke all on function public.obs_state_relation_detail(text) from public, anon;
grant execute on function public.obs_state_relation_detail(text) to authenticated, service_role;
revoke all on function public.obs_refresh_state_supplier_directory() from public, anon, authenticated;
grant execute on function public.obs_refresh_state_supplier_directory() to service_role;

do $$
begin
  perform cron.unschedule('atlas-state-supplier-refresh') where exists(select 1 from cron.job where jobname='atlas-state-supplier-refresh');
end $$;
select cron.schedule('atlas-state-supplier-refresh','35 4 * * *',$job$set statement_timeout to '600s'; select public.obs_refresh_state_supplier_directory();$job$);
