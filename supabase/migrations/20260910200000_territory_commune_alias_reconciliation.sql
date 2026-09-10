-- ATLAS Observatorio — Territorio
-- Corrige asociaciones comunales perdidas por alias/abreviaturas de fuentes integradas
-- y recupera geografía de entidades observadas cuando obs_entity.commune viene vacío.

create or replace function public.obs_commune_key(p_commune text)
returns text
language sql
immutable
parallel safe
set search_path = public, extensions, pg_temp
as $$
  select case public.obs_normalize_text(p_commune)
    when 'est central' then 'estacion central'
    when 'coyhaique' then 'coihaique'
    when 'con con' then 'concon'
    when 'san vicente t t' then 'san vicente'
    when 'puerto natales' then 'natales'
    when 'la calera' then 'calera'
    when 'aysen' then 'aisen'
    when 'san fco de mostazal' then 'mostazal'
    when 'san jose maipo' then 'san jose de maipo'
    when 'til til' then 'tiltil'
    when 'llay llay' then 'llaillay'
    when 'quinta tilcoco' then 'quinta de tilcoco'
    when 'san pedro de melipilla' then 'san pedro'
    when 'marchigue' then 'marchihue'
    when 'paihuano' then 'paiguano'
    when 'trehuaco' then 'treguaco'
    when 'alto bio bio' then 'alto biobio'
    when 'ohiggins' then 'o higgins'
    when 'torres de paine' then 'torres del paine'
    when 'antartida' then 'antartica'
    when 'p aguirre cerda' then 'pedro aguirre cerda'
    else public.obs_normalize_text(p_commune)
  end;
$$;

comment on function public.obs_commune_key(text) is
  'Normaliza nombres de comuna y resuelve alias históricos o abreviados presentes en fuentes integradas contra la nomenclatura canónica territorial de ATLAS.';

revoke all on function public.obs_commune_key(text) from public, anon;
grant execute on function public.obs_commune_key(text) to authenticated, service_role;

create or replace function public.obs_reconcile_missing_entity_geography()
returns integer
language plpgsql
security invoker
set search_path = public, extensions, pg_temp
as $$
declare
  v_n integer := 0;
begin
  with unresolved as (
    select e.entity_id, e.rut_search
    from public.obs_entity e
    where e.commune is null or btrim(e.commune) = ''
  ), candidates as (
    select
      e.entity_id,
      coalesce(
        nullif(btrim(u.commune), ''),
        nullif(btrim(pot.commune), ''),
        nullif(btrim(tx.commune), ''),
        nullif(btrim(o.commune), ''),
        nullif(btrim(f.commune), ''),
        nullif(btrim(r.social_commune), ''),
        nullif(btrim(r.tax_commune), '')
      ) as raw_commune
    from unresolved e
    left join lateral (
      select s.commune
      from public.obs_uaf_subject s
      where s.entity_id = e.entity_id
         or (e.rut_search is not null and s.rut_search = e.rut_search)
      order by (s.entity_id = e.entity_id) desc, s.refreshed_at desc nulls last
      limit 1
    ) u on true
    left join lateral (
      select p.commune
      from public.obs_uaf_potential_candidate p
      where p.entity_id = e.entity_id
         or (e.rut_search is not null and p.rut_search = e.rut_search)
      order by (p.entity_id = e.entity_id) desc, p.ivo_score desc nulls last
      limit 1
    ) pot on true
    left join lateral (
      select p.commune
      from public.aml_entity_tax_profile p
      where p.entity_id = e.entity_id
      order by p.commercial_year desc nulls last, p.updated_at desc nulls last
      limit 1
    ) tx on true
    left join lateral (
      select x.commune
      from public.obs_osfl_entity x
      where x.entity_id = e.entity_id
         or (e.rut_search is not null and x.rut_search = e.rut_search)
      order by x.refreshed_at desc nulls last
      limit 1
    ) o on true
    left join lateral (
      select x.commune
      from public.aml_v_fintech_entity_current x
      where x.atlas_entity_id = e.entity_id
         or (e.rut_search is not null and public.obs_normalize_text(coalesce(x.rut, '')) = e.rut_search)
      order by x.refreshed_at desc nulls last
      limit 1
    ) f on true
    left join lateral (
      select c.social_commune, c.tax_commune
      from public.aml_res_entity_bridge b
      join public.aml_res_company c on c.rut = b.rut
      where b.entity_id = e.entity_id
      order by c.refreshed_at desc nulls last
      limit 1
    ) r on true
  ), resolved as (
    select c.entity_id, t.commune_name, t.region_name
    from candidates c
    join public.obs_territory t
      on public.obs_commune_key(t.commune_name) = public.obs_commune_key(c.raw_commune)
    where c.raw_commune is not null
  )
  update public.obs_entity e
     set commune = r.commune_name,
         region = r.region_name
    from resolved r
   where e.entity_id = r.entity_id
     and (e.commune is null or btrim(e.commune) = '');

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.obs_reconcile_missing_entity_geography() from public, anon, authenticated;
grant execute on function public.obs_reconcile_missing_entity_geography() to service_role;

create or replace function public.obs_reconcile_missing_entity_geography_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  perform public.obs_reconcile_missing_entity_geography();
  return null;
end;
$$;

revoke all on function public.obs_reconcile_missing_entity_geography_trigger() from public, anon, authenticated;

drop trigger if exists obs_entity_reconcile_geography_after_insert on public.obs_entity;
create trigger obs_entity_reconcile_geography_after_insert
after insert on public.obs_entity
for each statement
execute function public.obs_reconcile_missing_entity_geography_trigger();

-- Recuperación inicial: sólo rellena entidades cuya comuna está vacía.
select public.obs_reconcile_missing_entity_geography();

-- Los contratos territoriales deben comparar contra la clave canónica de comuna.
do $$
declare v_def text;
begin
  select pg_get_functiondef('public.obs_territory_entity_directory_v2(text,text,text,text,text,integer,integer)'::regprocedure) into v_def;
  v_def := replace(v_def, 'public.obs_normalize_text(e.commune)', 'public.obs_commune_key(e.commune)');
  execute v_def;
end $$;

do $$
declare v_def text;
begin
  select pg_get_functiondef('public.obs_territory_potential_directory_v2(text,text,text,text,integer,integer)'::regprocedure) into v_def;
  v_def := replace(v_def, 'public.obs_normalize_text(p.commune)', 'public.obs_commune_key(p.commune)');
  execute v_def;
end $$;

do $$
declare v_def text;
begin
  select pg_get_functiondef('public.obs_territory_detail(text)'::regprocedure) into v_def;
  v_def := replace(v_def, 'public.obs_normalize_text(e.commune)', 'public.obs_commune_key(e.commune)');
  execute v_def;
end $$;

do $$
declare v_def text;
begin
  select pg_get_functiondef('public.obs_refresh_territory(text)'::regprocedure) into v_def;
  v_def := replace(v_def, 'public.obs_normalize_text(e.commune)', 'public.obs_commune_key(e.commune)');
  execute v_def;
end $$;

do $$
declare v_def text;
begin
  select pg_get_functiondef('public.obs_territory_commune_context_v2(text)'::regprocedure) into v_def;
  v_def := replace(v_def, 'public.obs_normalize_text(e.commune)', 'public.obs_commune_key(e.commune)');
  v_def := replace(v_def, 'public.obs_normalize_text(s.commune)', 'public.obs_commune_key(s.commune)');
  v_def := replace(v_def, 'public.obs_normalize_text(p.commune)', 'public.obs_commune_key(p.commune)');
  v_def := replace(v_def, 'public.obs_normalize_text(f.commune)', 'public.obs_commune_key(f.commune)');
  v_def := replace(
    v_def,
    'where s.commune is not null
    and public.obs_commune_key(s.commune) = (select commune_search from t)',
    'where (s.commune is not null and public.obs_commune_key(s.commune) = (select commune_search from t))
       or ((s.commune is null or btrim(s.commune) = '''') and exists (
         select 1 from entities e
         where e.entity_id = s.entity_id
            or (s.rut_search is not null and e.rut_search = s.rut_search)
       ))'
  );
  execute v_def;
end $$;

-- Sincroniza los contadores usados por el mapa sin recalcular ni alterar el IGR.
with ctx as (
  select public.obs_commune_key(e.commune) as commune_search,
         count(*)::int as entities,
         count(*) filter (where e.is_uaf_observed)::int as uaf_observed,
         count(*) filter (where e.is_sanctioned)::int as sanctioned,
         count(*) filter (where e.alert_count > 0)::int as alerted,
         coalesce(sum(e.finding_count), 0)::int as findings
  from public.obs_entity e
  where e.commune is not null
  group by 1
), resolved as (
  select t.territory_id, c.entities, c.uaf_observed, c.sanctioned, c.alerted, c.findings
  from public.obs_territory t
  left join ctx c on c.commune_search = t.commune_search
)
update public.obs_territory t
set ctx_entities = coalesce(r.entities, 0),
    ctx_uaf_observed = coalesce(r.uaf_observed, 0),
    ctx_sanctioned = coalesce(r.sanctioned, 0),
    ctx_alerted = coalesce(r.alerted, 0),
    ctx_findings = coalesce(r.findings, 0),
    refreshed_at = now()
from resolved r
where t.territory_id = r.territory_id;
