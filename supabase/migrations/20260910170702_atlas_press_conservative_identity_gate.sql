-- ATLAS Observatorio · gate conservador para coincidencias de prensa.
-- RUT explícito y alias curados son autoritativos; nombres cortos o genéricos
-- permanecen en revisión y no se imputan automáticamente.

insert into public.atlas_press_entity_alias (
  alias_normalized, canonical_entity_id, canonical_rut, relationship_type, note
)
select public.obs_normalize_text(v.alias_name),u.entity_id,u.rut,v.relationship_type,v.note
from public.obs_uaf_subject u
cross join (values
  ('Sartor AGF','DIRECT','Alias periodístico validado para Sartor Administradora General de Fondos.'),
  ('Sartor AGF S.A','DIRECT','Alias periodístico validado para Sartor Administradora General de Fondos.'),
  ('Sartor Administradora General de Fondos','DIRECT','Razón social abreviada observada en prensa.'),
  ('Sartor Administradora General de Fondos S.A','DIRECT','Razón social observada en prensa.'),
  ('Sartor','GROUP_CONTEXT','Marca/grupo: contexto solamente; no imputar por sí solo a una sociedad específica.')
) as v(alias_name,relationship_type,note)
where u.rut='76576607-9'
on conflict (alias_normalized,canonical_entity_id,relationship_type) do update
set canonical_rut=excluded.canonical_rut,note=excluded.note,active=true,updated_at=now();

create or replace function public.atlas_press_reconcile()
returns integer
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_resolved integer;
begin
  -- Reevalúa matches automáticos en cada corrida, sin degradar RUT ni decisiones curadas.
  update public.atlas_press_entity_link
  set link_status='PROBABLE',match_method='IDENTITY_RESOLUTION_REVIEW',requires_review=true,refreshed_at=now()
  where not is_manual and match_method like 'IDENTITY_RESOLUTION_%';

  -- 1. RUT explícito de la fuente.
  insert into public.atlas_press_entity_link (
    press_entity_id,canonical_entity_id,canonical_rut,link_status,match_method,score,
    confidence_band,resolution_state,requires_review,ambiguous,evidence,is_manual,refreshed_at
  )
  select distinct pe.press_entity_id,u.entity_id,u.rut,'RESOLVED','RUT_EXACT',100,
    'AUTORITATIVA','RUT_EXACT',false,false,
    jsonb_build_object('rut_fuente',r.rut,'regla','RUT explícito del índice de prensa'),false,now()
  from public.atlas_press_entity_history pe
  cross join lateral unnest(pe.ruts) r(rut)
  join public.obs_uaf_subject u
    on u.rut_search=nullif(regexp_replace(upper(coalesce(r.rut,'')),'[^0-9K]','','g'),'')
  where nullif(btrim(r.rut),'') is not null
  on conflict (press_entity_id,canonical_entity_id) do update set
    canonical_rut=excluded.canonical_rut,link_status='RESOLVED',match_method='RUT_EXACT',score=100,
    confidence_band=excluded.confidence_band,resolution_state=excluded.resolution_state,
    requires_review=false,ambiguous=false,evidence=excluded.evidence,refreshed_at=now();

  -- 2. Alias curados: DIRECT cuenta, GROUP_CONTEXT no se imputa.
  insert into public.atlas_press_entity_link (
    press_entity_id,canonical_entity_id,canonical_rut,link_status,match_method,score,
    confidence_band,resolution_state,requires_review,ambiguous,evidence,is_manual,refreshed_at
  )
  select distinct pe.press_entity_id,a.canonical_entity_id,a.canonical_rut,
    case when a.relationship_type='DIRECT' then 'RESOLVED' else 'CONTEXT' end,
    case when a.relationship_type='DIRECT' then 'CURATED_ALIAS' else 'GROUP_ALIAS' end,
    case when a.relationship_type='DIRECT' then 100 else 70 end,'CURADA',a.relationship_type,
    a.relationship_type<>'DIRECT',false,jsonb_build_object('alias',a.alias_normalized,'nota',a.note),true,now()
  from public.atlas_press_entity_history pe
  join public.atlas_press_entity_alias a
    on a.active and (
      a.alias_normalized=coalesce(pe.normalized_name,public.obs_normalize_text(pe.name))
      or exists (
        select 1 from unnest(pe.aliases) pa(alias_name)
        where public.obs_normalize_text(pa.alias_name)=a.alias_normalized
      )
    )
  join public.obs_uaf_subject u on u.entity_id=a.canonical_entity_id
  on conflict (press_entity_id,canonical_entity_id) do update set
    canonical_rut=excluded.canonical_rut,link_status=excluded.link_status,match_method=excluded.match_method,
    score=excluded.score,confidence_band=excluded.confidence_band,resolution_state=excluded.resolution_state,
    requires_review=excluded.requires_review,ambiguous=false,evidence=excluded.evidence,is_manual=true,refreshed_at=now();

  -- 3. Nombre: promoción sólo con identidad muy alta y nombre suficientemente específico.
  insert into public.atlas_press_entity_link (
    press_entity_id,canonical_entity_id,canonical_rut,link_status,match_method,score,
    confidence_band,resolution_state,requires_review,ambiguous,evidence,is_manual,refreshed_at
  )
  select v.observed_entity_id,v.canonical_entity_id,v.canonical_rut,
    'RESOLVED','IDENTITY_RESOLUTION_STRICT',v.score,v.confidence_band,v.resolution_state,
    coalesce(v.requires_review,true),coalesce(v.ambiguous,false),
    v.evidence||jsonb_build_object('regla_atlas','exact_resolution_key + score>=95 + no_ambiguous + nombre_especifico'),
    false,now()
  from public.aml_v_entity_resolution_top_v1 v
  join public.atlas_press_entity_history pe on pe.press_entity_id=v.observed_entity_id
  join public.obs_uaf_subject u on u.entity_id=v.canonical_entity_id
  where v.score>=95
    and v.confidence_band='MUY_ALTA'
    and v.resolution_state='PROBABLE_MISMA_ENTIDAD'
    and coalesce(v.ambiguous,false)=false
    and coalesce((v.evidence->>'exact_resolution_key')::boolean,false)=true
    and coalesce(upper(pe.entity_type),'UNKNOWN') not in ('LOCATION','PLACE','GEO')
    and (
      array_length(regexp_split_to_array(public.obs_normalize_text(v.observed_name),'\s+'),1)>=3
      or public.obs_normalize_text(v.observed_name) ~ '(^| )(agf|banco|bank|spa|ltda|limitada)( |$)'
    )
  on conflict (press_entity_id,canonical_entity_id) do update set
    canonical_rut=excluded.canonical_rut,
    link_status=case when public.atlas_press_entity_link.match_method='RUT_EXACT' or public.atlas_press_entity_link.is_manual then public.atlas_press_entity_link.link_status else excluded.link_status end,
    match_method=case when public.atlas_press_entity_link.match_method='RUT_EXACT' or public.atlas_press_entity_link.is_manual then public.atlas_press_entity_link.match_method else excluded.match_method end,
    score=greatest(coalesce(public.atlas_press_entity_link.score,0),coalesce(excluded.score,0)),
    confidence_band=case when public.atlas_press_entity_link.match_method='RUT_EXACT' then public.atlas_press_entity_link.confidence_band else excluded.confidence_band end,
    resolution_state=case when public.atlas_press_entity_link.match_method='RUT_EXACT' then public.atlas_press_entity_link.resolution_state else excluded.resolution_state end,
    requires_review=case when public.atlas_press_entity_link.match_method='RUT_EXACT' then false else excluded.requires_review end,
    ambiguous=case when public.atlas_press_entity_link.match_method='RUT_EXACT' then false else excluded.ambiguous end,
    evidence=case when public.atlas_press_entity_link.match_method='RUT_EXACT' then public.atlas_press_entity_link.evidence else excluded.evidence end,
    refreshed_at=now();

  -- 4. Los candidatos no promovidos quedan visibles en la cola de revisión.
  insert into public.atlas_press_entity_link (
    press_entity_id,canonical_entity_id,canonical_rut,link_status,match_method,score,
    confidence_band,resolution_state,requires_review,ambiguous,evidence,is_manual,refreshed_at
  )
  select v.observed_entity_id,v.canonical_entity_id,v.canonical_rut,
    'PROBABLE','IDENTITY_RESOLUTION_REVIEW',v.score,v.confidence_band,v.resolution_state,true,
    coalesce(v.ambiguous,false),
    v.evidence||jsonb_build_object('regla_atlas','candidato no promovido; requiere revisión'),false,now()
  from public.aml_v_entity_resolution_top_v1 v
  join public.atlas_press_entity_history pe on pe.press_entity_id=v.observed_entity_id
  join public.obs_uaf_subject u on u.entity_id=v.canonical_entity_id
  where v.score>=55
  on conflict (press_entity_id,canonical_entity_id) do nothing;

  select count(*) into v_resolved from public.atlas_press_entity_link where link_status='RESOLVED';
  return v_resolved;
end;
$$;

select public.atlas_press_reconcile();
select public.atlas_press_apply_obs(null);
