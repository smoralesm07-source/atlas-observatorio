import { useMemo } from 'react';
import { useRpc } from '../lib/rpc';

type SearchRow = {
  fintech_id: string;
  rut: string | null;
  brand: string | null;
  legal_name: string;
};

type SearchData = { error?: string; total: number; rows: SearchRow[] };

type Cohort = {
  cohort_code: string;
  cohort_label: string;
  metric_count: number;
  function_count: number;
};

type Metric = {
  observation_id: number;
  metric_code: string;
  label: string;
  dimension: string;
  value_numeric: number | null;
  value_text: string | null;
  unit: string | null;
  currency: string | null;
  qualifier: string | null;
  geography: string | null;
  cohort_peer_count: number | null;
  cohort_peer_rank: number | null;
  cohort_percentile: number | null;
  cohort_tier: string | null;
  observed_at: string;
  sort_order: number;
};

type Regulation = {
  regulator: string;
  registry: string;
  service: string | null;
  status: string;
  registration_no: string | null;
  effective_date: string | null;
  end_date: string | null;
  source_url: string | null;
  observed_at: string;
};

type MarketDetail = {
  error?: string;
  subject_type: string;
  subject_key: string;
  cohort: Cohort | null;
  metrics: Metric[];
  regulation: Regulation[];
  note: string;
};

export function FintechEntityMarketPosition({ rut, label }: { rut: string | null; label: string | null }) {
  const query = rut || label || '';
  const search = useRpc<SearchData>('obs_fintech_search_v2', {
    p_q: query || null,
    p_region: null,
    p_vertical: null,
    p_model: null,
    p_source: null,
    p_regulator: 'TODOS',
    p_psav: 'TODOS',
    p_operating: 'TODOS',
    p_limit: 5,
    p_offset: 0,
  }, { skip: !query });

  const resolved = useMemo(() => {
    const rows = search.data?.rows ?? [];
    const normalizedLabel = normalize(label);
    return rows.find((row) => rut && normalizeRut(row.rut) === normalizeRut(rut))
      ?? rows.find((row) => normalizedLabel && (normalize(row.brand) === normalizedLabel || normalize(row.legal_name) === normalizedLabel))
      ?? rows[0]
      ?? null;
  }, [search.data?.rows, rut, label]);

  const detail = useRpc<MarketDetail>('obs_fintech_market_weight_detail', {
    p_subject_type: 'ENTITY',
    p_subject_key: resolved?.fintech_id ?? null,
  }, { skip: !resolved?.fintech_id });

  const metrics = useMemo(() => {
    const latest = new Map<string, Metric>();
    for (const row of detail.data?.metrics ?? []) {
      const current = latest.get(row.metric_code);
      if (!current || String(row.observed_at) > String(current.observed_at)) latest.set(row.metric_code, row);
    }
    return [...latest.values()]
      .sort((a,b) => {
        const ac = a.cohort_percentile != null ? 1 : 0;
        const bc = b.cohort_percentile != null ? 1 : 0;
        if (ac !== bc) return bc-ac;
        return (a.sort_order ?? 999) - (b.sort_order ?? 999);
      })
      .slice(0,5);
  }, [detail.data?.metrics]);

  if (!query || search.loading || detail.loading) return <div className="fintech-entity-market-card compact-loading">Calculando posición relativa…</div>;
  if (search.error || detail.error || !resolved || detail.data?.error) return null;
  const cohort = detail.data?.cohort;
  if (!cohort || !metrics.length) return null;
  const regulation = detail.data?.regulation ?? [];

  return <div className="fintech-entity-market-card">
    <div className="fintech-entity-market-head">
      <div><span>Posición observable</span><b>{cohort.cohort_label}</b></div>
      <small>{metrics.filter((m) => m.cohort_percentile != null).length}/{metrics.length} métricas comparables</small>
    </div>
    <div className="fintech-entity-market-metrics">
      {metrics.map((row) => <div key={row.metric_code}>
        <span><b>{shortLabel(row.metric_code,row.label)}</b><small>{geoLabel(row.geography)}</small></span>
        <strong>{formatValue(row)}</strong>
        <em data-comparable={row.cohort_percentile != null}>
          {row.cohort_percentile != null
            ? `P${Math.round(row.cohort_percentile*100)} · ${row.cohort_peer_rank}/${row.cohort_peer_count}`
            : `${row.cohort_peer_count ?? 0} pares · insuf.`}
        </em>
      </div>)}
    </div>
    {regulation.length > 0 && <p><b>Huella regulatoria:</b> {regulation.map(formatRegulation).join(' · ')}</p>}
    <p>Comparación dentro de la misma cohorte y métrica. Regulación y tamaño se informan por separado; no es cuota de mercado ni un score compuesto.</p>
  </div>;
}

function normalize(value:string|null|undefined) { return (value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase(); }
function normalizeRut(value:string|null|undefined) { return (value ?? '').replace(/[^0-9kK]/g,'').toUpperCase(); }
function compact(value:number) { return new Intl.NumberFormat('es-CL',{notation:'compact',maximumFractionDigits:1}).format(value); }
function formatValue(row:Metric) {
  if (row.value_numeric == null) return row.value_text ?? 'n/d';
  if (row.currency==='USD' || row.unit==='USD') return `USD ${compact(row.value_numeric)}`;
  const suffix:Record<string,string>={rank:' tramo',workers:' trab.',users:' usuarios',clients:' clientes',companies:' empresas',merchants:' comercios',insured_persons:' asegurados',downloads:' descargas',transactions:' tx',verifications:' verificaciones',financings:' financiamientos',projects:' proyectos',institutions:' instituciones',sources:' fuentes',countries:' países',payment_methods:' medios',connections:' API',agreements:' acuerdos',providers:' prestadores',policies:' pólizas'};
  return `${compact(row.value_numeric)}${suffix[row.unit ?? ''] ?? (row.unit ? ` ${row.unit}` : '')}`;
}
function shortLabel(code:string,label:string) {
  const map:Record<string,string>={SII_SALES_BAND_RANK:'Ventas SII',WORKERS:'Trabajadores',USERS:'Usuarios',CLIENTS:'Clientes',BUSINESS_CLIENTS:'Clientes empresa',MERCHANTS:'Comercios',INSURED_PERSONS:'Asegurados',APP_DOWNLOADS_COUNT:'Descargas app',TRANSACTIONS_MONTHLY_COUNT:'Tx / mes',TRANSACTIONS_QUARTERLY_COUNT:'Tx / trimestre',TRANSACTIONS_ANNUAL_COUNT:'Tx / año',VERIFICATIONS_24H_COUNT:'Verificaciones / 24h',FINANCINGS_COUNT:'Financiamientos',PROJECTS_FINANCED_COUNT:'Proyectos financiados',PROCESSED_VOLUME_MONTHLY_USD:'Volumen / mes',PROCESSED_VOLUME_PERIOD_USD:'Volumen del período',ANNUAL_TRANSACTION_VOLUME_USD:'Volumen anual',ANNUALIZED_TRANSACTION_VOLUME_USD_EST:'Volumen anualizado',CUMULATIVE_TRANSACTION_VOLUME_USD:'Volumen acumulado',TPV_USD:'TPV',ORIGINATED_VOLUME_USD:'Originación',AUM_AUC_USD:'AUM / AUC',FINANCIAL_INSTITUTIONS_CONNECTED_COUNT:'Instituciones conectadas',DATA_SOURCES_CONNECTED_COUNT:'Fuentes conectadas',COUNTRIES_SERVICE_REACH:'Alcance países',COUNTRIES_OPERATING:'Países operando',PAYMENT_METHODS_COUNT:'Métodos de pago',API_CONNECTIONS:'Conexiones API',AGREEMENTS_COUNT:'Acuerdos',HEALTH_PROVIDERS_NETWORK:'Prestadores'};
  return map[code] ?? label;
}
function geoLabel(value:string|null) {
  if (!value) return 'alcance n/d';
  return ({CHILE:'Chile',LATAM:'LatAm',GLOBAL:'Global',INTERNATIONAL:'Internacional',COMPANY_WIDE:'Empresa',AMERICAS:'Américas'} as Record<string,string>)[value] ?? value;
}
function formatRegulation(row:Regulation) {
  if (row.regulator === 'CMF') return row.registration_no ? `CMF ${row.registry} N° ${row.registration_no}` : `CMF ${row.registry}`;
  if (row.regulator === 'UAF') return row.status === 'INSCRITO_PUBLICADO' ? 'UAF · inscrito publicado' : `UAF · ${row.status}`;
  return `${row.regulator} ${row.registry}`;
}
