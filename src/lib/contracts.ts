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
  /* Perfil tributario del SII. Existe para 45.433 de las 50.516 entidades: una
     entidad sin estos campos no es una entidad sin actividad, es una que el
     corte tributario no alcanza. */
  tax_status: string | null;
  tax_activity: string | null;
  tax_region: string | null;
  tax_activity_start: string | null;
  tax_termination: string | null;
  tax_sales_band_rank: number | null;
  tax_sales_band_uf: string | null;
  tax_size: string | null;
  tax_workers: number | null;
  tax_economic_sector: string | null;
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
  detail: {
    basis?: string;
    event_titles?: string[];
    /** Rótulo del recuento. Sin esto la ficha diría "eventos" a lo que son
     *  órdenes de compra o señales de ejecución. */
    unidad?: string;
    roles?: string[];
    alcance?: string;
    monto_12m_clp?: number;
    monto_clp?: number;
    altas?: number;
    prioridad_revision?: number;
  };
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
    /** URL a la resolución tal como la publica el regulador. */
    document_url: string | null;
    /** VALID, PARTIAL, UNKNOWN u OFFICIAL_CGR_URL. Un documento PARTIAL puede
     *  cubrir más de un acto sancionatorio. */
    document_quality: string | null;
    document_excerpt: string | null;
    resolution_ref: string | null;
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
  tax: TaxProfile | null;
  res: ResProfile | null;
  lifecycle: LifecycleMilestone[];
  lifecycle_notes: LifecycleNotes;
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
  /** El corte publica sólo parte del universo de esta fuente: la cobertura
   *  mide nuestro recorte, no la fuente, y la ausencia no acredita ausencia. */
  scope_partial: boolean;
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
  /** Corte comunal completo (0014): lo que el mapa pinta. Se une por CUT con la
   *  geometría estática, que no trae puntajes. */
  comunas?: TerritoryCommune[];
  semantics: string;
}

export interface TerritoryCommune {
  commune_code: string | null;
  territory_id: string;
  region_code: string | null;
  region_name: string;
  commune_name: string;
  igr_score: number | null;
  igr_level: string | null;
  igr_confidence: number | null;
  ctx_entities: number;
  ctx_uaf_observed: number;
  ctx_sanctioned: number;
  ctx_alerted: number;
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

/* ─────────────────────────────────────── gasto público y compras */

export interface SpendOverview {
  contract: 'ATLAS_OBS_SPEND_V1';
  disponible: boolean;
  corte: {
    snapshot_id: string;
    source_snapshot_id: string | null;
    generated_at: string | null;
    period_start: string | null;
    period_end: string | null;
    window_months: number | null;
    amount_total_clp: number | null;
    order_count: number | null;
    buyer_count: number | null;
    supplier_count: number | null;
    pair_count: number | null;
    signal_count: number | null;
    universe: Record<string, number>;
    readiness: {
      hypothesis_id: string; title: string; family: string;
      status: 'AVAILABLE' | 'PARTIAL' | 'REQUIRES_SOURCE';
      explanation: string;
      required_sources: string[]; available_sources: string[];
    }[];
    ingested: Record<string, unknown>;
  } | null;
  familias: {
    family: string; hallazgos: number; urgentes: number;
    materialidad_mm: number | null; prioridad_media: number | null;
  }[];
  severidades: { severity_band: string; hallazgos: number }[];
  cobertura: {
    proveedores: number; proveedores_en_universo: number; proveedores_con_nombre: number;
    compradores: number; compradores_en_universo: number; compradores_con_nombre: number;
  };
  presupuesto: {
    source_code: string; señales: number; con_entidad: number;
    monto_mm: number | null; altas: number;
  }[];
  top: SpendFinding[];
  semantics: string;
}

export interface SpendFinding {
  finding_id: string;
  family: string;
  finding_type: string;
  severity_band: string;
  review_priority: number | null;
  materiality_clp: number | null;
  title: string | null;
  summary: string | null;
  supplier_id: string | null;
  buyer_id: string | null;
  pair_id: string | null;
  supplier_label?: string | null;
  buyer_label?: string | null;
  supplier_entity_id?: string | null;
  buyer_entity_id?: string | null;
  total_count?: number;
}

export interface SpendActorDetail {
  contract: 'ATLAS_OBS_SPEND_ACTOR_V1';
  actor: {
    actor_id: string; actor_role: 'BUYER' | 'SUPPLIER'; label: string | null;
    entity_id: string | null; amount_12m: number | null;
    order_count_12m: number | null; counterpart_count: number | null;
    top_counterpart_id: string | null; top_counterpart_share: number | null;
    hhi: number | null; concentration_percentile: number | null;
    materiality_percentile: number | null; growth_ratio: number | null;
    growth_percentile: number | null; active_months: number | null;
    first_seen: string | null; last_seen: string | null;
    review_priority: number | null;
  };
  contrapartes: {
    pair_id: string; buyer_id: string; supplier_id: string;
    buyer_label: string | null; supplier_label: string | null;
    buyer_entity_id: string | null; supplier_entity_id: string | null;
    amount_12m: number | null; order_count_12m: number | null;
    buyer_share: number | null; supplier_share: number | null;
    active_months: number | null; acceleration_ratio: number | null;
    acceleration_percentile: number | null; price_signal_count: number | null;
    convergence_count: number | null; review_priority: number | null;
    flags: unknown[];
  }[];
  hallazgos: SpendFinding[];
  semantics: string;
}

/* ---------------------------------------------------------------- Pulso UAF

   El Pulso caracteriza el padron de sujetos obligados y su reportabilidad.
   Su eje temporal interno es el ciclo de vida ante el SII, porque no existe
   fecha de inscripcion UAF en ninguna fuente; su lectura territorial es
   contexto comunal —el IGR describe donde opera el sujeto, nunca al sujeto—;
   y su lectura de reportabilidad es SECTORIAL y agregada, porque no existe
   ROS por sujeto en ninguna fuente disponible. */

export type UafCohort =
  | 'TODOS' | 'ACTIVO' | 'TERMINO_GIRO' | 'SIN_PERFIL_SII'
  | 'OSFL' | 'PROVEEDOR_ESTADO' | 'SANCIONADO' | 'PRENSA' | 'CON_SENAL'
  | 'IGR_ALTO' | 'IGR_MUY_ALTO'
  | 'REGION' | 'SECTOR' | 'INDUSTRIA' | 'TERMINO_ANO'
  | 'ATENCION' | 'MOTIVO' | 'IPF_ALTO' | 'GIRO_ATIPICO'
  | 'CAMBIO_ACTIVIDAD' | 'SIN_TERRITORIO' | 'SECTOR_SIN_ROS';

/** Motivo de revisión de mayor precedencia. Ordena trabajo; no imputa nada. */
export type UafMotive =
  | 'SANCION_RECIENTE' | 'SANCION_HISTORICA' | 'TERMINO_GIRO' | 'IPF_ALTA'
  | 'SECTOR_SIN_ROS' | 'GIRO_ATIPICO' | 'SIN_TERRITORIO';

export interface UafAttentionRow {
  rut: string;
  entity_id: string | null;
  name: string;
  uaf_sector: string | null;
  economic_sector: string | null;
  main_activity: string | null;
  region: string | null;
  commune: string | null;
  igr_level: string | null;
  sii_status: string | null;
  sii_termination_date: string | null;
  motivo: UafMotive;
  orden: number;
  ipf_score: number | null;
  ipf_band: string | null;
  sanction_evidence_count: number;
  sanction_last_date: string | null;
  press_evidence_count: number;
  alert_count: number;
  activity_atypicality: number | null;
  is_state_supplier: boolean;
  workers: number | null;
  sales_band: string | null;
}

export interface UafReportingSector {
  sector_official: string;
  /** Nulo = categoría canónica de la ley sin ningún inscrito en el padrón. */
  sector_canonical: string | null;
  etiqueta: string;
  /** Padrón operativo vigente (30-06-2026). */
  padron_sujetos: number | null;
  sancionados: number | null;
  en_atencion: number | null;
  ipf_medio: number | null;
  /** Padrón del Informe Estadístico (31-12-2025). Otro corte, otro número. */
  registered_so_2025: number | null;
  ros_2021: number | null;
  ros_2022: number | null;
  ros_2023: number | null;
  ros_2024: number | null;
  ros_2025: number | null;
  ros_total_2021_2025: number | null;
  ros_per_100_so_2025: number | null;
  delta_ros_2025_vs_2024_pct: number | null;
  /** Verdadero: con inscritos y cero ROS 2021-2025. Nulo: no aplica. */
  silence_5y: boolean | null;
  indicios_total_2021_2025: number | null;
  /** ROS con indicios LA/FT sobre ROS enviados, 2021-2025. */
  icr_pct: number | null;
  has_conversion: boolean;
}

export interface UafNationalSeries {
  puntos: { periodo: string; valor: number | null }[];
  unidad: string | null;
  categoria: string | null;
  fuente: string | null;
  corte: string | null;
}

/**
 * Gatillante ACTECO: un codigo del SII cuya presencia caracteriza empiricamente
 * a un sector obligado. La correspondencia se mide sobre los propios inscritos,
 * no se escribe a mano.
 */
export interface UafScreeningActeco {
  acteco: string;
  glosa: string;
  /** RUT del SII con este codigo que no figuran en el padron UAF. Exacto por codigo. */
  universo: number | null;
  sii_total: number | null;
  inscritos_con_codigo: number | null;
  /** Fraccion de inscritos del sector que declara el codigo (0..1). */
  cobertura_max: number | null;
  pureza_max: number | null;
  lift_max: number | null;
  /** BAJO | MEDIO | ALTO. Un codigo amplio arrastra entidades ajenas al sector. */
  riesgo: string | null;
  /** Un mismo codigo puede caracterizar a mas de un sector. */
  sectores: string[];
}

/** Brecha por sector: padron inscrito contra universo observable en el SII. */
export interface UafScreeningSector {
  etiqueta: string;
  uaf_sector: string | null;
  inscritos: number | null;
  /** Suma de los universos de sus gatillantes. Bruta: un RUT con dos giros cuenta dos veces. */
  universo_bruto: number | null;
  gatillantes: number;
  cobertura_max: number | null;
  riesgo: string | null;
  actecos: string[];
}

/** Sector cuyo universo potencial no se puede construir desde ACTECO. */
export interface UafScreeningMode {
  uaf_sector: string;
  mode: 'ACTECO' | 'REGISTRO_EXTERNO' | 'NO_EVALUABLE_SII_PJ';
  external_source: string | null;
  note: string | null;
  inscritos: number;
}

export interface UafPulse {
  contract: 'ATLAS_OBS_UAF_PULSE_V3';
  snapshot: {
    snapshot_id: string;
    generated_at: string;
    published_at: string | null;
    status: string;
  } | null;
  universe: {
    total: number;
    activos: number;
    terminados: number;
    sin_perfil: number;
    con_inicio: number;
    juridicas: number;
    naturales: number;
    organismos: number;
    con_territorio: number;
    regiones: number;
    sectores_uaf: number;
    industrias: number;
    antiguedad_media: number | null;
    con_ipf: number;
    ipf_medio: number | null;
    ipf_p90: number | null;
    ipf_alto: number;
    giro_atipico: number;
    cambio_actividad: number;
    cambio_region: number;
    estructura_amplia: number;
    trabajadores: number | null;
    en_atencion: number;
  } | null;
  crosscuts: {
    osfl: number;
    proveedores: number;
    /** Lo que el padron atribuye. */
    sancionados_padron: number;
    /** Lo que el analista puede abrir y leer. Mide otra cosa. */
    sancionados_con_antecedente: number;
    sancionados_5y: number;
    prensa: number;
    con_senal: number;
    senales_totales: number;
    antecedentes_sancion: number;
    antecedentes_prensa: number;
  } | null;
  ipf_bands: { banda: string; sujetos: number; ipf_medio: number | null }[];
  attention: {
    total: number;
    motivos: { motivo: UafMotive; orden: number; sujetos: number; con_ipf_alto: number }[];
    top: UafAttentionRow[];
  };
  lifecycle: {
    terminated_by_year: { ano: number; n: number }[];
    started_by_year: { ano: number; n: number }[];
  };
  sanctions: {
    by_year: { ano: number; eventos: number; sujetos: number; monto_uf: number | null; con_documento: number }[];
    eventos: number;
    con_documento: number;
    monto_uf: number | null;
    ultimo: string | null;
  };
  reporting: {
    disponible: boolean;
    corte: {
      periodo: string;
      padron_referencia: number;
      padron_referencia_corte: string;
      fuente: string;
      fuente_url: string;
    };
    nacional: Record<string, UafNationalSeries>;
    sectores: UafReportingSector[];
    totales: {
      ros_2025: number | null;
      ros_5y: number | null;
      indicios_5y: number | null;
      ros_2025_max: number | null;
      sectores_silenciosos: number;
      sectores_sin_inscritos: number;
      sujetos_en_silencio: number;
      ros_top3: number;
    } | null;
  };
  screening: {
    disponible: boolean;
    corte: {
      sii_periodo: string;
      sii_dataset: string;
      uaf_corte: string;
      /** Linea base declarada por Radar_SII, no materializada RUT a RUT aqui. */
      universo_declarado: number;
      universo_estado: string;
      universo_nota: string;
      fuente: string;
      fuente_url: string;
    };
    totales: {
      gatillantes: number;
      sectores: number;
      universo_bruto: number | null;
      universo_top4: number | null;
      universo_riesgo_alto: number | null;
      inscritos_cubiertos: number;
      sectores_otro_modo: number;
      sujetos_otro_modo: number;
      padron_total: number;
      gatillantes_b: number;
    } | null;
    actecos: UafScreeningActeco[];
    sectores: UafScreeningSector[];
    modos: UafScreeningMode[];
    semantics: string;
  };
  by_region: {
    region: string;
    sujetos: number;
    terminados: number;
    sancionados: number;
    proveedores: number;
    en_atencion: number;
    igr_medio: number | null;
    igr_banda: string | null;
    en_igr_muy_alto: number;
    en_igr_alto: number;
  }[];
  by_sector: {
    sector: string;
    sujetos: number;
    terminados: number;
    sancionados: number;
    en_atencion: number;
    ipf_medio: number | null;
  }[];
  by_industry: {
    industria: string;
    sujetos: number;
    terminados: number;
    sancionados: number;
    banda_ventas_media: number | null;
  }[];
  igr_mix: { banda: string; sujetos: number; igr_medio: number | null }[];
  coverage: {
    supplier_capped: boolean;
    supplier_cap_note: string;
    press_has_links: boolean;
    press_note: string;
    sanction_note: string;
    uaf_registration_date: boolean;
    uaf_registration_note: string;
    reporting_level: string;
    reporting_note: string;
    silence_note: string;
    denominator_note: string;
  };
  semantics: string;
}

export interface UafSubjectRow {
  rut: string;
  entity_id: string | null;
  name: string;
  subject_nature: string | null;
  uaf_sector: string | null;
  sii_status: string | null;
  sii_activity_start_date: string | null;
  sii_termination_date: string | null;
  activity_years: number | null;
  economic_sector: string | null;
  main_activity: string | null;
  sales_band: string | null;
  workers: number | null;
  region: string | null;
  commune: string | null;
  igr_score: number | null;
  igr_level: string | null;
  is_osfl: boolean;
  is_state_supplier: boolean;
  supplier_amount_12m: number | null;
  sanction_count: number;
  sanction_evidence_count: number;
  sanction_last_date: string | null;
  has_press: boolean;
  press_evidence_count: number;
  alert_count: number;
  ipf_score: number | null;
  ipf_band: string | null;
  /** Motivo de mayor precedencia por el que el sujeto entra a revision. */
  attention_motive: UafMotive | null;
  /** Posicion del IPF dentro del padron completo, 0..100. */
  ipf_percentile: number | null;
  evidence_count: number;
  total_count: number;
}

/** La ficha devuelve la fila completa del sujeto, no la proyeccion de la lista:
 *  trae los campos que explican POR QUE el indice quedo donde quedo. */
export interface UafDossierSubject extends UafSubjectRow {
  entity_type: string | null;
  economic_subsector: string | null;
  territory_basis: string | null;
  sales_band_rank: number | null;
  termination_year: number | null;
  sanction_count_5y: number;
  supplier_order_count: number | null;
  ipa3_score: number | null;
  ipa3_band: string | null;
  /** Cuan infrecuente es su giro entre los pares del sector, 0..1. */
  activity_atypicality: number | null;
  /** Fraccion del sector que declara el mismo giro, 0..1. */
  activity_peer_share: number | null;
  sii_activity_changed: boolean | null;
  sii_region_changed: boolean | null;
  sii_signal_count: number | null;
  ownership_edge_count: number | null;
  /** Cuanto del IPF se calculo con datos presentes: un 40 % es un indice
   *  sostenido por poco, y la ficha lo dice junto al numero. */
  ipf_credibility_pct: number | null;
  attention_rank: number | null;
  /** Rango en UF resuelto desde el ordinal del SII. El tramo 1 es ausencia de
   *  informacion, no ventas cero. */
  sales_band_uf: string | null;
  sales_band_size: string | null;
  snapshot_id: string | null;
  refreshed_at: string | null;
}

/** Referencia del sector obligado al que pertenece el sujeto. Ausente cuando el
 *  sector tiene un solo inscrito: no hay mediana de la que hablar. */
export interface UafDossierPeers {
  sector: string | null;
  sujetos: number;
  con_ipf: number;
  ipf_mediana: number | null;
  ipf_p90: number | null;
  antiguedad_mediana: number | null;
  ventas_rank_mediana: number | null;
  ventas_rank_max: number | null;
  sancionados: number;
  terminados: number;
  en_atencion: number;
}

/** Posicion del sujeto dentro de su sector, en percentil sobre los pares que
 *  tienen la medida. Nula cuando el sector no da para comparar. */
export interface UafDossierPosition {
  ipf_percentil_sector: number | null;
  antiguedad_percentil_sector: number | null;
}

export interface UafEvidenceRow {
  kind: 'SANCION' | 'PRENSA';
  event_date: string | null;
  source_label: string | null;
  headline: string | null;
  summary: string | null;
  amount_uf: number | null;
  amount_clp: number | null;
  document_url: string | null;
  /** Falso en prensa: el productor no entrega URL y la ficha lo dice. */
  has_link: boolean;
  identity_status: string | null;
}

export interface UafDossier {
  contract: 'ATLAS_OBS_UAF_DOSSIER_V2';
  subject: UafDossierSubject | null;
  evidence: UafEvidenceRow[];
  peers: UafDossierPeers | null;
  position: UafDossierPosition | null;
  semantics: string;
}

/* ------------------------------------------ perfil tributario y ciclo de vida

   Lo primero que mira un analista sobre una entidad: desde cuándo existe, a qué
   se dedica, dónde tributa, de qué tamaño es y si sigue operando. */

export interface TaxProfile {
  commercial_year: number | null;
  current_status: string | null;
  activity_start_date: string | null;
  termination_date: string | null;
  first_activity_registration_date: string | null;
  region: string | null;
  province: string | null;
  commune: string | null;
  main_activity: string | null;
  economic_sector: string | null;
  economic_subsector: string | null;
  activity_count: number | null;
  activity_codes: string | null;
  activity_names: string | null;
  sales_band: string | null;
  sales_band_rank: number | null;
  /** Rango en UF anuales. El tramo más bajo es ausencia de dato, no cero. */
  sales_band_uf: string | null;
  size_label: string | null;
  workers_numeric: number | null;
  taxpayer_type: string | null;
  society_type: string | null;
  ownership_edge_count: number | null;
  legal_entity_partner_count: number | null;
  societies_as_partner_count: number | null;
  address_count: number | null;
  current_address_count: number | null;
  signal_count: number | null;
  signal_types: string | null;
  updated_at: string | null;
}

export interface ResProfile {
  constitution_date: string | null;
  company_age_days: number | null;
  observed_lifecycle_state: string | null;
  actuation_count: number | null;
  modification_count: number | null;
  transformation_count: number | null;
  merger_count: number | null;
  division_count: number | null;
  dissolution_count: number | null;
  last_change_date: string | null;
  relationship_count: number | null;
  coverage_note: string | null;
  capital: number | null;
  registry_date: string | null;
}

export type LifecycleKind = 'CONSTITUCION_RES' | 'INICIO_ACTIVIDADES' | 'TERMINO_GIRO';

export interface LifecycleMilestone {
  kind: LifecycleKind;
  fecha: string;
  etiqueta: string;
  fuente: string;
  detalle: string | null;
}

export interface LifecycleNotes {
  uaf_registration_date: boolean;
  uaf_registration_note: string;
  uaf_observed_at: string | null;
  res_coverage_note: string;
  sales_band_note: string;
  sanction_document_note: string;
}
