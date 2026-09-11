-- ATLAS Observatorio · ruta inmediata para alertas críticas.
-- Conserva el feed operativo original y antepone las alertas externas al RPC
-- que ya consumen versiones previas del frontend. Así las señales aparecen
-- aunque el navegador aún mantenga una versión estática anterior del bundle.

do $$
begin
  if to_regprocedure('public.obs_uaf_updates_base()') is null
     and to_regprocedure('public.obs_uaf_updates()') is not null then
    alter function public.obs_uaf_updates() rename to obs_uaf_updates_base;
  end if;
end $$;

create or replace function public.obs_uaf_updates()
returns jsonb
language sql
stable
set search_path to 'public', 'pg_temp'
as $$
with b as (
  select public.obs_uaf_updates_base() as j
), a as (
  select public.obs_uaf_external_alerts() as j
), critical_items as (
  select coalesce(jsonb_agg(
    jsonb_set(
      jsonb_set(
        jsonb_set(item, '{kind}', '"PRENSA"'::jsonb, true),
        '{title}', to_jsonb(
          case
            when item->>'severity' = 'CRITICAL' then '⚠ ALERTA CRÍTICA · ' || coalesce(item->>'entity_name', item->>'title')
            else '⚠ ATENCIÓN ALTA · ' || coalesce(item->>'entity_name', item->>'title')
          end
        ), true
      ),
      '{priority_label}', to_jsonb(case when item->>'severity' = 'CRITICAL' then 'Atención crítica' else 'Atención alta' end), true
    )
    order by case when item->>'severity'='CRITICAL' then 0 else 1 end,
             coalesce((item->>'urgency_score')::int,0) desc
  ), '[]'::jsonb) as items
  from a
  cross join lateral jsonb_array_elements(coalesce(a.j->'items','[]'::jsonb)) item
), base_filtered as (
  select coalesce(jsonb_agg(item order by ord), '[]'::jsonb) as items
  from b
  cross join lateral jsonb_array_elements(coalesce(b.j->'items','[]'::jsonb)) with ordinality x(item,ord)
  where not exists (
    select 1
    from a
    cross join lateral jsonb_array_elements(coalesce(a.j->'items','[]'::jsonb)) ai
    where ai->>'entity_id' is not null
      and ai->>'entity_id' = item->>'entity_id'
      and item->>'kind' = 'PRENSA'
  )
)
select jsonb_set(
  jsonb_set(
    b.j,
    '{items}',
    (select items from critical_items) || (select items from base_filtered),
    true
  ),
  '{generated_at}',
  to_jsonb(now()),
  true
)
from b;
$$;

revoke all on function public.obs_uaf_updates_base() from public, anon;
grant execute on function public.obs_uaf_updates_base() to authenticated;
revoke all on function public.obs_uaf_updates() from public, anon;
grant execute on function public.obs_uaf_updates() to authenticated;
