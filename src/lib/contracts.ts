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
