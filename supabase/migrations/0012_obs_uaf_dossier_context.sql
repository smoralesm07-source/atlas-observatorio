-- ATLAS Observatorio · La ficha del sujeto, con su contexto
--
-- La ficha que se abre desde una cifra del Pulso mostraba texto plano: una
-- tira de spans con el giro, la banda de ventas y los trabajadores, y debajo
-- una lista de antecedentes. Todo cierto y todo mudo. "IPF 72" no dice nada
-- sin saber que la mediana de su sector es 41; "Ventas 10.000-25.000 UF" no
-- dice nada sin saber que la mitad de sus pares está por debajo.
--
-- El contrato ya devolvía select * de obs_uaf_subject, de modo que la ficha
-- tenía a mano el percentil IPF, la credibilidad del índice, la atipicidad del
-- giro, las señales del SII y el motivo de atención: no los mostraba porque el
-- tipo de la interfaz no los declaraba. Esta migración no repite esos campos.
-- Agrega lo único que no se puede calcular desde una sola fila: la referencia
-- de sus pares.
--
-- LÍMITES DECLARADOS:
--  * El par es el sector UAF que obliga, no el rubro económico ni la comuna.
--    Comparar una automotora con un banco porque ambos son sujetos obligados
--    daría una mediana sin significado.
--  * El percentil se calcula sobre los pares CON el índice medido. Un sector
--    donde la mitad no tiene IPF produce un percentil sobre la otra mitad, y
--    la ficha publica ese denominador en vez de esconderlo.
--  * Un sector de un solo inscrito no tiene mediana ni percentil: se devuelve
--    nulo, y la interfaz omite la comparación en vez de dibujar una barra que
--    diría que el sujeto es a la vez el mínimo y el máximo de su sector.
--  * Estar sobre la mediana del sector no es un hallazgo. El IPF ordena
--    revisión y ninguna posición dentro de él imputa incumplimiento.

create or replace function public.obs_uaf_subject_dossier(p_rut text)
returns jsonb
language sql
stable
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
  with s as (
    select * from public.obs_uaf_subject
    where rut_search = nullif(regexp_replace(upper(coalesce(p_rut,'')), '[^0-9K]', '', 'g'), '')
       or rut = p_rut
    limit 1
  ),
  ev as (
    select e.kind, e.event_date, e.source_label, e.headline, e.summary,
           e.amount_uf, e.amount_clp, e.document_url, e.has_link, e.identity_status
    from public.obs_uaf_evidence e
    join s on s.rut = e.rut
    order by e.event_date desc nulls last
    limit 40
  ),
  -- Los pares del sujeto: el sector UAF que lo obliga. Se excluye a si mismo
  -- del recuento de posicion pero no de las medianas, que describen al sector
  -- completo tal como se publica.
  pares as (
    select p.*
    from public.obs_uaf_subject p
    join s on s.uaf_sector is not null and p.uaf_sector = s.uaf_sector
  ),
  ref as (
    select
      (select uaf_sector from s)                                       sector,
      count(*)                                                          sujetos,
      count(*) filter (where ipf_score is not null)                     con_ipf,
      round(percentile_cont(0.5) within group (order by ipf_score)
              filter (where ipf_score is not null)::numeric, 1)         ipf_mediana,
      round(percentile_cont(0.9) within group (order by ipf_score)
              filter (where ipf_score is not null)::numeric, 1)         ipf_p90,
      round(percentile_cont(0.5) within group (order by activity_years)
              filter (where activity_years is not null)::numeric, 1)    antiguedad_mediana,
      round(percentile_cont(0.5) within group (order by sales_band_rank)
              filter (where sales_band_rank is not null)::numeric, 1)   ventas_rank_mediana,
      max(sales_band_rank)                                              ventas_rank_max,
      count(*) filter (where sanction_evidence_count > 0)               sancionados,
      count(*) filter (where sii_status = 'TERMINATED_AS_PUBLISHED')    terminados,
      count(*) filter (where attention_rank is not null)                en_atencion
    from pares
  ),
  pos as (
    select
      case when (select con_ipf from ref) > 1 and (select ipf_score from s) is not null
           then round(100.0 * count(*) filter (
                  where p.ipf_score is not null
                    and p.ipf_score <= (select ipf_score from s))
                / nullif((select con_ipf from ref), 0), 1) end          ipf_percentil_sector,
      case when (select count(*) from pares where activity_years is not null) > 1
                and (select activity_years from s) is not null
           then round(100.0 * count(*) filter (
                  where p.activity_years is not null
                    and p.activity_years <= (select activity_years from s))
                / nullif((select count(*) from pares where activity_years is not null), 0), 1)
           end                                                          antiguedad_percentil_sector
    from pares p
  )
  select jsonb_build_object(
    'contract', 'ATLAS_OBS_UAF_DOSSIER_V2',
    -- obs_uaf_subject.sales_band guarda el ordinal del SII como texto ("2"), de
    -- modo que la ficha decía «Ventas 2». El mapeo a UF ya está gobernado en
    -- obs_sales_band_uf desde 0009 y no se repite aquí: se resuelve y se agrega
    -- el rango legible. El tramo 1 es «sin información de ventas», no ventas
    -- cero, y esa distinción viene de la propia función.
    'subject',  (select to_jsonb(x)
                   || jsonb_build_object(
                        'sales_band_uf',   public.obs_sales_band_uf(x.sales_band_rank),
                        'sales_band_size', public.obs_sales_band_size(x.sales_band_rank))
                   from s x),
    'evidence', (select coalesce(jsonb_agg(to_jsonb(e)),'[]') from ev e),
    -- Un sector de un solo inscrito no produce referencia: la ficha omite la
    -- comparacion en vez de dibujar al sujeto como su propia mediana.
    'peers',    (select case when r.sujetos > 1 then to_jsonb(r) end from ref r),
    'position', (select case when (select sujetos from ref) > 1 then to_jsonb(p) end from pos p),
    'semantics', 'El antecedente se muestra tal como lo publica su fuente. Un registro de prensa no es una sanción, y una sanción no es una imputación de lavado de activos. La comparación con los pares describe la posición del sujeto dentro de su sector obligado y no imputa incumplimiento: estar sobre la mediana del IPF ordena revisión, no concluye nada.'
  );
$function$;

comment on function public.obs_uaf_subject_dossier(text) is
  'Ficha v2 del sujeto obligado: su fila completa con el tramo de ventas legible, sus antecedentes con procedencia y la referencia de sus pares del mismo sector UAF. Ninguna posicion dentro del sector imputa incumplimiento.';

revoke all on function public.obs_uaf_subject_dossier(text) from public, anon;
grant execute on function public.obs_uaf_subject_dossier(text) to authenticated, service_role;

------------------------------------------------- el motivo viaja con la fila

-- La cola de revisión del Pulso rotula cada sujeto con su motivo de mayor
-- precedencia, pero al abrir la lista ese motivo se perdía: la fila sólo traía
-- el índice. Quien abre «Piden revisión» veía 2.728 nombres sin saber por qué
-- está cada uno, que es exactamente el dato que ordena el trabajo.
--
-- El cuerpo de la función ya nombraba attention_motive —lo usa el filtro por
-- MOTIVO— de modo que la guarda de idempotencia mira la firma de retorno y no
-- el texto completo: buscar la columna en todo el cuerpo daba un falso positivo
-- y dejaba la migración sin efecto.
do $$
declare def text;
begin
  select pg_get_functiondef(p.oid) into def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'obs_uaf_cohort';

  if def is null then
    raise exception 'obs_uaf_cohort no existe';
  end if;

  if position('ipf_band text, attention_motive text' in def) > 0 then
    raise notice 'la cohorte ya devuelve el motivo';
    return;
  end if;

  if position('ipf_band text, evidence_count bigint' in def) = 0
     or position('c.ipf_score, c.ipf_band,' in def) = 0 then
    raise exception 'la forma de obs_uaf_cohort no es la esperada';
  end if;

  def := replace(def,
    'ipf_band text, evidence_count bigint',
    'ipf_band text, attention_motive text, ipf_percentile numeric, evidence_count bigint');
  def := replace(def,
    'c.ipf_score, c.ipf_band,',
    'c.ipf_score, c.ipf_band, c.attention_motive, c.ipf_percentile,');

  -- El tipo de retorno cambia, de modo que create or replace no basta.
  drop function if exists public.obs_uaf_cohort(text, text, integer, integer);
  execute def;
end
$$;

comment on function public.obs_uaf_cohort(text,text,integer,integer) is
  'Resuelve una cifra del Pulso en la lista de sujetos que la componen, cada uno con su motivo de revision cuando lo tiene. El motivo ordena trabajo y no imputa incumplimiento.';

revoke all on function public.obs_uaf_cohort(text,text,integer,integer) from public, anon;
grant execute on function public.obs_uaf_cohort(text,text,integer,integer) to authenticated, service_role;
