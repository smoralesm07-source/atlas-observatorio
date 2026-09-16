-- Mantiene sincronizado el snapshot de marcas IPA3 con la vista vigente.
-- Se incorpora porque Entity 360 lee las marcas desde aml_ipa3_mark_scores_snapshot_v0_4.

create or replace function public.refresh_aml_ipa3_mark_scores_snapshot_v0_4()
returns integer
language plpgsql
set search_path to 'public'
as $function$
declare n integer;
begin
  delete from public.aml_ipa3_mark_scores_snapshot_v0_4 where true;
  insert into public.aml_ipa3_mark_scores_snapshot_v0_4
  select v.*, now()::timestamptz
  from public.aml_v_ipa3_mark_scores_v0_4 v;
  get diagnostics n = row_count;
  return n;
end;
$function$;

select public.refresh_aml_ipa3_mark_scores_snapshot_v0_4();
select public.refresh_aml_ipa3_entity_score_snapshot_v0_4();
