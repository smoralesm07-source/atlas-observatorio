/* Contrato del corte `radar.snapshot.v1`. Lo escribe collectors/radar/run.py.
   Es el mismo objeto que expondrá el contrato RPC al integrarse con ATLAS. */

export type SourceStatus = 'FRESH' | 'ARCHIVE' | 'DEGRADED' | 'UNREACHABLE' | 'NOT_CONSULTED';
export type Scope = 'CL' | 'LATAM' | 'GLOBAL';

export interface Economy {
  label: string;
  laft: string;
  rail: string;
}

export interface Source {
  code: string;
  name: string;
  economy: string;
  kind: 'api' | 'feed' | 'catalog' | 'curated' | 'pending';
  url: string | null;
  authority: string;
  legal: 0 | 1 | 2;
  does_not: string;
  status: SourceStatus;
  consulted_at: string;
  records_in: number;
  records_kept: number;
  error: string | null;
  note: string | null;
  content_sha256: string | null;
}

export interface RadarEvent {
  id: string;
  economy: string;
  source_code: string;
  event_type: string;
  title: string;
  scope: Scope;
  observed_at: string;
  event_date: string | null;
  actor: string | null;
  target: Record<string, unknown>;
  chile_link: { reason: string; confidence: 'alta' | 'media' | 'baja'; domains?: string[] } | null;
  evidence: { source_url?: string | null; indicator?: string };
  attributes: Record<string, unknown>;
  first_seen: string;
  carried_from?: string;
}

export interface EcosystemCategory {
  category: string;
  total: number;
  active: number;
  inactive: number;
  unknown: number;
  active_by_kind?: Record<string, number>;
  error?: string;
}

export interface Snapshot {
  schema: string;
  snapshot_id: string;
  generated_at: string;
  previous_snapshot_id: string | null;
  economies: Record<string, Economy>;
  sources: Source[];
  indicators: {
    by_economy: Record<string, { total: number; cl: number; new: number; by_scope: Partial<Record<Scope, number>> }>;
    ransomware: { victims_cl: number; by_year: Record<string, number>; top_groups: [string, number][]; by_confidence?: Record<string, number> };
    phishing: { domains: number; by_brand: [string, number][]; by_kind: Record<string, number> };
    breaches: { breaches_cl: number; accounts_cl: number } | null;
    ofac_crypto: { addresses_total: number; by_chain: Record<string, number> } | null;
    ecosystem: { categories: EcosystemCategory[] } | null;
  };
  events: RadarEvent[];
  new_event_ids: string[];
}
