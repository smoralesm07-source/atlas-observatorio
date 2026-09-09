create or replace function public.aml_fintech_function_alignment_tier_v1(p_vertical text,p_function_code text)
returns text
language sql
immutable
as $$
select case
  when p_function_code='FIN_LENDING' and coalesce(p_vertical,'') ~* '(financiamiento|cr[eé]dito|lending|pr[eé]stamo|factoring)' then 'PRIMARY'
  when p_function_code='FIN_CROWDFUNDING' and coalesce(p_vertical,'') ~* '(financiamiento|crowd|pr[eé]stamo|cr[eé]dito)' then 'PRIMARY'
  when p_function_code='FIN_CARDS' and coalesce(p_vertical,'') ~* '(pago|paytech|neobanco|tarjeta)' then 'PRIMARY'
  when p_function_code in ('FIN_INVESTMENT','FIN_INVESTMENT_ADVISORY') and coalesce(p_vertical,'') ~* '(wealth|inversi[oó]n|otros fiscalizados)' then 'PRIMARY'
  when p_function_code='FIN_REGTECH' and coalesce(p_vertical,'') ~* '(regtech)' then 'PRIMARY'
  when p_function_code='FIN_REMITTANCE_FX' and coalesce(p_vertical,'') ~* '(pago|remesa|fx|cambio)' then 'PRIMARY'
  when p_function_code='FIN_PAYMENTS' and coalesce(p_vertical,'') ~* '(pago|paytech|neobanco)' then 'PRIMARY'
  when p_function_code='FIN_OPEN_FINANCE' and coalesce(p_vertical,'') ~* '(open finance)' then 'PRIMARY'
  when p_function_code='FIN_ALT_TRADING_SYSTEM' and coalesce(p_vertical,'') ~* '(sistemas alternativos de transacci[oó]n)' then 'PRIMARY'
  when p_function_code='FIN_FINANCIAL_INTERMEDIATION' and coalesce(p_vertical,'') ~* '(intermediaci[oó]n)' then 'PRIMARY'
  when p_function_code in ('VA_FIAT_EXCHANGE','VA_VA_EXCHANGE','VA_TRANSFER','VA_CUSTODY_ADMIN','VA_ON_OFF_RAMP','VA_STABLECOIN_SERVICES','VA_HOSTED_WALLET') and coalesce(p_vertical,'') ~* '(activo.? digital|cripto)' then 'PRIMARY'

  when p_function_code='FIN_REGTECH' and coalesce(p_vertical,'') ~* '(infraestructura tecnol[oó]gica)' then 'ADJACENT'
  when p_function_code='FIN_PAYMENTS' and coalesce(p_vertical,'') ~* '(infraestructura tecnol[oó]gica|gesti[oó]n de finanzas)' then 'ADJACENT'
  when p_function_code='FIN_OPEN_FINANCE' and coalesce(p_vertical,'') ~* '(infraestructura tecnol[oó]gica)' then 'ADJACENT'
  when p_function_code in ('FIN_INVESTMENT','FIN_INVESTMENT_ADVISORY') and coalesce(p_vertical,'') ~* '(negociaci[oó]n de activos|intermediaci[oó]n|gesti[oó]n de finanzas)' then 'ADJACENT'
  when p_function_code='FIN_REMITTANCE_FX' and coalesce(p_vertical,'') ~* '(activo.? digital|negociaci[oó]n de activos|intermediaci[oó]n)' then 'ADJACENT'
  when p_function_code='FIN_FINANCIAL_INTERMEDIATION' and coalesce(p_vertical,'') ~* '(negociaci[oó]n de activos)' then 'ADJACENT'
  when p_function_code in ('VA_FIAT_EXCHANGE','VA_VA_EXCHANGE','VA_TRANSFER','VA_CUSTODY_ADMIN','VA_ON_OFF_RAMP','VA_STABLECOIN_SERVICES','VA_HOSTED_WALLET') and coalesce(p_vertical,'') ~* '(negociaci[oó]n de activos|intermediaci[oó]n)' then 'ADJACENT'
  else 'MISMATCH'
end;
$$;

create or replace function public.aml_fintech_function_quality_gate_v1()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare
  v_vertical text;
  v_tier text;
begin
  if new.evidence_class='INFERRED_FROM_DECLARED'
     and new.observation_key ~ '^[0-9a-f]{32}$'
     and new.subject_type='ENTITY' then
    select e.primary_vertical into v_vertical
    from public.aml_fintech_entity e
    where e.fintech_id=new.subject_key;
    v_tier := public.aml_fintech_function_alignment_tier_v1(v_vertical,new.function_code);

    if v_tier='MISMATCH' then
      new.evidence_status := 'SIGNAL';
      new.confidence := least(coalesce(new.confidence,0.7),0.70);
      new.basis := coalesce(new.basis,'') || ' [Quality gate: función fuera de la vertical principal; se conserva sólo como señal hasta validación específica.]';
    elsif v_tier='ADJACENT' then
      if new.evidence_status='OBSERVED' then new.evidence_status := 'PROBABLE'; end if;
      new.confidence := least(coalesce(new.confidence,0.85),0.85);
      new.basis := coalesce(new.basis,'') || ' [Quality gate: función adyacente a la vertical; requiere evidencia específica para elevarse a observada.]';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_aml_fintech_function_quality_gate_v1 on public.aml_fintech_function_observation;
create trigger trg_aml_fintech_function_quality_gate_v1
before insert or update on public.aml_fintech_function_observation
for each row execute function public.aml_fintech_function_quality_gate_v1();

with q as (
  select o.observation_id,
         public.aml_fintech_function_alignment_tier_v1(e.primary_vertical,o.function_code) tier
  from public.aml_fintech_function_observation o
  join public.aml_fintech_entity e on e.fintech_id=o.subject_key and o.subject_type='ENTITY'
  where o.evidence_class='INFERRED_FROM_DECLARED'
    and o.observation_key ~ '^[0-9a-f]{32}$'
)
update public.aml_fintech_function_observation o
set evidence_status=case
      when q.tier='MISMATCH' then 'SIGNAL'
      when q.tier='ADJACENT' and o.evidence_status='OBSERVED' then 'PROBABLE'
      else o.evidence_status end,
    confidence=case
      when q.tier='MISMATCH' then least(o.confidence,0.70)
      when q.tier='ADJACENT' then least(o.confidence,0.85)
      else o.confidence end,
    basis=case
      when q.tier='MISMATCH' and position('[Quality gate:' in coalesce(o.basis,''))=0 then coalesce(o.basis,'')||' [Quality gate: función fuera de la vertical principal; se conserva sólo como señal hasta validación específica.]'
      when q.tier='ADJACENT' and position('[Quality gate:' in coalesce(o.basis,''))=0 then coalesce(o.basis,'')||' [Quality gate: función adyacente a la vertical; requiere evidencia específica para elevarse a observada.]'
      else o.basis end
from q where q.observation_id=o.observation_id;

with ranked as (
  select observation_id,
         row_number() over(
           partition by subject_type,subject_key,function_code,evidence_class,coalesce(source_url,''),evidence_status
           order by confidence desc,observed_at desc,observation_id desc
         ) rn
  from public.aml_fintech_function_observation
  where evidence_class='INFERRED_FROM_DECLARED'
    and observation_key ~ '^[0-9a-f]{32}$'
)
delete from public.aml_fintech_function_observation o
using ranked r
where o.observation_id=r.observation_id and r.rn>1;

delete from public.aml_fintech_public_footprint_assessment a
where not exists (
  select 1 from public.aml_fintech_function_observation o
  where o.subject_type='ENTITY' and o.subject_key=a.fintech_id
    and o.function_code=a.function_code
    and o.evidence_status in ('OBSERVED','PROBABLE')
);

select public.aml_fintech_refresh_functional_profile();

revoke all on function public.aml_fintech_function_alignment_tier_v1(text,text) from public,anon,authenticated;
revoke all on function public.aml_fintech_function_quality_gate_v1() from public,anon,authenticated;
grant execute on function public.aml_fintech_function_alignment_tier_v1(text,text) to service_role;
grant execute on function public.aml_fintech_function_quality_gate_v1() to service_role;