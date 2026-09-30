-- Corrige el alcance del aumento de timeout introducido para Atlas.
--
-- Un statement_timeout de 30s aplicado a TODO el rol authenticated permite que
-- consultas costosas retengan conexiones durante demasiado tiempo. Monitores
-- dispara varias lecturas en paralelo (dashboard + búsqueda + detalle), por lo
-- que bajo concurrencia esto puede degradar la capacidad de respuesta general.
--
-- Restablecemos un margen global prudente y reservamos la ventana larga para
-- los contratos de Monitores, que son los que realmente necesitan más tiempo.

alter role authenticated
  set statement_timeout = '12s';

-- Aplica 30s sólo a los RPC públicos de OSFL y Fintech, sin depender de sus
-- firmas exactas. format('%s', oid::regprocedure) conserva la firma completa.
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as fn
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (
        p.proname like 'obs_osfl_%'
        or p.proname like 'obs_fintech_%'
      )
  loop
    execute format('alter function %s set statement_timeout = %L', r.fn, '30s');
  end loop;
end
$$;

-- Radar sancionatorio: el monitor carga dashboard y eventos en paralelo.
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as fn
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'atlas_v2_sanctions_query'
  loop
    execute format('alter function %s set statement_timeout = %L', r.fn, '30s');
  end loop;
end
$$;

-- La búsqueda federada sigue teniendo headroom propio, pero no necesita elevar
-- el timeout de todas las demás consultas del producto.
alter function public.atlas_v2_entity_search_cascade(jsonb)
  set statement_timeout = '30s';
