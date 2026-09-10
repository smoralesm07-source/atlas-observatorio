create or replace function public.obs_uaf_registry_evolution()
returns jsonb
language sql
stable
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
with totals as (
  select year,total,as_of_date,source_kind,source_label,source_url,note
  from public.obs_uaf_registry_history
  where year between 2022 and 2026
  order by year
), endpoints as (
  select sector,
         max(subjects) filter (where year=2022) as first_value,
         max(subjects) filter (where year=2026) as last_value,
         count(*) filter (where year between 2022 and 2026) as points_count
  from public.obs_uaf_registry_sector_history
  group by sector
), series as (
  select e.sector,
         e.last_value - e.first_value as delta,
         e.first_value,
         e.last_value,
         (select jsonb_agg(jsonb_build_object('year',h.year,'subjects',h.subjects) order by h.year)
            from public.obs_uaf_registry_sector_history h
           where h.sector=e.sector and h.year between 2022 and 2026) as points
  from endpoints e
  where e.first_value is not null and e.last_value is not null and e.points_count=5
), inc as (
  select * from series where delta > 0 order by delta desc, sector limit 5
), dec as (
  select * from series where delta < 0 order by delta asc, sector limit 5
)
select jsonb_build_object(
  'total', (select coalesce(jsonb_agg(to_jsonb(t) order by t.year),'[]'::jsonb) from totals t),
  'increases', (select coalesce(jsonb_agg(to_jsonb(i) order by i.delta desc),'[]'::jsonb) from inc i),
  'decreases', (select coalesce(jsonb_agg(to_jsonb(d) order by d.delta asc),'[]'::jsonb) from dec d),
  'note', 'Comparación de los últimos cinco cortes anuales publicados (2022–2026). La UAF publica stock por corte, no fecha individual de alta o baja; la variación no identifica por sí sola qué sujetos ingresaron o salieron.'
);
$function$;

grant execute on function public.obs_uaf_registry_evolution() to authenticated;
