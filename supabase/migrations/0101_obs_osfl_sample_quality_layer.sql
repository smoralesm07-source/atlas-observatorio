-- Capa de calidad para muestras OSFL.
-- No altera el Radar OSFL de origen. Sólo evita que entidades públicas evidentes,
-- clasificadas como OSFL únicamente por SII/core, entren en muestras/exportaciones.

create or replace view public.obs_osfl_sample_entity
with (security_invoker=true)
as
select o.*
from public.obs_osfl_entity o
where not (
  coalesce(o.confirmation_level,'') in ('SII_CLASSIFIED_ACTIVE','CORE_SII_ONLY')
  and coalesce(o.osfl_type,'') = 'Otras'
  and (
    upper(trim(coalesce(o.name,''))) like 'I MUNICIPALIDAD %'
    or upper(trim(coalesce(o.name,''))) like 'ILUSTRE MUNICIPALIDAD %'
    or upper(trim(coalesce(o.name,''))) like 'MUNICIPALIDAD %'
    or upper(trim(coalesce(o.name,''))) like 'SERVICIO LOCAL DE EDUCACION %'
    or upper(trim(coalesce(o.name,''))) like 'SERVICIO LOCAL DE EDUCACIÓN %'
    or upper(trim(coalesce(o.name,''))) like 'MINISTERIO %'
    or upper(trim(coalesce(o.name,''))) like 'SUBSECRETARIA %'
    or upper(trim(coalesce(o.name,''))) like 'SUBSECRETARÍA %'
    or upper(trim(coalesce(o.name,''))) like 'GOBIERNO REGIONAL %'
    or upper(trim(coalesce(o.name,''))) like 'SERVICIO DE SALUD %'
  )
);

revoke all on public.obs_osfl_sample_entity from anon;
grant select on public.obs_osfl_sample_entity to authenticated,service_role;

do $$
declare
  v_def text;
begin
  v_def := pg_get_functiondef('public.obs_state_sample_query(jsonb)'::regprocedure);
  if position('public.obs_osfl_entity' in v_def) = 0 then
    raise exception 'Expected OSFL source reference not found; refusing blind rewrite';
  end if;
  v_def := replace(v_def, 'public.obs_osfl_entity', 'public.obs_osfl_sample_entity');
  v_def := replace(v_def,
    'Marca vigente del Radar OSFL; confirmation_level se devuelve para control de calidad y no equivale por sí solo a personalidad jurídica validada.',
    'Marca Radar OSFL para muestras; excluye entidades públicas evidentes cuando la clasificación depende sólo de SII/core. confirmation_level se devuelve para control de calidad y no equivale por sí solo a personalidad jurídica validada.'
  );
  execute v_def;
end
$$;
