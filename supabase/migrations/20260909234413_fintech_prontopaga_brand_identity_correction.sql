insert into public.aml_fintech_identity_correction_audit(
  old_fintech_id,old_rut,old_legal_name,old_brand,
  new_fintech_id,new_rut,new_legal_name,new_brand,
  reason,evidence_source_code,evidence_url,metadata
)
select e.fintech_id,e.rut,e.legal_name,e.brand,
       e.fintech_id,e.rut,e.legal_name,'ProntoPaga',
       'La razón social UAF/SII se conserva como identidad jurídica; la marca comercial pública acreditada es ProntoPaga y debe usarse en lectura de mercado.',
       'COMPANY_OFFICIAL','https://www2.prontopaga.com/home-chile-es/',
       jsonb_build_object('correction_scope','DISPLAY_BRAND_ONLY','legal_identity_preserved',true)
from public.aml_fintech_entity e
where e.fintech_id='ENT-RUT-77066914-6'
  and e.brand is distinct from 'ProntoPaga'
  and not exists (
    select 1 from public.aml_fintech_identity_correction_audit a
    where a.new_fintech_id=e.fintech_id and a.new_brand='ProntoPaga'
      and a.reason like 'La razón social UAF/SII%'
  );

update public.aml_fintech_entity
set brand='ProntoPaga',refreshed_at=now()
where fintech_id='ENT-RUT-77066914-6' and brand is distinct from 'ProntoPaga';
