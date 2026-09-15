-- Entidad 360: elimina el recalculo global de IPA3/prensa en cada apertura.
-- La lógica se conserva, pero se acota por entity_id antes de resolver prensa,
-- reduciendo la consulta interactiva desde decenas de segundos a milisegundos.

create index if not exists aml_uaf_obligated_name_norm_ipa3_idx
on public.aml_uaf_obligated_subject_snapshot (
  public.obs_normalize_text(coalesce(entity_name, registry_name, rut))
);

create or replace function public.obs_ipa3_press_mark_for_entity(p_entity_id text)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
with subject_target as (
  select
    s.entity_id,
    s.rut,
    coalesce(nullif(btrim(s.entity_name),''), nullif(btrim(s.registry_name),''), s.rut) as entity_name,
    public.obs_normalize_text(coalesce(s.entity_name, s.registry_name, s.rut)) as canonical_name_norm
  from public.aml_uaf_obligated_subject_snapshot s
  where s.entity_id = p_entity_id
    and s.uaf_sector_canonical is distinct from 'Organismos públicos'
  limit 1
),
resolved_matches as (
  select
    l.press_entity_id,
    s.entity_id,
    s.rut,
    s.entity_name,
    greatest(coalesce(h.source_identity_confidence,0), least(1::numeric, coalesce(l.score,0)/100.0)) as identity_confidence,
    coalesce(h.normalized_name, public.obs_normalize_text(h.name)) as observed_name_norm,
    coalesce(h.aliases,'{}'::text[]) as aliases,
    case when l.match_method='RUT_EXACT' then 'RUT_EXACT'
         when l.is_manual then 'CURATED'
         else 'RESOLVED_STRICT' end as match_basis
  from subject_target s
  join public.atlas_press_entity_link l
    on l.canonical_entity_id=s.entity_id
  join public.atlas_press_entity_history h using (press_entity_id)
  where l.link_status='RESOLVED'
    and coalesce(l.ambiguous,false)=false
    and coalesce(l.requires_review,false)=false
    and (l.match_method='RUT_EXACT' or l.is_manual or coalesce(l.score,0)>=95)
),
exact_name_matches as (
  select
    h.press_entity_id,
    s.entity_id,
    s.rut,
    s.entity_name,
    h.source_identity_confidence as identity_confidence,
    coalesce(h.normalized_name, public.obs_normalize_text(h.name)) as observed_name_norm,
    coalesce(h.aliases,'{}'::text[]) as aliases,
    'LEGAL_NAME_EXACT'::text as match_basis
  from subject_target s
  join public.atlas_press_entity_history h
    on coalesce(h.normalized_name, public.obs_normalize_text(h.name))=s.canonical_name_norm
  where coalesce(h.source_identity_confidence,0)>=0.95
    and coalesce(h.requires_validation,false)=false
    and array_length(regexp_split_to_array(s.canonical_name_norm,'\s+'),1)>=3
    and (
      select count(*)
      from public.aml_uaf_obligated_subject_snapshot s2
      where s2.entity_id is not null
        and s2.uaf_sector_canonical is distinct from 'Organismos públicos'
        and public.obs_normalize_text(coalesce(s2.entity_name,s2.registry_name,s2.rut))=s.canonical_name_norm
    )=1
),
all_matches as (
  select * from resolved_matches
  union all
  select e.*
  from exact_name_matches e
  where not exists (
    select 1 from resolved_matches r
    where r.press_entity_id=e.press_entity_id and r.entity_id=e.entity_id
  )
),
dedup as (
  select distinct on (a.press_entity_id,a.entity_id)
    a.*,
    trim(regexp_replace(a.observed_name_norm,'\s+(spa|s a|sa|ltda|limitada|eirl)$','','i')) as core_name
  from all_matches a
  order by a.press_entity_id,a.entity_id,a.identity_confidence desc
),
identity_terms as (
  select
    d.*,
    (
      select tok
      from unnest(regexp_split_to_array(d.core_name,'\s+')) tok
      where length(tok)>=5
        and tok <> all(array[
          'banco','bancos','financiero','financiera','financieros','financieras',
          'administradora','administrador','general','fondos','fondo','inversion','inversiones',
          'asesoria','asesorias','sociedad','sociedades','grupo','holding','capital','credito','creditos',
          'chile','chilena','chileno','comercial','servicios','servicio','limitada','ltda','eirl','spa','agf','afip','liquidacion',
          'proyecto','proyectos','inmobiliario','inmobiliaria','inmobiliarios','inmobiliarias'
        ]::text[])
      order by length(tok) desc,tok
      limit 1
    ) as brand_token
  from dedup d
),
mention_evidence as (
  select
    d.*,
    m.mention_id,
    m.article_id,
    m.confidence as mention_confidence,
    a.article_date,
    a.media,
    a.title,
    a.summary,
    a.url,
    public.obs_normalize_text(a.title) as norm_title,
    public.obs_normalize_text(a.summary) as norm_summary,
    public.obs_normalize_text(concat_ws(' ',a.title,a.summary)) as article_text,
    public.obs_normalize_text(concat_ws(' ',m.role,array_to_string(m.roles,' '))) as role_text
  from identity_terms d
  join public.atlas_press_mention_history m
    on m.press_entity_id=d.press_entity_id
  join public.atlas_press_article_history a
    on a.article_id=m.article_id
  where coalesce(m.requires_validation,false)=false
    and coalesce(m.confidence,0)>=0.90
    and a.article_date>=current_date-90
),
classified as (
  select
    m.*,
    (
      (length(m.core_name)>=6 and position(m.core_name in m.norm_title)>0)
      or (m.brand_token is not null and position(' '||m.brand_token||' ' in ' '||m.norm_title||' ')>0)
      or exists (
        select 1
        from unnest(m.aliases) al
        cross join lateral (select public.obs_normalize_text(al) as alias_norm) x
        where length(x.alias_norm)>=6
          and (array_length(regexp_split_to_array(x.alias_norm,'\s+'),1)>=2 or length(x.alias_norm)>=10)
          and position(x.alias_norm in m.norm_title)>0
      )
    ) as title_identity_hit,
    m.article_text ~ '(lavado de activ|lavado de dinero|lavar dinero|blanqueo de capital|financiamiento del terrorismo)' as has_laft,
    m.article_text ~ '(narcotraf|trafico de drogas|crimen organizado|organizacion criminal|asociacion criminal|asociacion ilicita|cohecho|soborno|corrupcion|fraude|estafa|apropiacion indebida|administracion desleal|negociacion incompatible|secuestro extorsivo|extorsion|contrabando|malversacion|receptacion|trata de personas|trafico de armas|delito tributario|delitos tributarios|delito economico|delitos economicos)' as has_predicate,
    m.article_text ~ '(fiscalia|ministerio publico|tribunal|juzgado|formaliz|imputad|acusad|querell|investigad|detenid|condenad|prision preventiva|arresto domiciliario)' as has_official_action,
    m.role_text ~ '(investigad|imputad|formalizad|detenid|condenad|acusad|querellad|vinculad|ligad|involucrad|sociedad investigada|empresa investigada)' as adverse_role
  from mention_evidence m
),
qualified_articles as (
  select * from classified
  where title_identity_hit and (has_laft or has_predicate)
),
aggregated as (
  select
    entity_id,rut,entity_name,
    max(identity_confidence) as identity_confidence,
    max(mention_confidence) as mention_confidence,
    bool_or(has_laft) as has_laft,
    bool_or(has_predicate) as has_predicate,
    bool_or(has_official_action) as has_official_action,
    bool_or(adverse_role) as has_adverse_role,
    count(distinct article_id)::integer as article_count,
    count(distinct media)::integer as source_count,
    max(article_date) as event_at,
    (array_agg(title order by article_date desc,title))[1] as latest_title,
    (array_agg(summary order by article_date desc,title))[1] as latest_summary,
    (array_agg(media order by article_date desc,title))[1] as latest_source,
    (array_agg(url order by article_date desc,title))[1] as latest_url,
    string_agg(distinct match_basis,', ' order by match_basis) as match_basis
  from qualified_articles
  group by entity_id,rut,entity_name
),
eligible as (
  select
    a.*,
    least(a.identity_confidence,a.mention_confidence) as press_confidence,
    case when current_date-a.event_at<=30 then 1.00::numeric
         when current_date-a.event_at<=60 then 0.90::numeric
         else 0.80::numeric end as recency_factor,
    least(35::numeric,
      20::numeric
      + case when a.has_laft then 7 else 0 end
      + case when a.source_count>=2 then 4 else 0 end
      + case when a.has_official_action or a.has_adverse_role then 4 else 0 end
    ) as pre_decay_score
  from aggregated a
  where a.identity_confidence>=0.95
    and a.mention_confidence>=0.90
    and a.article_count>0
)
select jsonb_build_object(
  'entity_id',entity_id,
  'rut',rut,
  'entity_name',entity_name,
  'mark_id','P01',
  'mark_name','Prensa adversa material y atribuida',
  'semantic_class','EXTERNAL_ADVERSE_CONTEXT',
  'primary_dimension','EXTERNAL_EXPOSURE',
  'score_group','PRESS',
  'included_in_score',true,
  'raw_intensity',round(100::numeric*pre_decay_score/35.0,2),
  'standalone_cap',35::numeric,
  'contribution',round(pre_decay_score*recency_factor,2),
  'confidence',round(press_confidence,3),
  'readiness','ACTIVE',
  'event_at',event_at,
  'article_count',article_count,
  'source_count',source_count,
  'has_laft',has_laft,
  'has_predicate',has_predicate,
  'has_official_action',has_official_action,
  'latest_title',latest_title,
  'latest_summary',latest_summary,
  'latest_source',latest_source,
  'latest_url',latest_url,
  'match_basis',match_basis,
  'evidence',jsonb_strip_nulls(jsonb_build_object(
    'window_days',90,
    'identity_confidence_pct',round(identity_confidence*100,1),
    'mention_confidence_pct',round(mention_confidence*100,1),
    'recency_factor',recency_factor,
    'article_count',article_count,
    'source_count',source_count,
    'has_laft',has_laft,
    'has_predicate',has_predicate,
    'has_official_action',has_official_action,
    'latest_title',latest_title,
    'latest_source',latest_source,
    'latest_url',latest_url,
    'match_basis',match_basis
  )),
  'score_version','0.5-press-shadow'
)
from eligible
limit 1;
$$;

revoke all on function public.obs_ipa3_press_mark_for_entity(text) from public, anon, authenticated;
grant execute on function public.obs_ipa3_press_mark_for_entity(text) to service_role;

create or replace function public.obs_ipa3_entity_runtime(p_entity_id text)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
with b as (
  select *
  from public.aml_ipa3_entity_score_snapshot_v0_4
  where entity_id=p_entity_id
  limit 1
),
p as (
  select public.obs_ipa3_press_mark_for_entity(p_entity_id) as mark
),
ranked as (
  select
    g.group_name,g.group_score,g.driver_mark,
    row_number() over(order by g.group_score desc,
      case g.group_name when 'SANCTIONS' then 1 when 'PRESS' then 2 when 'ECONOMIC_TRAJECTORY' then 3 when 'REGISTRY' then 4 else 9 end
    ) as rn
  from b
  cross join p
  cross join lateral (values
    ('REGISTRY'::text,coalesce(b.registry_group_score,0::numeric),b.registry_driver_mark),
    ('ECONOMIC_TRAJECTORY'::text,coalesce(b.economic_group_score,0::numeric),b.economic_driver_mark),
    ('SANCTIONS'::text,coalesce(b.sanctions_group_score,0::numeric),b.sanctions_driver_mark),
    ('PRESS'::text,coalesce((p.mark->>'contribution')::numeric,0::numeric),case when coalesce((p.mark->>'contribution')::numeric,0)>0 then p.mark->>'mark_id' else null end)
  ) g(group_name,group_score,driver_mark)
),
o as (
  select
    max(group_score) filter(where rn=1) as g1,
    max(group_score) filter(where rn=2) as g2,
    max(group_score) filter(where rn=3) as g3,
    max(driver_mark) filter(where rn=1 and group_score>0) as dominant_mark_id_adjusted,
    count(*) filter(where group_score>0)::integer as independent_group_count_adjusted,
    coalesce(jsonb_agg(jsonb_build_object('rank',rn,'group',group_name,'score',round(group_score,2),'driver_mark',driver_mark) order by rn) filter(where group_score>0),'[]'::jsonb) as group_breakdown_adjusted
  from ranked
),
calc as (
  select
    case when coalesce((p.mark->>'contribution')::numeric,0)<=0 then b.ipa3_score
         else round(least(100::numeric,coalesce(o.g1,0)+0.25*coalesce(o.g2,0)+0.10*coalesce(o.g3,0)),2) end as adjusted_score,
    coalesce((p.mark->>'contribution')::numeric,0) as press_group_score
  from b cross join p cross join o
),
calc2 as (
  select c.*,
    case when c.press_group_score<=0 then b.priority_band_shadow
         when c.adjusted_score>=70 then 'MUY_ALTA'
         when c.adjusted_score>=55 then 'ALTA'
         when c.adjusted_score>=35 then 'MEDIA'
         when c.adjusted_score>0 then 'BAJA'
         else 'SIN_MARCA_SHADOW' end as adjusted_band
  from calc c cross join b
)
select jsonb_build_object(
  'priority',
    to_jsonb(b)
    || jsonb_build_object(
      'press_group_score',c.press_group_score,
      'press_driver_mark',case when c.press_group_score>0 then p.mark->>'mark_id' else null end,
      'press_confidence',case when p.mark is null then null else (p.mark->>'confidence')::numeric end,
      'press_event_at',p.mark->'event_at',
      'press_article_count',case when p.mark is null then null else (p.mark->>'article_count')::integer end,
      'press_source_count',case when p.mark is null then null else (p.mark->>'source_count')::integer end,
      'press_has_laft',case when p.mark is null then null else (p.mark->>'has_laft')::boolean end,
      'press_has_predicate',case when p.mark is null then null else (p.mark->>'has_predicate')::boolean end,
      'press_latest_title',p.mark->>'latest_title',
      'press_latest_source',p.mark->>'latest_source',
      'press_latest_url',p.mark->>'latest_url',
      'press_evidence',p.mark->'evidence',
      'ipa3_base_score',b.ipa3_score,
      'ipa3_score_adjusted',c.adjusted_score,
      'priority_band_adjusted',c.adjusted_band,
      'press_confidence_pct',case when p.mark is null then null else round((p.mark->>'confidence')::numeric*100,1) end,
      'dominant_mark_id_adjusted',o.dominant_mark_id_adjusted,
      'independent_group_count_adjusted',o.independent_group_count_adjusted,
      'group_breakdown_adjusted',o.group_breakdown_adjusted,
      'adjusted_score_version','0.5-press-shadow',
      'adjusted_semantics','PRIORIDAD_ANALITICA_NO_PROBABILIDAD_LAFT',
      'ipa3_score',c.adjusted_score,
      'priority_band_shadow',c.adjusted_band,
      'dominant_mark_id',coalesce(o.dominant_mark_id_adjusted,b.dominant_mark_id),
      'independent_group_count',o.independent_group_count_adjusted,
      'score_version','0.5-press-shadow',
      'semantics','PRIORIDAD_ANALITICA_NO_PROBABILIDAD_LAFT'
    ),
  'press_mark',p.mark,
  'ipa3_score',c.adjusted_score,
  'ipa3_band',c.adjusted_band
)
from b cross join p cross join o cross join calc2 c;
$$;

revoke all on function public.obs_ipa3_entity_runtime(text) from public, anon, authenticated;
grant execute on function public.obs_ipa3_entity_runtime(text) to service_role;

create or replace function public.obs_entity_detail(p_entity_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, atlas_v2_private, extensions
as $$
declare
  v_result jsonb;
  v_ipa3 jsonb;
  v_sanctions jsonb := '[]'::jsonb;
  v_sanction_count integer := 0;
  v_sanction_last timestamptz;
  v_coverage jsonb := '[]'::jsonb;
  v_sources jsonb := '[]'::jsonb;
  v_has_sanction_coverage boolean := false;
begin
  if not (
    auth.role() = 'service_role'
    or (
      auth.uid() is not null
      and exists (
        select 1
        from public.aml_allowed_users u
        where u.user_id = auth.uid()
          and u.enabled
      )
    )
  ) then
    raise exception 'ATLAS_CORE_FORBIDDEN' using errcode='42501';
  end if;

  v_result := public.obs_entity_detail_published(p_entity_id);

  if v_result is not null then
    v_ipa3 := public.obs_ipa3_entity_runtime(p_entity_id);

    if v_ipa3 is not null then
      v_result := jsonb_set(
        v_result,
        '{priority}',
        coalesce(v_ipa3->'priority', coalesce(v_result->'priority','null'::jsonb)),
        true
      );

      if v_ipa3->'press_mark' is not null and v_ipa3->'press_mark' <> 'null'::jsonb
         and coalesce((v_ipa3->'press_mark'->>'contribution')::numeric,0)>0 then
        v_result := jsonb_set(
          v_result,
          '{marks}',
          coalesce(v_result->'marks','[]'::jsonb) || jsonb_build_array(v_ipa3->'press_mark'),
          true
        );
      end if;

      v_result := jsonb_set(
        v_result,
        '{entity,ipa3_score}',
        coalesce(v_ipa3->'ipa3_score', coalesce(v_result #> '{entity,ipa3_score}','null'::jsonb)),
        true
      );
      v_result := jsonb_set(
        v_result,
        '{entity,ipa3_band}',
        coalesce(v_ipa3->'ipa3_band', coalesce(v_result #> '{entity,ipa3_band}','null'::jsonb)),
        true
      );
    end if;

    select
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'sanction_id', r.event_id,
            'event_date', r.event_date,
            'regulator', r.regulator,
            'subject', coalesce(s.subject, r.reason, r.event_kind),
            'identity_status', r.identity_status,
            'laft_direct', s.laft_direct,
            'amount_uf', r.amount_uf,
            'payload', coalesce(s.payload, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
              'event_kind', r.event_kind,
              'reason', r.reason,
              'event_class', r.event_class,
              'amount_clp', r.amount_clp
            )),
            'document_url', r.document_url,
            'document_quality', r.document_quality,
            'document_excerpt', r.document_excerpt,
            'resolution_ref', coalesce(r.resolution_ref, s.payload->'attributes'->>'resolution')
          )
          order by r.event_date desc nulls last, r.event_id
        ),
        '[]'::jsonb
      ),
      count(*)::integer,
      max(r.event_date)::timestamptz
    into v_sanctions, v_sanction_count, v_sanction_last
    from public.aml_v_sanctions_radiography_current_v0960 r
    left join public.aml_sanctions s
      on s.sanction_id = r.event_id
    where r.entity_id = p_entity_id;

    if v_sanction_count > 0 then
      v_result := jsonb_set(v_result, '{sanctions}', v_sanctions, true);
      v_result := jsonb_set(v_result, '{entity,is_sanctioned}', 'true'::jsonb, true);
      v_result := jsonb_set(v_result, '{entity,sanction_count}', to_jsonb(v_sanction_count), true);

      v_sources := coalesce(v_result #> '{entity,sources}', '[]'::jsonb);
      if not (v_sources @> '["RADAR_SANCIONES"]'::jsonb) then
        v_sources := v_sources || '["RADAR_SANCIONES"]'::jsonb;
        v_result := jsonb_set(v_result, '{entity,sources}', v_sources, true);
        v_result := jsonb_set(v_result, '{entity,source_count}', to_jsonb(jsonb_array_length(v_sources)), true);
      end if;

      select coalesce(
        jsonb_agg(
          case
            when item->>'source_code' = 'RADAR_SANCIONES' then
              item || jsonb_build_object(
                'status', 'PRESENT',
                'record_count', v_sanction_count,
                'last_event_at', v_sanction_last,
                'detail', coalesce(item->'detail', '{}'::jsonb) || jsonb_build_object(
                  'unidad', 'eventos sancionatorios',
                  'identity_basis', 'RADIOGRAPHY_RESOLVED_ENTITY'
                )
              )
            else item
          end
          order by ord
        ),
        '[]'::jsonb
      )
      into v_coverage
      from jsonb_array_elements(coalesce(v_result->'coverage', '[]'::jsonb))
           with ordinality as x(item, ord);

      select exists(
        select 1
        from jsonb_array_elements(v_coverage) c
        where c->>'source_code' = 'RADAR_SANCIONES'
      ) into v_has_sanction_coverage;

      if not v_has_sanction_coverage then
        v_coverage := v_coverage || jsonb_build_array(jsonb_build_object(
          'source_code', 'RADAR_SANCIONES',
          'source_name', 'Radar Sanciones · eventos regulatorios',
          'source_class', 'producer',
          'integration_mode', 'scheduled',
          'authoritative_source', 'CMF / UAF / SCJ / CGR',
          'source_data_status', 'fresh',
          'status', 'PRESENT',
          'record_count', v_sanction_count,
          'last_event_at', v_sanction_last,
          'detail', jsonb_build_object(
            'unidad', 'eventos sancionatorios',
            'identity_basis', 'RADIOGRAPHY_RESOLVED_ENTITY'
          )
        ));
      end if;

      v_result := jsonb_set(v_result, '{coverage}', v_coverage, true);
    end if;

    return v_result;
  end if;

  return atlas_v2_private.entity_detail_federated_core(p_entity_id);
end;
$$;

revoke all on function public.obs_entity_detail(text) from public, anon;
grant execute on function public.obs_entity_detail(text) to authenticated, service_role;
