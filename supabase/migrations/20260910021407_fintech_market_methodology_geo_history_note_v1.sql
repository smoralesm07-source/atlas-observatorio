do $do$
declare
  v_def text := pg_get_functiondef('public.obs_fintech_market_weight_status()'::regprocedure);
begin
  v_def := replace(v_def,
    'No se genera una cuota de mercado universal ni se suman métricas heterogéneas.',
    'No se genera una cuota de mercado universal ni se suman métricas heterogéneas. Los percentiles vigentes excluyen evidencia histórica y comparan sólo dentro de alcances geográficos equivalentes.');
  execute v_def;
end
$do$;

do $do$
declare
  v_def text := pg_get_functiondef('public.obs_fintech_market_weight_detail(text,text)'::regprocedure);
begin
  v_def := replace(v_def,
    'Percentil cohorte es la comparación preferente para entidades y sólo existe con al menos 3 pares en la misma métrica. Percentil global se conserva como referencia secundaria. No se suman métricas heterogéneas.',
    'Percentil cohorte es la comparación preferente para entidades y sólo existe con al menos 3 pares en la misma métrica y alcance geográfico comparable. La evidencia histórica queda visible pero fuera del ranking vigente. Percentil global se conserva como referencia secundaria. No se suman métricas heterogéneas.');
  execute v_def;
end
$do$;
