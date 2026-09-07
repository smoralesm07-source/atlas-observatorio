/* Shapes returned by the obs_* read contracts. A screen consumes a contract,
   never a table, so these types are the application boundary. */

export type SourceStatus = 'PRESENT' | 'ABSENT' | 'NOT_CONSULTED' | 'ERROR';
export type Priority = 'MUY ALTA' | 'ALTA' | 'MEDIA' | 'OBSERVAR' | string;

export interface Snapshot {
  snapshot_id: string;
  generated_at: string;
  status: string;
  row_counts: Record<string, number>;
  published_at: string | null;
}

export interface Pulse {
  contract: 'ATLAS_OBS_PULSE_V1';
  snapshot: Snapshot | null;
  universe: {
    entities: number;
    uaf_observed: number;
    sanctioned: number;
    multi_source: number;
    with_alerts: number;
    regions: number;
  } | null;
  alerts: {
    total: number;
    by_priority: { priority: string; n: number; avg_strength: number | null }[];
    by_family: { family: string; n: number; peak: number | null; urgent: number }[];
    top: AlertRow[];
  };
  findings: {
    total: number;
    by_type: { finding_type: string; n: number; avg_investigate: number | null }[];
  };
  sources: {
    source_class: string;
    n: number;
    fresh: number;
    silent: number;
    unknown: number;
  }[];
  territory: {
    region: string;
    entities: number;
    sanctioned: number;
    alerted: number;
    avg_priority: number | null;
  }[];
  semantics: string;
}

export interface AlertRow {
  alert_id: string;
  family: string;
  pattern_type: string;
  scope_type: string;
  scope_id: string | null;
  scope_label: string | null;
  strength: number | null;
  priority: Priority | null;
  title: string | null;
  summary: string | null;
  payload?: Record<string, unknown>;
  entity_ref?: {
    entity_id: string;
    rut: string | null;
    name: string;
    region: string | null;
    source_count: number;
    ipa3_score: number | null;
  } | null;
  total_count?: number;
}

export interface EntityRow {
  entity_id: string;
  rut: string | null;
  name: string;
  entity_type: string | null;
  region: string | null;
  commune: string | null;
  source_count: number;
  sources: string[];
  roles: string[];
  is_uaf_observed: boolean;
  is_sanctioned: boolean;
  uaf_sector: string | null;
  ipa3_score: number | null;
  ipa3_band: string | null;
  event_count: number;
  finding_count: number;
  alert_count: number;
  sanction_count: number;
  match_kind: string;
  match_rank: number;
  total_count: number;
}

export interface CoverageRow {
  source_code: string;
  source_name: string;
  source_class: string;
  integration_mode: string | null;
  authoritative_source: string | null;
  source_data_status: string | null;
  status: SourceStatus;
  record_count: number | null;
  last_event_at: string | null;
  detail: { basis?: string; event_titles?: string[] };
}

export interface EntityEvent {
  tipo: string | null;
  tipo_es: string | null;
  fecha: string | null;
  titulo: string | null;
  event_id: string | null;
  productor: string | null;
}

export interface EntityDetail {
  contract: 'ATLAS_OBS_ENTITY_V1';
  entity: EntityRow & { refreshed_at: string; snapshot_id: string };
  identity: {
    method: string | null;
    confidence: number | null;
    territory: Record<string, unknown> | null;
  };
  events: EntityEvent[];
  context: Record<string, unknown>;
  coverage: CoverageRow[];
  findings: {
    finding_key: string;
    finding_id: string | null;
    finding_type: string;
    title: string | null;
    region: string | null;
    commune: string | null;
    score_explore: number | null;
    score_supervise: number | null;
    score_investigate: number | null;
    source_count: number | null;
    evidence_count: number | null;
    payload: Record<string, unknown>;
  }[];
  alerts: AlertRow[];
  sanctions: {
    sanction_id: string;
    event_date: string | null;
    regulator: string | null;
    subject: string | null;
    identity_status: string | null;
    laft_direct: boolean | null;
    amount_uf: number | null;
    payload: Record<string, unknown>;
  }[];
  marks: {
    mark_id: string;
    mark_name: string | null;
    semantic_class: string | null;
    primary_dimension: string | null;
    score_group: string | null;
    included_in_score: boolean | null;
    raw_intensity: number | null;
    contribution: number | null;
    confidence: number | null;
    readiness: string | null;
    evidence: Record<string, unknown>;
  }[];
  priority: {
    ipa3_score: number | null;
    priority_band_shadow: string | null;
    score_confidence_pct: number | null;
    coverage_index_pct: number | null;
    dominant_mark_id: string | null;
    included_mark_count: number | null;
    independent_group_count: number | null;
    registry_group_score: number | null;
    economic_group_score: number | null;
    sanctions_group_score: number | null;
    reconciliation_status: string | null;
    score_as_of: string | null;
    score_version: string | null;
    semantics: string | null;
  } | null;
  uaf: Record<string, unknown> | null;
  osfl: Record<string, unknown> | null;
  peers: {
    commercial_year: number;
    peer_level: string | null;
    peer_n: number | null;
    sales_peer_percentile: number | null;
    sales_band_code: string | null;
    sales_band_delta: number | null;
    workforce_ratio: number | null;
    economic_sector: string | null;
    main_activity_changed: boolean | null;
    region_changed: boolean | null;
  }[];
  links: {
    relacion_id: string;
    entidad_origen_id: string;
    entidad_destino_id: string;
    tipo_relacion: string | null;
    estado_relacion: string | null;
    metodo_relacion: string | null;
    confianza: number | null;
    utilizable_en_analisis: boolean | null;
    requiere_revision: boolean | null;
  }[];
  semantics: string;
}

export interface SourceStatusRow {
  source_code: string;
  source_name: string;
  source_class: string;
  integration_mode: string | null;
  authoritative_source: string | null;
  software_status: string | null;
  data_status: string | null;
  last_source_record_at: string | null;
  last_successful_ingest_at: string | null;
  records_24h: number | null;
  error_rate_24h: number | null;
  notes: string | null;
  entity_coverage: number;
  coverage_share: number | null;
}

/* ──────────────────────────────────────────────────────── territorio */

export interface IgrComponent {
  id: string;
  label: string;
  configured_weight: number;
  score: number;
  value?: number;
  intensity?: number;
  persistence?: number;
  trend?: number;
  anomaly?: number;
  years_observed?: number;
}

export interface IgrLayer {
  label: string;
  configured_weight: number;
  score: number;
  coverage: number;
  components: IgrComponent[];
}

export interface TerritoryRow {
  territory_id: string;
  region_code: string | null;
  region_name: string;
  commune_code: string | null;
  commune_name: string;
  year: number | null;
  period: string | null;
  igr_score: number | null;
  igr_level: string | null;
  igr_confidence: number | null;
  layer_weights: Record<string, number>;
  layers: Record<string, IgrLayer>;
  interpretation: string | null;
  score_version: string | null;
  ctx_entities: number;
  ctx_uaf_observed: number;
  ctx_sanctioned: number;
  ctx_alerted: number;
  ctx_findings: number;
  snapshot_id: string;
  refreshed_at: string;
}

export interface TerritoryMap {
  contract: 'ATLAS_OBS_TERRITORY_V1';
  metodologia: {
    indicador: string;
    version: string;
    vigente_desde: string;
    formula: string;
    capas: Record<string, number>;
    caracterizacion: Record<string, number>;
    unidad_base: string;
    agregacion_regional: string;
    cobertura_delitos_base: {
      estado: string;
      materializadas: string[];
      no_materializadas: string[];
    };
    excluido_del_indice: string[];
  };
  cobertura: {
    comunas: number;
    con_universo: number;
    confianza_media: number | null;
    baja_confianza: number;
    anio: number | null;
  };
  regiones: {
    region_name: string;
    comunas: number;
    igr_ponderado: number | null;
    confianza_media: number | null;
    igr_max: number | null;
    ctx_entities: number;
    ctx_uaf: number;
    ctx_sancionadas: number;
    ctx_con_senal: number;
  }[];
  niveles: { igr_level: string; comunas: number }[];
  comunas_top: {
    territory_id: string;
    region_name: string;
    commune_name: string;
    commune_code: string | null;
    igr_score: number | null;
    igr_level: string | null;
    igr_confidence: number | null;
    ctx_entities: number;
    ctx_uaf_observed: number;
    ctx_sanctioned: number;
  }[];
  semantics: string;
}

export interface TerritoryDetail {
  contract: 'ATLAS_OBS_TERRITORY_DETAIL_V1';
  territorio: TerritoryRow;
  posicion: {
    igr_region: number | null;
    comunas_region: number;
    posicion_en_region: number;
    posicion_nacional: number;
    comunas_pais: number;
  };
  entidades: {
    entity_id: string; rut: string | null; name: string;
    entity_type: string | null; uaf_sector: string | null;
    is_uaf_observed: boolean; is_sanctioned: boolean;
    ipa3_score: number | null; source_count: number;
    alert_count: number; finding_count: number;
  }[];
  sectores: { uaf_sector: string; n: number }[];
  semantics: string;
}

/* ─────────────────────────────────────────────────────────── sector */

export interface SectorRow {
  uaf_sector_canonical: string;
  uaf_sector_id: number | null;
  subject_count: number;
  natural_person_subjects: number | null;
  vulnerability_index: number | null;
  risk_inherent_1_5: number | null;
  key_role: string | null;
  ipf_mean: number | null;
  ipf_p90: number | null;
  band_muy_alta: number | null;
  band_alta: number | null;
  band_media: number | null;
  band_baja: number | null;
  band_minima: number | null;
  sanctioned_subjects: number | null;
  sanction_events: number | null;
  sanction_rate_per_100: number | null;
  sii_active: number | null;
  sii_terminated: number | null;
  sii_absent: number | null;
  sii_coverage_pct: number | null;
  atypical_activity_subjects: number | null;
  median_sales_band_rank: number | null;
  top_region: string | null;
  top_region_share_pct: number | null;
  activities?: {
    activity_name: string;
    registered_count: number;
    universe_count: number;
    concentration: number;
    sector_support: number | null;
    coherence: number | null;
  }[];
}

export interface SectorOverview {
  contract: 'ATLAS_OBS_SECTOR_V1';
  metodologia: {
    vulnerabilidad: string;
    ipf: string;
    tasa_sancionatoria: string;
    irar_e: { estado: string; formula: string; nota: string };
  };
  totales: {
    sectores: number;
    inscritos: number;
    sancionados: number;
    eventos: number;
    vulnerabilidad_media: number | null;
    cobertura_sii_media: number | null;
  };
  sectores: SectorRow[];
  semantics: string;
}

export interface SectorDetail {
  contract: 'ATLAS_OBS_SECTOR_DETAIL_V1';
  sector: SectorRow;
  comparacion: {
    vulnerabilidad_media: number | null;
    ipf_medio: number | null;
    tasa_media: number | null;
    sectores: number;
  };
  territorio: { region: string; n: number; sancionadas: number }[];
  entidades: {
    entity_id: string; rut: string | null; name: string;
    region: string | null; commune: string | null;
    is_sanctioned: boolean; ipa3_score: number | null; ipa3_band: string | null;
    source_count: number; alert_count: number; finding_count: number;
  }[];
  semantics: string;
}
